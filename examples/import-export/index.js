/**
 * 导入导出插件
 *
 * · **批 1**：md / txt 导入（已验证）
 * · **批 2**：**html→md**、**docx→md** 导入；**导出 txt / html**
 * · **批 3（rev173.227）**：**导入落点改成 `日期导入/<YYYY-MM-DD>/[原分类/]<文件名>.md`**
 *   （需求 §12：统一放「日期导入」· 按原分类保存 · 同一天合并）＋ 导入时补 frontmatter
 *   （`created` = 导入时刻、`source` = 原文件名）
 * · 后续批：pdf / epub 导入（复用已内置 pdf.js / foliate-js）、长图、docx 导出、Android 导出
 *
 * ## 通道（全走契约）
 *
 * ```
 * 导入：host.pickFile() → host.readContentUri() → fetch(host.assetUrlAbs()) → 转换 → fs.createNote()
 * 导出：doc.active() → 渲染 → host.saveFile({ defaultName, content })
 *      （桌面写绝对路径；Android 走 SAF 的 content://，需要 uri-reader 的 write_content_uri —— 见文件尾注释）
 * ```
 *
 * ## 转换库从哪来
 *
 * 插件是 **Blob 模块**，import 不到裸包名 ⇒ 转换库放**应用内置** `public/vendor/`，
 * 用绝对 URL 加载。三个库都是 MIT/BSD，体积见 HANDOFF rev85 的选型表：
 * · turndown 7.2.4 + turndown-plugin-gfm 1.0.2（UMD，注入 `<script>`）
 * · marked 18.1.1（ESM，动态 `import()`）
 * · mammoth 1.13.0（UMD，注入 `<script>`）
 *
 * **懒加载**：三个库只在真正用到某格式时才拉（md/txt 导入不需要它们）。
 */

/* ─────────── 应用内置 vendor ─────────── */

/** Blob 模块里相对路径没有 base ⇒ 一律用**绝对 URL**（与 doc-reader 同一做法） */
const vendor = (p) => new URL(`/vendor/${p}`, location.origin).href

/** 注入一个 UMD `<script>`（turndown / mammoth 是 UMD，不能用 import 加载） */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.dataset.znPluginVendor = '1' // 供卸载时清理
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`转换库加载失败：${src}`))
    document.head.append(s)
  })
}

let libsPromise = null
/** 懒加载三个转换库（只拉一次；失败下次可重试） */
function libs() {  libsPromise ??= (async () => {
    try {
      const [marked] = await Promise.all([
        importWithRetry(vendor('marked/marked.esm.js')),
        loadScript(vendor('turndown/turndown.js')),
        loadScript(vendor('turndown/turndown-plugin-gfm.js')),
        loadScript(vendor('mammoth/mammoth.browser.min.js')),
      ])
      return {
        marked,
        TurndownService: window.TurndownService,
        gfm: window.turndownPluginGfm?.gfm,
        mammoth: window.mammoth,
      }
    } catch (e) {
      libsPromise = null // 失败别把坏结果缓存住
      throw e
    }
  })()
  return libsPromise
}

/**
 * 造一个配好的 TurndownService（html 导入与 epub 导入共用）。
 *
 * ⚠️ **必须显式 `remove` script / style / head / title / noscript** ——
 * turndown **不会**替你丢掉它们的**文本内容**：真机实测（`测试书籍.epub` 里藏了一段探测脚本），
 * 那段 `try{parent.__epubScriptRan=true;…}` 原样进了笔记正文。
 * EPUB 的 `<head>` 里还有 `<title>` 与内联样式，一并剔掉。
 */
async function makeTurndown() {
  const { TurndownService, gfm } = await libs()
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  if (gfm) td.use(gfm) // 表格 / 删除线 / 任务列表不在核心
  td.remove(['script', 'style', 'head', 'title', 'noscript'])

  /**
   * **mammoth 的表格 HTML 没有 `<thead>`**，而 turndown 的 gfm 插件要求 `th` / `thead`
   * 才认表格 ⇒ 会原样保留整块 `<table>…</table>`（真机实测，rev89 之后这一轮）。
   * 这里补一条兜底：把「首行当表头」的无 thead 表格转成 GFM 表格。
   * （有 `thead` 的会被 `filter` 排除，仍交给 gfm 自己的规则。）
   */
  td.addRule('tableWithoutThead', {
    filter: (node) => node.nodeName === 'TABLE' && !node.querySelector('thead'),
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'))
      if (!rows.length) return ''
      const cell = (c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|')
      const grid = rows.map((tr) => Array.from(tr.children).map(cell))
      const width = Math.max(...grid.map((r) => r.length))
      const pad = (r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]
      const line = (r) => `| ${pad(r).join(' | ')} |`
      return `\n\n${line(grid[0])}\n| ${pad(grid[0])
        .map(() => '---')
        .join(' | ')} |\n${grid.slice(1).map(line).join('\n')}\n\n`
    },
  })
  return td
}

