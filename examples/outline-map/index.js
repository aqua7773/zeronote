/**
 * 大纲 · 导图 v0.2（2026-10-13 rev52）—— 第一个功能插件，重做成"**导图在独立窗口**"。
 *
 * ## 分工（一次架构纠偏：不再指望"与编辑器同屏"）
 *
 * ```
 *   主区「大纲 · 导图」面板                        独立窗口（U1）
 *   ┌──────────────────────────────┐             ┌──────────────────────────────┐
 *   │ 项目计划   3 项      ❖ 导图  │  ──点击──▶  │ 项目计划        3 项          │
 *   │  • 调研                      │             │  ┌── 静态 SVG（只读大图）──┐  │
 *   │  • 设计                      │             │  └────────────────────────┘  │
 *   │ 另一组     2 项      ❖ 导图  │             │  • 调研          ＋  ✕       │
 *   │  • 排期                      │             │    • 竞品        ＋  ✕       │
 *   └──────────────────────────────┘             │    • 用户        ＋  ✕       │
 *                                                └──────────────────────────────┘
 * ```
 *
 * **关键取舍：编辑走 `fs` 写库文件，不走 `doc.replaceRange`。**
 *
 * 一开始想把大纲放侧栏（"与编辑器同屏"才有编辑器可改），但实测发现内核里
 * **`location: 'sidebar'` 的面板其实渲染在主区**（右侧栏早已取消，见 `App.tsx` 的注释）——
 * 主区被面板占满时编辑器卸载，`doc.replaceRange` 会静默 no-op。
 *
 * 而导图本来就在**独立窗口**里，那个 webview 里**没有编辑器**可言。
 * ⇒ 那就别绕：插件直接 `fs.readText` 读、改完 `fs.writeText` 写回（内核的原子写、库内路径校验都还在）。
 * 好处是**两边（主区面板 / 独立窗口）用同一套编辑逻辑**，不依赖编辑器是否挂载。
 *
 * ⚠️ **已知边界（诚实写下来）**：如果这篇笔记正开在编辑器里且**有未保存的手改**，
 * 插件写盘的东西可能被稍后的自动保存覆盖（用户手写优先——这个方向是对的）。
 * 反向也成立：插件写盘后，编辑器里显示的还是旧内容，切走再回来才会重读。
 *
 * ## 其它取舍（v0.1 沿用）
 * · 自算布局 + **静态 SVG**：`html` 节点是静态注入、跑不了脚本（生产 CSP 会拦内联脚本），
 *   所以 SVG 里放不了按钮 —— 编辑按钮一律用**声明式 UINode**，与图并列放在窗口下半部。
 * · 颜色全用 `var(--zn-*)`：SVG 内联进宿主 DOM，换主题自动跟随。
 * · `render` 是同步纯函数 ⇒ 数据放在**闭包缓存**里（读盘是异步的，只在 open/change/编辑后刷新）。
 */
/** 独立窗口的面板 id 前缀：`outline-map.map-<组序号>` */
const MAP_PREFIX = 'outline-map.map-'
/** 窗口与主区面板共用的"当前笔记"键（窗口是独立上下文，只能靠 store 交换这点信息） */
const STORE_LAST = 'lastNote'

/* ───────────────── ① 解析：Markdown → 树 ───────────────── */

