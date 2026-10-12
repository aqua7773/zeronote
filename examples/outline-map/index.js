/**
 * 大纲 · 导图 —— ZeroNote 的**第一个功能插件**。
 *
 * 做三件事：
 *   ① 把当前笔记的 **标题 + 列表** 解析成一棵树（大纲）；
 *   ② 按经典"横向树"布局把它画成 **SVG 思维导图**（左大纲 / 右导图 / 并排三视图）；
 *   ③ 一键把导图导出成 **Mermaid `mindmap`** 插进笔记 —— 这是"与生态兼容"的那一半：
 *      mermaid 是通行的文本图格式，别的工具（Typora / Obsidian / 网页 mermaid）都认。
 *
 * ## 三条设计取舍（写下来免得下次重新纠结）
 *
 * **① 为什么用 `html` 节点自己画 SVG，而不是接 markmap？**
 *    markmap 是成熟的"大纲 → 导图"库，但它的交互式渲染要**真 DOM + 脚本**：
 *    `markmap-view` 靠 d3 直接操作一个挂载点，而我们的 `html` 节点是
 *    `dangerouslySetInnerHTML` 注入的静态内容 —— **没有地方跑脚本**
 *    （生产构建里 Tauri 会给 `script-src` 注入打包资源的 sha256，届时内联脚本一律被拦）。
 *    要走 markmap 就得开 webview 逃生口（独立 origin 的页面），而那条路在 Android 上
 *    不服务 `.html`。结论：**自算布局 + 静态 SVG**，零依赖、离线可用、跟随主题，
 *    代价是导图不做缩放/折叠（要交互就得换渲染层，届时再评估）。
 *
 * **② 为什么每次 render 都重新解析？**
 *    `render` 按契约是**纯函数**，而插件拿不到"这一页被打开了"的事件。
 *    解析 + 布局 + 拼字符串对几千行笔记也就几毫秒，所以干脆不缓存：
 *    切笔记、改内容之后面板一刷新就跟上，也不会出现"面板里是上一篇的大纲"。
 *
 * **③ 颜色为什么全用 `var(--zn-*)`？**
 *    SVG 是内联进宿主 DOM 的，所以宿主主题变量直接生效 —— 换主题（含暗色）导图跟着变，
 *    插件一行颜色都不用写死。样式塞在一个 `<style>` 里（CSP 的 `style-src` 带
 *    `'unsafe-inline'` 且没有 hash ⇒ 有效），类名统一 `om-` 前缀，避免污染全局。
 */

const PANEL_ID = 'outline-map.panel'
const BIND_VIEW = 'outline-map.view'

/* ───────────────── ① 解析：Markdown → 树 ───────────────── */

const FENCE_RE = /^\s*(?:```|~~~)/
const ATX_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
/** 列表项：缩进 + 标记（`-` `*` `+` `1.` `1)`）+ 内容 */
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
/** 列表层级接在 6 级标题之后 —— 这样"标题下挂列表"天然成立，不用额外规则 */
const LIST_BASE = 7
/** 两个空格算一级（Tab 先展开成两个空格） */
const INDENT_UNIT = 2

/** 去掉行内标记，只留人看的文字（`**粗**` → 粗、`[文字](url)` → 文字、图片 → alt） */
const stripInline = (s) =>
  String(s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1')
    .trim()

/**
 * 解析成树。用"层级栈"处理**任意跳跃**的层级（H1 → H3、缩进从 0 跳到 4 都不会错）：
 * 新节点的父 = 栈里**最后一个层级更小**的节点。
 */
function parseOutline(md) {
  const root = { text: '', level: 0, children: [] }
  const stack = [root]
  let inFence = false
  let firstH1 = ''

  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (FENCE_RE.test(line)) {
      inFence = !inFence // 代码块里的 `# 注释`、`- 参数` 不是大纲，别当标题收进来
      continue
    }
    if (inFence || !line.trim()) continue

    const atx = ATX_RE.exec(line)
    const li = LIST_RE.exec(line)
    let level
    let text
    if (atx) {
      level = atx[1].length
      text = stripInline(atx[2])
    } else if (li) {
      const indent = li[1].replace(/\t/g, '  ').length
      level = LIST_BASE + Math.floor(indent / INDENT_UNIT)
      text = stripInline(li[2])
    } else {
      continue
    }
    if (!text) continue

    const node = { text, level, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop()
    stack[stack.length - 1].children.push(node)
    stack.push(node)
    if (!firstH1 && atx && atx[1].length === 1) firstH1 = text
  }

  // 文档是**单个 H1 打头**时，把它提升为根 —— 否则根节点和它内容重复
  // （根显示「绪论」，底下又挂一个「绪论」，导图上会看到两层一样的框）。
  if (root.children.length === 1 && root.children[0].text === firstH1) {
    const top = root.children[0]
    root.text = top.text
    root.children = top.children
  }

  return { root, firstH1 }
}

/** 摊平成缩进列表（`depth` 从 0 起，根不出现） */
function flatten(root) {
  const out = []
  const walk = (n, depth) => {
    if (n !== root) out.push({ text: n.text, depth })
    for (const c of n.children) walk(c, depth + (n === root ? 0 : 1))
  }
  walk(root, 0)
  return out
}

