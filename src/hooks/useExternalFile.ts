/**
 * 外部文件（打开文件 / Android SAF / 「待打开」/ 文件关联接线）—— 从 `App.tsx` 原样迁出
 * （rev127 · L3 第五刀）。
 *
 * 覆盖四条入口：
 *  - Windows 命令行参数 / 单实例转发（`zn:open-file` 事件 + 启动时 `opened_urls`）
 *  - Android「打开方式」（冷启动 `RunEvent::Opened` / 热启动 `onNewIntent` → `open-uri` 事件）
 *  - ☰ 菜单「打开文件…」（`pickFile` 留在 App，经本 hook 的 `openExternalFileRef` 进入）
 *
 * ⚠️ 行为必须与迁出前**逐字一致**（这些点不报错、但错了极难查）：
 *  - `content://` 必须在扩展名检查**之前**分流（内容 URI 通常没有扩展名，过早过滤会静默丢文件）；
 *  - 同一条可能被投两次（启动时「存状态 + 广播」重叠窗口）⇒ 3 秒内按路径去重；
 *  - 库外**文档**直接交给阅读器、绝不切库（切库会让用户以为笔记丢了）；
 *  - 库外**笔记**才把父目录当库打开，并留「待打开」等目标库就绪；
 *  - 冷启动竞态：要等插件接管 `core.openDocument` 再派发（`waitDocHandler`）。
 */
import { useCallback, useEffect, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Kernel } from '../kernel/kernel'
import {
  DOC_RE,
  MD_RE,
  relPathIn,
  SAF_READABLE_RE,
  samePath,
  splitPath,
  toLocalPath,
} from '../lib/app-paths'

export type ExternalFileRefs = {
  /** 当前库（openExternalFile 里判断"文件是否已在库内"） */
  vaultRef: MutableRefObject<string | null>
  /** 待打开的文件 —— 切库是异步的，等目标库就绪再开 */
  pendingOpenRef: MutableRefObject<{ vault: string; name: string } | null>
  /** 同一路径短时间去重：启动那条会「存状态 + 广播事件」，两条投递有重叠窗口 */
  recentOpenRef: MutableRefObject<Map<string, number>>
  /** `openExternalFile` 的稳定引用 —— 挂载时的监听只注册一次，不随库重建 */
  openExternalFileRef: MutableRefObject<(raw: string) => Promise<void>>
  openNoteRef: MutableRefObject<(p: string) => Promise<void>>
}

export type UseExternalFileArgs = {
  platform: 'android' | 'windows'
  kernel: Kernel | null
  /** 当前库（待打开 effect 要等它对齐） */
  vault: string | null
  /** App 的切库动作；返回**是否真的切了**（目录不存在时 false） */
  applyVault: (dir: string) => Promise<boolean>
  setToast: (msg: string | null) => void
  refs: ExternalFileRefs
}

export type ExternalFile = {
  /** 冷启动竞态：等文档插件接管 `core.openDocument` 再派发 */
  waitDocHandler: (timeoutMs?: number) => Promise<boolean>
  openExternalFile: (raw: string) => Promise<void>
  /** `openExternalFile` 的稳定引用（App 的 `pickFile` / 渲染期监听都用它） */
  openExternalFileRef: MutableRefObject<(raw: string) => Promise<void>>
}