const FENCE_RE = /^\s*(?:```|~~~)/
const ATX_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
/** 列表项：缩进 + 标记（`-` `*` `+` `1.` `1)`）+ 内容 */
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
/** 列表层级接在 6 级标题之后 —— 这样"标题下挂列表"天然成立，不用额外规则 */
const LIST_BASE = 7
/** 两个空格算一级（Tab 先展开成两个空格） */
const INDENT_UNIT = 2

/** 去掉行内标记，只留人看的文字 */
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

const indentOf = (s) => String(s).replace(/\t/g, '  ').length

/** 解析成整篇的树（v0.1 的老路，保留：selftest 的既有入口） */
function parseOutline(md) {
  const root = { text: '', level: 0, children: [] }
  const stack = [root]
  let inFence = false
  let firstH1 = ''

  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (FENCE_RE.test(line)) {
      inFence = !inFence
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
      level = LIST_BASE + Math.floor(indentOf(li[1]) / INDENT_UNIT)
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

/**
 * **v0.2 的核心解析：按"极大连通的列表块"分组**（用户规则 3/4），并且**带行号**。
 *
 * 连通性：**空行 / 标题 / 非列表行都断开一个块** ⇒"一组连续的 `- ` 行"就是一个块；
 * 块名 = 它上方最近的标题（没有 ⇒ `中心主题`）。
 * 行号是编辑的前提：改哪一行、删到哪一行，全按行号算（改完**整篇写回**）。
 */
function parseBlocks(md) {
  const lines = String(md ?? '').split(/\r?\n/)
  const blocks = []
  let cur = null
  let lastHeading = ''
  /** 最近标题的**行号**（-1 = 文档开头还没有标题）—— 行首按钮要按它定位 */
  let lastHeadingLine = -1
  let inFence = false
  const stack = []

  const closeBlock = () => {
    if (cur && cur.nodes.length) blocks.push(cur)
    cur = null
    stack.length = 0
  }

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      closeBlock()
      return
    }
    if (inFence) return
    if (!line.trim()) {
      closeBlock()
      return
    }
    const atx = ATX_RE.exec(line)
    if (atx) {
      closeBlock()
      lastHeading = stripInline(atx[2])
      lastHeadingLine = i
      return
    }
    const li = LIST_RE.exec(line)
    if (!li) {
      closeBlock()
      return
    }
    const text = stripInline(li[2])
    if (!text) return

    const indent = indentOf(li[1])
    if (!cur) {
      // `titleLine` = 组标题所在行（-1 = 这组上面没有标题 ⇒ 没有"标题左侧"，也就没有按钮）
      cur = { title: lastHeading || '中心主题', titleLine: lastHeadingLine, startLine: i, endLine: i, nodes: [] }
    }
    const node = { text, indent, line: i, endLine: i, children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else cur.nodes.push(node)
    stack.push({ node, indent })
    cur.endLine = i
  })
  closeBlock()

  // 子树的末行：从后往前推 —— 后一个兄弟之前的行都归前一个节点
  for (const b of blocks) {
    const flat = flatNodes(b.nodes)
    for (let k = 0; k < flat.length; k++) {
      const n = flat[k]
      const next = flat.slice(k + 1).find((m) => m.indent <= n.indent)
      n.endLine = next ? next.line - 1 : b.endLine
    }
  }

  return { blocks }
}

/** 块内树 → 先序数组 */
function flatNodes(nodes, out = []) {
  for (const n of nodes) {
    out.push(n)
    flatNodes(n.children, out)
  }
  return out
}

/** 块 → 导图用的树（根 = 块名） */
function blockToTree(block) {
  return { text: block.title, children: block.nodes }
}

/* ───────────────── ② 布局 + SVG ───────────────── */

const FS = 13
const FS_ROOT = 15
const NODE_H = 28
const NODE_H_ROOT = 40
const PAD_X = 10
const GAP_X = 52
const GAP_Y = 10
const MIN_W = 56
const hOf = (d) => (d === 0 ? NODE_H_ROOT : NODE_H)
const fsOf = (d) => (d === 0 ? FS_ROOT : FS)

const WIDE_RE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
const textWidth = (s, fs = FS) =>
  [...String(s)].reduce((w, ch) => w + (WIDE_RE.test(ch) ? 1 : 0.56), 0) * fs

/** 经典横向树布局：层级 → 横坐标；叶子按顺序占纵向槽位；父居中于子之间 */
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

  for (const n of nodes) {
    const w = Math.round(textWidth(n.text, fsOf(n.depth))) + PAD_X * 2
    n.w = Math.max(MIN_W, n.depth === 0 ? w + 14 : w)
  }
  const levelW = levels.map((ns) => Math.max(...ns.map((n) => n.w)))
  const levelX = []
  let acc = 0
  levelW.forEach((w, d) => {
    levelX[d] = acc
    acc += w + GAP_X
  })

  const SLOT = NODE_H_ROOT + GAP_Y
  let slot = 0
  const place = (n) => {
    if (!n.children.length) {
      n.y = slot * SLOT + SLOT / 2
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
    height: Math.max(NODE_H_ROOT, slot * SLOT - GAP_Y),
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

  out.push(
    `<style>.om-svg{font-family:var(--zn-font);display:block}` +
      `.om-link{fill:none;stroke:var(--zn-border);stroke-width:1.4}` +
      `.om-box{fill:var(--zn-bg);stroke:var(--zn-border)}` +
      `.om-d1>.om-box{fill:var(--zn-bg-active);stroke:var(--zn-bg-active)}` +
      `.om-d0>.om-box{fill:var(--zn-accent);stroke:var(--zn-accent)}` +
      `.om-t{font-size:${FS}px;fill:var(--zn-fg)}` +
      `.om-d1>.om-t{font-weight:500}` +
      `.om-d0>.om-t{font-size:${FS_ROOT}px;fill:#fff;font-weight:600}` +
      `.om-svg g:hover>.om-box{stroke:var(--zn-accent);stroke-width:1.8}` +
      `.om-box{transition:stroke 120ms ease,stroke-width 120ms ease}</style>`,
  )
  out.push(
    `<svg class="om-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
      `width="${W}" height="${H}" role="img" aria-label="思维导图">`,
  )

  for (const n of nodes) {
    for (const c of n.children) {
      const x1 = n.x + n.w
      const mx = (x1 + c.x) / 2
      out.push(`<path class="om-link" d="M${x1} ${n.y} C${mx} ${n.y} ${mx} ${c.y} ${c.x} ${c.y}"/>`)
    }
  }
  for (const n of nodes) {
    const h = hOf(n.depth)
    out.push(`<g class="om-d${n.depth}">`)
    out.push(
      `<rect class="om-box" x="${n.x}" y="${(n.y - h / 2).toFixed(1)}" ` +
        `width="${n.w}" height="${h}" rx="7"/>`,
    )
    out.push(
      `<text class="om-t" x="${(n.x + n.w / 2).toFixed(1)}" ` +
        `y="${(n.y + fsOf(n.depth) * 0.35).toFixed(1)}" text-anchor="middle">${esc(n.text)}</text>`,
    )
    out.push('</g>')
  }
  out.push('</svg>')
  return out.join('')
}

/* ───────────────── ③ 导出：Mermaid mindmap ───────────────── */

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

/* ───────────────── 面板 / 窗口 ───────────────── */

const INDENT = '　' // 全角空格：UINode 没有缩进字段，用它做视觉层级

export default {
  async apply(ctx) {
    const { doc, command, view, host, fs, store, subscriptions, editor } = ctx

    /**
     * 闭包缓存：`render` 是**同步**纯函数，而读盘是异步的 ⇒ 数据在这儿。
     * 三个刷新点：① `doc.on('open')`（换了笔记）② `doc.on('change')`（编辑器里改了）
     * ③ 本插件的编辑命令（改完盘再读一次）—— 窗口那边的数据也走同一套。
     */
    let cache = { path: null, content: '', blocks: [] }

    async function reload(path) {
      if (!path) {
        cache = { path: null, content: '', blocks: [] }
        return
      }
      try {
        const content = await fs.readText(path)
        cache = { path, content, blocks: parseBlocks(content).blocks }
      } catch (e) {
        host.log('warn', `读取笔记失败（${path}）：${String(e)}`)
        cache = { path, content: '', blocks: [] }
      }
    }

    /* ── 编辑：**直接写库文件**（不依赖编辑器挂载，两个窗口同一套） ── */
    const editLines = (mutate) => {
      if (!cache.path) {
        host.notify('没有可写的笔记：先在主窗口打开一篇', 'warn')
        return Promise.resolve(false)
      }
      const lines = String(cache.content).split(/\r?\n/)
      mutate(lines)
      return fs
        .writeText(cache.path, lines.join('\n'))
        .then(() => reload(cache.path))
        .then(() => {
          view.refresh()
          return true
        })
    }

    /** 按行号插入一行（`at` 是插入位置的上一行号） */
    const insertAfter = (line, text) =>
      editLines((lines) => {
        const at = Math.max(0, Math.min(Number(line), lines.length - 1))
        lines.splice(at + 1, 0, text)
      })

    /** 删除 [from, to] 行（含） */
    const deleteRange = (from, to) =>
      editLines((lines) => {
        const a = Math.max(0, Math.min(Number(from), lines.length - 1))
        const b = Math.max(a, Math.min(Number(to), lines.length - 1))
        lines.splice(a, b - a + 1)
      })

    /* ── 窗口模式（U1）：这个 webview 是不是"某个导图窗口"？ ──
       窗口是独立上下文（没有 doc.active()），所以"当前是哪篇笔记、哪一组"靠 store 传递。
       定位**不认死索引**：优先按 `startLine` 找回同一组（笔记在两次读取之间被改过也不会错位）。 */
    const winId = new URLSearchParams(location.search).get('pluginWindow')
    const isMapWindow = Boolean(winId && winId.startsWith(MAP_PREFIX))

    if (isMapWindow) {
      const idx = Number(winId.slice(MAP_PREFIX.length))
      /** 实际渲染哪一组 —— 用 store 里的定位信息校正过的索引（见下） */
      let groupIndex = idx
      let title = '导图'
      /** 诊断出口（CDP / 排查用）：窗口里到底拿到了什么 */
      const diag = { winId, idx, target: null, err: null, path: null, blocks: 0, group: null }
      window.__omWin = diag

      try {
        const target = await store.get(`open:${winId}`, null)
        diag.target = target
        if (target?.note) {
          diag.path = target.note
          await reload(target.note)
          diag.blocks = cache.blocks.length
          // 先按 startLine 认（内容可能被改过），退而按标题，再退按索引
          const byLine =
            Number.isFinite(Number(target.startLine)) &&
            cache.blocks.find((b) => b.startLine === Number(target.startLine))
          const byTitle = target.title ? cache.blocks.find((b) => b.title === target.title) : null
          const block = byLine || byTitle || cache.blocks[idx] || null
          diag.group = block ? { title: block.title, startLine: block.startLine } : null
          if (block) {
            groupIndex = cache.blocks.indexOf(block)
            title = `导图 · ${block.title}`
          }
        } else {
          diag.err = 'store 里没有这个面板的打开记录'
        }
      } catch (e) {
        diag.err = String(e)
        host.log('warn', `导图窗口初始化失败：${String(e)}`)
      }

      /** 窗口渲染：上半 SVG（只读大图）+ 下半可编辑节点列表（按钮是声明式 UINode——SVG 里放不了） */
      const renderWindow = () => {
        const block = cache.blocks[groupIndex]
        if (!block) {
          return {
            type: 'stack',
            gap: 'md',
            children: [
              { type: 'text', value: '这一组没了', variant: 'title' },
              {
                type: 'text',
                value: '笔记内容变了（组数或顺序对不上）。关掉窗口，回主窗口重新点「❖ 导图」。',
                variant: 'caption',
              },
            ],
          }
        }
        const rows = flatNodes(block.nodes)
        const baseIndent = rows[0]?.indent ?? 0
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
                { type: 'text', value: block.title, variant: 'title' },
                { type: 'badge', text: `${rows.length} 项`, tone: 'muted' },
                { type: 'button', label: '重新读盘', variant: 'ghost', onClick: 'outline-map.reload' },
              ],
            },
            { type: 'text', value: cache.path ?? '', variant: 'caption' },
            { type: 'html', value: toSvg(blockToTree(block)) },
            { type: 'divider' },
            { type: 'text', value: '编辑（直接写回库文件；＋ 插子主题 / ✕ 删该节点连同子项）', variant: 'caption' },
            {
              type: 'list',
              empty: '（空组）',
              items: rows.map((n, i) => ({
                key: `n${i}`,
                node: {
                  type: 'row',
                  gap: 'xs',
                  align: 'center',
                  wrap: true,
                  children: [
                    {
                      type: 'text',
                      value: `${INDENT.repeat(Math.max(0, Math.round((n.indent - baseIndent) / INDENT_UNIT)))}• ${n.text}`,
                      variant: 'caption',
                    },
                    {
                      type: 'button',
                      label: '＋',
                      variant: 'ghost',
                      payload: { line: n.line, endLine: n.endLine, indent: n.indent },
                      onClick: 'outline-map.add-child',
                    },
                    {
                      type: 'button',
                      label: '✕',
                      variant: 'ghost',
                      payload: { line: n.line, endLine: n.endLine },
                      onClick: 'outline-map.remove-node',
                    },
                  ],
                },
              })),
            },
          ],
        }
      }

      // 编辑命令：窗口里同样注册（改的是同一个库文件）
      registerEditing(subscriptions, command, { insertAfter, deleteRange, host })

      view.registerPanel({ id: winId, title, location: 'main', render: renderWindow })
      host.log('info', `导图窗口就绪：${winId}`)
      return
    }

    /* ── 主窗口 ── */
    const known = await store.get(STORE_LAST, null)
    const opened = doc.active()
    await reload(opened?.path ?? (typeof known === 'string' ? known : null))
    if (opened?.path) await store.set(STORE_LAST, opened.path)

    // 换笔记 / 编辑器里改了 ⇒ 跟上（`doc.on` 是 U3b 接上的真事件）
    subscriptions.push(
      doc.on('open', (d) => {
        void store.set(STORE_LAST, d.path)
        void reload(d.path).then(() => view.refresh())
      }),
      doc.on('change', (d) => {
        // change 带来的是**编辑器里的最新内容**：直接用它算分组，不必再读盘
        cache = { path: d.path, content: d.content, blocks: parseBlocks(d.content).blocks }
        view.refresh()
      }),
    )

    /**
     * **唯一的常驻界面：每个大纲组标题左侧的「❖」按钮**（`editor.addLineAction`，rev54）。
     *
     * 用户 2026-10-13 定的形态：「**笔记本身就是大纲**」，不给大纲另开一块地方；
     * 导图开独立窗口、分屏交给 Windows；按钮**不放右上角，放标题左侧**。
     *
     * 内核侧实现是 CM6 的 **widget decoration**（`side: -1` = 行首之前）——
     * 视图元素、不进文档、不占偏移 ⇒ Markdown 源保持原样。
     * 点击时命令收到 `{ line }`，这里按 `block.titleLine` 找回那一组。
     *
     * ⚠️ 两条边界：① 正则只能决定"哪些行有按钮"，所以**每个标题行**都有这个按钮，
     * "这个标题下到底有没有列表"是**点击时**判断的（没有就提示一句）；
     * ② 文档开头那段**没有标题**的裸列表，其 `titleLine` 为 -1 ⇒ 没有按钮，
     * 那种组仍可用命令面板的 `outline-map.open-map` 打开。
     */
    subscriptions.push(
      editor.addLineAction({
        id: 'map-btn',
        pattern: '^#{1,6}\\s',
        flags: 'm',
        label: '❖',
        title: '把这一组开成导图窗口',
        onClick: 'outline-map.open-map-at-line',
        // 不传 className：要"无痕融入"（用户 2026-10-13）—— 默认档就是最克制的那个
      }),
    )

    /**
     * 把第 `bi` 组开成独立导图窗口 —— 两个入口共用：
     * · 命令面板 `outline-map.open-map`（按组号）
     * · **标题左侧的「❖」按钮** `outline-map.open-map-at-line`（按行号反查组号）
     */
    const openMapByIndex = async (bi) => {
      const block = cache.blocks[bi]
      if (!cache.path || !block) {
        host.notify('先打开一篇带列表的笔记', 'warn')
        return
      }
      const panelId = `${MAP_PREFIX}${bi}`
      // 窗口是独立上下文：把"哪篇笔记的哪一组"写进 store，供那边的 apply 读。
      // 除索引外还写 `startLine` / `title` —— 那边优先按它们找回同一组（内容被改过也不会错位）。
      await store.set(`open:${panelId}`, {
        note: cache.path,
        block: bi,
        startLine: block.startLine,
        title: block.title,
      })
      /**
       * 先把面板注册上再开窗 —— 内核的 `openWindow` 会校验"面板已注册"（明确报错优于开一个白窗）。
       * 那边（新 webview）会**自己再注册一次**同 id 的面板，内容是它从 store 读盘后算的；
       * 这里这份只服务"主窗口里也能直接看这一组"。
       */
      view.registerPanel({
        id: panelId,
        title: `导图 · ${block.title}`,
        location: 'main',
        render: () => ({
          type: 'stack',
          gap: 'md',
          children: [
            { type: 'text', value: block.title, variant: 'title' },
            { type: 'text', value: cache.path ?? '', variant: 'caption' },
            { type: 'divider' },
            { type: 'html', value: toSvg(blockToTree(block)) },
          ],
        }),
      })
      view.openWindow({ panel: panelId, title: `导图 · ${block.title}`, width: 940, height: 700 })
      host.notify(`已在新窗口打开「${block.title}」（可多开；窗口里能编辑）`)
    }

    registerEditing(subscriptions, command, { insertAfter, deleteRange, host })

    subscriptions.push(
      command.register({
        id: 'outline-map.reload',
        title: '大纲：重新读盘并解析',
        run: async () => {
          await reload(cache.path)
          view.refresh()
          host.notify('已重新读盘')
        },
      }),
      command.register({
        id: 'outline-map.insert-mermaid',
        title: '大纲：把某组导图插入笔记（Mermaid mindmap）',
        run: async () => {
          const block = cache.blocks[0]
          if (!cache.path || !block) {
            host.notify('当前笔记里没有列表，导不出导图', 'warn')
            return
          }
          const tree = blockToTree(block)
          const md = toMermaid(tree, tree.text)
          const tail = String(cache.content).endsWith('\n') ? '' : '\n'
          await fs.writeText(cache.path, `${cache.content}${tail}\n\`\`\`mermaid\n${md}\n\`\`\`\n`)
          await reload(cache.path)
          view.refresh()
          host.notify('已把 Mermaid mindmap 追加到笔记末尾')
        },
      }),
      command.register({
        id: 'outline-map.open-map',
        title: '大纲：把某组导图开成独立窗口（按组号）',
        run: async (payload) => {
          const bi = Number((payload ?? {}).block)
          await openMapByIndex(Number.isFinite(bi) ? bi : 0)
        },
      }),
      command.register({
        id: 'outline-map.open-map-at-line',
        title: '大纲：把该标题下的导图开成独立窗口（标题左侧按钮用）',
        run: async (payload) => {
          const line = Number((payload ?? {}).line)
          if (!Number.isFinite(line) || line < 0) {
            host.notify('这条命令要带 { line }（由标题左侧的「❖」按钮传）', 'warn')
            return
          }
          const bi = cache.blocks.findIndex((b) => b.titleLine === line)
          if (bi < 0) {
            host.notify('这个标题下面还没有列表 ⇒ 没有可开的导图组', 'warn')
            return
          }
          await openMapByIndex(bi)
        },
      }),
    )

    host.log('info', `大纲 · 导图 v0.2 就绪（导图在新窗口；编辑直接写库文件）`)
  },
}

