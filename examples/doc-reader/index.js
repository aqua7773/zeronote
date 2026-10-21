/**
 * 文档阅读器（doc-reader）—— **只读**，绝不写库文件。
 *
 * ## 它接的是哪个口
 * 内核只认识"这是一份只读文档"（`NoteMeta.kind === 'doc'`），**不认识 pdf/epub**。
 * 所以内核注册了 `core.openDocument`（默认实现只 toast 一句"没有插件能打开"），
 * 本插件 `command.bind('core.openDocument', …)` **接管**它 —— 与 `core.newNote` 同一套机制：
 * bind 只换实现、不动元数据，**卸载时自动还原**（契约 §2.1.1 / §2.7）。
 *
 * ## 界面怎么承载（rev173.84 整窗接管 → 面板；rev173.86 每份文档一个面板）
 * 以前是 `view.overrideShell`（把内核 UI **整个请下场**）：PDF.js 的 canvas、foliate 的
 * `contentDocument` 都塞不进 21 种 UINode，只能接管。代价记在 rev173.81 的调研里 ——
 * 退出方式三套并存（内核右下角 / 插件顶栏 ✕ / 返回键直接退 App）。
 *
 * rev173.81 面板支持 `mount`、rev173.83 面板能进标签条 / 拖出成窗口 ⇒ 改注册成面板。
 * **rev173.86 起每份文档一个面板**（`doc-reader.view.<hash>`，title = 文件名）：
 *   · 说明.txt / probe.pdf 同时打开 = 两条标签，互不顶掉（用户要的"文档也能多标签"）
 *   · 面板标 `hidden: true` —— 它们是"打开的那份文档"，不是功能入口，不进 ☰ 菜单
 *   · 标签拖出 / 右键「在新窗口打开」= `?pluginWindow=<panelId>` 独立窗口
 *   · 手机只有主区：面板 + 返回键（rev173.82 的降级同一处）
 * 阅读器自己不再画「✕ 关闭」—— 退出路径归内核（窗口的 ✕ / 关标签 / 返回键）。
 *
 * ## 窗口里怎么知道读哪份、切标签回来为什么还在原页
 *   · **独立窗口**是新的 webview，插件会重新 `apply`（模块级变量全空）——
 *     面板 id 在 `?pluginWindow=` 里，用它在 `store.docs`（panelId → 文档记录）里找回文档，
 *     再把这个面板重建出来。与 outline-map 的 `open:<panelId>` 同一套做法。
 *   · 切到别的标签再切回来，面板会**重新 mount**（`PanelMount` 的依赖是 `[panel]`）——
 *     PDF 要重新加载，但页码 / 缩放从模块级 `readerState`（panelId → `{page, scale}`）恢复。
 *
 * ## 渲染库从哪来
 * 应用内置资源 `<origin>/vendor/…`（**绝对 URL**：插件入口跑在 Blob 模块里，
 * 相对导入没有 base 目录，见契约 §3.2）：
 *   · **pdf.js 6.4.299**（Apache-2.0）—— 自绘 canvas 阅读器
 *   · **foliate-js 1.0.1**（MIT）—— EPUB / MOBI / AZW3 / FB2 / CBZ
 * ⇒ 升级渲染库只换 `public/vendor`，插件本体不动。
 *
 * ## 字节怎么取
 * `host.assetUrl(库内相对路径)` + `fetch` → Blob。**不用 `fs.readText`**（它按 UTF-8 读，二进制会坏）。
 * 两条 2026-10-13 实测的事实：
 *   · asset 协议两端都返回正确 MIME + 支持 Range（桌面与 Android 都是 200 / `application/pdf`）
 *   · ⚠️ **Android 上"点开头的目录段"会 403**（如 `.zn/…`）—— 根因是 Tauri scope 的
 *     `requireLiteralLeadingDot`（unix 默认 true）⇒ 已在 `tauri.conf.json` 里显式关掉。
 *
 * ## 有意不做（用户 2026-10-13 明确）
 * 不做「最近打开」列表、不做书签 / 跨会话的阅读进度记忆 —— "只要能打开看就行"。
 * （rev173.86 的 `readerState` 只活在内存里：切标签回来能回到原页，重启就没了。）
 */

/* ───────────── 渲染库单例（重开文档不重复 import） ───────────── */

/** 应用内置 vendor 的**绝对** URL：Blob 模块里相对路径没有 base 可解析 */
const vendor = (p) => new URL(`/vendor/${p}`, location.origin).href

let pdfjsPromise = null
/**
 * pdf.js 用 **legacy build**（`public/vendor/pdfjs/build/` 里放的**就是 legacy 那一份**）——
 * modern build 依赖很新的运行时 API（`Map.prototype.getOrInsertComputed`，TC39 新提案），
 * 而 **Android System WebView 没有**：2026-10-13 真机实测（Chrome 143）抛
 * `TypeError: this[#da].getOrInsertComputed is not a function`，桌面 WebView2（Chrome 154）却正常。
 * legacy 由官方转译（覆盖更老的 Chromium）、体积只大 12%（523 KB + 1.32 MB）；
 * 同构先例：Readest（Tauri 2 + Android）用的也是 legacy worker。
 *
 * ⚠️ **目录名仍叫 `build/` 是有意的**：vite dev server **在启动时就把 `public/` 的文件列表定死**，
 * 启动后**新增**的路径一律落进 SPA fallback（实测 `/vendor/pdfjs/legacy/…` → `200` 但
 * `content-type: text/html`、981 字节的 index.html）⇒ 换目录名就得重启 dev 才生效。
 * 放回既有目录名，dev 下改完立即可用。（生产构建全量复制 `public/`，没有这个问题。）
 */
