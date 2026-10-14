/**
 * 离线自测：**「❖」按钮该出现在哪些行**（`mapButtonLines`）。
 *
 * 起因（2026-10-14 用户实测）：`# 绪论` 下面接着 `## 数据模型` / `## 信息世界基本概念`，
 * 它只是一个**容器标题**（文档结构的根），却被当成了一组大纲、标题左边冒出「❖」按钮。
 * 用户原话：「只有标题下面接大纲的时候才会被判断为大纲，可以转成思维导图。单独的标题
 * 不构成思维导图」。
 *
 * 用法：
 *   node selftest-buttons.mjs                     # 跑内置用例（离线，不需要库）
 *   node selftest-buttons.mjs <笔记.md>           # 额外打印某个真实文件的按钮行
 *
 * 行号都是 **0 基**（与 `parseBlocks` 的 `titleLine` / `startLine` 同一口径）。
 */
import { readFileSync } from 'node:fs'
import { mapButtonLines } from './index.js'

const cases = [
  {
    name: '简单笔记：一个标题 + 一组列表（下面没有子标题）⇒ 标题行给按钮',
    md: '# 标题\n- a\n  - b\n',
    expect: [0],
  },
  {
    name: '容器标题：H1 下面还接着 H2 ⇒ H1 不给按钮，H2 给（用户 2026-10-14 要的形态）',
    md: '# 绪论\n- x\n  - y\n## 数据模型\n- p\n  - q\n',
    expect: [3],
  },
  {
    name: '多个同级标题：互不为容器 ⇒ 都给',
    md: '# A\n- x\n## B\n- y\n## C\n- z\n',
    expect: [2, 4],
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
    md: '# T\n- a\n```\n# 不是标题\n- 不是列表\n```\n',
    expect: [0],
  },
  {
    name: '容器下面还有更深标题：三级都得看层级（H1 容器 / H2 容器 / H3 叶子）',
    md: '# A\n- x\n## B\n- y\n### C\n- z\n',
    expect: [4],
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

const file = process.argv[2]
if (file) {
  const md = readFileSync(file, 'utf8')
  const lines = md.split(/\r?\n/)
  const got = mapButtonLines(md)
  console.log(`\n— ${file} —`)
  console.log(got.length ? '该出按钮的行：' : '（这篇没有按钮）')
  for (const l of got) console.log(`  第 ${l + 1} 行：${lines[l] ?? ''}`)
}

console.log(`\n${cases.length - failed}/${cases.length} passed${failed ? ` —— ${failed} 个失败` : ''}`)
process.exit(failed ? 1 : 0)