export function useExternalFile({
  platform,
  kernel,
  vault,
  applyVault,
  setToast,
  refs,
}: UseExternalFileArgs): ExternalFile {
  const { vaultRef, pendingOpenRef, recentOpenRef, openExternalFileRef, openNoteRef } = refs

  /**
   * **冷启动竞态：等文档插件接管 `core.openDocument` 再派发**（rev82，真机实测挖出来的）。
   *
   * 症状（真机读数）：应用**冷启动**时从文件管理器点 PDF —— `onNewIntent`/`opened_urls`
   * 那条线在前端挂载后**立刻**执行（实测 `readContentUri` 在应用起来后 ~20ms 就跑完了），
   * 而库内插件（doc-reader）是**异步 blob import**、更晚才 `bind('core.openDocument')`。
   * 两者之间那个窗口里，命令表里还是**内核占位实现** ⇒ 请求被一句
   * 「没有能打开 .该 的插件 —— 到「插件管理」装一个文档阅读器」吞掉
   * （用户看到的正是"明明插件在跑却说没装"）。
   *
   * 判据用内核的 `implTag('core.openDocument')`：`'core'` = 还是占位/内核实现，
   * `plugin:<id>` = 已被插件接管。热启动时第一次判断就通过（零开销）。
   * 超时（8 秒）后**仍然派发** —— 那说明确实没有插件接管，该给用户的提示还得给。
   */
  const waitDocHandler = useCallback(async (timeoutMs = 8000) => {
    const t0 = Date.now()
    for (;;) {
      const tag = kernel?.commands.implTag('core.openDocument')
      if (tag && tag !== 'core') return true
      if (Date.now() - t0 >= timeoutMs) return false
      await new Promise((r) => setTimeout(r, 120))
    }
  }, [kernel])

  /**
   * 「打开一个外部文件」—— 三条入口共用：Windows 的命令行参数 / 单实例转发、
   * Android 的「打开方式」（Rust 侧 `RunEvent::Opened` → `zn:open-file`）、
   * 以及 ☰ 菜单的「打开文件…」。
   */
  const openExternalFile = useCallback(
    async (raw: string) => {
      const path = toLocalPath(raw)
      if (!path) return
      // 去重：同一条可能被投两次（启动时的「存状态 + 广播」重叠窗口）
      const now = Date.now()
      const seen = recentOpenRef.current.get(path)
      if (seen !== undefined && now - seen < 3000) return
      recentOpenRef.current.set(path, now)
      /**
       * ⚠️ **content:// 必须在扩展名检查之前分流**（2026-10-14 真机实测到的 bug）。
       *
       * 内容 URI 里**通常没有扩展名**（`content://media/external/file/1000000123`），
       * 拿它去过 `MD_RE` / `DOC_RE` 必然为 false ⇒ 文件在这一行被**静默丢掉**：
       * 文件管理器点 PDF 选 ZeroNote，应用起来了、却什么都不打开。
       * 类型判断只能挪到 `read_content_uri` 返回**副本文件名**之后（`SAF_READABLE_RE`）——
       * 那时才是唯一知道"这是什么类型"的时刻。
       */
      if (/^content:\/\//i.test(path)) {
        /**
         * Android SAF：系统「打开方式」递来的是**内容 URI**，`std::fs` 读不了它。
         *
         * 2026-10-14 起交给原生插件 `tauri-plugin-uri-reader`：它在 Android 侧用
         * `ContentResolver` 把文件**复制到应用缓存**，返回绝对路径；我们再让阅读器读那份副本
         * （`core.openDocument({ abs })`）。
         *
         * 为什么是"复制到缓存"而不是"导入笔记库"：从文件管理器打开多半只是**看一眼**，
         * 不该往用户的库里塞副本。（md 若要编辑，那属于"导入"，不在本轮。）
         */
        try {
          const r = await invoke<{ path: string; name: string }>(
            'plugin:uri-reader|read_content_uri',
            { uri: path },
          )
          const name = r.name || '文档'
          console.log(
            `[zn-uri] 副本就绪 path=${r.path} name=${name} 可阅读=${SAF_READABLE_RE.test(name)} kernel=${!!kernel}`,
          )
          if (!SAF_READABLE_RE.test(name)) {
            setToast(`「${name}」不是可阅读的文档类型（支持 pdf / epub / txt / md 等）`)
            return
          }
          const ready = await waitDocHandler()
          console.log(`[zn-uri] openDocument 派发（插件接管就绪=${ready}）`)
          void kernel?.commands.api
            .execute('core.openDocument', { abs: r.path, name })
            .then((x) => console.log('[zn-uri] openDocument 返回', String(x)))
            .catch((e) => console.error('[zn-uri] openDocument 抛错', String(e)))
        } catch (e) {
          setToast(`读不了这个文件：${e}`)
        }
        return
      }
      // 笔记与**只读文档**都认；其它类型静默忽略（与 Rust 侧同一口径，不弹错）
      const isDoc = DOC_RE.test(path)
      if (!MD_RE.test(path) && !isDoc) return
      const cur = vaultRef.current
      const rel = cur ? relPathIn(cur, path) : null
      if (rel) {
        // 已在当前库内 ⇒ 直接开：文档交给插件（core.openDocument），笔记走编辑器
        if (isDoc) void kernel?.commands.api.execute('core.openDocument', { path: rel })
        else await openNoteRef.current(rel)
        return
      }
      /**
       * **库外的只读文档 ⇒ 直接交给阅读器，绝不切库**（2026-10-14 用户实测后改）。
       *
       * 原先所有库外文件都走「把父目录当库打开」（那是为**笔记**设计的：编辑器只认库内路径）。
       * 但从文件管理器点一个 PDF，用户只是想**看一眼** —— 把父目录（比如 `Documents`）当库切过去，
       * 笔记库就被换掉了，界面显示"这个库还没有笔记"，像笔记全丢了（用户截图报的 bug）。
       *
       * 阅读器支持库外**绝对路径**（`core.openDocument({ abs })` → `host.assetUrlAbs`），
       * 所以文档不需要进库、也不需要切库。
       */
      if (isDoc) {
        // 文件名从路径末段取（`splitPath` 的解构在下面才声明，这里先自己取）
        const docName = path.split(/[\\/]/).pop() || '文档'
        await waitDocHandler()
        void kernel?.commands.api.execute('core.openDocument', { abs: path, name: docName })
        return
      }
      const { dir, name } = splitPath(path)
      if (!dir || !name) return
      pendingOpenRef.current = { vault: dir, name }
      // 目录不存在时 `applyVault` 会拒绝切库（并说明原因）—— 那就别把「待打开」留在 ref 里：
      // 它会一直等着那个库，等用户哪天又建出同名目录、切过去时突然弹出一篇笔记。
      if (!(await applyVault(dir))) pendingOpenRef.current = null
    },
    // `kernel` 进依赖：文档要经 `core.openDocument` 派发（切库时 kernel 会重建）。
    // 其余 refs / setToast 都是稳定引用（useRef 对象、setState setter）—— 列全是为了
    // 通过 exhaustive-deps；它们不会变，所以不会让 openExternalFile 重建。
    [
      applyVault,
      kernel,
      waitDocHandler,
      recentOpenRef,
      vaultRef,
      openNoteRef,
      setToast,
      pendingOpenRef,
    ],
  )

  useEffect(() => {
    openExternalFileRef.current = openExternalFile
  }, [openExternalFile, openExternalFileRef])

  /**
   * **Android 热启动的「打开方式」**（2026-10-14 修）。
   *
   * 背景：`RunEvent::Opened`（Rust 侧那条线）**只在冷启动**触发 —— Tauri 的
   * `TauriActivity.onNewIntent` 只把 intent 交给插件管理器、**没转给 tao**（实测根因，
   * 详见 `src-tauri/plugins/tauri-plugin-uri-reader/android/.../UriReaderPlugin.kt` 的注释）。
   * 所以"应用已在运行时点文件管理器里的 PDF 选 ZeroNote"什么都不发生。
   *
   * 那条路我们自己走：插件在 `onNewIntent` 里推 `open-uri` 事件，这里接到就复用**同一套**
   * `openExternalFile`（content:// → `read_content_uri` 复制到缓存 → 阅读器）。
   */
  useEffect(() => {
    if (platform !== 'android') return
    let disposed = false
    let unlisten: (() => void) | null = null
    void (async () => {
      try {
        const { addPluginListener } = await import('@tauri-apps/api/core')
        const listener = await addPluginListener<{ uri?: string }>(
          'uri-reader',
          'open-uri',
          (p) => {
            if (p?.uri) void openExternalFileRef.current(p.uri)
          },
        )
        if (disposed) void listener.unregister()
        else {
          unlisten = () => void listener.unregister()
          console.log('[zn-uri] listener registered')
        }
      } catch (e) {
        console.error('[zn-uri] listener failed', e)
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [platform, openExternalFileRef])

  /**
   * 待打开的文件：**等目标库就绪**再 `openNote`。
   *
   * `applyVault` 是异步的 —— 它只换掉 `vault` 状态，真正的 `ensure_vault` + 笔记列表刷新
   * 发生在 kernel 重建之后的 effect 里；切库前就 openNote 会读到**旧库**。
   * 所以用 ref 记着它，等 `vault` 与 kernel 对齐了再开，用掉即清空。
   *
   * 本 effect 必须排在 `openNoteRef` 的同步 effect **之后**：同一轮 commit 里
   * effect 按声明顺序执行，排在后面才拿得到新 kernel 的 `openNote`。
   */
  useEffect(() => {
    const pending = pendingOpenRef.current
    if (!pending || !vault || !kernel) return
    if (!samePath(vault, pending.vault)) return
    pendingOpenRef.current = null
    void (async () => {
      // 文档（pdf / epub / …）交给插件渲染；笔记走编辑器 —— 与 `openExternalFile` 同一口径。
      // 文档这条同样要等接管者（冷启动竞态，见 `waitDocHandler` 注释）。
      if (DOC_RE.test(pending.name)) {
        await waitDocHandler()
        void kernel.commands.api.execute('core.openDocument', { path: pending.name })
        return
      }
      void openNoteRef.current(pending.name)
    })()
  }, [vault, kernel, waitDocHandler, pendingOpenRef, openNoteRef])

  /**
   * 文件关联的接线：挂载后拉一次启动时攒下的文件，再订阅运行期事件。
   *
   * 顺序有意如此：**先挂监听再拉取** —— 反过来会漏掉"挂监听之前刚好到达"的那一条
   * （`opened_urls` 是取走即清空的，漏了就永远丢了）。两条都不阻塞首屏。
   */
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        const fn = await listen<string>('zn:open-file', (e) => {
          void openExternalFileRef.current(e.payload)
        })
        if (disposed) fn()
        else unlisten = fn
      } catch {
        /* 非 Tauri 环境（浏览器预览）没有事件系统 —— 忽略即可 */
      }
      try {
        const urls = await invoke<string[]>('opened_urls')
        for (const u of urls) await openExternalFileRef.current(u)
      } catch {
        /* 老内核 / 浏览器预览里没有这个命令 —— 忽略即可 */
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [openExternalFileRef])

  return { waitDocHandler, openExternalFile, openExternalFileRef }
}