/**
 * 补齐老 WebView 缺失的新 API。
 *
 * 真机实测（Android 16 · System WebView **Chrome 143**）：pdf.js 在**主线程渲染路径**上调用
 * `Map.prototype.getOrInsertComputed`（很新的 TC39 提案，Chrome < 145 没有）⇒
 * `TypeError: this[#da].getOrInsertComputed is not a function`。
 * ⚠️ **桌面测不出来**：WebView2 是 Chrome 154，自带这个 API。
 * ⚠️ **换 legacy build 也不够**：legacy 只做语法转译、不带这个 polyfill
 * （真机实测：legacy 版能解析出 1 页，然后仍倒在渲染那一步）。所以这里补上。
 */
const ensureMapApis = () => {
  const M = Map.prototype
  if (typeof M.getOrInsertComputed === 'function') return
  Object.defineProperty(M, 'getOrInsertComputed', {
    value: function (key, compute) {
      if (!this.has(key)) this.set(key, compute(key))
      return this.get(key)
    },
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

/**
 * 动态 import 的**一次带参重试**（2026-10-15 真机实测的救火措施）。
 *
 * 症状：`import('/vendor/pdfjs/build/pdf.min.mjs')` 报
 * `Failed to fetch dynamically imported module: …pdf.min.mjs`，但：
 * · **同一个 URL 用 `fetch()` 能拿到完整内容**（523758 字节、`content-type: text/javascript`）；
 * · **同目录同后缀的 `pdf.worker.min.mjs`、以及 `foliate/epub.js` 都能 import**；
 * · **给那条 URL 加个查询串（`?x=1`）立刻成功**。
 * ⇒ 判定为该 URL 的加载缓存里有一条坏记录（清应用 `cache/WebView` **无效** ⇒ 记录不在那儿）。
 * ⚠️ **根因未定**（诚实标注，别当结论传下去）；生产包走 asset 协议、对查询串的支持未知，
 * 所以**正常路径不带参数**，只在失败后加一次。
 */
const importWithRetry = async (url) => {
  try {
    return await import(url)
  } catch (err) {
    try {
      return await import(`${url}${url.includes('?') ? '&' : '?'}znretry=${Date.now()}`)
    } catch {
      throw err // 两次都失败：抛原始错误（信息更干净，便于诊断）
    }
  }
}

const loadPdfjs = () =>
  (pdfjsPromise ??= (ensureMapApis(), importWithRetry(vendor('pdfjs/build/pdf.min.mjs'))))

let foliatePromise = null
const loadFoliate = () => (foliatePromise ??= importWithRetry(vendor('foliate/view.js')))

/** 扩展名 → 渲染器。`foliate` 一套通吃电子书格式（它内部自己判 zip / MOBI / FB2） */
const RENDERERS = {
  pdf: 'pdf',
  epub: 'foliate',
  mobi: 'foliate',
  azw3: 'foliate',
  azw: 'foliate',
  fb2: 'foliate',
  cbz: 'foliate',
  txt: 'text',
  // `.md` 也吃，但**只用于库外文件**（Android「打开方式」递来的 SAF 文件被复制到缓存后，
  // 走的就是这条路）：**库内的 .md 是笔记，走编辑器**，根本不会进这里。
  // 库外 md 按纯文本显示（要编辑得先导入库 —— 那是另一件事）。
  md: 'text',
  markdown: 'text',
}

/* ───────────── 小工具 ───────────── */

const nameOf = (p) => p.split('/').pop() ?? p

const extOf = (p) => {
  const n = nameOf(p)
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i + 1).toLowerCase() : ''
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

/**
 * 阅读器外观。注入到**面板容器内部** ⇒ 面板 dispose 时随容器一起消失，不污染内核样式。
 * 颜色一律走 `--zn-*` 令牌 ⇒ 深浅色主题自动跟随。
 *
 * rev173.87：**去掉顶栏**（用户「绿框不需要」—— 标签条已经写着文件名，再压一条工具栏
 * 等于把阅读区又挤小一截）。翻页改成**滚轮 / 键盘**（PDF），删除走**右键菜单**。
 */
const CSS = `
.dn-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;background:var(--zn-bg,#fff);color:var(--zn-fg,#111)}
/* 弹层里的按钮：**触控目标 ≥30px**（手机实测：更小的点不中，还会被系统当图片长按） */
.dn-btn{flex:none;min-height:30px;padding:4px 9px;font-size:12.5px;border:1px solid var(--zn-border,#d4d4d8);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
/* 只读区：撑满整个面板，自己滚（面板容器那条 overflow:auto 只是兜底） */
.dn-body{flex:1;min-height:0;overflow:auto;background:var(--zn-bg-subtle,#f7f7f8)}
/* 原尺寸显示（用户 2026-10-15：「PDF 显示会强制缩放，取消掉，做原格式查看」）：
   原先这行是 max-width:100% 加 height:auto —— 它把 A4（595px 宽）压到屏宽，
   而 canvas 的 height 是 pdf.js 按 1:1 设的 **inline 尺寸**（CSS 盖不掉）⇒
   画面被**横向压扁**（宽 66%、高 100%），看着就是"被强制缩放"。
   现在：块级 + auto margin ⇒ 宽度 > 容器时 auto 归 0，靠 .dn-body 横向滚动看全。
   （不能用 flex 居中：内容超宽时左边会被裁掉且滚不过去；EPUB / TXT 渲染器自己会把
   display 覆盖成 block，见各自 mount 里的 body.style.display 赋值）。 */
/* 连续滚动（rev173.87 · 用户「翻页做成滚轮无限下滑」）：所有页竖排、滚轮往下就是下一页；
   .dn-pages 只负责排布，每页的尺寸由 JS 按 viewport × 缩放写进 style。
   超宽页（原尺寸查看）靠 margin:0 auto 在容器内居中；比容器还宽时 auto 归 0 ⇒ 可横向滚。 */
.dn-pages{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:10px 0}
.dn-page{display:block;margin:0 auto;box-shadow:0 1px 8px rgba(0,0,0,.28);background:#fff}
.dn-text{flex:1;margin:0;padding:16px 18px;white-space:pre-wrap;word-break:break-word;font:14px/1.7 ui-monospace,Consolas,monospace}
.dn-msg{padding:26px;font-size:13px;line-height:1.7;color:var(--zn-fg-subtle,#71717a);max-width:44em}
.dn-menu{position:absolute;z-index:20;min-width:190px;padding:4px;border:1px solid var(--zn-border,#d4d4d8);border-radius:8px;background:var(--zn-bg,#fff);box-shadow:0 6px 20px rgba(0,0,0,.18)}
.dn-menu-item{display:block;width:100%;padding:7px 10px;font-size:13px;text-align:left;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dn-menu-item:hover{background:var(--zn-bg-hover,#f4f4f5)}
.dn-menu-item.is-danger{color:var(--zn-danger,#dc2626)}
.dn-menu-hint{padding:5px 10px 7px;font-size:11px;color:var(--zn-fg-subtle,#71717a);border-top:1px solid var(--zn-border,#e4e4e7);margin-top:4px}
.dn-confirm{position:absolute;z-index:21;max-width:300px;padding:12px 14px;border:1px solid var(--zn-border,#d4d4d8);border-radius:10px;background:var(--zn-bg,#fff);box-shadow:0 8px 24px rgba(0,0,0,.22);font-size:13px;line-height:1.6}
.dn-confirm-row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
`

/* ───────────── 三种渲染器 ───────────── */
/* 统一接口：返回 { next?, prev?, zoom?, destroy? }。rev173.87 起没有顶栏 —— 渲染器不回调进度，
   翻页 / 缩放全在文档区域自己处理（滚轮 / Ctrl+滚轮 / ←→）。
   `state` = **阅读位置缓存**（每个面板一份）：切到别的标签再切回来，面板会重新 mount，
   PDF 要重新加载 —— 但会滚回上次看的那一页。 */

async function mountPdf(body, { url, state }) {
  const pdfjs = await loadPdfjs()
  // worker **同源**即可（CSP 无需额外放行：无 worker-src 时回退链是 child-src → script-src →
  // default-src，而 script-src 含 'self'；blob worker 则被 script-src 的 blob: 放行 —— 实测）
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs/build/pdf.worker.min.mjs')

  const doc = await pdfjs.getDocument({
    url,
    cMapUrl: vendor('pdfjs/cmaps/'), // 中文 PDF 必需（缺它中文变方框）
    cMapPacked: true,
    standardFontDataUrl: vendor('pdfjs/standard_fonts/'),
    wasmUrl: vendor('pdfjs/wasm/'), // jbig2 / openjpeg（扫描件）
    isEvalSupported: false, // CVE-2024-4367 缓解：PDF 内嵌 JS 不走 eval
  }).promise

  /** 阅读位置 / 缩放缓存（`state` 由 mountReader 按 panelId 交进来，切标签回来接着看） */
  const saved = state && typeof state === 'object' ? state : {}
  let scale = Math.min(4, Math.max(0.25, Number(saved.scale) || 1))

  /** 页宽高（scale=1）：未知的先用第一页占位，真渲染时用真实尺寸修正（混排 PDF 也稳） */
  const firstVp = (await doc.getPage(1)).getViewport({ scale: 1 })
  const sizes = new Map()
  const sizeOf = (n) => sizes.get(n) || { width: firstVp.width, height: firstVp.height }

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const wrap = el('div', 'dn-pages')
  body.append(wrap)

  /**
   * n → `{ canvas, done }`。**先把所有页建成占位**（空 canvas，尺寸由 CSS 撑），滚到才渲染。
   * 为什么不全画：A4 一页 dpr2 的位图 ≈ 8 MB，一本 100 页的书就是 800 MB —— 必然崩。
   * 主流阅读器（含 pdf.js 自带 viewer）都是这套"占位 + 按需渲染"。
   */
  const slots = new Map()
  for (let n = 1; n <= doc.numPages; n++) {
    const canvas = el('canvas', 'dn-page')
    canvas.dataset.page = String(n)
    const size = sizeOf(n)
    canvas.style.width = `${Math.round(size.width * scale)}px`
    canvas.style.height = `${Math.round(size.height * scale)}px`
    wrap.append(canvas)
    slots.set(n, { canvas, done: false })
  }

  const renderPage = async (n) => {
    const s = slots.get(n)
    if (!s || s.done) return
    s.done = true
    try {
      const p = await doc.getPage(n)
      const vp = p.getViewport({ scale })
      // 记下真实尺寸（scale=1），缩放 / 占位都用它
      sizes.set(n, { width: vp.width / scale, height: vp.height / scale })
      s.canvas.width = Math.floor(vp.width * dpr)
      s.canvas.height = Math.floor(vp.height * dpr)
      s.canvas.style.width = `${Math.floor(vp.width)}px`
      s.canvas.style.height = `${Math.floor(vp.height)}px`
      const ctx = s.canvas.getContext('2d')
      await p.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise
    } catch {
      s.done = false // 下次进入视口再试
    }
  }

  /** 离开视口的页释放位图、只留占位高度（回来时重画） */
  const releasePage = (n) => {
    const s = slots.get(n)
    if (!s || !s.done) return
    s.done = false
    s.canvas.width = 0
    s.canvas.height = 0
  }

  /** 只渲染"看得见 + 上下各一屏半"的页 —— 滚轮一直往下滑 = 一直有下一页 */
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = Number(e.target.dataset.page)
        if (!n) continue
        if (e.isIntersecting) void renderPage(n)
        else releasePage(n)
      }
    },
    { root: body, rootMargin: '150% 0px' },
  )
  for (const s of slots.values()) io.observe(s.canvas)

  /** 可见页立刻渲染（缩放后 IntersectionObserver 不会再次回调已相交的元素，得手动推一把） */
  const renderVisible = () => {
    const top = body.scrollTop
    const bottom = top + body.clientHeight
    for (const [n, s] of slots) {
      const off = s.canvas.offsetTop
      const h = s.canvas.offsetHeight
      if (off + h >= top && off <= bottom) void renderPage(n)
    }
  }

  /** 缩放锚点：记下"视口顶端落在哪一页、页内百分之几"，缩放后滚回同一处（视觉不跳） */
  const anchor = () => {
    const top = body.scrollTop
    for (const [n, s] of slots) {
      const off = s.canvas.offsetTop
      const h = s.canvas.offsetHeight
      if (off <= top && top < off + h) return { n, ratio: (top - off) / Math.max(1, h) }
    }
    return { n: 1, ratio: 0 }
  }
  const restoreAnchor = (a) => {
    const s = slots.get(a.n)
    if (s) body.scrollTop = s.canvas.offsetTop + s.canvas.offsetHeight * a.ratio
  }

  const zoom = (d) => {
    const a = anchor()
    scale = Math.min(4, Math.max(0.25, +(scale + d).toFixed(2)))
    saved.scale = scale
    for (const [n, s] of slots) {
      const size = sizeOf(n)
      s.canvas.style.width = `${Math.round(size.width * scale)}px`
      s.canvas.style.height = `${Math.round(size.height * scale)}px`
      s.done = false
      s.canvas.width = 0
      s.canvas.height = 0
    }
    restoreAnchor(a)
    renderVisible()
  }

  /**
   * **Ctrl + 滚轮 = 缩放**（用户 2026-10-21 指定）；普通滚轮保持原生滚动。
   *
   * ⚠️ 必须 non-passive + preventDefault：WebView2 的默认行为是「Ctrl+滚轮缩放整个页面」
   * ——不拦的话缩放的是内核 UI（标签条 / 侧栏一起变大），而不是 PDF 页。
   */
  const onWheel = (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    zoom(e.deltaY > 0 ? -0.2 : 0.2)
  }
  body.addEventListener('wheel', onWheel, { passive: false })

  /** 恢复阅读位置（切标签回来 / 同一文档重开）：滚到上次看的那页顶部 */
  const restore = () => {
    const n = Math.min(Math.max(1, Number(saved.page) || 1), doc.numPages)
    if (n <= 1) return
    const s = slots.get(n)
    if (s) body.scrollTop = Math.max(0, s.canvas.offsetTop - 8)
  }
  requestAnimationFrame(restore)

  /** 记住"看到第几页"：滚动停下 120ms 后按 scrollTop 反查（连续滚动没有"当前页"） */
  let scrollTimer = 0
  const remember = () => {
    const probe = body.scrollTop + body.clientHeight * 0.25
    let cur = 1
    for (const [n, s] of slots) if (s.canvas.offsetTop <= probe) cur = n
    saved.page = cur
  }
  const onScroll = () => {
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(remember, 120)
  }
  body.addEventListener('scroll', onScroll, { passive: true })

  return {
    /** 键盘 / PageDown：连续模式里"翻一页"就是滚一屏 */
    next: () => {
      body.scrollTop += Math.max(200, body.clientHeight * 0.9)
    },
    prev: () => {
      body.scrollTop -= Math.max(200, body.clientHeight * 0.9)
    },
    zoom,
    destroy: () => {
      io.disconnect()
      body.removeEventListener('scroll', onScroll)
      body.removeEventListener('wheel', onWheel)
      clearTimeout(scrollTimer)
      for (const s of slots.values()) {
        s.canvas.width = 0
        s.canvas.height = 0
      }
      slots.clear()
      wrap.remove()
      try {
        void doc.destroy()
      } catch {
        /* 已经没了就算了 */
      }
    },
  }
}