/* ───────────────── ② 布局 + SVG ───────────────── */

const FS = 13 // 字号
const NODE_H = 28
const PAD_X = 10
const GAP_X = 46 // 层间距
const GAP_Y = 8 // 同层相邻节点的缝
const MIN_W = 56

/** 全角/宽字符按 1 个字号宽估、其余按 0.56 —— 只为排版，不追求像素级精确 */
const WIDE_RE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
const textWidth = (s) => [...String(s)].reduce((w, ch) => w + (WIDE_RE.test(ch) ? 1 : 0.56), 0) * FS

/**
 * 经典横向树布局：
 *  · 层级 → 横坐标（每层宽度取该层最宽节点 + 层间距）
 *  · 叶子按出现顺序各占一个纵向槽位；父节点纵向居中于它的子节点之间
 * 复杂度 O(n)，几百个节点的导图也是瞬时的。
 */
function layout(root) {
  const levels = []
  const nodes = []
  const walkLevels = (n, d) => {
    n.depth = d
    ;(levels[d] || (levels[d] = [])).push(n)
    nodes.push(n)
    for (const c of n.children) walkLevels(c, d + 1)
  }
  walkLevels(root, 0)

  for (const n of nodes) n.w = Math.max(MIN_W, Math.round(textWidth(n.text)) + PAD_X * 2)
  const levelW = levels.map((ns) => Math.max(...ns.map((n) => n.w)))
  const levelX = []
  let acc = 0
  levelW.forEach((w, d) => {
    levelX[d] = acc
    acc += w + GAP_X
  })

  let slot = 0
  const place = (n) => {
    if (!n.children.length) {
      n.y = slot * (NODE_H + GAP_Y) + NODE_H / 2
      slot += 1
    } else {
      n.children.forEach(place)
      n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2
    }
    n.x = levelX[n.depth]
  }
  place(root)

  return {
    nodes,
    width: Math.max(MIN_W, acc - GAP_X),
    height: Math.max(NODE_H, slot * (NODE_H + GAP_Y) - GAP_Y),
  }
}

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

