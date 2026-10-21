/**
 * 文档阅读器（doc-reader）—— **只读**，绝不写库文件。
 *
 * ## 它接的是哪个口
 * 内核只认识"这是一份只读文档"（`NoteMeta.kind === 'doc'`），**不认识 pdf/epub**。
 * 所以内核注册了 `core.openDocument`（默认实现只 toast 一句"没有插件能打开"），
 * 本插件 `command.bind('core.openDocument', …)` **接管**它 —— 与 `core.newNote` 同一套机制：
 * bind 只换实现、不动元数据，**卸载时自动还原**（契约 §2.1.1 / §2.7）。
 *
 * ## 界面怎么承载（rev173.84：整窗接管 → 面板）
 * 以前是 `view.overrideShell`（把内核 UI **整个请下场**）：PDF.js 的 canvas、foliate 的
 * `contentDocument` 都塞不进 21 种 UINode，只能接管。代价记在 rev173.81 的调研里 ——
 * 退出方式三套并存（内核右下角 / 插件顶栏 ✕ / 返回键直接退 App）。
 *
 * rev173.81 起面板支持 `mount`（真 DOM）、rev173.83 起面板能进主区标签条并拖出成独立窗口
 * ⇒ 改注册成**一个面板**（`doc-reader.view`）：
 *   · 默认在主区标签里打开（宿主为每个面板注册 `core.panel.<id>`，我们执行它）
 *   · 标签拖出 / 右键「在新窗口打开」= `?pluginWindow=doc-reader.view` 独立窗口（rev173.83）
 *   · 手机只有主区：面板 + 顶栏「返回编辑器」由内核提供（rev173.82 的降级同一处）
 * 阅读器自己不再画「✕ 关闭」—— 退出路径归内核（窗口的 ✕ / 主区的返回编辑器 / 关标签）。
 *
 * ## 换文档、窗口里怎么知道读哪份
 * 面板的 `mount` **只跑一次**（`PanelMount` 的依赖是 `[panel]`，`refresh`/`setState` 都不重挂），
 * 所以"换一份文档"不能靠重挂面板：
 *   · **同窗口内**：模块级 `currentDoc` + 实例的 `show()` 回调（命令表与面板在同一个 JS 上下文）
 *   · **独立窗口**：那是**新的 webview**，插件会重新 `apply` 一遍，模块级变量是空的
 *     ⇒ 打开文档时把 `{ mode, path, abs, name }` 写进 `store`（键 `last`），窗口里 mount 读它。
 *     这正是 outline-map 用 `open:<panelId>` 传上下文的那套做法（`index.js:1611` 的注释）。
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
 * 不做「最近打开」、不做书签 / 阅读进度记忆 —— "只要能打开看就行"。
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
 */