async function mountFoliate(body, { url, name }) {
  await loadFoliate() // 注册 <foliate-view> 自定义元素
  const view = document.createElement('foliate-view')
  view.style.cssText = 'width:100%;height:100%;display:block'
  body.style.display = 'block' // 连续滚动交给 foliate 自己管，别让 flex 干扰它的测量
  body.append(view)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`读取失败：HTTP ${res.status}`)
  // foliate 按 `type` / 文件名判格式 ⇒ 必须是 File（Blob 没有 name）
  const file = new File([await res.blob()], name)

  /**
   * **深色适配**（rev173.87 · 用户「深色模式还用深色字体」）。
   *
   * EPUB 的正文跑在 foliate 自己的 iframe 里：**父文档的 `--zn-*` 变量不会继承过去**，
   * 而电子书自带的 CSS 常常写死 `color: #2f4f4f` 之类 ⇒ 深色主题下就是"深字配深底"。
   * 用 foliate paginator 的 `setStyles(css)` 把当前主题的**计算值**注入进去（每个 section 的
   * `<style>`），并用 `!important` 压过书里的 CSS。主题切换时重新注入。
   */
  const injectTheme = () => {
    const cs = getComputedStyle(document.documentElement)
    const fg = cs.getPropertyValue('--zn-fg').trim() || '#18181b'
    const bg = cs.getPropertyValue('--zn-bg').trim() || '#ffffff'
    const accent = cs.getPropertyValue('--zn-accent').trim() || fg
    try {
      view.renderer?.setStyles?.(
        `html,body{color:${fg} !important;background:${bg} !important}
         a{color:${accent} !important}
         img,video,svg{background:transparent !important}`,
      )
    } catch {
      /* 老版 foliate 没有 setStyles —— 宁可回到默认，也别把书打不开 */
    }
  }
  const onLoad = () => injectTheme()
  view.addEventListener('load', onLoad)
  const themeObserver = new MutationObserver(injectTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  await view.open(file)
  // 官方 reader.js 也是 open 之后手动推第一屏
  view.renderer?.setAttribute?.('flow', 'scrolled')
  view.renderer?.next?.()
  injectTheme()

  return {
    next: () => view.goRight?.(),
    prev: () => view.goLeft?.(),
    destroy: () => {
      themeObserver.disconnect()
      view.removeEventListener('load', onLoad)
      try {
        view.close?.()
      } catch {
        /* 忽略 */
      }
    },
  }
}

