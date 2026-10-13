/**
 * Asset / 渲染能力探针（一次性夹具，2026-10-13）
 *
 * ## 为什么要有它
 * 「文档格式阅读器」插件（`examples/doc-reader/`）不走内核命令拿字节，而是
 * `host.assetUrl(库内相对路径)` → `fetch` → Blob（内核 `fs` 只有 `readText`，没有二进制读）。
 * 这条通路的前提必须在**两端**实测，而不是推断。
 *
 * ## 它验四件事（全部自动跑，结果落到两处便于 adb 直读）
 *   ① asset 协议读库内文件：HTTP 状态 / MIME / 字节数 / `Range` 是否 206
 *   ② **pdf.js 能否加载并真渲染**（渲染第 1 页到 canvas，数非白像素）
 *   ③ **foliate-js 能否加载并解析 EPUB**（拿到 metadata / 章节数 / 章节文本长度）
 *   ④ 脚本沙箱：解析出的章节里，`<script>` 是否被执行
 *
 * ## 已知的两端差异（2026-10-13 实测）
 * - 桌面（WebView2）：asset `200` + `application/pdf` + Range `206`
 * - **Android：点开头的路径段（如 `.zn/…`）→ 403**。根因 `tauri-2.12.3/src/scope/fs.rs:215-225`
 *   的 `require_literal_leading_dot`（unix 默认 true）⇒ 已在 `tauri.conf.json` 关掉；
 *   本探针同时测"点目录"与"普通目录"两个目标来复现/复验这一点。
 *
 * 结果写两处：插件 store（`<库>/.zn/plugins/asset-probe/store.json`）
 * 与库根 `asset-probe-result.json`（探针用完删掉）。
 */

/** 两个对照目标：一个在点目录里（Android 预期 403），一个不在（两端都该 200） */
const TARGETS = ['.zn/plugins/asset-probe/probe.pdf', 'probe.pdf']

/** 应用内置 vendor 的绝对 URL（插件跑在 Blob 模块里，相对路径没有 base） */
const vendor = (p) => new URL(`/vendor/${p}`, location.origin).href