/* ─────────── 小工具 ─────────── */

const extOf = (name) => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/**
 * 字节 → 文本：**先按 UTF-8 严格解，失败才回退 GBK**。
 *
 * 为什么不能直接 `res.text()`：那是「UTF-8 宽松解码」—— 遇到 GBK 文本**不报错**，
 * 只是整篇变成乱码（用户拿到一篇看不懂的笔记，比报错更糟）。
 * `fatal: true` 让 UTF-8 在非法字节处抛错，我们才有机会换 GBK；
 * Chromium 原生支持 `'gbk'` 这个 label，零依赖。
 */
function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gbk').decode(buf)
  }
}

/* ─────────── 源文件 → Markdown ─────────── */

/**
 * 动态 `import()` 的**一次带参重试**（与 doc-reader 同款防御，见 HANDOFF rev84）。
 *
 * 真机实测过：同源同目录同后缀，某条 URL 会报 `Failed to fetch dynamically imported module`，
 * 而**加个查询串立刻成功**（坏记录在那条 URL 的加载缓存里，根因未定）。
 * 正常路径不带参数，只在失败后加一次。
 */
async function importWithRetry(url) {
  try {
    return await import(url)
  } catch (err) {
    try {
      return await import(`${url}${url.includes('?') ? '&' : '?'}znretry=${Date.now()}`)
    } catch {
      throw err
    }
  }
}

let pdfjsPromise = null
/** 加载已内置的 pdf.js（与 doc-reader 用的是同一份 vendor，不重复引库） */
function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const lib = await importWithRetry(vendor('pdfjs/build/pdf.min.mjs'))
    lib.GlobalWorkerOptions.workerSrc = vendor('pdfjs/build/pdf.worker.min.mjs')
    return lib
  })()
  return pdfjsPromise
}

/**
 * pdf.js 的 `TextItem[]` → 文本行。
 *
 * pdf.js **不做版面分析**（没有段落/阅读顺序 API），只有每段的
 * `transform` 矩阵（`[a,b,c,d,e,f]`，其中 `e` = x、`f` = y）和 `hasEOL`。
 * 这里用最朴素也最稳的启发式：**同一行的 y 相差 ≤ 2** 归为一行（PDF 的 y 轴向上 ⇒
 * 按 y 递减即从上到下），行内按 x 排序拼接。
 * 局限（如实告诉用户）：多栏排版、表格会退化成"看起来像文字流"；扫描件没有文字对象。
 */
function pdfTextToLines(items) {
  const rows = []
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.transform) continue
    const x = it.transform[4]
    const y = Math.round(it.transform[5])
    let row = rows.find((r) => Math.abs(r.y - y) <= 2)
    if (!row) {
      row = { y, parts: [] }
      rows.push(row)
    }
    row.parts.push({ x, s: it.str })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join('')
        .trimEnd(),
    )
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === '')) // 连续空行压一行
}

/** PDF → Markdown（先支持**有文字层**的 PDF；扫描件给明确提示） */
async function pdfToMarkdown(buf) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  try {
    const chunks = []
    let textItems = 0
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      textItems += tc.items.length
      const lines = pdfTextToLines(tc.items)
      chunks.push(`## 第 ${i} 页\n\n${lines.join('\n')}`)
    }
    if (textItems === 0) {
      throw new Error('这份 PDF 没有文字层（可能是扫描件/纯图片）—— 需要 OCR，不在本插件范围')
    }
    return chunks.join('\n\n')
  } finally {
    try {
      await doc.destroy()
    } catch {
      /* 已经销毁就算了 */
    }
  }
}

/**
 * EPUB → Markdown。
 *
 * **自己解 zip（fflate）＋ turndown 转换**，而不是调 foliate-js 的解析 API ——
 * foliate 的 `EPUB` 类要求调用方提供一组 `loadText/loadBlob/getSize` 回调（它把 zip 访问
 * 抽象出去了），而我们**已经在文档阅读器里用过它渲染**（`/vendor/foliate/view.js`）；
 * 对"抽文本"这个需求，直接 `unzipSync` + 读 OPF/spine 更直白，也复用了已有的 turndown。
 *
 * 流程（EPUB = 一个 zip）：`META-INF/container.xml` → OPF 路径 → OPF 里解析
 * `manifest[id → href]` 与 `spine` 顺序 → 逐章 XHTML 交给 turndown → 拼接。
 */