async function mountText(body, { url }) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`读取失败：HTTP ${res.status}`)
  const text = await res.text()
  body.style.display = 'block'
  const pre = el('pre', 'dn-text', text)
  body.append(pre)
  return {}
}

const MOUNTERS = { pdf: mountPdf, foliate: mountFoliate, text: mountText }

/* ───────────── 插件本体 ───────────── */

/**
 * 面板 id 前缀。**每个文档一个面板**（rev173.86 · 用户「文档也能多标签打开」）：
 * `doc-reader.view.<hash32(文档键)>` —— 「说明.txt」「probe.pdf」各是一条标签，互不顶掉。
 *
 * 为什么用 hash：库内路径可以是中文 / 带斜杠 / 带空格，而面板 id 还要拼进
 * `core.panel.<id>` 命令和 `panel:<id>` 标签键 —— 短且无歧义最省事
 * （32 位碰撞概率 1/2^32，同一库几十份文档完全可以忽略）。
 */
const PANEL_PREFIX = 'doc-reader.view'

/** store 键：打开过的文档（panelId → 记录）。窗口模式靠它还原；主窗口只在打开时写 */
const STORE_DOCS = 'docs'
/** store 里最多留多少条记录（标签上限 12，留点余量给"被挤出标签、之后可能重开"的文档） */
const MAX_DOC_RECORDS = 20

