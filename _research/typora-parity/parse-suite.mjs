/**
 * 一次性诊断脚本（临时，_shots/ 在 .gitignore 内）。
 *
 * 用 **ZeroNote 自己用的解析器**（@codemirror/lang-markdown → Lezer markdown）批量解析测试集，
 * 打印块级结构（深度 ≤2，带源码片段）—— 用来对照 Typora 的渲染截图，判断差异出在解析层还是渲染层。
 *
 * 用法：node _shots/parse-suite.mjs <file...>
 */
import { readFileSync } from 'node:fs'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

// 必须跟 atomic 一致：它用 `markdown({ base: markdownLanguage })`（GFM：
// 表格 / 删除线 / 任务列表 / 自动链接）。用默认 `markdown()` 会漏掉这些节点，
// 拿它对照会把"GFM 本来支持"误报成差异。
const parser = markdown({ base: markdownLanguage }).language.parser

for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8')
  console.log(`\n===== ${file.split(/[\\/]/).pop()} =====`)
  const tree = parser.parse(src)
  // 用 toString()（Lezer 的树打印）而不是 getChildren()：
  // 后者在懒解析的树上拿不到子节点（实测只吐出 Document 一行）。
  // 加换行让它可读。
  console.log(tree.toString().replace(/\(/g, '(\n').replace(/\)/g, '\n)'))
}
