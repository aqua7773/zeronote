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
  /** 标题清单（行号 + 层级）—— 判断"容器标题"要用（见 `headingIsContainer`） */
  const headings = []
  let cur = null
  let lastHeading = ''
  /** 最近标题的**行号**（-1 = 文档开头还没有标题）—— 行首按钮要按它定位 */
  let lastHeadingLine = -1
  /**
   * **当前标题下是否已经产出过一个块**（2026-10-14 用户裁定用）。
   *
   * 起因：空行把一个大纲断成多块时，**第二块起**仍然沿用上面那个标题当中心主题 ——
   * 用户原话「单独大纲渲染的中心主题是上一级的标题，实际上**不接标题的大纲应该统一使用
   * 中心主题作为导图中心**」。⇒ 只有"标题下面第一个块"算接着标题，后续块一律用默认中心主题。
   */
  let headingUsed = false
  /**
   * **最近那个标题是否仍"紧邻"下面的列表**（2026-10-14 用户实测加的）。
   *
   * 起因：用户笔记里 `# 标题接正文` → `123` / `456` → 空行 → `非大纲` → 列表，
   * 结果那组列表被算成"这个标题下的大纲"、`❖` 入口挂到了标题行上 ——
   * 用户原话「**标题和大纲之间隔了好几条正文和一个空行，不应该被判断为一组**」。
   *
   * 规则（用户 2026-10-14 两轮裁定后的最终版）：遇到标题 ⇒ true；
   * 遇到**正文行**或**空行** ⇒ false（第二句原话「空行也算」）——
   * 也就是"标题下面**紧挨着**列表才算一组"。
   * 清零后新起的块 `titleLine = -1` ⇒ 入口挂到**它自己的第一行**、中心主题用默认值。
   */
  let headingAdjacent = false
  let inFence = false
  const stack = []

  const closeBlock = () => {
    if (cur && cur.nodes.length) {
      blocks.push(cur)
      headingUsed = true
    }
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
      /**
       * 空行：既断开"同一标题下的两个块"，**也算把标题与列表隔开**
       * （用户 2026-10-14 二次裁定「**空行也算**」）——
       * 判据是"标题下面**紧挨着**列表才算一组"，中间不管夹正文还是空行都不算。
       */
      headingAdjacent = false
      closeBlock()
      return
    }
    const atx = ATX_RE.exec(line)
    if (atx) {
      closeBlock()
      lastHeading = stripInline(atx[2])
      lastHeadingLine = i
      headingUsed = false // 新标题 ⇒ 它下面的**第一个**块才算接着它
      headingAdjacent = true // 标题刚出现 ⇒ 还没被正文隔开
      headings.push({ line: i, level: atx[1].length, text: lastHeading })
      return
    }
    const li = LIST_RE.exec(line)
    if (!li) {
      // 正文行 ⇒ 后面的大纲不再算"这个标题下的组"（用户 2026-10-14 的判据）
      headingAdjacent = false
      closeBlock()
      return
    }
    const text = stripInline(li[2])
    if (!text) return

    const indent = indentOf(li[1])
    if (!cur) {
      /**
       * `titleLine` = 组标题所在行（-1 = 这组上面**没有紧邻的标题** ⇒ 入口挂到它自己第一行）。
       * 两个条件都要：① 这是该标题下的**第一个**块（`!headingUsed`）
       * ② 标题与列表之间**没夹正文**（`headingAdjacent`）。
       * 中心主题同样跟着走：不接标题的大纲用 `中心主题`。
       */
      const attachHeading = Boolean(lastHeading) && !headingUsed && headingAdjacent
      cur = {
        title: attachHeading ? lastHeading : '中心主题',
        titleLine: attachHeading ? lastHeadingLine : -1,
        startLine: i,
        endLine: i,
        nodes: [],
      }
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

  return { blocks, headings }
}

/**
 * **这个标题是不是"容器"** —— 它下面（在遇到同级或更浅的标题之前）还有**更深一级的标题**。
 *
 * 用户 2026-10-14 定的判据（原话）：「**只有标题下面接大纲的时候才会被判断为大纲，
 * 可以转成思维导图。单独的标题不构成思维导图**」。
 * 落成可判定的形式：`# 绪论` 下面接着 `## 数据模型` / `## 信息世界基本概念` ⇒ 它**只是文档
 * 结构的根**（容器），不算"一组大纲" ⇒ 它那一行不给按钮；`## 数据模型`（下面直接就是列表）
 * 才是一组 ⇒ 给按钮。
 *
 * 为什么必须看**标题层级**而不是"这行下面有没有列表"：容器标题下面通常也有列表，
 * 但那些列表其实归它下面的子标题管（`# 绪论` 下那 20 行列表就是这种情况）。
 */
function headingIsContainer(headings, line) {
  const self = headings.find((h) => h.line === line)
  if (!self) return false
  for (const h of headings) {
    if (h.line <= line) continue
    if (h.level <= self.level) return false // 同级 / 更浅 ⇒ 这个标题的辖区到此结束
    return true // 出现更深一级的标题 ⇒ 它是容器
  }
  return false
}

/**
 * 这组列表里**有没有嵌套**（任一节点带子项）。
 *
 * 用户 2026-10-14 第四次要求：「**单独一个大纲**不用竖线**也不视为导图**」——
 * 落成判据就是这条：**单层平铺列表不算大纲**（不给「❖」入口）。
 * 理由：单层列表开成导图只有一个节点，毫无意义；它也不需要层级引导线。
 */
function hasNested(nodes) {
  return nodes.some((n) => n.children.length > 0)
}

/**
 * **入口表**：哪些行有「❖」按钮、各自开第几组（`parseBlocks` 的索引）。
 *
 * 三种入口行（按优先级）：
 * 1. **组标题行** —— 该标题不是容器、且这一行还没被别的组占用；
 * 2. **裸列表组的第一行** —— 文档开头没有标题那种；
 * 3. **它自己的第一行** —— 上面两种情况用不上时。
 *
 * 第 3 条是 2026-10-14 补的（用户实测）：**同一个标题下面可以有多个独立大纲**
 * （空行把它们断开，见 `parseBlocks` 的连通性规则），它们共享同一行标题 ——
 * 原来只给标题行画一个按钮，点开的是**第一组**，后面那几组**根本没有入口**。
 * 用户原话：「单独大纲也应该能够用导图打开」。
 *
 * ⚠️ 命令 `outline-map.open-map-at-line` 必须用**同一张表**反查组号，
 * 否则"按钮画在哪一行"与"点了开哪一组"会各算一套。
 */
