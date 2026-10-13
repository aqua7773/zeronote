/**
 * 文档阅读器（doc-reader）—— **只读**，绝不写库文件。
 *
 * ## 它接的是哪个口
 * 内核只认识"这是一份只读文档"（`NoteMeta.kind === 'doc'`），**不认识 pdf/epub**。
 * 所以内核注册了 `core.openDocument`（默认实现只 toast 一句"没有插件能打开"），
 * 本插件 `command.bind('core.openDocument', …)` **接管**它 —— 与 `core.newNote` 同一套机制：
 * bind 只换实现、不动元数据，**卸载时自动还原**（契约 §2.1.1 / §2.7）。
 *
 * ## 界面怎么承载
 * `view.overrideShell`（**真 DOM**）—— 不走 `registerWebView` 的 iframe：那儿是 opaque origin，
 * 既跑不了 PDF.js 的 canvas，也读不到 foliate-js 需要的 `contentDocument`。
 * 接管由**用户动作**触发（点文件树里的文档），不是 onStartup —— 符合契约 §2.8 的插件义务。
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

const loadPdfjs = () =>
  (pdfjsPromise ??= (ensureMapApis(), import(vendor('pdfjs/build/pdf.min.mjs'))))

let foliatePromise = null
const loadFoliate = () => (foliatePromise ??= import(vendor('foliate/view.js')))

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
 * 阅读器外观。注入到**接管容器内部** ⇒ 释放接管时随容器一起消失，不污染内核样式。
 * 颜色一律走 `--zn-*` 令牌 ⇒ 深浅色主题自动跟随。
 */
const CSS = `
.dn-root{display:flex;flex-direction:column;width:100%;height:100%;background:var(--zn-bg,#fff);color:var(--zn-fg,#111)}
.dn-bar{display:flex;align-items:center;gap:8px;flex:none;padding:6px 10px;font-size:13px;border-bottom:1px solid var(--zn-border,#e4e4e7);background:var(--zn-bg-subtle,#f7f7f8)}
.dn-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dn-meta{flex:none;color:var(--zn-fg-subtle,#71717a)}
/* 顶栏按钮：**触控目标 ≥30px**（手机实测：更小的点不中，还会被系统当图片长按）。
   注意：这段在模板字符串里，**不能出现反引号**（会提前结束字符串 —— 真踩过）。
   尺寸也别太大：顶栏元素多，手机上会把最右的「⋮」挤出屏幕（也真踩过）。 */
.dn-btn{flex:none;min-height:30px;padding:4px 9px;font-size:12.5px;border:1px solid var(--zn-border,#d4d4d8);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dn-bar-btn:disabled{opacity:.4;cursor:default}
.dn-body{flex:1;min-height:0;overflow:auto;display:flex;justify-content:center;align-items:flex-start;background:var(--zn-bg-subtle,#f7f7f8)}
.dn-page{max-width:100%;height:auto;margin:10px 0;box-shadow:0 1px 8px rgba(0,0,0,.28);background:#fff}
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

export default {
  apply(ctx) {
    const { command, view, host, subscriptions, fs } = ctx

    /** 当前接管句柄。内核**同一时刻只允许一个接管者** ⇒ 换文档前必须先放掉旧的 */
    let shell = null
    const release = () => {
      const s = shell
      shell = null
      try {
        s?.dispose()
      } catch {
        /* 已经释放过就算了 */
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

      release() // 先放掉上一个接管者，否则 overrideShell 会抛"已有接管者"

      const url = abs ? host.assetUrlAbs(abs) : host.assetUrl(path)

      shell = view.overrideShell({
        mount: (root, mctx) => {
          root.classList.add('dn-root')
          const style = document.createElement('style')
          style.textContent = CSS
          root.append(style)

          /* ── 顶栏：关闭 / 文件名 / 进度 / 缩放 / 翻页 ── */
          const bar = el('div', 'dn-bar')
          const btnClose = el('button', 'dn-btn', '✕ 关闭')
          btnClose.title = '关闭阅读器，回到笔记（Esc）'
          const title = el('span', 'dn-title', name)
          title.title = abs || path
          const meta = el('span', 'dn-meta', '载入中…')
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
          // ⚠️ 「⋮」放**关闭按钮之后**（左起第 2），不放最右：手机上顶栏元素多，
          // 放最右会被挤出屏幕（真机实测：标题被压没、⋮ 被裁掉一半 ⇒ 点不中）。
          bar.append(btnClose, btnMore, title, meta, btnOut, btnIn, btnPrev, btnNext)
          // 库外文件（Android「打开方式」→ 原生插件复制到缓存的副本）**不给删除入口**：
          // 它不在库里，内核的删除是"库内相对路径"，对它没有意义；缓存由系统自己回收。
          if (abs) btnMore.remove()
          root.append(bar)

          const body = el('div', 'dn-body')
          root.append(body)

          let api = null
          let dead = false
          const setMeta = (t) => {
            if (!dead) meta.textContent = t
          }

          btnClose.addEventListener('click', release)
          btnPrev.addEventListener('click', () => api?.prev?.())
          btnNext.addEventListener('click', () => api?.next?.())
          btnOut.addEventListener('click', () => api?.zoom?.(-0.25))
          btnIn.addEventListener('click', () => api?.zoom?.(0.25))

          /* ── 删除：顶栏「⋮」或**右键**唤出，两个入口 —— 逻辑删除 / 物理删除 ──
             （用户 2026-10-13 要求） */
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
            try {
              await fs.delete(path)
              host.notify(`已移入回收站：${name}（「回收站」里能恢复）`)
              release()
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
            try {
              await fs.delete(path)
              const entry = (await fs.listTrash()).find((t) => t.originalPath === path)
              if (!entry) throw new Error('放进回收站后没能找回它（文件仍在回收站，可去那里手动删）')
              await fs.purgeTrash(entry.id)
              host.notify(`已彻底删除：${name}`)
              release()
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
            const q = el('div', '', `彻底删除「${name}」？`)
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
          // 桌面右键唤出同一菜单（EPUB 章节在 iframe 里，那种情况用顶栏「⋮」）
          root.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            openMenu(e.clientX, e.clientY)
          })
          const onDocDown = (e) => {
            if (menuEl && !menuEl.contains(e.target) && e.target !== btnMore) closeMenu()
            if (confirmEl && !confirmEl.contains(e.target)) closeConfirm()
          }
          document.addEventListener('mousedown', onDocDown)

          const onKey = (e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              release()
            } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
              e.preventDefault()
              api?.next?.()
            } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
              e.preventDefault()
              api?.prev?.()
            }
          }
          document.addEventListener('keydown', onKey)

          void (async () => {
            try {
              api = await MOUNTERS[kind](body, { url, name, onMeta: setMeta })
              // 缩放只有 PDF 有意义（foliate 自己管排版）；手机上再让位给更重要的按钮
              // （顶栏在窄屏放不下 8 个元素，见上面「⋮」那条注释）
              if (kind !== 'pdf' || mctx?.platform === 'android') {
                btnIn.remove()
                btnOut.remove()
              }
            } catch (e) {
              if (dead) return
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

          return () => {
            dead = true
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('mousedown', onDocDown)
            closeMenu()
            closeConfirm()
            try {
              api?.destroy?.()
            } catch {
              /* 忽略 */
            }
            body.textContent = ''
          }
        },
      })

      host.log('info', `文档阅读器：接管 core.openDocument 打开 ${abs || path}（${kind}）`)
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

    host.log('info', '文档阅读器已就绪（接管 core.openDocument）')
  },
}