async function epubToMarkdown(buf) {
  const fflate = await importWithRetry(vendor('fflate/fflate.mjs'))
  const files = fflate.unzipSync(new Uint8Array(buf))
  const readPath = (p) => {
    const hit = files[p] ?? files[decodeURIComponent(p)]
    return hit ? decodeText(hit) : null
  }

  const container = readPath('META-INF/container.xml')
  if (!container) throw new Error('这个 EPUB 里没有 META-INF/container.xml（不是标准 EPUB？）')
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1]
  if (!opfPath) throw new Error('container.xml 里找不到 OPF 路径')
  const opf = readPath(opfPath)
  if (!opf) throw new Error(`OPF 读不到：${opfPath}`)
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  // manifest：id → { href, mt }（只认 XHTML / HTML）
  const manifest = {}
  for (const tag of opf.match(/<item\b[^>]*>/g) ?? []) {
    const id = /id="([^"]+)"/.exec(tag)?.[1]
    const href = /href="([^"]+)"/.exec(tag)?.[1]
    const mt = /media-type="([^"]+)"/.exec(tag)?.[1] ?? ''
    if (id && href) manifest[id] = { href, mt }
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1])
  const title = /<dc:title[^>]*>([^<]*)</i.exec(opf)?.[1]?.trim() ?? ''

  const td = await makeTurndown()

  const parts = []
  if (title) parts.push(`# ${title}`)
  let chapters = 0
  for (const id of spine) {
    const item = manifest[id]
    if (!item) continue
    if (item.mt && !/x?html/i.test(item.mt)) continue
    const html = readPath(base + item.href)
    if (!html) continue
    chapters++
    const md = td.turndown(html).trim()
    if (md) parts.push(md)
  }
  if (chapters === 0) throw new Error('这个 EPUB 的 spine 里没有可读的 XHTML 章节')
  console.log('[io] epub 章节数 =', chapters, '| 标题 =', title)
  return parts.join('\n\n')
}

/**
 * `buf` 是原始字节（不是字符串）—— docx 要走 `arrayBuffer`，
 * 文本类才解码；这样只读一次文件。
 */
async function toMarkdown(name, buf) {
  const ext = extOf(name)

  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return decodeText(buf)

  if (ext === 'html' || ext === 'htm') {
    const td = await makeTurndown()
    return td.turndown(decodeText(buf))
  }

  if (ext === 'docx') {
    /**
     * 走 **`convertToHtml` + turndown**，而不是 mammoth 自带的 `convertToMarkdown`。
     *
     * 真机实测（rev86）：`convertToMarkdown` 把**表格拍成逐单元格一行**
     * （`表头A` / `表头B` / `a` / `b` 各占一行），而它输出的 HTML 里表格结构是完整的
     * ⇒ 交给配好 gfm 的 turndown 能还原成 GFM 表格。
     * 两条路都不做"还原版式"（mammoth 官方也声明走语义化），但**表格这一项差别很明显**。
     */
    const { mammoth } = await libs()
    const r = await mammoth.convertToHtml({ arrayBuffer: buf })
    const td = await makeTurndown()
    return td.turndown(r.value)
  }

  if (ext === 'pdf') return await pdfToMarkdown(buf)
  if (ext === 'epub') return await epubToMarkdown(buf)

  throw new Error(`还不支持 .${ext}`)
}

/* ─────────── Markdown → 其它格式 ─────────── */

