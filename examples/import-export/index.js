/**
 * 导入导出插件
 *
 * · **批 1**：md / txt 导入（已验证）
 * · **批 2**（本次）：**html→md**、**docx→md** 导入；**导出 txt / html**
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
function libs() {
  libsPromise ??= (async () => {
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
 * `buf` 是原始字节（不是字符串）—— docx 要走 `arrayBuffer`，
 * 文本类才解码；这样只读一次文件。
 */
async function toMarkdown(name, buf) {
  const ext = extOf(name)

  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return decodeText(buf)

  if (ext === 'html' || ext === 'htm') {
    const { TurndownService, gfm } = await libs()
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    if (gfm) td.use(gfm) // 表格 / 删除线 / 任务列表不在核心
    return td.turndown(decodeText(buf))
  }

  if (ext === 'docx') {
    const { mammoth } = await libs()
    const r = await mammoth.convertToMarkdown({ arrayBuffer: buf })
    return r.value
  }

  if (ext === 'pdf') return await pdfToMarkdown(buf)

  throw new Error(`还不支持 .${ext}（epub 在下一批）`)
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

/* ─────────── 插件本体 ─────────── */

export default {
  apply(ctx) {
    const { fs, doc, command, view, host, subscriptions } = ctx

    /**
     * 找一个**还不存在**的库内相对路径：`foo.md` 撞名就 `foo-1.md`、`foo-2.md`…
     * （内核没有"存在否"的查询原语；`fs.readText` 读不到即视为空着）
     */
    async function freeRelPath(stem, ext = 'md') {
      for (let i = 0; i < 200; i++) {
        const rel = i === 0 ? `${stem}.${ext}` : `${stem}-${i}.${ext}`
        try {
          await fs.readText(rel)
        } catch {
          return rel
        }
      }
      return `${stem}-${Date.now()}.${ext}`
    }

    /** 读一个源文件（`raw` 省略则弹系统选择器）→ `{ buf, name }`；取消返回 `null` */
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
      return { buf, name }
    }

    /**
     * 导入一个文件（`raw` 省略则弹选择器）→ 落库的相对路径；用户取消返回 `null`。
     * 支持的源格式见 `toMarkdown`。
     */
    async function importOne(raw) {
      const src = await readSource(raw)
      if (!src) return null

      const md = await toMarkdown(src.name, src.buf)
      const stem = src.name.replace(/\.[^.]+$/, '') || 'imported'
      const rel = await freeRelPath(stem, 'md')
      await fs.createNote(rel, md)
      host.log('info', `导入 ${src.name} → ${rel}（${md.length} 字符）`)
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
          return await importOne(typeof p.path === 'string' ? p.path : undefined)
        }),
      }),
    )

    for (const [id, fmt, title] of [
      ['io.exportTxt', 'txt', '导出当前笔记为纯文本（txt）…'],
      ['io.exportHtml', 'html', '导出当前笔记为网页（html）…'],
      ['io.exportPng', 'png', '导出当前笔记为长图（PNG）…'],
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
            { type: 'divider' },
            {
              type: 'text',
              value:
                '导入支持：md / txt / html / docx（pdf / epub 在下一批）。\n' +
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