/** 32 位 FNV-1a */
const hash32 = (s) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 文档 → 稳定的面板 id（库内 / 库外各一套键，避免同名不同来源相撞） */
const panelIdFor = (doc) =>
  `${PANEL_PREFIX}.${hash32(doc.mode === 'abs' ? `abs:${doc.abs}` : `vault:${doc.path}`)}`

/**
 * 阅读位置缓存：panelId → `{ page, scale }`（只有 PDF 用）。
 *
 * 切到别的标签再切回来时，面板会**重新 mount**（`PanelMount` 的语义：effect 依赖 `[panel]`，
 * 切走就卸载了），PDF 要重新加载 —— 有这份缓存就不会回到第 1 页。
 */
const readerState = new Map()

/**
 * 一份文档的阅读器界面（模块级函数：每个面板各调一次，`doc` 是**闭包常量**）。
 * 所以这一版不再需要"当前文档"那种模块级可变状态 —— 面板即文档。
 *
 * rev173.87：**没有自己的顶栏**（用户「绿框不需要」）。阅读区 = 整个面板，
 * 翻页 = 滚轮 / ←→（PDF）、滚动（EPUB），删除 = 右键菜单。
 */
function mountReader(root, { doc, panelId, fs, host, dropDoc }) {
  root.classList.add('dn-root')
  const style = document.createElement('style')
  style.textContent = CSS
  root.append(style)

  let body = el('div', 'dn-body')
  root.append(body)

  let api = null
  let dead = false
  /** 代际：异步渲染器回来时如果已经换过 body / 已卸载，就把它丢掉（别串味） */
  let gen = 0
  /** 删除后进入空态：面板还开着（标签还在），但不该再去读那个文件 */
  let empty = false

  const teardown = () => {
    const a = api
    api = null
    try {
      a?.destroy?.()
    } catch {
      /* 已经没了就算了 */
    }
  }

  /**
   * 换一块干净的 body：旧渲染器（异步、可能还在路上）写的是那个**已脱离文档树**的 div。
   * 只清空不换节点的话，旧渲染器回来后仍会往可见的 body 里 append（串味）。
   */
  const freshBody = () => {
    const next = el('div', 'dn-body')
    body.replaceWith(next)
    body = next
  }

  const showEmpty = (msg) => {
    empty = true
    gen += 1
    teardown()
    freshBody()
    body.append(el('div', 'dn-msg', msg))
  }

  const load = () => {
    if (dead || empty) return
    const my = ++gen
    teardown()
    freshBody()

    const saved = readerState.get(panelId) ?? { page: 1, scale: 1 }
    readerState.set(panelId, saved)

    void (async () => {
      try {
        const a = await MOUNTERS[doc.kind](body, {
          url: doc.url,
          name: doc.name,
          state: saved,
        })
        if (dead || my !== gen) {
          try {
            a?.destroy?.()
          } catch {
            /* 忽略 */
          }
          return
        }
        api = a
      } catch (e) {
        if (dead || my !== gen) return
        body.textContent = ''
        const m = el('div', 'dn-msg', `打开失败：${e?.message ?? String(e)}`)
        // Android 上"点开头的目录"读不了（asset scope 限制）—— 给出可执行的解释
        if (/403/.test(String(e?.message))) {
          m.textContent += '\n\n若是从 . 开头的目录里打开的（如 .zn/…），Android 端读不了 —— 把文档放到普通目录再试。'
        }
        body.append(m)
      }
    })()
  }

  /* ── 删除：**右键菜单**（rev173.87 去掉顶栏后唯一的入口）──
     逻辑删除 / 物理删除两个选项；键盘用户在文档区域右键即可（桌面），
     手机长按文件树里的文档也能到同一个菜单（那是文件树的菜单，不是这里）。 */
  let menuEl = null
  let confirmEl = null
  const closeMenu = () => {
    menuEl?.remove()
    menuEl = null
  }
  const closeConfirm = () => {
    confirmEl?.remove()
    confirmEl = null
  }

  /** 逻辑删除：移入 `.zn/trash/`，**可恢复** */
  const trashIt = async () => {
    if (doc.mode !== 'vault') return
    try {
      await fs.delete(doc.path)
      host.notify(`已移入回收站：${doc.name}（「回收站」里能恢复）`)
      void dropDoc(panelId)
      showEmpty(`已移入回收站：${doc.name}（「回收站」里能恢复）`)
    } catch (e) {
      host.notify(`删除失败：${e?.message ?? String(e)}`, 'warn')
    }
  }

  /**
   * 物理删除：**内核没有"直接抹掉库内文件"的命令**，所以是两步 ——
   * `delete` 移进回收站 → `listTrash` 按 `originalPath` 找回它的 id → `purgeTrash` 真删。
   *
   * ⚠️ **不能拿 `delete` 的返回值直接当 id**：它返回 `.zn/trash/<stamp>/<名>`（带斜杠），
   * 而 `purge_trash` 明确拒绝带斜杠的 id（`src-tauri/src/lib.rs:561`）。
   */
  const purgeIt = async () => {
    if (doc.mode !== 'vault') return
    try {
      await fs.delete(doc.path)
      const entry = (await fs.listTrash()).find((t) => t.originalPath === doc.path)
      if (!entry) throw new Error('放进回收站后没能找回它（文件仍在回收站，可去那里手动删）')
      await fs.purgeTrash(entry.id)
      host.notify(`已彻底删除：${doc.name}`)
      void dropDoc(panelId)
      showEmpty(`已彻底删除：${doc.name}`)
    } catch (e) {
      host.notify(`彻底删除失败：${e?.message ?? String(e)}`, 'warn')
    }
  }

  /** 把浮层放到点击点附近，并夹进容器内（右侧/底部不越界） */
  const place = (node, x, y) => {
    const r = root.getBoundingClientRect()
    root.append(node)
    const maxL = Math.max(8, root.clientWidth - node.offsetWidth - 8)
    const maxT = Math.max(8, root.clientHeight - node.offsetHeight - 8)
    node.style.left = `${Math.min(Math.max(8, x - r.left), maxL)}px`
    node.style.top = `${Math.min(Math.max(8, y - r.top), maxT)}px`
  }

  const openConfirm = (x, y) => {
    closeConfirm()
    confirmEl = el('div', 'dn-confirm')
    const q = el('div', '', `彻底删除「${doc.name}」？`)
    q.style.fontWeight = '600'
    const warn = el('div', '', '这会永久抹掉文件，不进回收站 —— 撤不回来。')
    warn.style.color = 'var(--zn-fg-subtle,#71717a)'
    const row = el('div', 'dn-confirm-row')
    const cancel = el('button', 'dn-btn', '取消')
    cancel.addEventListener('click', closeConfirm)
    const ok = el('button', 'dn-btn', '彻底删除')
    ok.style.color = 'var(--zn-danger,#dc2626)'
    ok.style.borderColor = 'var(--zn-danger,#dc2626)'
    ok.addEventListener('click', () => {
      closeConfirm()
      void purgeIt()
    })
    row.append(cancel, ok)
    confirmEl.append(q, warn, row)
    place(confirmEl, x, y)
  }

  const openMenu = (x, y) => {
    // 库外文档 / 已删除：没有可删的，右键不弹（弹一个全是禁用项的菜单只会更迷惑）
    if (doc.mode !== 'vault' || empty) return
    closeConfirm()
    closeMenu()
    menuEl = el('div', 'dn-menu')
    const b1 = el('button', 'dn-menu-item', '删除（移入回收站）')
    b1.addEventListener('click', () => {
      closeMenu()
      void trashIt()
    })
    const b2 = el('button', 'dn-menu-item is-danger', '彻底删除…')
    b2.addEventListener('click', () => {
      closeMenu()
      openConfirm(x, y)
    })
    menuEl.append(b1, b2, el('div', 'dn-menu-hint', '「回收站」里能恢复；彻底删除不能'))
    place(menuEl, x, y)
  }

  // 右键唤出删除菜单（rev173.87 去掉顶栏后这是**唯一**入口）
  root.addEventListener('contextmenu', (e) => {
    if (doc.mode !== 'vault' || empty) return
    e.preventDefault()
    openMenu(e.clientX, e.clientY)
  })
  const onDocDown = (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu()
    if (confirmEl && !confirmEl.contains(e.target)) closeConfirm()
  }
  document.addEventListener('mousedown', onDocDown)

  // Esc 不拦截：面板里 Esc 没有"退出阅读器"这回事（退出归内核的返回键 / 关标签）
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault()
      api?.next?.()
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      api?.prev?.()
    }
  }
  document.addEventListener('keydown', onKey)

  load()

  return () => {
    dead = true
    gen += 1
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('mousedown', onDocDown)
    closeMenu()
    closeConfirm()
    teardown()
    body.textContent = ''
  }
}