/** Markdown → 纯文本：温和地剥掉标记（不追求完美，够读就行） */
function mdToText(md) {
  return md
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') // frontmatter
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1') // 代码块去围栏
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接只留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Markdown → **单文件 HTML**（样式内联，可直接发给别人 / 打印成 PDF） */
async function mdToHtml(md, title) {
  const { marked } = await libs()
  const body = marked.parse(md)
  const esc = String(title).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc}</title>
<style>
  :root{color-scheme:light dark}
  body{max-width:46em;margin:0 auto;padding:2.2em 1.2em 4em;
       font:16px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
       color:#18181b;background:#fff;word-wrap:break-word}
  h1,h2,h3,h4{line-height:1.3;margin:1.6em 0 .6em}
  h1{font-size:1.9em;border-bottom:1px solid #e4e4e7;padding-bottom:.3em}
  h2{font-size:1.45em}
  code{background:#f4f4f5;padding:.15em .35em;border-radius:4px;font-size:.9em}
  pre{background:#f4f4f5;padding:1em;border-radius:8px;overflow:auto}
  pre code{background:none;padding:0}
  blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid #d4d4d8;color:#52525b}
  table{border-collapse:collapse;margin:1em 0}
  th,td{border:1px solid #d4d4d8;padding:.4em .7em}
  img{max-width:100%}
  a{color:#2563eb}
  @media (prefers-color-scheme:dark){
    body{color:#e4e4e7;background:#18181b}
    code,pre{background:#27272a}
    h1{border-color:#3f3f46}
    blockquote{border-color:#52525b;color:#a1a1aa}
    th,td{border-color:#3f3f46}
  }
  @media print{body{max-width:none;padding:0}}
</style></head>
<body>
${body}
</body></html>`
}

/** HTML 文本转义（`mdToHtml` / `mdToLongImage` 都要给 `<title>` 用） */
const escHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * Markdown → **长图 PNG**（用户点名的功能）。
 *
 * 路线：Markdown → HTML（marked）→ 挂在**离屏容器**（同源 ⇒ 拿得到 computedStyle）
 * → `modern-screenshot` 的 `domToPng` → dataURL → `Uint8Array`
 * （给 `host.saveFile` 走 base64 过桥 —— `Vec<u8>` 那条路会被序列化成 JSON 数字数组）。
 *
 * 为什么用 modern-screenshot 而不是 html2canvas：它是 html-to-image 的 fork，走
 * **SVG foreignObject** 路线（CSS 交给浏览器自己渲染，保真），体积也只有 1/4
 * （gzip 14 KB vs 47 KB）。
 *
 * ⚠️ 已知限制（如实标注）：
 * · **canvas 单边上限**约 16384 px ⇒ 太高就自动降 scale（这里按 `scrollHeight` 判断）
 * · **跨域字体**在 foreignObject 里会失败；这里用系统字体（本地）没这个问题
 * · 超长笔记（几万字）建议分段导出
 */
async function mdToLongImage(md, title) {
  const { marked } = await libs()
  const { domToPng } = await importWithRetry(vendor('modern-screenshot/modern-screenshot.mjs'))
  const width = Math.max(320, Math.min(window.innerWidth || 600, 760))
  const box = document.createElement('div')
  box.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    `width:${width}px`,
    'background:#ffffff',
    'color:#18181b',
    'padding:28px 24px',
    'font:16px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    'word-wrap:break-word',
  ].join(';')
  box.innerHTML =
    `<style>` +
    `h1{font-size:1.7em;margin:.9em 0 .5em;padding-bottom:.25em;border-bottom:1px solid #e4e4e7}` +
    `h2{font-size:1.35em;margin:1.2em 0 .45em}` +
    `h3{font-size:1.15em;margin:1.1em 0 .4em}` +
    `p{margin:.7em 0}` +
    `code{background:#f4f4f5;padding:.12em .32em;border-radius:4px;font-size:.9em}` +
    `pre{background:#f4f4f5;padding:.9em;border-radius:8px;overflow:auto}` +
    `pre code{background:none;padding:0}` +
    `blockquote{margin:.9em 0;padding:.15em 1em;border-left:3px solid #d4d4d8;color:#52525b}` +
    `table{border-collapse:collapse;margin:.9em 0}` +
    `th,td{border:1px solid #d4d4d8;padding:.35em .6em}` +
    `img{max-width:100%}` +
    `ul,ol{padding-left:1.6em}` +
    `.zn-li-head{font-size:.85em;color:#71717a;margin-bottom:.8em}` +
    `</style>` +
    `<div class="zn-li-head">${escHtml(title)}</div>${marked.parse(md)}`
  document.body.append(box)
  try {
    const h = Math.max(1, box.scrollHeight)
    // canvas 单边约 16384：高度×scale 超了就降 scale（优先保内容完整）
    const scale = h * 2 > 16000 ? Math.max(1, 16000 / h) : 2
    console.log('[io] 长图尺寸 w=', width, 'h=', h, 'scale=', scale)
    const dataUrl = await domToPng(box, { scale, backgroundColor: '#ffffff' })
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } finally {
    box.remove()
  }
}

/** 行内标记 → docx 的 `TextRun[]`（粗体 / 斜体 / 行内代码；链接退化成 `文字 (url)`） */
function inlineRuns(D, text) {
  const out = []
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new D.TextRun(text.slice(last, m.index)))
    if (m[2] != null) out.push(new D.TextRun({ text: m[2], bold: true }))
    else if (m[4] != null)
      out.push(new D.TextRun({ text: m[4], font: { ascii: 'Consolas', eastAsia: '等线' } }))
    else if (m[6] != null) out.push(new D.TextRun({ text: m[6], italics: true }))
    else if (m[8] != null) out.push(new D.TextRun({ text: `${m[8]} (${m[9]})` }))
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(new D.TextRun(text.slice(last)))
  return out.length ? out : [new D.TextRun(text)]
}

/**
 * Markdown → **docx**（[docx](https://www.npmjs.com/package/docx) 9.11.0，自写映射）。
 *
 * 为什么不引现成的 markdown-docx：选型报告里那几个包**月下载个位数**，或 2016 年就停更
 * （见 HANDOFF rev85）；而 `docx` 本身活跃维护（MIT），且**中文零成本** ——
 * 它只写字体名（`font.eastAsia`），**不需要内嵌字体**（对比 jsPDF 要嵌 17.7 MB 的思源黑体）。
 *
 * 覆盖：标题 1–6 / 段落 / 无序列表 / 有序列表（都按项目符号）/ 引用 / 围栏代码块 / 分隔线；
 * 行内：粗体 / 斜体 / 行内代码 / 链接（退化成文字 + url）。
 * **表格与图片暂不支持**（如实标注，不静默丢——列表外的行照样进正文）。
 */
async function mdToDocx(md, title) {
  await loadScript(vendor('docx/docx.iife.js'))
  const D = window.docx
  if (!D || !D.Document || !D.Packer) throw new Error('docx 库没有挂到 window（vendor 加载异常）')

  const children = [new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun(title)] })]
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let inCode = false
  let codeBuf = []

  const flushCode = () => {
    if (!codeBuf.length) return
    children.push(
      new D.Paragraph({
        children: codeBuf.map(
          (t) => new D.TextRun({ text: t, font: { ascii: 'Consolas', eastAsia: '等线' }, size: 20 }),
        ),
      }),
    )
    codeBuf = []
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*```/.test(line)) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(raw)
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = D.HeadingLevel[`HEADING_${h[1].length}`]
      children.push(new D.Paragraph({ heading: lvl, children: inlineRuns(D, h[2]) }))
      continue
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ul) {
      children.push(new D.Paragraph({ bullet: { level: 0 }, children: inlineRuns(D, ul[1]) }))
      continue
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ol) {
      children.push(new D.Paragraph({ bullet: { level: 0 }, children: inlineRuns(D, ol[1]) }))
      continue
    }
    const bq = /^>\s?(.*)$/.exec(line)
    if (bq) {
      children.push(
        new D.Paragraph({
          indent: { left: 360 },
          children: [new D.TextRun({ text: bq[1], italics: true, color: '52525B' })],
        }),
      )
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      children.push(new D.Paragraph('——————')) // docx 没有原生分割线；用一条字符线（保守 API）
      continue
    }
    if (line.trim() === '') {
      children.push(new D.Paragraph(''))
      continue
    }
    children.push(new D.Paragraph({ children: inlineRuns(D, line) }))
  }
  flushCode()

  const doc = new D.Document({
    styles: {
      default: {
        document: {
          run: { font: { ascii: 'Calibri', eastAsia: '微软雅黑' }, size: 22 },
        },
      },
    },
    sections: [{ children }],
  })
  const blob = await D.Packer.toBlob(doc)
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Markdown → **PDF：走浏览器打印栈**（桌面专有）。
 *
 * 为什么不自绘 PDF：选型报告里 jsPDF 的中文要嵌**整**字体（Noto Sans SC 变量 TTF = 17.7 MB）、
 * pdf-lib 的 CJK 子集化有**未修 bug**（HANDOFF rev85 有链接）。而 `window.print()` 用系统字体、
 * 中文零成本、零体积 —— Tauri 源码注释原文：「`window.print()` works on all platforms」。
 *
 * 做法：往 `body` 挂一个 `.zn-print-root`，**屏幕上**全屏显示（让用户先看到排版），
 * **打印时**用 `@media print` 把 `body` 的其它子元素全部隐藏、只留它，并加 `@page` 边距与
 * `break-inside: avoid`（表格/代码块不被切页）。
 *
 * ⚠️ **Android 走不通**（Tauri 的打印在 Android 无效，issue #11933 open）—— 平台判断在调用处。
 */
async function printMarkdown(md, title, dryRun) {
  const { marked } = await libs()
  const body = marked.parse(md)
  const box = document.createElement('div')
  box.className = 'zn-print-root'
  box.innerHTML =
    `<style>` +
    `@media screen{.zn-print-root{position:fixed;inset:0;z-index:9999;overflow:auto;background:#fff;color:#18181b;padding:2.2em 1.2em;font:16px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}}` +
    `@media print{body>*{display:none!important}body>.zn-print-root{display:block!important;position:static;padding:0;overflow:visible}` +
    `@page{margin:16mm 14mm}pre,blockquote,table,img{break-inside:avoid}}` +
    `h1{font-size:1.8em}h2{font-size:1.4em}h3{font-size:1.15em}` +
    `pre{background:#f4f4f5;padding:.8em;border-radius:6px;overflow:auto}` +
    `code{background:#f4f4f5;padding:.1em .3em;border-radius:4px}` +
    `pre code{background:none}` +
    `blockquote{margin:.9em 0;padding:.15em 1em;border-left:3px solid #d4d4d8;color:#52525b}` +
    `table{border-collapse:collapse}th,td{border:1px solid #d4d4d8;padding:.3em .6em}` +
    `</style>` +
    `<h1>${escHtml(title)}</h1>${body}`
  document.body.append(box)
  await new Promise((r) => setTimeout(r, 250)) // 等排版完成再调打印
  const chars = box.innerHTML.length
  if (dryRun) {
    // 探针模式：只报排版结果，**绝不调 `print()`**
    // —— 那会弹出系统打印对话框，在自动化里等于把会话卡死（本轮特意加这道闸）
    box.remove()
    return { chars }
  }
  window.print() // 打印栈：用户在「目标打印机」里选「另存为 PDF」
  setTimeout(() => box.remove(), 3000) // 打印对话框通常是阻塞的；不阻塞时兜底清理
  return { chars }
}

/* ─────────── 导入落点与元数据（需求 §12 · rev173.227） ─────────── */

/**
 * 「日期导入」根目录（需求原文用词）。
 *
 * ⚠️ 与 AI 插件联动：`examples/ai/index.js` 的 `EXCLUDED_DIRS` 里有同名条目 ——
 * 导入后的笔记**不触发 AI 自动任务**（需求 §12 最后两条：导入后不立即让 AI 整理）。
 * 改名要两边一起改。
 */
export const IMPORT_ROOT = '日期导入'

/**
 * 目录 / 文件名清洗：去掉 Windows 非法字符与控制字符，压空白，去首尾点，限 40 字。
 * 返回 '' 表示「这一层不要」（调用方决定：分类为空就不建那层目录）。
 */
export function sanitizeDirName(raw) {
  return String(raw ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 40)
}

/**
 * 没有「分类」语义的父目录名 —— 从这些目录导入时猜出来的分类只是噪音。
 * （`cache` 那几条是 Android `content://` 的副本落点：`.../cache/<原名>`。）
 */
const GENERIC_PARENTS = new Set([
  'desktop', 'downloads', 'download', 'documents', 'document', 'temp', 'tmp', 'cache', 'caches',
  'users', 'export', 'exports', 'dcim', 'pictures', 'movies', 'music',
  '桌面', '下载', '下载夹', '文档', '临时', '导出',
])

/**
 * 从源文件的绝对路径猜「原分类」= 父目录名（需求 §12「尽量保留原分类」）。
 *
 * 判据很保守：**只取直接父目录**，通用目录（桌面 / 下载 / 缓存 …）与盘符根返回 ''。
 * 为什么不做「往上找第一个有意义的目录」：那会把 `C:/Users/AQUA/…` 猜成 `AQUA`，
 * 比不猜更糟；真正的「原分类」只有批量导入器（印象笔记 / Notion 导出目录树）才拿得到。
 */
export function guessCategory(absPath) {
  const s = String(absPath ?? '').trim()
  if (!s) return ''
  const parts = s.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2]
  if (!parent || /^[a-zA-Z]:$/.test(parent)) return ''
  if (GENERIC_PARENTS.has(parent.toLowerCase())) return ''
  return sanitizeDirName(parent)
}

/** 本地日期 `YYYY-MM-DD`（同一天多次导入要落进同一个目录） */
export function importDateStamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 导入落点（**不含扩展名**，交给 `freeRelPath` 加 `.md` 并去重）：
 *
 * ```
 * 日期导入/<YYYY-MM-DD>/<文件名>
 * 日期导入/<YYYY-MM-DD>/<原分类>/<文件名>     ← 有分类时多一层
 * ```
 *
 * 需求 §12：统一放「日期导入」· 里面按原分类名保存 · 同一天多次导入合并同一目录。
 */
export function importBasePath({ date, stem, category }) {
  const d = date instanceof Date ? date : new Date(date ?? Date.now())
  const day = importDateStamp(d)
  const cat = sanitizeDirName(category)
  const name = sanitizeDirName(stem) || 'imported'
  return cat ? `${IMPORT_ROOT}/${day}/${cat}/${name}` : `${IMPORT_ROOT}/${day}/${name}`
}

/**
 * 给导入内容补元数据（需求 §12「创建时间等」）：
 *
 * - 没有 frontmatter → 新建一块，写 `created` / `source`
 * - 已有 frontmatter → **就地追加缺的键**（已有同名键不覆盖：md 导入常自带 frontmatter）
 *
 * ⚠️ 诚实口径：`created` 是**导入时刻**，不是源文件的创建时间 ——
 * asset 协议不返回 `Last-Modified`（实测只有 `content-length` / `content-type`），
 * 内核也没有 `stat` 原语。要真拿源文件时间得先加契约原语（未做，见 HANDOFF rev173.227）。
 */
export function withImportFrontmatter(md, { source, created } = {}) {
  const text = String(md ?? '')
  const at = created instanceof Date ? created.toISOString() : String(created ?? new Date().toISOString())
  const fields = [`created: ${at}`]
  if (source) fields.push(`source: ${String(source).replace(/[\r\n]+/g, ' ').trim()}`)

  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return `---\n${fields.join('\n')}\n---\n\n${text}`

  const head = m[1]
  const add = fields.filter((line) => {
    const key = line.slice(0, line.indexOf(':'))
    return !new RegExp(`^${key}\\s*:`, 'm').test(head)
  })
  if (!add.length) return text
  return `---\n${head}\n${add.join('\n')}\n---\n` + text.slice(m[0].length)
}

/* ─────────── 插件本体 ─────────── */

export default {
  apply(ctx) {
    const { fs, doc, command, view, host, subscriptions } = ctx

    /**
     * 把 `base`（库内相对路径、**不含扩展名**）变成不撞名的完整路径：
     * `日期导入/2026-10-28/工作/周报` → `…/周报.md` / `…/周报-1.md` …
     * （内核没有"存在否"的查询原语；`fs.readText` 读不到即视为空着）
     */
    async function freeRelPath(base, ext = 'md') {
      for (let i = 0; i < 200; i++) {
        const rel = i === 0 ? `${base}.${ext}` : `${base}-${i}.${ext}`
        try {
          await fs.readText(rel)
        } catch {
          return rel
        }
      }
      return `${base}-${Date.now()}.${ext}`
    }

    /** 读一个源文件（`raw` 省略则弹系统选择器）→ `{ buf, name, path }`；取消返回 `null` */
    async function readSource(raw) {
      let picked = raw
      if (!picked) {
        picked = await host.pickFile()
        if (!picked) return null
      }
      if (typeof picked !== 'string') return null
      console.log('[io] picked =', picked, '| readContentUri =', typeof host.readContentUri)

      const { path: abs, name } = await host.readContentUri(picked)
      const res = await fetch(host.assetUrlAbs(abs))
      if (!res.ok) throw new Error(`读源文件失败（HTTP ${res.status}）`)
      const buf = await res.arrayBuffer()
      console.log('[io] 源 =', abs, '| 名 =', name, '| 字节 =', buf.byteLength)
      return { buf, name, path: abs }
    }

    /**
     * 导入一个文件（`raw` 省略则弹选择器）→ 落库的相对路径；用户取消返回 `null`。
     * 支持的源格式见 `toMarkdown`。
     *
     * **落点（rev173.227 · 需求 §12）**：`日期导入/<YYYY-MM-DD>/[原分类/]<文件名>.md`
     * —— 同一天多次导入自然合并进同一个日期目录；分类默认从**源文件父目录**猜
     * （`opts.category` 可显式指定）。
     */
    async function importOne(raw, opts) {
      const o = opts && typeof opts === 'object' ? opts : {}
      const src = await readSource(raw)
      if (!src) return null

      const md = await toMarkdown(src.name, src.buf)
      const stem = src.name.replace(/\.[^.]+$/, '') || 'imported'
      const now = new Date()
      const category = o.category ? sanitizeDirName(o.category) : guessCategory(src.path || raw || '')
      const rel = await freeRelPath(importBasePath({ date: now, stem, category }), 'md')
      /**
       * 元数据（需求 §12「尽量保留原分类、创建时间等」）：
       * 分类已经体现在**目录**上；创建时间来源拿不到（asset 协议不返回 Last-Modified），
       * 所以 frontmatter 里记的是**导入时刻**，键名 `created` 与手写笔记的约定一致。
       */
      const body = withImportFrontmatter(md, { source: src.name, created: now })
      await fs.createNote(rel, body)
      host.log('info', `导入 ${src.name} → ${rel}（${body.length} 字符${category ? ` · 分类 ${category}` : ''}）`)
      host.notify(`已导入「${rel}」`)
      return rel
    }

    /**
     * 导出当前笔记。`format`：`txt` / `html`；`toVault` 为真时**写进库内**（不弹保存框）——
     * 这条路径既给"导出到笔记库"用，也是**可自动验收**的那条（系统"另存为"没法脚本化）。
     */
    /** 导出格式表：`format` → `{ ext, render }`（`render` 返回字符串或 `Uint8Array`） */
    const EXPORTERS = {
      txt: { ext: 'txt', render: (md, stem) => mdToText(md, stem) },
      html: { ext: 'html', render: (md, stem) => mdToHtml(md, stem) },
      png: { ext: 'png', render: (md, stem) => mdToLongImage(md, stem) },
      docx: { ext: 'docx', render: (md, stem) => mdToDocx(md, stem) },
      // `pdf` 没有 `render` —— 它由**系统打印栈**生成（见上面 pdf 分支），这里只为通过格式校验
      pdf: { ext: 'pdf', render: null },
    }

    async function exportActive(format, toVault, probe) {
      const d = doc.active()
      if (!d) {
        host.notify('没有打开的笔记', 'warn')
        return null
      }
      const spec = EXPORTERS[format]
      if (!spec) throw new Error(`未知导出格式：${format}`)
      const stem = (d.path.split('/').pop() || 'note').replace(/\.[^.]+$/, '')

      /**
       * ⚠️ **实测更正（2026-10-15）**：`window.print()` 在 Tauri 的 **WebView2 里静默无效** ——
       * 调用**立即返回**、不弹打印对话框、不产生任何 PDF（真机 + CDP 双向验证：
       * `window.print` 是 function，但调用后同步返回；`io.exportPdf` 也拿不到任何产物）。
       *
       * **一手来源**：`wry-0.57.0/src/webview2/mod.rs:1796`
       * ```rust
       * pub fn print(&self) -> Result<()> { self.eval("window.print()", …) }
       * ```
       * ⇒ 换成 Tauri 的 Rust `print()` 也救不了（**同一条路**）。
       * rev88 依据的是 Tauri 源码里一句「`window.print()` works on all platforms」的注释 ——
       * 那句话**对 WebView2 不成立**（WebView2 需要宿主显式接 `ShowPrintUI`，wry 没接）。
       *
       * **改走可靠的两步**：导出 HTML → 提示用户用**浏览器**打开它、浏览器里「打印 → 另存为 PDF」。
       * 浏览器打印栈比 WebView2 完整，中文零成本（系统字体），也不用把 17.7 MB 字体塞进包里。
       */
      if (format === 'pdf') {
        const rel = await freeRelPath(stem, 'html')
        await fs.createNote(rel, await mdToHtml(d.content, stem))
        host.log('info', `PDF 走浏览器打印：已导出 ${rel}`)
        host.notify(`已导出「${rel}」—— 用浏览器打开它，「打印 → 另存为 PDF」就得到 PDF`)
        return { format: 'pdf', viaHtml: rel }
      }

      const content = await spec.render(d.content, stem)

      /**
       * **探针**：只渲染、不落盘，回报字节数（给自动化验收用）。
       *
       * 为什么需要：长图是**二进制**，`toVault` 那条路走不通（`fs.createNote` 只收字符串），
       * 而"另存为"对话框没法脚本化点选 ⇒ 没有探针就只能靠人眼看。
       */
      if (probe) {
        const size = typeof content === 'string' ? content.length : content.byteLength
        host.log('info', `[探针] ${format} 渲染成功：${size} 字节`)
        return { format, size }
      }

      if (toVault) {
        // ⚠️ 二进制（长图）不能走 `fs.createNote` —— 它收的是字符串
        if (typeof content !== 'string') {
          throw new Error('二进制导出（长图）不能写进笔记库，请用「另存为」')
        }
        const rel = await freeRelPath(stem, spec.ext)
        await fs.createNote(rel, content)
        host.notify(`已写入笔记库：「${rel}」`)
        return rel
      }

      const saved = await host.saveFile({ defaultName: `${stem}.${spec.ext}`, content })
      host.notify(saved ? `已导出：${saved}` : '已取消导出')
      return saved
    }

    /* ── 命令 ── */

    const guard = (fn) => async (payload) => {
      try {
        return await fn(payload)
      } catch (e) {
        console.error('[io] 失败', e)
        host.notify(`操作失败：${String(e)}`, 'error')
        return null
      }
    }

    subscriptions.push(
      command.register({
        id: 'io.importFile',
        title: '导入外部文件…',
        run: guard(async (payload) => {
          const p = payload && typeof payload === 'object' ? payload : {}
          return await importOne(typeof p.path === 'string' ? p.path : undefined, {
            category: typeof p.category === 'string' ? p.category : '',
          })
        }),
      }),
    )

    for (const [id, fmt, title] of [
      ['io.exportTxt', 'txt', '导出当前笔记为纯文本（txt）…'],
      ['io.exportHtml', 'html', '导出当前笔记为网页（html）…'],
      ['io.exportPng', 'png', '导出当前笔记为长图（PNG）…'],
      ['io.exportDocx', 'docx', '导出当前笔记为 Word（docx）…'],
      ['io.exportPdf', 'pdf', '导出当前笔记为 PDF…'],
    ]) {
      subscriptions.push(
        command.register({
          id,
          title,
          run: guard(async (payload) => {
            const p = payload && typeof payload === 'object' ? payload : {}
            return await exportActive(fmt, Boolean(p.toVault), Boolean(p.probe))
          }),
        }),
      )
    }

    /* ── 侧栏面板 ── */

    subscriptions.push(
      view.registerPanel({
        id: 'io.panel',
        title: '导入导出',
        location: 'sidebar',
        render: () => ({
          type: 'stack',
          children: [
            { type: 'text', value: '导入导出', variant: 'title' },
            { type: 'text', value: '把外部文件变成库内笔记，把笔记导出成别的格式。', variant: 'caption' },
            { type: 'button', label: '导入文件…', onClick: 'io.importFile' },
            { type: 'divider' },
            { type: 'text', value: '导出当前笔记', variant: 'caption' },
            { type: 'button', label: '导出为 txt…', onClick: 'io.exportTxt' },
            { type: 'button', label: '导出为 html…', onClick: 'io.exportHtml' },
            { type: 'button', label: '导出为长图 png…', onClick: 'io.exportPng' },
            { type: 'button', label: '导出为 Word docx…', onClick: 'io.exportDocx' },
            { type: 'button', label: '导出为 PDF（打印）…', onClick: 'io.exportPdf' },
            { type: 'divider' },
            {
              type: 'text',
              value:
                '导入支持：md / txt / html / docx（pdf / epub 在下一批）。\n' +
                '落点：日期导入/<日期>/[原分类/]文件名.md —— 同一天多次导入合并到同一目录。\n' +
                '导出支持：txt / html（pdf / docx / 长图在后续批次）。\n' +
                'Android 的"另存为"需要下一次构建才会生效（见 HANDOFF rev85）。',
              variant: 'caption',
            },
          ],
        }),
      }),
    )

    /** 卸载时把注入的 vendor script 摘掉（内核记不了这笔账 ⇒ 自己申报） */
    host.onRollback(() => {
      document.querySelectorAll('script[data-zn-plugin-vendor]').forEach((s) => s.remove())
    })

    host.log('info', '导入导出插件已就绪（批 2：html / docx 导入 ＋ txt / html 导出）')
  },
}
