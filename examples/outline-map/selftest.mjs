/**
 * 离线自测：`node selftest.mjs <笔记路径> [输出 svg 路径]`
 *
 * 为什么要有它：插件的核心（解析 → 布局 → SVG / Mermaid）全是**纯函数**，
 * 不该为了看一眼输出就去开 GUI 点菜单（那样既慢，又会抢用户的鼠标）。
 * 这里直接把结果打出来 + 落一份 SVG，需要看图时再用浏览器 headless 转 PNG。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseOutline, parseBlocks, flatNodes, blockToTree, flatten, toSvg, toMermaid } from './index.js'

const file = process.argv[2]
if (!file) {
  console.error('用法：node selftest.mjs <笔记路径> [out.svg]')
  process.exit(2)
}
const outSvg = process.argv[3] ?? 'outline-map.svg'

const md = readFileSync(file, 'utf8')
const { root, firstH1 } = parseOutline(md)
const flat = flatten(root)
root.text = firstH1 || '（本篇）'

console.log(`笔记：${file}`)
console.log(`节点：${flat.length} 项，层级 ${flat.reduce((m, r) => Math.max(m, r.depth), 0) + 1} 级`)
console.log('— 大纲 —')
console.log(flat.map((r) => '  '.repeat(r.depth) + r.text).join('\n'))
console.log('— Mermaid mindmap —')
console.log(toMermaid(root, root.text))
const svg = toSvg(root)
writeFileSync(outSvg, svg)
console.log(`— SVG — 已写入 ${outSvg}（${svg.length} 字节）`)

/**
 * v0.2 的分组（组 = 极大连通的列表块，见 index.js 文件头）。
 * **带行号**：编辑写回靠它 —— 离线这里就能看出"第几行属于哪一组"对不对。
 */
const { blocks } = parseBlocks(md)
console.log(`— 分组（v0.2）— 共 ${blocks.length} 组`)
blocks.forEach((b, i) => {
  const rows = flatNodes(b.nodes)
  console.log(
    `  [${i}] ${b.title}：行 ${b.startLine + 1}–${b.endLine + 1}，${rows.length} 项` +
      `（顶级 ${b.nodes.length}）`,
  )
})
if (blocks.length) {
  const first = blocks[0]
  console.log(`— 第 0 组的导图 SVG 长度：${toSvg(blockToTree(first)).length} 字节 —`)
}

/**
 * 再落一份**带颜色兜底**的 HTML 预览：插件在宿主里靠 `var(--zn-*)` 取主题色，
 * 而独立打开 SVG 时那些变量不存在（会渲染成黑块/透明）。
 * 这组变量**只存在于预览页**，绝不进插件本体 —— 否则会反向覆盖宿主的主题。
 */
const previewHtml = `<!doctype html><meta charset="utf-8"><title>outline-map 预览</title><style>
:root{--zn-fg:#1f2328;--zn-bg-subtle:#f6f8fa;--zn-border:#d0d7de;--zn-accent:#2563eb;
      --zn-font:system-ui,"Microsoft YaHei",sans-serif}
body{margin:0;padding:18px;background:#fff}
</style>${svg}`
const outHtml = `${outSvg.replace(/\.svg$/i, '')}.preview.html`
writeFileSync(outHtml, previewHtml)
console.log(`— 预览 — 已写入 ${outHtml}（浏览器打开，或 headless 截图）`)
