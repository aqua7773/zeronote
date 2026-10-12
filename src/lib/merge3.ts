/**
 * 行级三方合并（diff3 的简化版）—— 解决「插件写盘」与「用户手改」撞车。
 *
 * ## 它要解决的具体场景
 *
 * 导图窗口是**直接写库文件**的（`fs.writeText`），而编辑器持有的是**内存里的文档**。
 * 两边都可能动同一篇笔记：
 *   · 用户在编辑器里打字（还没到 800ms 自动保存）；
 *   · 同时导图那边拖了个节点、写了盘。
 * 谁后写谁就把对方**整篇**盖掉 —— 这是 ZeroNote 从 v0.2 起就写明的边界，
 * rev62 才真正处理：**合并点在「写盘之前」**，而不是等 `fs.watch` 事件
 * （实测 watch 会迟到好几秒，那时 800ms 的自动保存早就把插件改动盖掉了）。
 *
 * ## 为什么停在「行级」
 *
 * 笔记是 markdown，改动天然落在**行**上：导图改的是一组 `- ` 行，用户手改是别处的段落。
 * 行级三方合并就够用 —— 字符级 diff 代码更多，对中文也没有额外收益。
 *
 * ## 冲突策略（用户 2026-10-13 定：**手写优先**）
 *
 * 同一段 base 行两边都改了 ⇒ **保留编辑器里的那份（mine）**，冲突数 +1，
 * 但**不往正文里写 `<<<<<<<` 标记** —— 笔记是给人读的，塞冲突标记只会污染文档。
 * 调用方拿 `conflicts` 去提示「有几处插件改动没能合进来」。
 */

/** 一段"base 的 `[start, end)` 行被 `rep` 替换掉"的变更块 */
type Block = { start: number; end: number; rep: string[] }

export type MergeResult = {
  /** 合并后的全文（行尾统一成 `\n`） */
  text: string
  /** 两边改到同一段、最终保留 mine 的处数（0 = 干净合并） */
  conflicts: number
  /** mine 相对 base 的变更块数（诊断：到底谁动了） */
  mineBlocks: number
  /** theirs 相对 base 的变更块数 */
  theirsBlocks: number
}

/** LCS 表的规模上限；超过就退化成「整段替换」一个块（正常笔记远低于它） */
const MAX_DP_CELLS = 4_000_000

/**
 * 切行。**保留末尾那个空串**（`'a\nb\n'` → `['a','b','']`），这样 `join('\n')` 能原样还原 ——
 * 去掉它会让每篇笔记的尾换行被吃掉一次。
 */
export function splitLines(s: string): string[] {
  return String(s ?? '').split('\n')
}

/**
 * 求 `base → other` 的变更块（按行）。
 *
 * 先裁掉公共前缀/后缀（笔记场景命中率极高，能省掉绝大部分 DP），中间那段再跑 LCS。
 * 回溯时把**连续变更聚成一个块** —— 块少，后面归并时"谁跟谁撞了"才好判断。
 */
export function diffBlocks(base: string[], other: string[]): Block[] {
  let head = 0
  while (head < base.length && head < other.length && base[head] === other[head]) head++
  let tail = 0
  while (
    tail < base.length - head &&
    tail < other.length - head &&
    base[base.length - 1 - tail] === other[other.length - 1 - tail]
  ) {
    tail++
  }
  const b = base.slice(head, base.length - tail)
  const o = other.slice(head, other.length - tail)
  if (b.length === 0 && o.length === 0) return [] // 完全一样：没有任何变更块
  if (b.length === 0 || o.length === 0 || b.length * o.length > MAX_DP_CELLS) {
    return [{ start: head, end: base.length - tail, rep: o }]
  }

  const n = b.length
  const m = o.length
  // LCS 长度表（从右下往左上填，回溯时就能一路往右下走）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = b[i] === o[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const blocks: Block[] = []
  let i = 0
  let j = 0
  let cur: Block | null = null
  const flush = () => {
    if (cur) blocks.push(cur)
    cur = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && b[i] === o[j]) {
      flush() // 相同的行 ⇒ 变更块到此为止
      i++
      j++
      continue
    }
    if (!cur) cur = { start: head + i, end: head + i, rep: [] }
    const c = cur // 取局部引用：闭包（flush）会让 TS 放弃对 cur 的非空窄化
    if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      c.rep.push(o[j])
      j++
    } else {
      i++
    }
    c.end = head + i
  }
  flush()
  return blocks
}

/**
 * 三方合并。`base` = **上次与磁盘一致时**的内容。
 *
 * 归并：沿 base 走，谁的变更块**起点在前**先应用谁；两块在 base 上**有交叠** ⇒ 冲突（mine 赢）。
 */
export function mergeLines(base: string, mine: string, theirs: string): MergeResult {
  if (mine === theirs) return { text: mine, conflicts: 0, mineBlocks: 0, theirsBlocks: 0 }
  if (base === mine) return { text: theirs, conflicts: 0, mineBlocks: 0, theirsBlocks: 0 }
  if (base === theirs) return { text: mine, conflicts: 0, mineBlocks: 0, theirsBlocks: 0 }

  const b = splitLines(base)
  const mb = diffBlocks(b, splitLines(mine))
  const tb = diffBlocks(b, splitLines(theirs))

  const out: string[] = []
  let bi = 0
  let mi = 0
  let ti = 0
  let conflicts = 0

  /** 把 base 上 `[bi, until)` 的原样行吐出来 */
  const emitUpTo = (until: number) => {
    if (until > bi) {
      out.push(...b.slice(bi, until))
      bi = until
    }
  }
  const applyBlock = (blk: Block) => {
    emitUpTo(blk.start)
    out.push(...blk.rep)
    bi = Math.max(bi, blk.end)
  }

  while (mi < mb.length && ti < tb.length) {
    const cm = mb[mi]
    const ct = tb[ti]
    if (cm.end <= ct.start) {
      applyBlock(cm) // mine 的块整体在 theirs 之前：互不干扰
      mi++
    } else if (ct.end <= cm.start) {
      applyBlock(ct)
      ti++
    } else {
      // 交叠 ⇒ 冲突：mine 赢，并丢掉所有与它相交的 theirs 块（手写优先）
      applyBlock(cm)
      mi++
      conflicts++
      while (ti < tb.length && tb[ti].start < cm.end) ti++
    }
  }
  while (mi < mb.length) applyBlock(mb[mi++])
  while (ti < tb.length) applyBlock(tb[ti++])
  emitUpTo(b.length)

  return { text: out.join('\n'), conflicts, mineBlocks: mb.length, theirsBlocks: tb.length }
}