function toSvg(root) {
  const { nodes, width, height } = layout(root)
  const W = Math.round(width)
  const H = Math.round(height)
  const out = []

  // 颜色全部走宿主变量 ⇒ 亮/暗主题自动跟随；类名统一 om- 前缀避免污染
  out.push(
    `<style>.om-svg{font-family:var(--zn-font);display:block}` +
      `.om-link{fill:none;stroke:var(--zn-border);stroke-width:1.4}` +
      `.om-box{fill:var(--zn-bg-subtle);stroke:var(--zn-border)}` +
      `.om-root>.om-box{fill:var(--zn-accent);stroke:var(--zn-accent)}` +
      `.om-t{font-size:${FS}px;fill:var(--zn-fg)}` +
      `.om-root>.om-t{fill:#fff;font-weight:600}</style>`,
  )
  out.push(
    `<svg class="om-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
      `width="${W}" height="${H}" role="img" aria-label="思维导图">`,
  )

  for (const n of nodes) {
    for (const c of n.children) {
      const x1 = n.x + n.w
      const mx = (x1 + c.x) / 2
      out.push(
        `<path class="om-link" d="M${x1} ${n.y} C${mx} ${n.y} ${mx} ${c.y} ${c.x} ${c.y}"/>`,
      )
    }
  }
  for (const n of nodes) {
    out.push(`<g class="${n.depth === 0 ? 'om-root' : ''}">`)
    out.push(
      `<rect class="om-box" x="${n.x}" y="${(n.y - NODE_H / 2).toFixed(1)}" ` +
        `width="${n.w}" height="${NODE_H}" rx="6"/>`,
    )
    out.push(
      `<text class="om-t" x="${(n.x + n.w / 2).toFixed(1)}" ` +
        `y="${(n.y + FS * 0.35).toFixed(1)}" text-anchor="middle">${esc(n.text)}</text>`,
    )
    out.push('</g>')
  }
  out.push('</svg>')
  return out.join('')
}

/* ───────────────── ③ 导出：Mermaid mindmap ───────────────── */

/**
 * mermaid 的 mindmap 节点文本：纯中英数 + 空格可以直接写，
 * 含标点（`(`、`[]`、`:` …）必须用 `["..."]` 包起来，否则语法报错。
 */
const mermaidLabel = (s) => {
  const t = String(s).replace(/[\r\n]+/g, ' ').trim() || '（空）'
  return /^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 -]*$/.test(t) ? t : `["${t.replace(/"/g, "'")}"]`
}

function toMermaid(root, rootLabel) {
  const out = ['mindmap']
  out.push(`  root((${mermaidLabel(rootLabel)}))`)
  const walk = (n, depth) => {
    for (const c of n.children) {
      out.push(`${'  '.repeat(depth + 2)}${mermaidLabel(c.text)}`)
      walk(c, depth + 1)
    }
  }
  walk(root, 0)
  return out.join('\n')
}

/* ───────────────── 面板 ───────────────── */

const INDENT = '　' // 全角空格：UINode 的 list 没有缩进字段，用它做视觉层级

export default {
  apply(ctx) {
    const { doc, command, view, host, subscriptions } = ctx

    /** 此刻的展示数据。**不缓存**：每次 render 现算（见文件头取舍②） */
    function snapshot() {
      const note = doc.active()
      if (!note) return { note: null, flat: [], svg: '', mermaid: '', label: '' }
      const { root, firstH1 } = parseOutline(note.content)
      const flat = flatten(root)
      if (!flat.length) return { note, flat, svg: '', mermaid: '', label: '' }
      const fileName = String(note.path).split('/').pop().replace(/\.(md|markdown)$/i, '')
      const label = firstH1 || fileName
      root.text = label
      return { note, flat, svg: toSvg(root), mermaid: toMermaid(root, label), label }
    }

    function render() {
      const { note, flat, svg } = snapshot()

      if (!note) {
        return {
          type: 'stack',
          gap: 'md',
          children: [
            { type: 'text', value: '大纲 · 导图', variant: 'title' },
            { type: 'divider' },
            {
              type: 'text',
              value: '先打开一篇笔记 —— 这个插件读的是**当前打开的那一篇**。',
              variant: 'caption',
            },
          ],
        }
      }

      if (!flat.length) {
        return {
          type: 'stack',
          gap: 'md',
          children: [
            { type: 'text', value: '大纲 · 导图', variant: 'title' },
            { type: 'text', value: note.path, variant: 'caption' },
            { type: 'divider' },
            {
              type: 'text',
              value:
                '这篇里没有可用的层级：写几个 `# 标题`，或用 `- 列表` 缩进两级，' +
                '导图就会长出来。（代码块里的 `#` 不算）',
              variant: 'caption',
            },
          ],
        }
      }

      const maxDepth = flat.reduce((m, r) => Math.max(m, r.depth), 0) + 1
      const outlineNode = {
        type: 'list',
        empty: '没有标题或列表',
        items: flat.map((r, i) => ({
          key: `o${i}`,
          node: {
            type: 'text',
            // 全角空格缩进 = 层级；list 没有缩进字段
            value: `${INDENT.repeat(r.depth)}${r.text}`,
            variant: r.depth === 0 ? 'body' : 'caption',
          },
        })),
      }
      const mapNode = { type: 'html', value: svg }

      return {
        type: 'stack',
        gap: 'md',
        children: [
          {
            type: 'row',
            gap: 'sm',
            align: 'center',
            wrap: true,
            children: [
              { type: 'text', value: '大纲 · 导图', variant: 'title' },
              { type: 'badge', text: `${flat.length} 项 · ${maxDepth} 级`, tone: 'muted' },
              {
                type: 'button',
                label: '重新解析',
                variant: 'ghost',
                onClick: 'outline-map.refresh',
              },
              {
                type: 'button',
                label: '插入 Mermaid',
                variant: 'ghost',
                onClick: 'outline-map.insert-mermaid',
              },
            ],
          },
          { type: 'text', value: note.path, variant: 'caption' },
          { type: 'divider' },
          {
            type: 'tabs',
            bind: BIND_VIEW,
            tabs: [
              {
                key: 'both',
                label: '并排',
                node: {
                  type: 'row',
                  gap: 'lg',
                  align: 'start',
                  children: [outlineNode, mapNode],
                },
              },
              { key: 'outline', label: '大纲', node: outlineNode },
              { key: 'map', label: '导图', node: mapNode },
            ],
          },
        ],
      }
    }

    subscriptions.push(
      command.register({
        id: 'outline-map.refresh',
        title: '大纲：重新解析当前笔记',
        run: () => view.refresh(PANEL_ID),
      }),
      command.register({
        id: 'outline-map.insert-mermaid',
        title: '大纲：把导图插入笔记（Mermaid mindmap）',
        run: async () => {
          const { note, mermaid } = snapshot()
          if (!note) {
            host.notify('先打开一篇笔记', 'warn')
            return
          }
          if (!mermaid) {
            host.notify('这篇里没有标题或列表，导不出导图', 'warn')
            return
          }
          try {
            // 插在光标处，前后留空行 —— 免得和上下文粘成一段
            await doc.insertAtCursor(`\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`)
            host.notify('已插入 Mermaid mindmap（Typora / Obsidian 都能渲染）')
          } catch (e) {
            host.notify(`插入失败：${String(e)}`, 'error')
          }
        },
      }),
      view.registerPanel({
        id: PANEL_ID,
        title: '大纲 · 导图',
        location: 'main',
        render,
      }),
    )

    host.log('info', '大纲 · 导图插件就绪（标题 + 列表 → SVG / Mermaid）')
  },
}

/**
 * 纯函数导出 —— 给 `selftest.mjs` **离线**验证解析/布局/导出用。
 * 宿主只取 `default`，多这几行导出不影响加载；好处是核心逻辑不必开 GUI 就能测
 * （也就没有"抢用户鼠标"的风险）。
 */
export { parseOutline, flatten, toSvg, toMermaid }