export default {
  apply(ctx) {
    const { command, view, host, subscriptions, fs, store } = ctx

    /**
     * 当前库的标识（`host.assetUrl('')` 里带着库根）。
     *
     * 全局插件的 store 跨库共用，换库后库内相对路径属于上一个库 —— 拿新库根去拼会读到
     * 同名文件或 404。**不用 `vault:open`**：它每代插件都发（重扫 / 换库都发），
     * 冷启动从文件管理器点 PDF 的派发可能赶在它之前，会误清刚打开的文档。
     */
    const vaultKey = () => {
      try {
        return host.assetUrl('')
      } catch {
        return ''
      }
    }

    /** store 记录 → doc（校验 + 拼 asset URL）；坏记录 / 换库 / 不认识的扩展名 → null */
    const toDoc = (v) => {
      if (!v || typeof v !== 'object') return null
      const mode = v.mode === 'abs' ? 'abs' : v.mode === 'vault' ? 'vault' : null
      const path = typeof v.path === 'string' ? v.path : ''
      const abs = typeof v.abs === 'string' ? v.abs : ''
      if (!mode || (mode === 'vault' ? !path : !abs)) return null
      // 库内路径换了库就作废；库外绝对路径不受影响（它在应用缓存里，与当前库无关）
      if (mode === 'vault' && typeof v.vault === 'string' && v.vault && v.vault !== vaultKey()) return null
      const name = typeof v.name === 'string' && v.name ? v.name : nameOf(abs || path)
      const kind = RENDERERS[extOf(name)]
      if (!kind) return null
      return {
        mode,
        path,
        abs,
        name,
        kind,
        url: abs ? host.assetUrlAbs(abs) : host.assetUrl(path),
      }
    }

    const readDocs = async () => {
      try {
        const v = await store.get(STORE_DOCS, {})
        return v && typeof v === 'object' ? v : {}
      } catch {
        return {}
      }
    }

    /** 记一条「这个面板打开的是哪份文档」（窗口模式 / 重开都要） */
    const saveDoc = async (panelId, doc) => {
      try {
        const all = await readDocs()
        all[panelId] = {
          mode: doc.mode,
          path: doc.path,
          abs: doc.abs,
          name: doc.name,
          vault: vaultKey(),
          at: Date.now(),
        }
        const kept = Object.entries(all)
          .sort((a, b) => (Number(b[1]?.at) || 0) - (Number(a[1]?.at) || 0))
          .slice(0, MAX_DOC_RECORDS)
        await store.set(STORE_DOCS, Object.fromEntries(kept))
      } catch (e) {
        host.log('warn', `阅读器记不住已打开的文档：${String(e)}`)
      }
    }

    const dropDoc = async (panelId) => {
      try {
        const all = await readDocs()
        if (!(panelId in all)) return
        delete all[panelId]
        await store.set(STORE_DOCS, all)
      } catch {
        /* 忽略：记不住最多是窗口里少恢复一个面板 */
      }
    }

    /** 已注册的文档面板句柄：同一文档再次打开时先放掉旧的（否则面板表里留着一份旧闭包） */
    const panelHandles = new Map()

    /** 给这份文档注册一个「它就是这份文档」的面板，返回面板 id */
    const ensurePanel = (doc) => {
      const id = panelIdFor(doc)
      try {
        panelHandles.get(id)?.dispose()
      } catch {
        /* 已经释放过就算了 */
      }
      panelHandles.set(
        id,
        view.registerPanel({
          id,
          // 标签标题就是文件名 —— 多标签时一眼能分清是哪份
          title: doc.name,
          location: 'main',
          // 不进 ☰ 菜单：这是"打开的那份文档"，不是功能入口（否则打开 10 份就多 10 项）
          hidden: true,
          mount: (root) => mountReader(root, { doc, panelId: id, fs, host, dropDoc }),
        }),
      )
      if (!readerState.has(id)) readerState.set(id, { page: 1, scale: 1 })
      return id
    }

    /**
     * 把面板开到主区并进标签条（宿主为每个面板注册的 `core.panel.<id>`）。
     *
     * ⚠️ **重试**：那条命令由宿主在 `onPanelsChange` 之后（React effect 里）注册 ——
     * 刚 `registerPanel` 时可能还不存在；冷启动竞态（Android 从文件管理器点 PDF）正好撞上。
     * 命令不存在时 `execute` 会**抛错**（不是静默 no-op），所以重试既安全又必要。
     */
    const openPanel = async (panelId) => {
      for (let i = 0; i < 5; i++) {
        try {
          await command.execute(`core.panel.${panelId}`)
          return true
        } catch (e) {
          if (i === 4) {
            host.log('warn', `阅读器面板打不开：${String(e)}`)
            host.notify('阅读器面板还没就绪 —— 从 ☰ 菜单或命令面板里再打开一次', 'warn')
            return false
          }
          await new Promise((r) => setTimeout(r, 120))
        }
      }
      return false
    }

    const openDocument = async (payload) => {
      const p = payload && typeof payload === 'object' ? payload : {}
      /**
       * 两种来源：
       *   · `{ path }` —— **库内相对路径**（文件树里点文档、或 `core.openDocument` 的常规用法）
       *   · `{ abs, name }` —— **库外绝对路径**（Android 系统「打开方式」递来的 `content://`
       *     由内核的原生插件复制到应用缓存后，就是走这条）
       */
      const abs = typeof p.abs === 'string' && p.abs ? p.abs : ''
      const path = abs ? '' : typeof p.path === 'string' ? p.path : ''
      if (!abs && !path) return

      const name = abs ? p.name || abs.split(/[\\/]/).pop() || '文档' : nameOf(path)
      const ext = extOf(name)
      const kind = RENDERERS[ext]
      if (!kind) {
        host.notify(`文档阅读器不认识 .${ext} 这种格式`, 'warn')
        return
      }

      const doc = {
        mode: abs ? 'abs' : 'vault',
        path,
        abs,
        name,
        kind,
        url: abs ? host.assetUrlAbs(abs) : host.assetUrl(path),
      }
      const panelId = ensurePanel(doc)
      void saveDoc(panelId, doc)
      await openPanel(panelId)
      host.log('info', `文档阅读器：打开 ${abs || path}（${kind}）→ ${panelId}`)
    }

    /**
     * 窗口模式：`?pluginWindow=<panelId>` 是**新的 webview**，插件会重新 apply —
     * 模块级变量全是空的，所以用 panelId 从 store 找回"这份面板该显示哪份文档"，
     * 再把面板重建出来（App 渲染 `pluginWindowId` 时就能在面板表里找到它）。
     */
    const winPanelId = new URLSearchParams(location.search).get('pluginWindow')
    if (winPanelId && winPanelId.startsWith(`${PANEL_PREFIX}.`)) {
      void (async () => {
        try {
          const doc = toDoc((await readDocs())[winPanelId])
          if (!doc) {
            host.log('warn', `阅读器窗口：store 里没有 ${winPanelId} 的文档（可能已过期）`)
            return
          }
          ensurePanel(doc)
          host.log('info', `阅读器窗口：从 store 还原 ${doc.name}`)
        } catch (e) {
          host.log('warn', `阅读器窗口还原失败：${String(e)}`)
        }
      })()
    }

    /* 接管内核的派发点：bind 只换实现、不动元数据；卸载时宿主自动还原（契约 §2.1.1） */
    subscriptions.push(command.bind('core.openDocument', openDocument))

    /* 自带一个入口：命令面板里也能开（挑库里第一份文档；没有就如实说） */
    subscriptions.push(
      command.register({
        id: 'doc-reader.open',
        title: '文档阅读器：打开库内的文档…',
        run: async () => {
          try {
            const list = (await ctx.fs.listNotes()).filter((n) => n.kind === 'doc')
            if (!list.length) {
              host.notify('这个库里还没有文档（PDF / EPUB / …）', 'warn')
              return
            }
            await openDocument({ path: list[0].path })
          } catch (e) {
            host.notify(`打不开：${String(e)}`, 'warn')
          }
        },
      }),
    )

    host.log('info', '文档阅读器已就绪（每个文档一个面板 · 接管 core.openDocument）')
  },
}