/**
 * 注册"编辑两个命令" —— 主窗口与导图窗口都要有（改的是同一个库文件）。
 * 抽出来是因为窗口分支会在 `return` 之前提前注册，避免两处重复。
 */
function registerEditing(subs, command, { insertAfter, deleteRange, host }) {
  subs.push(
    command.register({
      id: 'outline-map.add-child',
      title: '大纲：在该节点下插入子主题',
      run: async (payload) => {
        const p = payload ?? {}
        if (!Number.isFinite(Number(p.line))) {
          host.notify('这条命令要带 { line }（由列表行内按钮传）', 'warn')
          return
        }
        const indent = Number.isFinite(Number(p.indent)) ? Number(p.indent) : 0
        const at = Number.isFinite(Number(p.endLine)) ? Number(p.endLine) : Number(p.line)
        const ok = await insertAfter(at, `${' '.repeat(indent + INDENT_UNIT)}- 新主题`)
        if (ok) host.notify('已插入子主题「新主题」（写回库文件）')
      },
    }),
    command.register({
      id: 'outline-map.remove-node',
      title: '大纲：删除该节点连同它的子项',
      run: async (payload) => {
        const p = payload ?? {}
        if (!Number.isFinite(Number(p.line))) {
          host.notify('这条命令要带 { line }（由列表行内按钮传）', 'warn')
          return
        }
        const last = Number.isFinite(Number(p.endLine)) ? Number(p.endLine) : Number(p.line)
        const ok = await deleteRange(Number(p.line), last)
        if (ok) host.notify(`已删除 ${last - Number(p.line) + 1} 行（写回库文件）`)
      },
    }),
  )
}

/**
 * 纯函数导出 —— 给 `selftest.mjs` **离线**验证解析/布局/导出用（不必开 GUI）。
 */
export { parseOutline, parseBlocks, flatNodes, blockToTree, flatten, toSvg, toMermaid }
