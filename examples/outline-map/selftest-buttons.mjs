/**
 * 离线自测：**「❖」按钮该出现在哪些行、各自开哪一组**（`mapButtonTargets`）。
 *
 * 起因（2026-10-14 用户实测两条）：
 * ① `# 绪论` 下面接着 `## 数据模型` / `## 信息世界基本概念`，它只是一个**容器标题**
 *    （文档结构的根），却被当成一组大纲、标题左边冒出「❖」按钮 ——
 *    用户原话「只有标题下面接大纲的时候才会被判断为大纲……单独的标题不构成思维导图」。
 * ② 同一个标题下面用**空行断开**的第二个大纲**完全没有入口**（按钮只画在标题行，点开的是第一组）
 *    —— 用户原话「单独大纲也应该能够用导图打开」。
 *
 * 顺带钉住「有按钮 ⇔ 能开出导图」这条不变量：`mapButtonTargets` 的 `index` 必须落在
 * `parseBlocks` 的 `blocks` 里，且该块的 `startLine` 与入口行对得上（标题行入口则是 `titleLine`）。
 *
 * 用法：
 *   node selftest-buttons.mjs                     # 跑内置用例（离线，不需要库）
 *   node selftest-buttons.mjs <笔记.md>           # 额外打印某个真实文件的入口表
 *
 * 行号都是 **0 基**（与 `parseBlocks` 的 `titleLine` / `startLine` 同一口径）。
 */
import { readFileSync } from 'node:fs'
import { parseBlocks, mapButtonTargets, mapButtonLines, outlineDepths, outlineFoldEnds } from './index.js'

const cases = [
  {
    name: '简单笔记：一个标题 + 一组列表（下面没有子标题）⇒ 标题行给按钮',
    md: '# 标题\n- a\n  - b\n',
    expect: [0],
  },
  {
    name: '容器标题：H1 下面还接着 H2 ⇒ H1 那组挂到自己列表首行，H2 给标题行（用户 2026-10-14 ①的形态）',
    md: '# 绪论\n- x\n  - y\n## 数据模型\n- p\n  - q\n',
    expect: [1, 3],
  },
  {
    name: '同一标题下两个独立大纲（空行断开）⇒ 第二个挂它自己的第一行（用户 2026-10-14 ②的形态）',
    md: '# T\n- a\n  - b\n\n- c\n  - d\n',
    expect: [0, 4],
  },
  {
    name: '容器标题的组挂到它自己的第一行（标题行不给按钮）',
    md: '# A\n- x\n  - y\n## B\n- p\n  - q\n',
    expect: [1, 3],
  },
  {
    name: '多个同级标题：H1 是容器（下面是 H2）⇒ 它那组挂首行，两个 H2 各给标题行',
    md: '# A\n- x\n  - x1\n## B\n- y\n  - y1\n## C\n- z\n  - z1\n',
    expect: [1, 3, 6],
  },
  {
    name: '裸列表（文档开头没有标题）⇒ 入口挂在它自己的第一行',
    md: '- a\n  - b\n',
    expect: [0],
  },
  {
    name: '只有标题、下面没有列表 ⇒ 没有按钮',
    md: '# 空标题\n\n## 另一个\n',
    expect: [],
  },
  {
    name: '代码围栏里的 `#` 与 `-` 都不算（不进分组、不进标题表）',
    md: '# T\n- a\n  - a1\n```\n# 不是标题\n- 不是列表\n```\n',
    expect: [0],
  },
  {
    name: '单层平铺列表**不算大纲**⇒ 不给入口（用户 2026-10-14 第四次要求：「单独一个大纲不视为导图」）',
    md: '- a\n- b\n',
    expect: [],
  },
  {
    name: '「非大纲」那种：标题 + 单行列表 ⇒ 不给入口',
    md: '# 非大纲\n- 大纲\n',
    expect: [],
  },
  {
    name: '有嵌套才算大纲 ⇒ 给入口',
    md: '- a\n  - b\n',
    expect: [0],
  },
  {
    name: '标题与大纲之间夹了正文 ⇒ **不算这标题下的组**，入口挂到列表第一行（用户 2026-10-14 实测）',
    md: '# 标题接正文\n123\n456\n\n非大纲\n- 大纲\n  - 1\n',
    expect: [5],
  },
  {
    name: '容器下面还有更深标题：H1、H2 都是容器（各自挂首行），只有 H3 叶子给标题行',
    md: '# A\n- x\n  - x1\n## B\n- y\n  - y1\n### C\n- z\n  - z1\n',
    expect: [1, 4, 6],
  },
]