/**
 * 补齐老 WebView 缺的新 API —— 详见 `examples/doc-reader/index.js` 同函数的注释。
 * 一句话：Android WebView（实测 Chrome 143）没有 `Map.prototype.getOrInsertComputed`，
 * 而 pdf.js 的渲染路径用它 ⇒ 桌面测不出、真机必炸。
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

export default {
  apply(ctx) {
    const { host, store, fs, command } = ctx

    /* ── ① asset 协议读字节 ── */
    const probeAsset = async (rel) => {
      const out = { rel }
      try {
        const url = host.assetUrl(rel)
        out.url = url
        const r = await fetch(url)
        const buf = await r.arrayBuffer()
        out.status = r.status
        out.ct = r.headers.get('content-type')
        out.len = buf.byteLength
        out.magic = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)))
        const r2 = await fetch(url, { headers: { Range: 'bytes=0-9' } })
        const b2 = await r2.arrayBuffer()
        out.rangeStatus = r2.status
        out.contentRange = r2.headers.get('content-range')
        out.head = new TextDecoder().decode(b2)
      } catch (e) {
        out.err = String(e)
      }
      return out
    }

    /* ── ② pdf.js 端到端渲染 ── */
    const probePdf = async () => {
      const out = {}
      try {
        ensureMapApis()
        const pdfjs = await import(vendor('pdfjs/build/pdf.min.mjs'))
        pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs/build/pdf.worker.min.mjs')
        out.loaded = true
        const doc = await pdfjs.getDocument({
          url: host.assetUrl(TARGETS[1]),
          cMapUrl: vendor('pdfjs/cmaps/'),
          cMapPacked: true,
          standardFontDataUrl: vendor('pdfjs/standard_fonts/'),
          wasmUrl: vendor('pdfjs/wasm/'),
          isEvalSupported: false,
        }).promise
        out.pages = doc.numPages
        const page = await doc.getPage(1)
        const vp = page.getViewport({ scale: 1 })
        const cv = document.createElement('canvas')
        cv.width = Math.floor(vp.width)
        cv.height = Math.floor(vp.height)
        const c2d = cv.getContext('2d')
        await page.render({ canvasContext: c2d, canvas: cv, viewport: vp }).promise
        out.width = cv.width
        out.height = cv.height
        try {
          const d = c2d.getImageData(0, 0, cv.width, cv.height).data
          let nw = 0
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nw++
          }
          out.nonWhite = nw
        } catch (e) {
          out.nonWhite = `canvas 被污染/读不了：${String(e).slice(0, 60)}`
        }
        void doc.destroy?.()
      } catch (e) {
        out.err = String(e)
      }
      return out
    }

    /* ── ③④ foliate-js 解析 EPUB（并验章节里的脚本没跑） ── */
    const probeEpub = async () => {
      const out = {}
      const hostEl = document.createElement('div')
      hostEl.style.cssText =
        'position:fixed;left:0;top:0;width:800px;height:600px;opacity:0.01;pointer-events:none;z-index:-1'
      document.body.append(hostEl)
      try {
        await import(vendor('foliate/view.js')) // 注册 <foliate-view>
        out.loaded = true
        const view = document.createElement('foliate-view')
        view.style.cssText = 'width:100%;height:100%;display:block'
        hostEl.append(view)

        const res = await fetch(host.assetUrl('测试书籍.epub'))
        if (!res.ok) throw new Error(`读取 EPUB 失败：HTTP ${res.status}`)
        const file = new File([await res.blob()], '测试书籍.epub')

        const loaded = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 8000)
          view.addEventListener('load', (e) => {
            clearTimeout(timer)
            resolve(e.detail?.doc ?? null)
          })
        })
        await view.open(file)
        view.renderer?.setAttribute?.('flow', 'scrolled')
        view.renderer?.next?.()

        out.title = view.book?.metadata?.title ?? null
        out.subtitle = view.book?.metadata?.language ?? null
        out.sections = view.book?.sections?.length ?? null
        out.toc = view.book?.toc?.length ?? null

        const doc = await loaded
        out.chapterLoaded = !!doc
        out.chapterTextLen = doc?.body?.textContent?.length ?? 0
        // 章节里的探针脚本若被执行，会设置 parent.__epubScriptRan
        out.scriptRan = window.__epubScriptRan ?? null
        try {
          view.close?.()
        } catch {
          /* 忽略 */
        }
      } catch (e) {
        out.err = String(e)
      } finally {
        hostEl.remove()
      }
      return out
    }

    const run = async () => {
      const out = {
        t: Date.now(),
        vault: fs.vaultPath(),
        ua: navigator.userAgent,
        // ⚠️ Android 上这里**不是** vite 的地址，而是 `http://tauri.localhost`（Tauri 的 origin）——
        // 插件里凡是用 `location.origin` 拼绝对 URL 的地方都要靠这条对账。
        origin: location.origin,
        assets: [],
        urls: [],
      }
      // 诊断：几个 vendor 资源到底哪个取不到（区分 404 / MIME / 其它）
      for (const rel of [
        'pdfjs/build/pdf.min.mjs',
        'pdfjs/build/pdf.worker.min.mjs',
        'foliate/view.js',
        'pdfjs/cmaps/LICENSE',
      ]) {
        const full = vendor(rel)
        try {
          const r = await fetch(full)
          const t = await r.text()
          out.urls.push({
            rel,
            full,
            status: r.status,
            ct: r.headers.get('content-type'),
            len: t.length,
          })
        } catch (e) {
          out.urls.push({ rel, full, err: String(e) })
        }
      }
      for (const rel of TARGETS) out.assets.push(await probeAsset(rel))
      out.pdf = await probePdf()
      out.epub = await probeEpub()

      try {
        await store.set('probe', out)
      } catch (e) {
        out.storeErr = String(e)
      }
      try {
        await fs.writeText('asset-probe-result.json', JSON.stringify(out, null, 2))
      } catch (e) {
        out.fileErr = String(e)
      }

      host.notify(
        `探针：asset=${out.assets.map((a) => a.status ?? a.err).join('/')} · pdf=${out.pdf.err ? 'ERR' : `${out.pdf.pages}页/${out.pdf.nonWhite}px`} · epub=${out.epub.err ? 'ERR' : `${out.epub.title}/${out.epub.chapterTextLen}字`}`,
        out.pdf.err || out.epub.err ? 'warn' : 'info',
      )
    }

    // 返回值由宿主自动登记（契约 §2.7），不必自己 push
    command.register({ id: 'asset-probe.run', title: 'Asset/渲染探针：重跑一次', run })

    void run()
  },
}