function mapButtonTargets(md) {
  const { blocks, headings } = parseBlocks(md)
  const out = []
  const used = new Set()
  blocks.forEach((b, index) => {
    if (!b.nodes.length) return
    if (!hasNested(b.nodes)) return // 单层平铺列表不算大纲（用户 2026-10-14 第四次要求）
    const isContainer = b.titleLine >= 0 && headingIsContainer(headings, b.titleLine)
    const line =
      b.titleLine === -1 || isContainer || used.has(b.titleLine) ? b.startLine : b.titleLine
    if (used.has(line)) return // 同一行只放一个按钮
    used.add(line)
    out.push({ line, index })
  })
  return out
}

/**
 * **哪些行该出现「❖」按钮**（纯函数，可离线断言）—— `mapButtonTargets` 的简化投影。
 *
 * 与 `parseBlocks` 同一份解析 ⇒「有按钮」与「能开出导图」永远同真同假。
 */
function mapButtonLines(md) {
  return mapButtonTargets(md).map((t) => t.line)
}

/**
 * **行号 → 列表深度**（1 起）—— 只收**列表行**，正文/标题/空行都不在表里。
 *
 * 用途：大纲**竖线**。内核的 `editor.addLineClass` 只能问"这一行要什么 class"，
 * 而"层级"必须由解析出来（渲染后的缩进是 CM6 按层级给的 `padding-left`，
 * 跟源码里的空格数无关 —— 见 `contract.ts` 里 `EditorLineClassRule` 的说明）。
 *
 * 每个块**各算各的**：同一标题下被空行断开的第二块是独立的一棵树，深度从 1 重新起算
 * （与 `mapButtonTargets` 把它的入口挂到自己第一行是同一个道理）。
 */
function outlineDepths(md) {
  const { blocks } = parseBlocks(md)
  const map = new Map()
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      map.set(n.line, depth)
      walk(n.children, depth + 1)
    }
  }
  for (const b of blocks) walk(b.nodes, 1)

  /**
   * 补**空列表项**的深度（2026-10-17 用户报：「同级列表没有内容和有内容缩进不同」）。
   *
   * 背景：`parseBlocks` 会跳过「`- ` 后面还没写内容」的列表行（它不进树、也不该进导图，
   * 否则导图里会多一个空白节点）—— 但**它仍然是列表行**。没有 `zn-ol-dN` 时，
   * 这一行只能用 CM6 的默认缩进（实测 padding-left 34px），比同级列表多出一截。
   *
   * 这里按缩进回推：取它前面最近一个「缩进不比它深」的非空列表行的深度。
   * 找不到就按第一级（1）。
   */
  const lines = String(md ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (map.has(i)) continue
    // ⚠️ 用**原始行**、不 trimEnd：`- `（空列表项）去掉尾空格就只剩 `-`，
    // 匹配不上 `LIST_RE`（它要求 marker 后至少一个空格）。
    const m = LIST_RE.exec(lines[i])
    if (!m || stripInline(m[2])) continue
    const indent = indentOf(m[1])
    /**
     * 按**缩进关系**定深度（不是直接抄前一行）：
     *  · 前一个列表行缩进**更小** ⇒ 它是父级，深度 = 父 + 1；
     *  · 缩进**相等** ⇒ 同级，深度照抄；
     *  · 缩进更大 ⇒ 那是更深的兄弟，继续往上找。
     * 这样「Tab 把空项缩进成子项」之后，那一行才会真的按子级缩进渲染。
     */
    let depth = 1
    for (let j = i - 1; j >= 0; j--) {
      const pm = LIST_RE.exec(lines[j])
      // 内层要的是**非空**列表行（空的没进 map、没法当参照）—— 注意与上面外层的条件相反
      if (!pm || !stripInline(pm[2])) continue
      const prevIndent = indentOf(pm[1])
      const prevDepth = map.get(j) ?? 1
      if (prevIndent < indent) {
        depth = prevDepth + 1
        break
      }
      if (prevIndent === indent) {
        depth = prevDepth
        break
      }
    }
    map.set(i, depth)
  }

  return map
}

/**
 * **行号 → 该行的"子项末行"**（0 起，含）—— 只收**有子项的列表行**（= 折点）。
 *
 * 与 `outlineDepths` 同一棵树：深度决定"画几层竖线"，这个决定"能折叠到哪一行"。
 * 折叠范围就是该行**子树里的最大行号**（子树在文档里是连续区间）。
 *
 * 与 `outlineDepths` 一样**每个块各算各的**：同一标题下被空行断开的第二块是独立的一棵树。
 */
