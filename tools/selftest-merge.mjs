#!/usr/bin/env node
/**
 * `src/lib/merge3.ts` 的**离线自测** —— 不必开 GUI、不必跑 CDP。
 *
 * 为什么要有它：合并算法的正确性靠"人眼看界面"验不出来（界面只显示最终文本），
 * 而它一旦错了就是**静默丢用户的内容**。这里把每个分支都钉成一条断言：
 * 没人改 / 只有一边改 / 两边改不同处（**核心**）/ 两边改同一处（冲突保留 mine）。
 *
 * 用法：`node tools/selftest-merge.mjs`
 * 依赖：Node ≥ 22.6（原生跑 `.ts`，本机 v24）。
 */
import { diffBlocks, mergeLines, splitLines } from '../src/lib/merge3.ts'

let pass = 0
const fails = []

const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`✓ ${name}`)
  } else {
    fails.push(name)
    console.log(`✗ ${name}\n    实际 ${a}\n    期望 ${e}`)
  }
}

const BASE = '# 项目计划\n\n- 调研\n  - 竞品\n  - 用户\n- 设计\n\n## 另一组\n\n- 排期\n  - 里程碑\n'

/* ① 谁都没改 ⇒ 原样 */
check('① 三方相同 ⇒ 原样返回', mergeLines(BASE, BASE, BASE).text, BASE)

/* ② 只有编辑器改了 */
{
  const mine = BASE.replace('- 设计', '- 设计（改过）')
  const r = mergeLines(BASE, mine, BASE)
  check('② 只有 mine 改 ⇒ 用 mine', r.text, mine)
  check('② 且无冲突', r.conflicts, 0)
}

/* ③ 只有磁盘变了（导图写回）⇒ 用 theirs */
{
  const theirs = BASE.replace('- 排期', '- 排期\n  - 新主题')
  const r = mergeLines(BASE, BASE, theirs)
  check('③ 只有 theirs 改 ⇒ 用 theirs', r.text, theirs)
}

/* ④ **核心**：两边改不同处 ⇒ 两边的改动都保留（这就是"自动合并"） */
{
  const mine = BASE.replace('- 设计', '- 设计（用户改的）') // 上半篇
  const theirs = BASE.replace('- 里程碑', '- 里程碑\n  - 导图加的') // 下半篇
  const r = mergeLines(BASE, mine, theirs)
  check(
    '④ 两边改不同处 ⇒ 都保留（用户的 + 导图的）',
    [r.text.includes('用户改的'), r.text.includes('导图加的'), r.conflicts],
    [true, true, 0],
  )
}

/* ⑤ 两边改**同一行** ⇒ 冲突，保留 mine，且**不写冲突标记** */
{
  const mine = BASE.replace('- 设计', '- 设计A')
  const theirs = BASE.replace('- 设计', '- 设计B')
  const r = mergeLines(BASE, mine, theirs)
  check('⑤ 同一行两边都改 ⇒ mine 赢', r.text.includes('- 设计A') && !r.text.includes('- 设计B'), true)
  check('⑤ 冲突数 = 1', r.conflicts, 1)
  check('⑤ 不往正文塞冲突标记', /<<<<<<<|>>>>>>>|=======/.test(r.text), false)
}

/* ⑥ 用户加一段 + 导图改另一组 ⇒ 都保留（真实场景的形状） */
{
  const mine = BASE + '\n- 用户追加的一条\n'
  const theirs = BASE.replace('- 竞品\n  - 用户', '- 竞品\n  - 用户\n  - 导图新增')
  const r = mergeLines(BASE, mine, theirs)
  check(
    '⑥ 用户追加 + 导图扩子树 ⇒ 两处都在',
    [r.text.includes('用户追加的一条'), r.text.includes('导图新增'), r.conflicts],
    [true, true, 0],
  )
}

/* ⑦ **真交叠**：mine 把两行合成一行（块 [4,6)），theirs 改了其中第二行（块 [5,6)）⇒ 区间相交 */
{
  const mine = BASE.replace('  - 竞品\n  - 用户', '  - 竞品与用户')
  const theirs = BASE.replace('  - 用户', '  - 用户改')
  const r = mergeLines(BASE, mine, theirs)
  check('⑦ 区间相交 ⇒ 认冲突、mine 赢、内容不重复', [r.conflicts >= 1, /- 用户/.test(r.text)], [true, false])
}
/* ⑦b 相邻但**不相交**的改动 ⇒ 不该误报冲突（区分"挨着"与"撞上"） */
{
  const mine = BASE.replace('  - 竞品', '  - 竞品改')
  const theirs = BASE.replace('  - 用户', '  - 用户改')
  const r = mergeLines(BASE, mine, theirs)
  check('⑦b 相邻两行各改各的 ⇒ 零冲突、都在', [r.conflicts, r.text.includes('竞品改'), r.text.includes('用户改')], [0, true, true])
}

/* ⑧ 尾换行/往返一致 */
{
  const r = mergeLines(BASE, BASE, BASE)
  check('⑧ 尾换行保持（往返一致）', r.text.endsWith('\n'), true)
  check('⑧ splitLines/join 往返一致', splitLines(BASE).join('\n'), BASE)
}

/* ⑨ diffBlocks 基本形状 */
{
  check('⑨ 无改动 ⇒ 0 个块', diffBlocks(splitLines(BASE), splitLines(BASE)).length, 0)
  const blocks = diffBlocks(splitLines(BASE), splitLines(BASE.replace('- 设计', '- X')))
  check('⑨ 改一行 ⇒ 1 个块', [blocks.length, blocks[0].start, blocks[0].end], [1, 5, 6])
}

/* ⑩ 规模：1000 行、改两处，别炸也别退化 */
{
  const big = Array.from({ length: 1000 }, (_, i) => `- 第 ${i} 行`).join('\n') + '\n'
  const mine = big.replace('- 第 10 行', '- 第 10 行（我改的）')
  const theirs = big.replace('- 第 900 行', '- 第 900 行（导图改的）')
  const t0 = Date.now()
  const r = mergeLines(big, mine, theirs)
  const ms = Date.now() - t0
  check(
    `⑩ 1000 行两处改动 ⇒ 都保留且够快（${ms}ms）`,
    [r.text.includes('我改的'), r.text.includes('导图改的'), r.conflicts, ms < 2000],
    [true, true, 0, true],
  )
}

console.log(`\n${fails.length ? '✗ 失败' : '✓ 全部通过'}：${pass}/${pass + fails.length}`)
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exitCode = 1
}