/**
 * 中心主题（`blocks[].title`）—— 2026-10-14 用户裁定：**只有接着标题的第一个块**用标题当中心，
 * 其余（空行断开的后续块、文档开头的裸列表）一律用「中心主题」。
 * 用户原话：「单独大纲渲染的中心主题是上一级的标题，实际上不接标题的大纲应该统一使用
 * 中心主题作为导图中心」。
 */
const titleCases = [
  { name: '接着标题的第一个块 ⇒ 中心主题 = 标题', md: '# T\n- a\n  - b\n', expect: ['T'] },
  {
    name: '同一标题下第二个块 ⇒ 中心主题（用户 2026-10-14 裁定）',
    md: '# T\n- a\n\n- c\n',
    expect: ['T', '中心主题'],
  },
  {
    name: '同一标题下三个块 ⇒ 只有第一块用标题',
    md: '# T\n- a\n\n- c\n\n- d\n',
    expect: ['T', '中心主题', '中心主题'],
  },
  { name: '文档开头裸列表 ⇒ 中心主题', md: '- a\n- b\n', expect: ['中心主题'] },
  {
    name: '换标题后重新计数 ⇒ 每个标题下的第一个块都用它自己',
    md: '# A\n- a\n\n- b\n## C\n- c\n',
    expect: ['A', '中心主题', 'C'],
  },
]

/**
 * **层级**（`outlineDepths`，竖线用）：行号 → 深度（1 起）。
 * 期望写成 `[[行号, 深度], …]`（会按行号排序后逐项比对）。
 */
const depthCases = [
  { name: '层级：平铺三项都是 1', md: '- a\n- b\n- c\n', expect: [[0, 1], [1, 1], [2, 1]] },
  {
    name: '层级：三级嵌套 + 回到上层',
    md: '- a\n  - a1\n    - a11\n  - a2\n- b\n',
    expect: [[0, 1], [1, 2], [2, 3], [3, 2], [4, 1]],
  },
  {
    name: '层级：同一标题下两个独立块**各从 1 起算**',
    md: '# T\n- a\n  - a1\n\n- b\n',
    expect: [[1, 1], [2, 2], [4, 1]],
  },
  {
    name: '层级：正文/标题/空行都不进表',
    md: '# T\n正文\n- a\n\n- b\n',
    expect: [[2, 1], [4, 1]],
  },
]

let failed = 0
for (const c of cases) {
  const got = mapButtonLines(c.md)
  const ok = got.length === c.expect.length && got.every((v, i) => v === c.expect[i])
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  if (!ok) console.log(`      期望 [${c.expect.join(', ')}]，实得 [${got.join(', ')}]`)
}

/**
 * 不变量：每个入口都指得到一组，且行号与那一组的标题行/首行一致。
 * （这条抓的是"按钮画出来了但点开是空的/开错组"这类错位 —— 它比行号清单更本质。）
 */
let inv = 0
for (const c of cases) {
  const { blocks } = parseBlocks(c.md)
  for (const t of mapButtonTargets(c.md)) {
    const b = blocks[t.index]
    if (!b) {
      inv += 1
      console.log(`FAIL  不变量：${c.name} —— 入口行 ${t.line} 指向不存在的组 ${t.index}`)
      continue
    }
    if (t.line !== b.titleLine && t.line !== b.startLine) {
      inv += 1
      console.log(
        `FAIL  不变量：${c.name} —— 入口行 ${t.line} 既不是组标题行 ${b.titleLine} 也不是首行 ${b.startLine}`,
      )
    }
  }
}
if (!inv) console.log('PASS  不变量：每个入口行都对得上一个真实组（标题行或首行）')