function outlineFoldEnds(md) {
  const { blocks } = parseBlocks(md)
  const map = new Map()
  const walk = (nodes) => {
    for (const n of nodes) {
      walk(n.children)
      if (!n.children.length) continue
      let last = n.line
      for (const c of flatNodes(n.children)) last = Math.max(last, c.line)
      map.set(n.line, last)
    }
  }
  for (const b of blocks) walk(b.nodes)
  return map
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

/* ───────────────── ④ 真导图库：mind-elixir（离线） ─────────────────
 *
 * 用户 2026-10-13 的裁决：「去看有没有开源的思维导图项目，能用就直接用，不要再闭门造车」——
 * 这个段就是那次裁决的落地：图交给 **Mind Elixir 5.15.1**（MIT）画，
 * `layout` / `toSvg` 那套自算布局退居"主区预览 + 库载不进时的兜底"。
 *
 * 库**就在插件目录里**（`vendor/`，共 110 KB，不走 CDN ⇒ 离线、手机也能用）。
 * 加载方式必须是"运行时自己装配"：
 *   · 插件入口本身跑在 **Blob 模块**里 ⇒ **相对导入没有 base 目录**（契约 §3.2 的硬限制）；
 *   · 所以：`fs.readText` 读出 IIFE 产物 → 补一句 `export default` → 新 Blob → 动态 import。
 * `vendor/MindElixir.iife.js` 尾部实测是 `I.default = Ct; I.RIGHT = 1; …`（`Ct` 是类），
 * 所以**类在 `.default` 上**，常量（RIGHT / THEME / DARK_THEME）在同级。
 */
const LIB_VERSION = '5.15.1'
/** 同一个 webview 里只加载一次（失败会清掉缓存，允许重试） */
let libPromise = null

function loadMindElixir(fs, pluginId) {
  if (libPromise) return libPromise
  libPromise = (async () => {
    const base = `.zn/plugins/${pluginId}/vendor`
    const [src, css] = await Promise.all([
      fs.readText(`${base}/MindElixir.iife.js`),
      fs.readText(`${base}/MindElixir.css`),
    ])
    const code = `${src}\nexport default (typeof MindElixir !== 'undefined' && MindElixir.default) || null;`
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    try {
      const mod = await import(/* @vite-ignore */ url)
      const ME = mod.default
      if (typeof ME !== 'function') {
        throw new Error(`MindElixir 全局形状不对（typeof = ${typeof ME}）—— 查 vendor/MindElixir.iife.js`)
      }
      return { MindElixir: ME, css, version: LIB_VERSION }
    } finally {
      URL.revokeObjectURL(url)
    }
  })()
  libPromise.catch(() => {
    libPromise = null
  })
  return libPromise
}

/**
 * 块 → mind-elixir 数据。根 = 块名（笔记里那个标题）。
 * `id` 用**路径**（`n0.2`）而不是行号：行号一改就废，路径能解释、能复现。
 */
function blockToMeData(block) {
  const mk = (node, id) => ({
    id,
    topic: node.text,
    children: (node.children ?? []).map((c, i) => mk(c, `${id}.${i}`)),
  })
  return {
    nodeData: {
      id: 'root',
      topic: block.title,
      root: true,
      children: (block.nodes ?? []).map((n, i) => mk(n, `n${i}`)),
    },
    direction: 1, // MindElixir.RIGHT —— 大纲向右展开成树
  }
}

/**
 * mind-elixir 数据 → 笔记里的 `- ` 行。**根不写**：块名就是笔记里那个标题行。
 * `baseIndent` 保留原来那组的缩进基准（有人把整列表缩进两格也不打乱）。
 */
function meDataToLines(data, baseIndent = 0) {
  const out = []
  const walk = (node, depth) => {
    const text = String(node?.topic ?? '')
      .replace(/\r?\n/g, ' ')
      .trim()
    out.push(`${' '.repeat(baseIndent + depth * INDENT_UNIT)}- ${text}`)
    for (const c of node?.children ?? []) walk(c, depth + 1)
  }
  for (const c of data?.nodeData?.children ?? []) walk(c, 0)
  return out
}

/** 宿主当前是不是暗色主题（`<html data-theme="dark">`，见 styles.css） */
function isDarkTheme() {
  const t = document.documentElement.dataset.theme
  if (t) return t === 'dark'
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 把宿主的 `--zn-*` 令牌映射成 mind-elixir 的 `cssVar` —— **主题跟随宿主**，
 * 而不是库自带那套粉紫 Latte。
 *
 * 只覆盖"颜色"那几项：间距 / 圆角 / 节点尺寸是库刻意调过的，照抄会难看。
 * 根节点那个强调块（`--main-color` / `--main-bgcolor`）**保持库的明暗两套** ——
 * 它是"根"的视觉标识，跟着宿主的中性灰反而糊成一片。
 */
function znMindTheme(MindElixir) {
  const cs = getComputedStyle(document.documentElement)
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback
  const base = isDarkTheme() ? MindElixir.DARK_THEME : MindElixir.THEME
  const d = base.cssVar
  return {
    ...base,
    /**
     * ⚠️ **分支色 / 节点边框色不走 CSS 变量**：库在生成每个节点时把 `borderColor`
     * 设成 `theme.palette[i % palette.length]`（实测：只改 `--panel-border-color` 没用，
     * 截图里连线还是库自带的粉紫）。所以要跟随宿主就得**换掉整个 palette**。
     * 用宿主的中性阶梯（深→浅），与项目「中性灰」审美一致，同时保留分支的层次感。
     */
    palette: [
      v('--zn-accent', '#3f3f46'),
      v('--zn-fg-muted', '#71717a'),
      v('--zn-fg-subtle', '#a1a1aa'),
      v('--zn-border-strong', '#d4d4d8'),
      v('--zn-fg', '#18181b'),
    ],
    cssVar: {
      ...d,
      '--bgcolor': v('--zn-bg', d['--bgcolor']), // 画布底
      '--color': v('--zn-fg-muted', d['--color']), // 连线 / 次级文字
      '--panel-bgcolor': v('--zn-bg-subtle', d['--panel-bgcolor']), // 子节点底
      '--panel-color': v('--zn-fg', d['--panel-color']), // 子节点文字
      '--panel-border-color': v('--zn-border', d['--panel-border-color']), // 子节点边框
      '--selected': v('--zn-accent', d['--selected']), // 选中描边
    },
  }
}

/** 右键菜单的中文文案（库默认是英文；字段名见 `contextMenu` 插件） */
const MM_LOCALE = {
  addChild: '添加子节点',
  addParent: '添加父节点',
  addSibling: '添加兄弟节点',
  removeNode: '删除节点',
  focus: '专注模式',
  cancelFocus: '退出专注',
  moveUp: '上移',
  moveDown: '下移',
  link: '连线',
  linkBidirectional: '双向连线',
  clickTips: '点击目标节点',
  summary: '概要',
}

/* ───────────────── 面板 / 窗口 ───────────────── */

const INDENT = '　' // 全角空格：UINode 没有缩进字段，用它做视觉层级

export default {
  async apply(ctx) {
    const { doc, command, view, host, fs, store, subscriptions, editor, pluginId } = ctx

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

      /* ── 真导图（rev57）：接管这个窗口的**内容区**，在里面跑 mind-elixir ──
       *
       * 面板注册照旧保留：它是"身份"（`openWindow` 的校验、标题条上的名字都靠它）。
       * 真正画图的是 `overrideShell` —— 契约 §2.8 写明**窗口模式下接管的是内容区**，
       * 标题条与关闭按钮由内核保留（所以接管了自己也关得掉）。
       * 声明式 UINode 表达不了"画布 + 拖拽"这类界面：这正是 U2 存在的理由。 */

      /** 按 store 里记的定位信息找回"同一组"：先 startLine（内容改过也能认），再标题，最后索引 */
      const locateBlock = () => {
        const t = diag.target
        const byLine =
          Number.isFinite(Number(t?.startLine)) && cache.blocks.find((b) => b.startLine === Number(t.startLine))
        const byTitle = t?.title ? cache.blocks.find((b) => b.title === t.title) : null
        return byLine || byTitle || cache.blocks[groupIndex] || null
      }

      /**
       * 写回：导图数据 ⇒ 这一组的 `- ` 行 ⇒ 整篇写盘。
       *
       * **先重读盘、再定位行号**：导图是异步交互（拖、双击改名、快捷键），
       * 这中间编辑器里可能已经改了同一篇 —— 拿旧行号去 splice 会写坏别处。
       * 定位不上就抛错退出，**绝不"猜一个位置写下去"**。
       */
      const saveBack = async (data) => {
        if (!cache.path) throw new Error('没有笔记路径')
        await reload(cache.path)
        const block = locateBlock()
        if (!block) throw new Error('这一组已不在笔记里（标题或列表被改过）')
        const flat = flatNodes(block.nodes)
        const base = flat.length ? Math.min(...flat.map((n) => n.indent)) : 0
        const fresh = meDataToLines(data, base)
        return editLines((lines) => {
          lines.splice(block.startLine, block.endLine - block.startLine + 1, ...fresh)
        })
      }

      /** 挂载器：`overrideShell` 的 `mount`（**同步、只调一次**）—— 先占位，再把库异步拉起来 */
      const mountMindMap = (el) => {
        el.replaceChildren()
        // 只补 overflow：`position/inset` 交给 `.zn-shell-mount` 的 CSS（它在窗口模式下铺满内容区）
        el.style.overflow = 'hidden'

        /**
         * **没有顶栏**（用户 2026-10-13 裁决）—— 上一版那条自绘栏压掉画布高度，
         * 而且"看着像菜单栏却没有菜单"。现在改成：
         *   · 四个动作（撤销 / 重做 / 写回 / 重画）进**画布空白处的右键菜单**
         *     （节点上右键仍是库自己那套，已中文化）
         *   · 状态信息改成**悬浮在画布左上角**的小浮层（`pointer-events:none`，不挡画布操作）
         */
        const body = document.createElement('div') // mind-elixir 的容器：铺满整个内容区
        /**
         * ⚠️ **别给这个元素设 `position`** —— 库的构造函数里有 `S.style.position = 'relative'`，
         * 会把它收到的 el 改掉；而 `relative` + `inset/四边:0` **不是拉伸**，只是"偏移 0"
         * ⇒ 容器高度塌回内容高度（实测 `.map-container` 403，而内容区 665）。
         * 只给 `width/height: 100%`，让它撑满上面那个已经铺满的挂载区。
         */
        body.style.cssText = 'width:100%;height:100%'
        body.dataset.znMmBody = ''

        const status = document.createElement('div')
        status.dataset.znMmStatus = ''
        status.style.cssText =
          'position:absolute;left:8px;top:8px;z-index:5;pointer-events:none;padding:2px 8px;' +
          'border:1px solid var(--zn-border);border-radius:999px;background:var(--zn-bg-subtle);' +
          'font-size:11px;line-height:1.7;color:var(--zn-fg-muted);opacity:.9;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%'

        let mind = null
        let themeWatch = null
        let ready = false
        let saveTimer = null
        let saving = false
        let again = false

        const setStatus = (text, tone) => {
          status.textContent = text
          // 用宿主令牌，不写死颜色（浮层也要跟着明暗主题走）
          status.style.color =
            tone === 'warn' ? 'var(--zn-danger)' : tone === 'ok' ? 'var(--zn-success)' : 'var(--zn-fg-muted)'
          status.style.borderColor = tone === 'warn' ? 'var(--zn-danger)' : 'var(--zn-border)'
        }

        const flush = async () => {
          saveTimer = null
          if (!mind || !ready) return
          if (saving) {
            again = true // 上一次还在写：记一下，写完再补一次（别丢用户的最后一拖）
            return
          }
          saving = true
          try {
            const ok = await saveBack(mind.getData())
            setStatus(ok ? '已写回笔记' : '写回被拒（看日志）', ok ? 'ok' : 'warn')
          } catch (e) {
            setStatus(`写回失败：${String(e).slice(0, 80)}`, 'warn')
            host.log('warn', `导图写回失败：${String(e)}`)
          } finally {
            saving = false
            if (again) {
              again = false
              void flush()
            }
          }
        }

        const scheduleSave = () => {
          if (!ready) return // init/refresh 期间自己发的事件不算"用户编辑"
          setStatus('待写回…')
          if (saveTimer) clearTimeout(saveTimer)
          saveTimer = setTimeout(() => void flush(), 400)
        }

        /* ── 画布空白处的右键菜单：四个动作的**唯一常驻入口**（顶栏已撤） ── */
        const menu = document.createElement('div')
        menu.dataset.znMmMenu = ''
        menu.style.cssText =
          'position:fixed;z-index:60;display:none;min-width:150px;padding:4px;border:1px solid var(--zn-border);' +
          'border-radius:8px;background:var(--zn-bg);box-shadow:0 10px 28px rgba(0,0,0,.16)'

        const hideMenu = () => {
          menu.style.display = 'none'
        }

        const mkItem = (label, hint, run) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.textContent = label
          if (hint) {
            const h = document.createElement('span')
            h.textContent = hint
            h.style.cssText = 'float:right;color:var(--zn-fg-subtle);font-size:11px;margin-left:16px'
            b.appendChild(h)
          }
          b.style.cssText =
            'display:block;width:100%;text-align:left;font:inherit;font-size:13px;padding:6px 10px;' +
            'border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer'
          b.onmouseenter = () => {
            b.style.background = 'var(--zn-bg-hover)'
          }
          b.onmouseleave = () => {
            b.style.background = 'transparent'
          }
          b.onclick = () => {
            hideMenu()
            run()
          }
          return b
        }

        menu.append(
          mkItem('撤销', 'Ctrl+Z', () => {
            mind?.undo()
            void flush() // undo/redo **不 fire operation** ⇒ 自己补一次写回
          }),
          mkItem('重做', 'Ctrl+Shift+Z', () => {
            mind?.redo()
            void flush()
          }),
          mkItem('写回', '', () => void flush()),
          mkItem('重画', '按磁盘重读', () => void rebind()),
        )

        /**
         * 在**捕获阶段**听右键：库在容器上装了它自己的节点菜单，
         * 只有"节点之外"的右键才归我们（捕获 + `stopPropagation` ⇒ 两条路不打架）。
         */
        const onContextMenu = (e) => {
          if (e.target instanceof Element && e.target.closest('me-tpc')) return // 节点上 ⇒ 交给库
          e.preventDefault()
          e.stopPropagation()
          menu.style.display = 'block'
          const r = menu.getBoundingClientRect()
          menu.style.left = `${Math.min(e.clientX, Math.max(6, window.innerWidth - r.width - 6))}px`
          menu.style.top = `${Math.min(e.clientY, Math.max(6, window.innerHeight - r.height - 6))}px`
        }
        const onAnyPointerDown = (e) => {
          if (!menu.contains(e.target)) hideMenu()
        }
        el.addEventListener('contextmenu', onContextMenu, true)
        document.addEventListener('pointerdown', onAnyPointerDown, true)

        /** 读盘 → 建/重画导图（同一个实例、同一条笔记） */
        const rebind = async () => {
          ready = false
          try {
            const { MindElixir, css, version } = await loadMindElixir(fs, pluginId)
            if (!document.querySelector('style[data-zn-mm]')) {
              const st = document.createElement('style')
              st.dataset.znMm = ''
              st.textContent = css
              document.head.appendChild(st)
            }
            const block = locateBlock()
            if (!block) {
              setStatus('这一组已不在笔记里', 'warn')
              return
            }
            const data = blockToMeData(block)
            if (mind) {
              mind.refresh(data)
            } else {
              mind = new MindElixir({
                el: body,
                direction: 1,
                editable: true,
                newTopicName: '新主题', // 与旧版「＋」按钮插的文案保持一致
                draggable: true, // 节点拖动：v5 内置该交互，这里显式声明意图
                allowUndo: true, // ⇒ 实例自带 undo() / redo()（init 里自动装 operationHistory）
                contextMenu: { locale: MM_LOCALE }, // 中文右键菜单（默认英文）
                theme: znMindTheme(MindElixir), // 跟随宿主 `--zn-*` 令牌，不是库自带那套
              })
              mind.init(data)
              mind.bus.addListener('operation', scheduleSave)
              /**
               * 宿主切主题（`<html data-theme>`）⇒ 跟着重画。
               * `changeTheme` 内部只 `refresh()`、**不 fire operation** ⇒ 换主题不会被当成一次编辑写回。
               */
              themeWatch = new MutationObserver(() => mind?.changeTheme(znMindTheme(MindElixir)))
              themeWatch.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-theme'],
              })
            }
            ready = true
            /** 诊断出口（CDP 断言用）：不算"给人看的界面"，但验收要靠它读数 */
            window.__mmWin = {
              winId,
              lib: version,
              block: block.title,
              topics: body.querySelectorAll('me-tpc').length,
              hasUndo: typeof mind.undo === 'function',
              draggable: mind.draggable,
              themeBg: getComputedStyle(body.querySelector('.map-container') ?? body)
                .getPropertyValue('--bgcolor')
                .trim(),
              themePalette: mind.theme?.palette?.[0] ?? null,
            }
            // 实例本身也露出一个（CDP 驱动 addChild / undo / getData 用）—— 同 `__omWin` / `__docProbeLog` 的先例
            window.__mmMind = mind
            setStatus(`mind-elixir ${version} · ${flatNodes(block.nodes).length} 个节点`)
          } catch (e) {
            setStatus(`库载入失败：${String(e).slice(0, 80)}`, 'warn')
            host.log('error', `mind-elixir 载入失败：${String(e)}`)
          }
        }

        /**
         * 库内置的 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 直接调 undo/redo，**不 fire operation**
         * ⇒ 捕获阶段补一次写回（不然"撤销完磁盘还是旧的"，界面与磁盘就分家了）。
         */
        const onUndoKey = (e) => {
          if (!(e.ctrlKey || e.metaKey) || e.altKey) return
          const k = e.key.toLowerCase()
          if (k === 'z' || k === 'y') setTimeout(() => void flush(), 60)
        }
        el.addEventListener('keydown', onUndoKey, true)

        el.append(body, status, menu)
        void rebind()

        return {
          dispose() {
            ready = false
            themeWatch?.disconnect()
            themeWatch = null
            el.removeEventListener('contextmenu', onContextMenu, true)
            document.removeEventListener('pointerdown', onAnyPointerDown, true)
            el.removeEventListener('keydown', onUndoKey, true)
            if (saveTimer) clearTimeout(saveTimer)
            saveTimer = null
            try {
              mind?.destroy()
            } catch {
              /* 已经没了 */
            }
            mind = null
          },
        }
      }

      subscriptions.push(view.overrideShell({ mount: mountMindMap }))
      host.log('info', `导图窗口就绪（内容区由 mind-elixir ${LIB_VERSION} 接管）：${winId}`)
      return
    }

    /* ── 主窗口 ── */
    const known = await store.get(STORE_LAST, null)
    const opened = doc.active()
    await reload(opened?.path ?? (typeof known === 'string' ? known : null))
    if (opened?.path) await store.set(STORE_LAST, opened.path)

    /**
     * 诊断出口（排查 / 验收用）：主窗口这边认为"当前是哪篇、记得几组"。
     * 起因：cache 是**异步**填的，空着的时候点「❖」只会弹一句 warn ——
     * 没有读数就只能猜"是没打开笔记还是开窗失败"（静默失效最贵）。
     */
    let docOpenHits = 0
    window.__omMain = () => ({
      path: cache.path,
      blocks: cache.blocks.map((b) => ({
        title: b.title,
        titleLine: b.titleLine,
        start: b.startLine,
        end: b.endLine,
      })),
      docOpenHits,
    })

    /**
     * 诊断出口（CDP 验收用）：**当前文档的「入口表」**（`mapButtonTargets` 的原样输出）。
     *
     * 为什么要它：按钮是 CM6 的视图装饰，肉眼只能数截图；而"哪几行有入口、各自开第几组"
     * 是**纯函数**的结果 —— 直接读出来就能断言（与本文件 `selftest-buttons.mjs` 同一套期望）。
     * 传参可以顺便对任意文本试算：`__omButtons('# A\n- x\n')`。
     */
    window.__omButtons = (md) => mapButtonTargets(typeof md === 'string' ? md : cache.content)

    // 换笔记 / 编辑器里改了 ⇒ 跟上（`doc.on` 是 U3b 接上的真事件）
    subscriptions.push(
      doc.on('open', (d) => {
        docOpenHits += 1
        void store.set(STORE_LAST, d.path)
        /**
         * ⚠️ **同步**先把 path 落进 cache（内容仍留旧值，等 reload 覆盖）。
         *
         * 为什么不能只靠 `reload()`：`initialFolded` 是**同步**回调，而 reload 要 await 读盘 ——
         * 中间那一帧 `cache.path` 还是**上一篇**笔记的 ⇒ 恢复折叠会查错集合，
         * 症状是"切回笔记后折叠全没了 / 折错行"（2026-10-14 实测踩到）。
         */
        cache = { ...cache, path: d.path }
        void reload(d.path).then(() => view.refresh())
        // 读盘比编辑器挂载慢 ⇒ 读完再让内核按 initialFolded 恢复一次（rev81 起不再需要 refresh）
        void foldLoad().then(() => editor.restoreFolds())
      }),
      doc.on('change', (d) => {
        // change 带来的是**编辑器里的最新内容**：直接用它算分组，不必再读盘
        cache = { path: d.path, content: d.content, blocks: parseBlocks(d.content).blocks }
        view.refresh()
      }),
    )

    /**
     * **大纲组标题左侧的「❖」按钮**（`editor.addLineAction`；rev54 引入、**rev65 收紧**）。
     *
     * 用户 2026-10-13 定的形态：「**笔记本身就是大纲**」，导图开独立窗口、分屏交给 Windows；
     * 按钮**不放右上角，放标题左侧**。内核侧是 CM6 的 widget decoration（`side: -1`），
     * 视图元素、不进文档、不占偏移 ⇒ Markdown 源保持原样。
     *
     * **rev65 收紧的规则（用户 2026-10-13）**：**下面没有列表的标题不再显示按钮** ——
     * 以前是"每个标题行都有按钮，点下去才提示这组没有列表"，现在把判断提前到**渲染时**。
     *
     * 怎么做到的：正则只能看单行，所以内核新加了 `filter`（能看全文的谓词，见契约）。
     * 这里的判据**直接复用导图自己的解析器 `parseBlocks`** ⇒
     * **"有按钮"与"能开出导图"永远同真同假**，不会出现"有按钮但点开是空的"。
     *
     * 三处细节：
     * · pattern 同时收**标题行与列表行** —— 否则"文档开头那组没有标题的裸列表"没有候选行，
     *   给它挂入口（用户 2026-10-13 要的）就无从谈起。
     * · `filter` 会被**逐行**问，而判据是整篇解析 ⇒ 用"上次那份文本"做一层缓存，
     *   一次装饰器重建只解析一遍。
     * · 裸列表组挂在**它自己的第一行**上（`startLine`），不是标题行（它没有标题）。
     * · **rev76（2026-10-14）再收紧一档 —— 容器标题不给按钮**：标题下面还接着更深一级标题时
     *   （`# 绪论` 下面接 `## 数据模型` / `## 信息世界基本概念`），它只是文档结构的**根**，
     *   不算"一组大纲"（用户原话：「只有标题下面接大纲的时候才会被判断为大纲……单独的标题
     *   不构成思维导图」）。判据落在纯函数 `mapButtonLines` / `headingIsContainer` 里，
     *   本处 filter 只是查表。
     */
    let btnCacheDoc = null
    let btnCacheLines = new Set()
    /** `mapButtonLines` 的单条缓存 —— 键就是文本本身（CM6 一次重建里传的是同一份字符串） */
    const buttonLinesOfDoc = (doc) => {
      if (btnCacheDoc !== doc) {
        btnCacheLines = new Set(mapButtonTargets(doc).map((t) => t.line))
        btnCacheDoc = doc
        /**
         * 诊断出口（CDP 排查"按钮该有却没画"用）：filter **实际收到的文本**与它算出的行号。
         * 起因 2026-10-14：`__omButtons()`（读 cache）说有 2 个入口，屏幕上却只画了 1 个 ——
         * 只有把 filter 的输入摊开，才能分清是"两次的文本不一样"还是"渲染没重建"。
         */
        window.__omFilterSeen = {
          len: doc.length,
          targets: [...btnCacheLines],
          head: doc.slice(0, 48).replace(/\n/g, '|'),
        }
      }
      return btnCacheLines
    }

    subscriptions.push(
      editor.addLineAction({
        id: 'map-btn',
        pattern: '^(?:#{1,6}[^\\S\\n]|[^\\S\\n]*(?:[-*+]|\\d+[.)])[^\\S\\n])',
        flags: 'm',
        label: '❖',
        title: '把这一组开成导图窗口',
        /**
         * 判据 = `mapButtonTargets`（纯函数，与解析同源）：
         * · **容器标题不给按钮**（2026-10-14 用户实测：`# 绪论` 下面接子标题，它只是结构的根）；
         * · **同一标题下第二个及以后的独立大纲**把入口挂到**它自己的第一行**
         *   （原来它们没有入口 —— 用户原话「单独大纲也应该能够用导图打开」）。
         */
        filter: ({ doc, line }) => buttonLinesOfDoc(doc).has(line),
        onClick: 'outline-map.open-map-at-line',
        // 不传 className：要"无痕融入"（用户 2026-10-13）—— 默认档就是最克制的那个
      }),
    )

    /**
     * **大纲竖线**（`editor.addLineClass`，2026-10-14 rev78）—— 按缩进层级给行加 `zn-ol-dN`，
     * 具体线由 `styles.css` 的 `zn-ol-d*` 规则用 `background-origin: content-box` 画出来。
     *
     * 为什么走内核 API 而不是 `addMark` 的正则：**渲染后的缩进由 CM6 按层级给**
     * （`padding-left` 第 1 级 34px、每级 +10.2px），源码里的空格数与之无关
     * ⇒ 只能"解析出层级"再逐行告诉宿主。
     */
    let depthCacheDoc = null
    let depthCacheMap = new Map()
    const depthByLineOf = (doc) => {
      if (depthCacheDoc !== doc) {
        depthCacheMap = outlineDepths(doc)
        depthCacheDoc = doc
      }
      return depthCacheMap
    }

    subscriptions.push(
      editor.addLineClass({
        id: 'outline-lines',
        classAt: ({ doc, line, folded }) => {
          const d = depthByLineOf(doc).get(line)
          if (!d) return null
          // 封顶 6 级：样式表只画到 d6（再深的层级共用 d6 的线，视觉上够用）
          const cls = [`zn-ol-d${Math.min(d, 6)}`]
          /**
           * **折叠圆点的外观与可点性都挂在行 class 上**（2026-10-14 改）。
           *
           * 圆托由本插件自己的样式表（`outline.css`）画在**圆点自己的伪元素**上
           * ⇒ 与圆点同一个盒子，**同心是定义上的**（内核不再画独立按钮，也就没有像素题）。
           * 点击由本插件的事件委托接（见下方 `onFoldClick`）。
           *
           * `zn-ol-foldable` = 这一行有子项（能折）；`zn-ol-folded` = 当前已折叠（圆托常驻）。
           */
          if (foldEndsOfDoc(doc).has(line)) {
            cls.push('zn-ol-foldable')
            /**
             * `folded` 由**内核**从 CM6 官方折叠状态里读出来（`foldedRanges`，rev81）——
             * 插件不再自己记一份"哪些行折着"的镜像，也就不会有"插件记的和编辑器显示的不是一回事"。
             */
            if (folded) cls.push('zn-ol-folded')
          }
          return cls.join(' ')
        },
      }),
    )

    /**
     * **大纲折叠 / 展开**（`editor.addFold`，2026-10-14 rev80）。
     *
     * 用户 2026-10-14 裁决「**要记**」⇒ 折叠状态**持久化到库内** `.zn/outline-folded.json`，
     * **不写进笔记文件**（笔记保持纯 markdown，插件不往正文里塞任何标记）。
     *
     * ⚠️ **锚点用"行文本签名"，不存行号**（rev78 方案里点名的那条）：行号会随编辑漂移，
     * 而折叠状态是**跨会话**的 —— 存行号的话，第二天打开笔记折叠就全跑位了。
     * 签名 = 该行去空白后的前 40 字；匹配不到就当"没折叠"（宁可展开，不折错行）。
     */
    const FOLD_FILE = '.zn/outline-folded.json'
    const foldSig = (text) =>
      String(text)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40)

    /**
     * 行 → **折叠锚点**。
     *
     * ⚠️ **必须带上"同文本的第几次出现"**（用户 2026-10-14 实测踩到）：
     * 只按文本签名记，内容相同的行会共用同一个锚点 —— 例子就是那篇笔记里的
     * 顶层 `- 1` 与它子树里的 `- 1`：点**子节点**的圆点，命中的是**父节点**那条记录
     * ⇒ 一折就把整棵父树收起来（用户原话「点红框节点折叠会触发整个绿框全部折叠」）。
     *
     * 序号 = 该文本在本篇里**此前出现过几次**（从 0 数）。它的局限要说清：
     * 在它**前面**插入一行**完全相同**的文本会让序号错位（罕见；真错位了表现为"折叠记错行"，
     * 用户再点一下就恢复）。换成"祖先链路径"能更稳，但要在每次重排后重算路径，暂不做。
     */
    const foldAnchor = (md, line) => {
      const lines = String(md ?? '').split(/\r?\n/)
      const sig = foldSig(lines[line] ?? '')
      if (!sig) return ''
      let nth = 0
      for (let i = 0; i < line; i++) if (foldSig(lines[i] ?? '') === sig) nth++
      return `${sig}#${nth}`
    }

    /** 整份文件读进内存一份：`isFolded` 是**同步**回调，不能在里面 await */
    let foldAll = null
    let foldSaveTimer = null

    const foldLoad = async () => {
      if (foldAll) return foldAll
      foldAll = {}
      try {
        const raw = await fs.readText(FOLD_FILE)
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) foldAll = parsed
      } catch {
        /* 文件不存在 / 内容坏了：从空开始。**不是错误** —— 第一次用本来就没有这个文件 */
      }
      return foldAll
    }

    /** 某篇笔记的折叠签名表（就地建，返回的数组可直接改） */
    const foldSetOf = (path) => {
      const k = path ?? ''
      if (!foldAll) foldAll = {}
      if (!Array.isArray(foldAll[k])) foldAll[k] = []
      return foldAll[k]
    }

    /** 写盘去抖 400ms：连续折叠几次只落一次盘 */
    const foldSaveSoon = () => {
      if (foldSaveTimer) clearTimeout(foldSaveTimer)
      foldSaveTimer = setTimeout(() => {
        foldSaveTimer = null
        void fs
          .writeText(FOLD_FILE, JSON.stringify(foldAll ?? {}, null, 2))
          .catch((e) => host.log('warn', `折叠状态写盘失败：${String(e)}`))
      }, 400)
    }

    let foldCacheDoc = null
    let foldCacheMap = new Map()
    /** 与 `buttonLinesOfDoc` / `depthByLineOf` 同一套"按整篇缓存"写法（回调会被逐行问） */
    const foldEndsOfDoc = (d) => {
      if (foldCacheDoc !== d) {
        foldCacheMap = outlineFoldEnds(d)
        foldCacheDoc = d
      }
      return foldCacheMap
    }

    /** 诊断出口（CDP 验收用）：当前笔记的折点表、插件记的折叠签名、以及**内核侧实际**的折叠态 */
    window.__omFolds = () => ({
      path: cache.path,
      ends: [...foldEndsOfDoc(cache.content)].map(([line, end]) => `${line}→${end}`),
      folded: [...foldSetOf(cache.path)],
      // rev81：内核读的是 CM6 官方状态（`foldedRanges`）。它与 `folded` 对不上 = 桥断了
      kernelFolded: [...foldEndsOfDoc(cache.content).keys()].filter((line) => editor.foldAt(line)),
      loaded: foldAll !== null,
    })

    /**
     * 诊断出口（CDP 验收用）：**折叠集合每次变化**的快照。
     * rev81 起触发点在**内核**（它 dispatch 官方 effect、再对账），这里记的是它送过来的那份集合。
     */
    const foldLog = (foldedLines) => {
      ;(window.__omFoldLog ??= []).push({
        foldedLines: [...foldedLines],
        path: cache.path,
        at: Date.now(),
        stack: String(new Error().stack || '').split('\n').slice(1, 4).join(' | '),
      })
    }

    subscriptions.push(
      editor.addFold({
        id: 'outline-fold',
        foldEndAt: ({ doc: d, line }) => {
          const end = foldEndsOfDoc(d).get(line)
          return end === undefined ? null : end
        },
        /**
         * **挂载时 / `restoreFolds()` 时**问一次"上次折起来的是哪些行"。
         *
         * rev80 这里叫 `isFolded`，是**每次都问**"现在折着没" —— 于是插件必须持有一份
         * 与编辑器同步的镜像状态（也就是 rev80 那几个坑的来源）。rev81 起状态归 CM6 官方
         * （`foldedRanges`），插件只在"恢复"这一个时机提供答案。
         */
        initialFolded: ({ doc: d, line }) => foldSetOf(cache.path).includes(foldAnchor(d, line)),
        /**
         * **对账**：内核把"当前真实折着的行"（0 起、升序）**整份**送过来 ⇒ 整份重写记录。
         *
         * 为什么不是逐行加减（rev81 第一版那样，实测有漏洞）：折叠可以嵌套，
         * 而展开祖先时子孙的折叠**一起消失** ⇒ 逐行通知收不到那几条，
         * 记录里就留下"其实已经展开"的签名，下次打开又照着它们折起来
         * （用户看到的是"我明明展开过，重开又折上了"）。
         */
        onFoldChange: ({ doc: d, foldedLines }) => {
          const path = cache.path
          if (!path) return
          if (!foldAll) foldAll = {}
          foldAll[path] = foldedLines.map((line) => foldAnchor(d, line)).filter((a) => !!a)
          foldLog(foldedLines)
          foldSaveSoon()
        },
      }),
    )

    /**
     * **点圆点 = 折叠 / 展开**（事件委托，2026-10-14 改）。
     *
     * 为什么用委托、不直接给圆点绑监听：圆点是**库渲染的**（`.cm-atomic-bullet`），
     * 每次重排 / 换笔记都会重建 ⇒ 绑上去的监听会跟着丢；委托在文档级挂一次就够。
     *
     * 两个判据：① 命中的元素在圆点里；② 它所在行带 `zn-ol-foldable`（＝有子项、能折）。
     * **行号问内核**（`editor.lineAtElement`）—— DOM 子元素索引 ≠ 行号
     * （折叠时被隐藏的行根本不渲染，索引会整体错位），只有内核手上有 EditorView。
     */
    const toggleFoldAt = (line) => {
      if (!cache.path || line === null) return
      /**
       * **折叠 / 展开交给内核**（rev81）：它 dispatch 官方的 `foldEffect` / `unfoldEffect`。
       *
       * 插件这侧只剩"点到了哪一行" —— 状态、子行显隐、行 class（`zn-ol-folded`）全部由
       * 官方折叠状态驱动，插件不再自己改集合再喊 `refresh()`（rev80 那条路上踩过
       * "状态改了但界面没跟上"的坑）。写盘走 `onToggle` 回调。
       * 返回值 = 这一行能不能折（叶子行拿到 false，什么也不做）。
       */
      editor.toggleFold(line)
    }

    const onFoldClick = (e) => {
      const t = e.target
      if (!(t instanceof Element)) return
      if (!t.closest('.cm-atomic-bullet')) return
      const lineEl = t.closest('.cm-line')
      if (!lineEl || !lineEl.classList.contains('zn-ol-foldable')) return
      toggleFoldAt(editor.lineAtElement(lineEl))
    }
    document.addEventListener('click', onFoldClick)
    subscriptions.push({
      dispose: () => document.removeEventListener('click', onFoldClick),
    })

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
          /**
           * 按**入口行**反查组号 —— 用与按钮同一张表 `mapButtonTargets`，
           * 所以"哪一行有按钮"与"点了开哪一组"永远一致
           * （标题行 / 裸列表首行 / 同标题下第二个独立大纲的首行，三种入口都在表里）。
           */
          const hit = mapButtonTargets(cache.content).find((t) => t.line === line)
          if (!hit) {
            host.notify('这一行没有可开的导图组（先打开一篇带列表的笔记）', 'warn')
            return
          }
          await openMapByIndex(hit.index)
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
export {
  parseOutline,
  parseBlocks,
  headingIsContainer,
  mapButtonTargets,
  mapButtonLines,
  outlineDepths,
  outlineFoldEnds,
  flatNodes,
  blockToTree,
  flatten,
  toSvg,
  toMermaid,
  blockToMeData,
  meDataToLines,
}