const CSS = `
.dn-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;background:var(--zn-bg,#fff);color:var(--zn-fg,#111)}
.dn-bar{display:flex;align-items:center;gap:8px;flex:none;padding:6px 10px;font-size:13px;border-bottom:1px solid var(--zn-border,#e4e4e7);background:var(--zn-bg-subtle,#f7f7f8)}
.dn-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dn-meta{flex:none;color:var(--zn-fg-subtle,#71717a)}
/* 顶栏按钮：**触控目标 ≥30px**（手机实测：更小的点不中，还会被系统当图片长按）。
   注意：这段在模板字符串里，**不能出现反引号**（会提前结束字符串 —— 真踩过）。
   尺寸也别太大：顶栏元素多，手机上会把最右的「⋮」挤出屏幕（也真踩过）。 */
.dn-btn{flex:none;min-height:30px;padding:4px 9px;font-size:12.5px;border:1px solid var(--zn-border,#d4d4d8);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dn-bar-btn:disabled{opacity:.4;cursor:default}
/* 只读区：撑满剩余高度，自己滚（面板容器那条 overflow:auto 只是兜底） */
.dn-body{flex:1;min-height:0;overflow:auto;background:var(--zn-bg-subtle,#f7f7f8)}
/* 原尺寸显示（用户 2026-10-15：「PDF 显示会强制缩放，取消掉，做原格式查看」）：
   原先这行是 max-width:100% 加 height:auto —— 它把 A4（595px 宽）压到屏宽，
   而 canvas 的 height 是 pdf.js 按 1:1 设的 **inline 尺寸**（CSS 盖不掉）⇒
   画面被**横向压扁**（宽 66%、高 100%），看着就是"被强制缩放"。
   现在：块级 + auto margin ⇒ 宽度 > 容器时 auto 归 0，靠 .dn-body 横向滚动看全。
   （不能用 flex 居中：内容超宽时左边会被裁掉且滚不过去；EPUB / TXT 渲染器自己会把
   display 覆盖成 block，见各自 mount 里的 body.style.display 赋值）。 */
.dn-page{display:block;margin:10px auto;box-shadow:0 1px 8px rgba(0,0,0,.28);background:#fff}
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
/* 统一接口：返回 { next?, prev?, zoom?, destroy? }；进度通过 onMeta 文本回调推给顶栏 */

async function mountPdf(body, { url, onMeta }) {
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

  const canvas = el('canvas', 'dn-page')
  body.append(canvas)

  let page = 1
  let scale = 1
  let rendering = false
  let pending = null

  const draw = async (n) => {
    if (rendering) {
      pending = n
      return
    }
    rendering = true
    try {
      const p = await doc.getPage(n)
      const vp = p.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = `${Math.floor(vp.width)}px`
      canvas.style.height = `${Math.floor(vp.height)}px`
      const ctx = canvas.getContext('2d')
      await p.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise
      page = n
      onMeta(`第 ${n} / ${doc.numPages} 页 · ${Math.round(scale * 100)}%`)
    } finally {
      rendering = false
      if (pending != null && pending !== page) {
        const q = pending
        pending = null
        void draw(q)
      }
    }
  }

  await draw(1)
  return {
    next: () => {
      if (page < doc.numPages) void draw(page + 1)
    },
    prev: () => {
      if (page > 1) void draw(page - 1)
    },
    zoom: (d) => {
      scale = Math.min(4, Math.max(0.25, +(scale + d).toFixed(2)))
      void draw(page)
    },
    destroy: () => {
      try {
        void doc.destroy()
      } catch {
        /* 已经没了就算了 */
      }
    },
  }
}

async function mountFoliate(body, { url, name, onMeta }) {
  await loadFoliate() // 注册 <foliate-view> 自定义元素
  const view = document.createElement('foliate-view')
  view.style.cssText = 'width:100%;height:100%;display:block'
  body.style.display = 'block' // 连续滚动交给 foliate 自己管，别让 flex 干扰它的测量
  body.append(view)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`读取失败：HTTP ${res.status}`)
  // foliate 按 `type` / 文件名判格式 ⇒ 必须是 File（Blob 没有 name）
  const file = new File([await res.blob()], name)

  view.addEventListener('relocate', (e) => {
    const d = e.detail ?? {}
    const pct = d.fraction != null ? ` · ${Math.round(d.fraction * 100)}%` : ''
    onMeta(`${d.tocItem?.label ?? name}${pct}`)
  })

  await view.open(file)
  // 官方 reader.js 也是 open 之后手动推第一屏
  view.renderer?.setAttribute?.('flow', 'scrolled')
  view.renderer?.next?.()

  return {
    next: () => view.goRight?.(),
    prev: () => view.goLeft?.(),
    destroy: () => {
      try {
        view.close?.()
      } catch {
        /* 忽略 */
      }
    },
  }
}

async function mountText(body, { url, onMeta }) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`读取失败：HTTP ${res.status}`)
  const text = await res.text()
  body.style.display = 'block'
  const pre = el('pre', 'dn-text', text)
  body.append(pre)
  onMeta(`${text.length} 字符`)
  return {}
}

const MOUNTERS = { pdf: mountPdf, foliate: mountFoliate, text: mountText }

/* ───────────── 插件本体 ───────────── */

/** 面板 id：宿主会为它注册 `core.panel.doc-reader.view`（命令面板 / ☰ 菜单 / 标签拖出都认它） */
const PANEL_ID = 'doc-reader.view'
/** store 键：窗口（新 webview）重新 apply 后靠它找回"该显示哪份文档" */
const STORE_LAST = 'last'

/**
 * 当前文档 —— **模块级**，只在同一个 JS 上下文内有效（独立窗口有自己的模块实例）。
 * 形状：`{ mode: 'vault'|'abs', path, abs, name, kind, url }`
 */
let currentDoc = null
/** 已挂载的阅读器实例（换文档 / 删除时通知它们重绘；面板 mount 只跑一次，不会自动重挂） */
const liveInstances = new Set()

export default {
  apply(ctx) {
    const { command, view, host, subscriptions, fs, store } = ctx

    /**
     * 当前库的标识。**全局插件的 store 跨库共用**（`plugin-host.ts:849` 的注释：
     * 装一次、配置一次）—— 换库后 `last` 里的**库内相对路径**属于上一个库，
     * 拿新库根去拼会读到同名文件或 404（静默错文件比报错更难查）。
     *
     * 用 `host.assetUrl('')`：它把相对路径拼上库根再转 asset URL ⇒ 值里天然带着库根。
     * 为什么不用 `vault:open` 事件：它**每代插件都发**（`usePluginHost.ts:347`，重扫 / 换库都发），
     * 而冷启动从文件管理器点 PDF 时派发（`waitDocHandler` ≤120ms 轮询）可能赶在它之前 ——
     * 那时清掉刚打开的文档，面板就变空态（回归）。
     */
    const vaultKey = () => {
      try {
        return host.assetUrl('')
      } catch {
        return ''
      }
    }

    /** 写一份"当前是哪份文档"进 store（异步；失败只记日志 —— 读不到最多是窗口显示空态） */
    const persist = (doc) => {
      void Promise.resolve(
        store.set(STORE_LAST, {
          mode: doc.mode,
          path: doc.path,
          abs: doc.abs,
          name: doc.name,
          vault: vaultKey(),
        }),
      ).catch((e) => host.log('warn', `阅读器记不住当前文档：${String(e)}`))
    }

    /** 从 store 还原（窗口模式的主路径；主窗口里仅在"面板被 ☰ 直接打开"时用到） */
    const restore = async () => {
      try {
        const v = await store.get(STORE_LAST, null)
        if (!v || typeof v !== 'object') return null
        const mode = v.mode === 'abs' ? 'abs' : v.mode === 'vault' ? 'vault' : null
        const path = typeof v.path === 'string' ? v.path : ''
        const abs = typeof v.abs === 'string' ? v.abs : ''
        if (!mode || (mode === 'vault' ? !path : !abs)) return null
        /**
         * 库内路径换了库就作废（`vault` 是写记录时那个库的 asset 根）。
         * **库外绝对路径不受影响**：它在应用缓存里，与当前库无关。
         */
        if (mode === 'vault' && typeof v.vault === 'string' && v.vault && v.vault !== vaultKey()) {
          void Promise.resolve(store.delete(STORE_LAST)).catch(() => {})
          host.log('info', '阅读器：上次的文档属于别的库，已忽略')
          return null
        }
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
      } catch (e) {
        host.log('warn', `阅读器读不回上次的文档：${String(e)}`)
        return null
      }
    }

    /** 让所有挂着的实例换到这份文档（同步；mount 不再跑，所以这里是唯一的换文档通道） */
    const show = (doc) => {
      currentDoc = doc
      for (const inst of [...liveInstances]) {
        try {
          inst.show(doc)
        } catch (e) {
          host.log('warn', `阅读器实例重绘失败：${String(e)}`)
        }
      }
    }

    /**
     * 把面板开到主区并进标签条。
     *
     * 走宿主为面板注册的 `core.panel.<id>` 命令 —— 它做两件事：`setMainView(panelId)` +
     * 把 `panel:<id>` 塞进标签条（rev173.83）。插件没有直接的"打开我自己"原语，这是公开路径。
     *
     * ⚠️ **重试**：那条命令由宿主在 `onPanelsChange` 之后（React effect 里）注册。插件刚
     * `registerPanel` 时它可能还不存在；冷启动竞态（Android 从文件管理器点 PDF，派发在
     * 应用起来 ~20ms 内）正好撞在这个窗口里。命令不存在时 `execute` 会**抛错**（不是静默
     * no-op），所以重试几次既安全又必要。
     */
    const openPanel = async () => {
      for (let i = 0; i < 5; i++) {
        try {
          await command.execute(`core.panel.${PANEL_ID}`)
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

    /** 当前文档被删掉（逻辑删除 / 彻底删除）后：内存与 store 一起清，实例回到空态 */
    const forget = (msg) => {
      const doc = currentDoc
      currentDoc = null
      void Promise.resolve(store.delete(STORE_LAST)).catch(() => {})
      for (const inst of [...liveInstances]) {
        try {
          inst.clear(msg ?? `已移入回收站：${doc?.name ?? '文档'}（「回收站」里能恢复）`)
        } catch {
          /* 单个实例出错不影响别的 */
        }
      }
    }

    const openDocument = async (payload) => {
      const p = payload && typeof payload === 'object' ? payload : {}
      /**
       * 两种来源：
       *   · `{ path }` —— **库内相对路径**（文件树里点文档、或 `core.openDocument` 的常规用法）
       *   · `{ abs, name }` —— **库外绝对路径**（2026-10-14 加）：Android 系统「打开方式」递来
       *     的 `content://` 由内核的原生插件复制到应用缓存后，就是走这条（缓存不在库里）。
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
      show(doc) // ① 已挂着的实例先换文档（同步，主窗口里这是主路径）
      persist(doc) // ② 落 store —— 独立窗口重新 apply 后靠它（异步，不阻塞）
      await openPanel() // ③ 主区 + 标签条
      host.log('info', `文档阅读器：打开 ${abs || path}（${kind}）`)
    }

    /**
     * 面板本体。`location: 'main'` ⇒ 主区页面 + 可进标签条 + 可拖出成窗口（rev173.83）。
     * 顶栏里的「删除」仍然保留（触屏与 EPUB 都得靠它 —— 手机长按虽然派发 `contextmenu`，
     * 但 EPUB 章节跑在 foliate 自己的 iframe 里，那里的右键不会冒泡到面板容器）。
     */
    view.registerPanel({
      id: PANEL_ID,
      title: '文档阅读器',
      location: 'main',
      mount: (root) => {
        root.classList.add('dn-root')
        const style = document.createElement('style')
        style.textContent = CSS
        root.append(style)

        /* ── 顶栏：删除 / 文件名 / 进度 / 缩放 / 翻页 ──
           「关闭」不在这里：主区有「返回编辑器」，窗口有标题条 ✕，标签有关闭按钮。 */
        const bar = el('div', 'dn-bar')
        const title = el('span', 'dn-title', '文档阅读器')
        title.title = '还没有打开文档'
        const meta = el('span', 'dn-meta', '')
        const btnOut = el('button', 'dn-btn', '−')
        const btnIn = el('button', 'dn-btn', '＋')
        const btnPrev = el('button', 'dn-btn', '‹')
        const btnNext = el('button', 'dn-btn', '›')
        // 删除入口：**触屏与 EPUB 都得靠它** —— 手机上长按虽然会派发 `contextmenu`，
        // 但 EPUB 的章节跑在 foliate 自己的 iframe 里，那里的右键不会冒泡到我们的容器
        // 用**文字**「删除」而不是 `⋮` 符号：真机实测符号按钮点不中（怀疑命中区/字体问题），
        // 文字按钮又明确又稳 —— 手机上用户也一眼看得懂。
        const btnMore = el('button', 'dn-btn', '删除')
        btnMore.title = '删除这个文档…'
        btnMore.style.color = 'var(--zn-danger,#dc2626)'
        // ⚠️ 「⋮」放**删除按钮之后**（左起第 2），不放最右：手机上顶栏元素多，
        // 放最右会被挤出屏幕（真机实测：标题被压没、⋮ 被裁掉一半 ⇒ 点不中）。
        bar.append(btnMore, title, meta, btnOut, btnIn, btnPrev, btnNext)
        root.append(bar)

        let body = el('div', 'dn-body')
        root.append(body)

        let api = null
        let dead = false
        /** 换文档的代际：异步挂载器回来时如果已经换过，就把它丢掉（别串味） */
        let gen = 0

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
         * 换一块干净的 body：旧挂载器（异步、可能还在路上）写的是那个**已脱离文档树**的 div。
         * 只清空不换节点的话，旧挂载器回来后仍会往可见的 body 里 append（串味）。
         */
        const freshBody = () => {
          const next = el('div', 'dn-body')
          body.replaceWith(next)
          body = next
        }

        const setMeta = (t) => {
          if (!dead) meta.textContent = t
        }

        const showEmpty = (msg) => {
          gen += 1
          teardown()
          freshBody()
          title.textContent = '文档阅读器'
          title.title = '还没有打开文档'
          setMeta('')
          btnMore.hidden = true
          btnIn.hidden = true
          btnOut.hidden = true
          btnPrev.hidden = true
          btnNext.hidden = true
          body.append(el('div', 'dn-msg', msg))
        }

        const load = (doc) => {
          if (dead) return
          const my = ++gen
          teardown()
          freshBody()

          title.textContent = doc.name
          title.title = doc.abs || doc.path
          setMeta('载入中…')
          // 库外文件（Android「打开方式」→ 原生插件复制到缓存的副本）**不给删除入口**：
          // 它不在库里，内核的删除是"库内相对路径"，对它没有意义；缓存由系统自己回收。
          btnMore.hidden = doc.mode === 'abs'
          // 缩放只有 PDF 有意义（foliate 自己管排版）；手机上再让位给更重要的按钮
          // （顶栏在窄屏放不下 8 个元素，见上面「⋮」那条注释）
          const zoomable = doc.kind === 'pdf' && host.platform !== 'android'
          btnIn.hidden = !zoomable
          btnOut.hidden = !zoomable
          btnPrev.hidden = false
          btnNext.hidden = false

          void (async () => {
            try {
              const a = await MOUNTERS[doc.kind](body, { url: doc.url, name: doc.name, onMeta: setMeta })
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
              // Android 上"点开头目录"读不了（asset scope 限制）—— 给出可执行的解释
              if (/403/.test(String(e?.message))) {
                m.textContent += '\n\n若是从 . 开头的目录里打开的（如 .zn/…），Android 端读不了 —— 把文档放到普通目录再试。'
              }
              body.append(m)
              setMeta('失败')
            }
          })()
        }

        /* ── 翻页 / 缩放：绑定一次，闭包里的 `api` 随文档切换更新 ── */
        btnPrev.addEventListener('click', () => api?.prev?.())
        btnNext.addEventListener('click', () => api?.next?.())
        btnOut.addEventListener('click', () => api?.zoom?.(-0.25))
        btnIn.addEventListener('click', () => api?.zoom?.(0.25))

        /* ── 删除：顶栏「删除」或**右键**唤出，两个入口 —— 逻辑删除 / 物理删除 ── */
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
          const doc = currentDoc
          if (!doc || doc.mode !== 'vault') return
          try {
            await fs.delete(doc.path)
            host.notify(`已移入回收站：${doc.name}（「回收站」里能恢复）`)
            forget()
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
         * 中途失败就停在"已在回收站"那一步 —— 文件还能找回，不会丢。
         */
        const purgeIt = async () => {
          const doc = currentDoc
          if (!doc || doc.mode !== 'vault') return
          try {
            await fs.delete(doc.path)
            const entry = (await fs.listTrash()).find((t) => t.originalPath === doc.path)
            if (!entry) throw new Error('放进回收站后没能找回它（文件仍在回收站，可去那里手动删）')
            await fs.purgeTrash(entry.id)
            host.notify(`已彻底删除：${doc.name}`)
            forget(`已彻底删除：${doc.name}`)
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
          const q = el('div', '', `彻底删除「${currentDoc?.name ?? '文档'}」？`)
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
          const doc = currentDoc
          // 空态 / 库外文档：没有可删的，右键不弹（弹一个全是禁用项的菜单只会更迷惑）
          if (!doc || doc.mode !== 'vault') return
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

        btnMore.addEventListener('click', (e) => {
          e.stopPropagation()
          const r = btnMore.getBoundingClientRect()
          openMenu(r.left, r.bottom + 4)
        })
        // 桌面右键唤出同一菜单（EPUB 章节在 iframe 里，那种情况用顶栏「删除」）
        root.addEventListener('contextmenu', (e) => {
          if (!currentDoc || currentDoc.mode !== 'vault') return
          e.preventDefault()
          openMenu(e.clientX, e.clientY)
        })
        const onDocDown = (e) => {
          if (menuEl && !menuEl.contains(e.target) && e.target !== btnMore) closeMenu()
          if (confirmEl && !confirmEl.contains(e.target)) closeConfirm()
        }
        document.addEventListener('mousedown', onDocDown)

        // Esc 不再拦截：面板里 Esc 没有"退出阅读器"这回事（退出归内核的返回编辑器 / 关标签）
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

        /* ── 首帧：内存优先，其次 store（窗口模式） ── */
        const instance = {
          show: load,
          clear: (msg) => showEmpty(msg ?? '这份文档已不可用'),
        }
        liveInstances.add(instance)

        if (currentDoc) {
          load(currentDoc)
        } else {
          showEmpty('正在读取上次打开的文档…')
          void restore().then((doc) => {
            if (dead) return
            if (doc) {
              currentDoc = doc
              load(doc)
            } else {
              showEmpty('从左侧文件树里点一个 PDF / EPUB / TXT —— 它会在这个标签里打开。')
            }
          })
        }

        return () => {
          dead = true
          gen += 1
          liveInstances.delete(instance)
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDocDown)
          closeMenu()
          closeConfirm()
          teardown()
          body.textContent = ''
        }
      },
    })

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

    host.log('info', '文档阅读器已就绪（面板 doc-reader.view，接管 core.openDocument）')
  },
}