/* ── 中心主题 ── */
let tFail = 0
for (const c of titleCases) {
  const got = parseBlocks(c.md).blocks.map((b) => b.title)
  const ok = got.length === c.expect.length && got.every((v, i) => v === c.expect[i])
  if (!ok) tFail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  if (!ok) console.log(`      期望 [${c.expect.join(', ')}]，实得 [${got.join(', ')}]`)
}

/**
 * **折叠范围**（`outlineFoldEnds`，2026-10-14 rev80）：折点 → 子项末行。
 *
 * 判据抓三件事：① **只有有子项的行**才是折点（平铺单层不该出现折叠圆点）；
 * ② 范围是**子树的最大行号**（深层嵌套要一路盖到底）；③ 空行断开的块**各算各的**。
 */
const foldCases = [
  { name: '一层嵌套：父行折叠范围 = 唯一子行', md: '- a\n  - b\n', expect: [[0, 1]] },
  {
    name: '两层嵌套：父折到最深子行，中间那层也各自是折点',
    md: '- a\n  - b\n    - c\n',
    expect: [
      [0, 2],
      [1, 2],
    ],
  },
  { name: '平铺单层列表：没有折点（不给折叠圆点）', md: '- a\n- b\n', expect: [] },
  {
    name: '空行断开的两个块：各算各的',
    md: '- a\n  - b\n\n- c\n  - d\n',
    expect: [
      [0, 1],
      [3, 4],
    ],
  },
  {
    name: '兄弟节点：前一个有子项、后一个没有',
    md: '- a\n  - b\n  - c\n- d\n  - e\n',
    expect: [
      [0, 2],
      [3, 4],
    ],
  },
]

const file = process.argv[2]
if (file) {
  const md = readFileSync(file, 'utf8')
  const lines = md.split(/\r?\n/)
  const { blocks } = parseBlocks(md)
  console.log(`\n— ${file} —`)
  const targets = mapButtonTargets(md)
  console.log(targets.length ? '入口表（入口行 → 组）：' : '（这篇没有入口）')
  for (const t of targets) {
    console.log(`  第 ${t.line + 1} 行「${lines[t.line] ?? ''}」⇒ 组[${t.index}]「${blocks[t.index]?.title}」`)
  }
}

/* ── 层级（竖线） ── */
let dFail = 0
for (const c of depthCases) {
  const got = [...outlineDepths(c.md).entries()].sort((a, b) => a[0] - b[0])
  const ok =
    got.length === c.expect.length &&
    got.every(([line, depth], i) => line === c.expect[i][0] && depth === c.expect[i][1])
  if (!ok) dFail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  if (!ok) {
    console.log(`      期望 [${c.expect.map((p) => p.join(':')).join(', ')}]`)
    console.log(`      实得 [${got.map((p) => p.join(':')).join(', ')}]`)
  }
}

/* ── 折叠范围（rev80） ── */
let fFail = 0
for (const c of foldCases) {
  const got = [...outlineFoldEnds(c.md).entries()].sort((a, b) => a[0] - b[0])
  const ok =
    got.length === c.expect.length &&
    got.every(([line, end], i) => line === c.expect[i][0] && end === c.expect[i][1])
  if (!ok) fFail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  if (!ok) {
    console.log(`      期望 [${c.expect.map((p) => p.join(':')).join(', ')}]`)
    console.log(`      实得 [${got.map((p) => p.join(':')).join(', ')}]`)
  }
}

const total = cases.length + titleCases.length + depthCases.length + foldCases.length
const bad = failed + tFail + dFail + inv + fFail
console.log(
  `\n${total - failed - tFail - dFail - fFail}/${total} passed` +
    `${failed ? ` —— 按钮行 ${failed} 个失败` : ''}${tFail ? ` —— 中心主题 ${tFail} 个失败` : ''}` +
    `${dFail ? ` —— 层级 ${dFail} 个失败` : ''}${inv ? ` —— 不变量 ${inv} 处失败` : ''}` +
    `${fFail ? ` —— 折叠 ${fFail} 个失败` : ''}`,
)
process.exit(bad ? 1 : 0)
