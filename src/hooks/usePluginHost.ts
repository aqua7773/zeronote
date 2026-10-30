/**
 * 插件宿主（扫描 / 加载 / 懒激活 / `.znp` 安装）—— 从 `App.tsx` 原样迁出（rev128 · L3 第六刀）。
 *
 * 覆盖：
 *  - **加载链 effect**：全局插件根扫描 → 静态声明 /
 *    懒激活 / 立即加载 → 平台门 → 卡死兜底标记（`LS_LOADING`）。
 *    （rev173.259 起**不再预装任何插件** —— 首次启动就是零插件。）
 *  - **串行链**：同一时刻只有一代在「卸上一代 / 装本代」（`pluginChainRef`），
 *    被取代的一代在每个检查点 `return` 退出。
 *  - **`.znp` 安装**：从路径安装（`installZnpFromPath`）+ 插件页按钮（`installZnp`）+
 *    CDP 诊断出口（`__znInstallZnp`）。
 *
 * ⚠️ 行为必须与迁出前**逐字一致**（这些点不报错、但错了极难查）：
 *  - `loadedPluginsRef` 必须跨 effect 可见：加载**中途**被打断时 cleanup 也要清到正在加载的插件，
 *    否则命令/面板留在宿主里成幽灵（下一次加载同 id 直接撞「命令 id 重复」）；
 *  - `pluginChainRef` 必须串行：卸载是异步的，不串行会撞「命令 id 重复」；
 *  - 平台门要在**加载前**提前判（连懒激活插件一起挡），否则手机命令面板会列出跑不通的桌面命令；
 *  - 加载前落 `LS_LOADING` 标记、`finally` 里清 —— 只有进程真死才会留下，供启动自愈指认。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import type { Kernel } from '../kernel/kernel'
import type { WebviewBridgeHandler } from '../kernel/webview-bridge'
import type { UsageRecorder } from '../kernel/plugin-usage'
import {
  listPluginDirs,
  loadPlugin,
  platformOf,
  PlatformMismatch,
  readManifest,
  supportsPlatform,
  unloadPlugin,
  type LoadedPlugin,
  type PluginDirEntry,
  type PluginHostDeps,
} from '../kernel/plugin-host'
import { collectPluginDirs, globalPluginRoot, tryGlobalPluginRoot } from '../kernel/plugin-roots'
import { installFromMarket, type MarketEntry } from '../kernel/market'
import type { Disposable, PluginManifest } from '../kernel/contract'
import { LS_LOADING } from '../lib/boot-heal'
import { dropBootPluginStyles } from '../lib/boot-plugin-styles'

export type UsePluginHostArgs = {
  kernel: Kernel | null
  vault: string | null
  /**
   * **笔记独立窗口**（`?note=`，rev173.51）不需要插件 —— 它只画编辑器（rev173.53），
   * 面板 / 侧栏 / 时间流全都不渲染。false ⇒ 整个加载链不跑（rev173.60）。
   *
   * 为什么值得单独一个开关：每个 `note-*` 窗口都曾跑一遍扫描 + 加载立即执行的插件 ——
   * 拆三个标签就是三份额外启动成本，还会与主窗口并发写同一批插件文件。默认 `true`，只有笔记窗口传 false。
   */
  enabled?: boolean
  /**
   * 能力使用审计（rev173.78）：记录"每个插件实际调用了哪些 API"。
   * 不传 ⇒ 完全不记录（笔记窗口 / 测试）。
   */
  usage?: UsageRecorder
  /** 重扫信号：安装 / 删除 / 手动重扫时 +1 */
  reloadToken: number
  /** 已禁用插件 id（同步 ref —— 加载 effect 里要读最新值） */
  disabledRef: MutableRefObject<Set<string>>
  setManifests: Dispatch<SetStateAction<PluginManifest[]>>
  setPluginEntries: Dispatch<SetStateAction<Record<string, PluginDirEntry>>>
  setGlobalRoot: Dispatch<SetStateAction<string | null>>
  setLoadedIds: Dispatch<SetStateAction<string[]>>
  setPlatformSkipped: Dispatch<SetStateAction<string[]>>
  setPluginError: Dispatch<SetStateAction<string | null>>
  setReloadToken: Dispatch<SetStateAction<number>>
  setToast: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

export type PluginHost = {
  /** 从路径安装 `.znp`（`confirmFirst: false` 只给自动化验收用） */
  installZnpFromPath: (picked: string, confirmFirst?: boolean) => Promise<string | null>
  /** 插件管理页按钮：选文件 → 走完整流程 */
  installZnp: () => Promise<void>
  /**
   * 从市场安装 / 更新（rev173.148）：下载 + 整包 sha256 + 解包 + 重扫，
   * 一次完成，失败不落盘。返回装好的 id（失败 null，错误进 `pluginError`）。
   */
  installZnpFromUrl: (entry: MarketEntry) => Promise<string | null>
  /**
   * 按插件 id 取 **WebView 能力通道**（rev173.76 · 契约 §7.9）。
   * 没这个插件 / 纯样式插件 ⇒ `undefined`（通道关闭，页面照常显示）。
   */
  getWebviewBridge: (pluginId: string) => WebviewBridgeHandler | undefined
  /** 签名状态（rev173.77）：未加载的插件返回 undefined */
  getSignature: (pluginId: string) => 'signed' | 'unsigned' | undefined
  /**
   * **单插件热重载**（rev173.240 · 需求 §2.13 的未做项）：只卸这一个再装它，别的不动。
   *
   * 与 `setReloadToken(t+1)`（整代重载）的区别：整代会把十来个插件的状态一起重置
   * （面板收起、定时器重排、store 重读）—— 调试一个插件时那是噪音。
   * 实现挂在**同一条串行链**上：与整代加载互斥，否则两边同时注册同一条命令 id 会撞。
   * 插件没加载（禁用 / 平台不符）⇒ 抛错（调用方给用户看文案）。
   */
  reloadPlugin: (pluginId: string) => Promise<void>
}

export function usePluginHost({
  kernel,
  vault,
  reloadToken,
  // 默认开：主窗口 / 插件窗口行为不变；只有笔记独立窗口（`?note=`）传 false
  enabled = true,
  usage,
  disabledRef,
  setManifests,
  setPluginEntries,
  setGlobalRoot,
  setLoadedIds,
  setPlatformSkipped,
  setPluginError,
  setReloadToken,
  setToast,
  setError,
}: UsePluginHostArgs): PluginHost {
  /**
   * 已加载的插件**跨 effect 保存**（不是 effect 内的局部数组）。
   *
   * 为什么必须是 ref：加载是 `await` 的。如果加载**中途**被打断（用户点启用/禁用、
   * 切库、重新扫描），effect 的 cleanup 会跑；而那时正在加载的那个插件**还没被
   * push 进数组** ⇒ cleanup 会漏掉它 ⇒ 它已注册的命令/面板留在宿主里成了幽灵
   * ⇒ 下一次加载同一个 id 直接撞「命令 id 重复」，而且**一次污染之后每次重载都失败**。
   * （真机实测踩到：一次打断后 3 个插件接连变成未启用。）
   *
   * cleanup 用 `splice(0)` 消费，保证这份清单只被处理一次；加载路径里另有
   * `cancelled` 检查兜住"加载完成时 effect 已经取消"的那一半。
   */
  const loadedPluginsRef = useRef<LoadedPlugin[]>([])
  /**
   * `app:ready` 是否已发过（契约 §1.4，rev173.40）。**应用级事件只发一次**；
   * 重扫插件 / 切库发的是 `vault:open`（"当前库这一代插件已就位"）。
   */
  const readyRef = useRef(false)
  /**
   * 插件生命周期的**串行链**：同一时刻只有一代在「卸载上一代 / 加载本代」。
   *
   * 为什么必须是串行的（真机实测两轮才收敛）：
   *  · 卸载是**异步**的（插件 `dispose` 可能是 async）—— cleanup 里 `void unloadPlugin`
   *    火忘不管，新一代就开始注册命令 ⇒ 撞「命令 id 重复：ui-kit.hit」；
   *  · 反过来，旧一代可能正卡在 `await loadPlugin()` **内部**（命令已注册、但还没 push
   *    进清单）；这时新一代也开始加载同名插件 ⇒ 一样撞。
   * 所以整段（① 卸旧代 ② 装新代）挂到同一条 promise 链上，被取代的一代在每个检查点
   * `return` 退出，链才前进。
   */
  const pluginChainRef = useRef<Promise<void>>(Promise.resolve())
  /** 单插件热重载的实现（effect 里按「当前这一代」的目录表挂上；没挂上就报未就绪） */
  const reloadOneRef = useRef<(pluginId: string) => Promise<void>>(async (pluginId: string) => {
    throw new Error(`插件宿主未就绪，无法重载 ${pluginId}`)
  })

  useEffect(() => {
    const k = kernel
    // rev173.60：笔记独立窗口不需要插件（只画编辑器）⇒ 扫描 / 加载整段跳过
    if (!k || !vault || !enabled) return
    let cancelled = false
    // 用 ref 里那份（跨 effect 可见）：中途被打断时 cleanup 也能清到正在加载的插件
    const loaded = loadedPluginsRef.current
    /** 静态声明了命令、但**还没加载**的插件：id → 条目（激活时用；条目带根，全局/库内都找得对） */
    const pending = new Map<string, PluginDirEntry>()
    /** 本次静态声明过命令的插件 id —— 卸载时要把它们的命令元数据也清掉 */
    const declaredIds = new Set<string>()
    /**
     * 本次静态登记过的**条目菜单动作**（rev173.281 · J#18）。
     *
     * 与命令同一时机清理：插件可能从没被激活过，它声明的菜单项却已经挂在
     * 文件树 / 时间流的右键菜单里了 —— 不清掉就是「点了报命令不存在」的幽灵项。
     */
    const declaredItemMenus: Disposable[] = []
    /** 本次因平台不符被跳过的插件 id（循环末尾交给 state，供插件页标「不适用」） */
    const platformSkippedIds: string[] = []
    /** 平台门的输入 —— 取 kernel 的 `host.platform`（单一真相），别另算一遍 UA */
    const currentPlatform = platformOf(k.host.platform)
    const deps: PluginHostDeps = {
      vault,
      platform: k.host.platform,
      fs: k.fs,
      doc: k.doc,
      index: k.index,
      event: k.event,
      command: k.commands.api,
      view: k.view,
      store: k.store,
      host: k.host,
      net: k.net,
      service: k.service,
      editor: k.editor,
      itemMenu: (pluginId: string) => k.itemMenu.scoped(pluginId),
      capability: k.capability,
      // 能力使用审计（rev173.78）：App 侧传进来，没传就不记录
      usage,
      onLog: (msg, level) => k.host.log(level ?? 'info', msg),
      // 2026-10-13 拆权限门：`isGranted` 接线**已删除**（内核不再做权限判定）
    }

    /**
     * 懒激活入口：命令真的被执行时，宿主回调它把插件载进来。
     * 幂等 —— 重复点同一条命令不该加载两次。
     */
    const activate = async (pluginId: string) => {
      // 本代已被取代：一颗插件都别再加载（会跟新代撞命令 id）
      if (cancelled) throw new Error(`插件 ${pluginId} 正在重载，请重试`)
      if (loaded.some((l) => l.manifest.id === pluginId)) return
      const entry = pending.get(pluginId)
      if (!entry) throw new Error(`找不到待激活的插件：${pluginId}`)
      const l = await loadPlugin(entry, deps)
      pending.delete(pluginId)
      // 同加载路径：激活期间 effect 可能已被取消，别留下幽灵。
      // **先判取消再 push** —— cleanup 已经 splice 过清单，push 进去就再没人管它了
      if (cancelled) {
        await unloadPlugin(l, deps)
        k.releaseServices(pluginId)
        k.releaseEditorMarks(pluginId)
        k.releaseCapabilities(pluginId)
        k.releaseItemMenus(pluginId)
        return
      }
      setLoadedIds((ids) => (ids.includes(pluginId) ? ids : [...ids, pluginId]))
    }
    k.commands.setActivator(activate)

    /**
     * 本代的「① 卸上一代 + ② 装本代」**整段**排到同一条链上 —— 两代互斥，不会同时注册命令。
     * 被取代时（cleanup 把 `cancelled` 置真）在每个检查点 `return` 退出，让链尽快前进。
     */
    const run = pluginChainRef.current.then(async () => {
      // ① 先把上一代卸干净（命令表空出来），才允许注册新命令
      for (const l of loaded.splice(0)) {
        try {
          await unloadPlugin(l, deps)
        } catch {
          /* 单个插件卸载失败不阻断其余的 */
        }
        // 强制回收它提供的服务 —— 不指望插件自己 dispose 掉 provide 的东西
        k.releaseServices(l.manifest.id)
        k.releaseEditorMarks(l.manifest.id)
        k.releaseCapabilities(l.manifest.id)
        k.releaseItemMenus(l.manifest.id)
      }
      if (cancelled) return

      // ② 再加载本代
      k.commands.setActivator(activate)
      setPluginError(null)
      try {
        // 2026-10-18 rev173.5：插件**只有全局一处**（用户「取消库内插件这种形式，
        // 所有插件都是全局的」）—— 扫描、安装、删除都落在 `appDataDir()/.zn/plugins/`。
        // 切库不再换插件；库内 `.zn/plugins/` 的旧副本由迁移脚本搬走。
        // rev173.259：**不再预装任何插件**（用户「不设置内置插件，之前预装的改为推荐优先安装」）——
        // 第一次启动就是零插件，装插件统一走 插件中心 → 插件市场（或手动装 .znp）。
        const globalRoot = await tryGlobalPluginRoot()
        if (cancelled) return
        const entries = await collectPluginDirs((msg) => {
          // 读目录失败不再是"插件列表空着"的静默状态（rev173.41）：插件页会显示这条原因
          if (!cancelled) setPluginError(msg)
        })
        const list: PluginManifest[] = []
        /** manifest id → 条目：后面加载 / 懒激活 / 删除都从这里取根 */
        const byId: Record<string, PluginDirEntry> = {}
        for (const entry of entries) {
          if (cancelled) return
          try {
            const m = await readManifest(entry.root, entry.dir)
            list.push(m)
            byId[m.id] = entry
          } catch (e) {
            setPluginError(`读取插件 ${entry.dir} 失败：${String(e)}`)
          }
        }
        if (cancelled) return
        setManifests(list)
        setPluginEntries(byId)
        setGlobalRoot(globalRoot)
        /**
         * 单插件热重载（rev173.240）—— 必须在 `byId` 建好之后挂，
         * 且整段排到串行链上：与整代加载并发就会撞「命令 id 重复」。
         */
        reloadOneRef.current = async (pluginId: string) => {
          const entry = byId[pluginId]
          if (!entry) throw new Error(`找不到插件目录：${pluginId}`)
          pluginChainRef.current = pluginChainRef.current.then(async () => {
            const idx = loaded.findIndex((l) => l.manifest.id === pluginId)
            if (idx >= 0) {
              const [old] = loaded.splice(idx, 1)
              try {
                await unloadPlugin(old, deps)
              } catch {
                // 卸载失败也继续重装：旧命令若真残留，loadPlugin 会明确报 id 重复（比静默好）
              }
              k.releaseServices(pluginId)
              k.releaseEditorMarks(pluginId)
              k.releaseCapabilities(pluginId)
            }
            const fresh = await loadPlugin(entry, deps)
            loaded.push(fresh)
            setLoadedIds((ids) => (ids.includes(pluginId) ? ids : [...ids, pluginId]))
          })
          await pluginChainRef.current
        }
        const ids: string[] = []
        for (const m of list) {
          // 每轮都先看取消：**被取代就整轮退出**，绝不继续注册（继续只会跟新代撞 id）
          if (cancelled) return
          if (disabledRef.current.has(m.id)) continue
          /**
           * 平台门（**提前判**，与 `loadPlugin` 里那道用的是同一个 `supportsPlatform`）：
           * 必须在这里判才能连**懒激活**的插件一起挡住 —— 否则它的命令元数据会被静态登记，
           * 于是手机的命令面板里列出一条永远跑不通的桌面专属命令。
           */
          if (!supportsPlatform(m, currentPlatform)) {
            platformSkippedIds.push(m.id)
            continue
          }
          /**
           * **条目菜单动作静态登记**（rev173.281 · J#18）。
           *
           * 对**所有**插件都登记（不只懒激活的）：manifest 里写了就应该出现在菜单里，
           * 不需要插件先 apply 一次。非懒激活插件在 `apply()` 里再 `itemMenu.register`
           * 同一个 command 时，注册表按 pluginId + command 去重 ⇒ 运行时那份覆盖静态这份，
           * 菜单里仍然只有一项。
           */
          for (const action of m.contributes?.itemMenus ?? []) {
            try {
              declaredItemMenus.push(k.itemMenu.declare([action], m.id))
            } catch (e) {
              setPluginError(`插件 ${m.id} 的条目菜单声明无效：${String(e)}`)
            }
          }
          /**
           * 懒激活判定：写了 `activationEvents` 且**不含** onStartup / onVaultOpen
           * ⇒ 只静态登记命令元数据，插件代码一行都不跑（命令面板照样列得出它）。
           * 没写（或写了 onStartup）⇒ **老行为**：立即 apply —— 现有插件零影响。
           */
          const events = m.activationEvents
          const lazy =
            Array.isArray(events) &&
            events.length > 0 &&
            !events.includes('onStartup') &&
            !events.includes('onVaultOpen')
          if (lazy) {
            for (const c of m.contributes?.commands ?? []) {
              try {
                k.commands.declare({ ...c, pluginId: m.id })
                declaredIds.add(m.id)
              } catch (e) {
                setPluginError(`插件 ${m.id} 的命令声明冲突：${String(e)}`)
              }
            }
            const entry = byId[m.id]
            if (!entry) continue // 防御：byId 与 list 同步写入，正常到不了这里
            pending.set(m.id, entry)
            continue
          }
          // 卡死兜底 C 段：**加载前**落一条"正在加载"标记（localStorage 是同步写 ⇒ 必然落盘，
          // 实测见 docs/卡死兜底方案-2026-10-13.md §6 的 P3）。插件若在 apply 里占死主线程，
          // 这条标记就是重启后唯一能指认"是谁卡的"线索。
          try {
            localStorage.setItem(LS_LOADING, JSON.stringify({ id: m.id, t: Date.now() }))
          } catch {
            /* 写不进去不影响加载本身 */
          }
          try {
            const entry = byId[m.id]
            if (!entry) continue
            const l = await loadPlugin(entry, deps)
            // 加载**完成那一刻**才被取代：当场卸掉再整轮退出（否则它就是幽灵命令）
            if (cancelled) {
              await unloadPlugin(l, deps)
              k.releaseServices(m.id)
              k.releaseEditorMarks(m.id)
              k.releaseCapabilities(m.id)
              k.releaseItemMenus(m.id)
              return
            }
            loaded.push(l)
            ids.push(m.id)
          } catch (e) {
            // 平台不符 = 正常跳过，不是错误（上面已提前判过，这里是防御：
            // 加载期间目录里的 manifest 被换掉，也走同一条路，别报成"加载失败"）
            if (e instanceof PlatformMismatch) {
              platformSkippedIds.push(m.id)
              continue
            }
            // 被取代时不再报错：那些失败多半是取消造成的假象
            if (!cancelled) setPluginError(`插件 ${m.id} 加载失败：${String(e)}`)
            // 加载失败 ⇒ 刚才静态登记的条目菜单动作要撤掉（否则菜单里留着点了报错的项）
            k.releaseItemMenus(m.id)
          } finally {
            // 加载**走完**了（成功或失败）⇒ 标记使命结束。
            // 只有"进程在这里死掉"才会把它留下 —— 那正是启动自愈要认的那种卡死。
            try {
              localStorage.removeItem(LS_LOADING)
            } catch {
              /* 无所谓 */
            }
          }
        }
        if (!cancelled) {
          setLoadedIds(ids)
          setPlatformSkipped(platformSkippedIds)
          /**
           * 内核生命周期事件（契约 §1.4，rev173.40）。
           *
           * **为什么在这里发**：插件在 `loadPlugin` 里注册的 `event.on(...)` 只有加载完
           * 这一代才全部就位 —— 更早发，监听者收不到，事件等于没发。
           * `vault:open` 每代都发（重扫 / 切库都是"当前库的插件已就位"）；
           * `app:ready` 只发一次（应用级）。
           */
          k.event.emit('vault:open', { vault })
          if (!readyRef.current) {
            readyRef.current = true
            k.event.emit('app:ready', { vault })
          }
        }
      } catch (e) {
        if (!cancelled) setPluginError(String(e))
      } finally {
        // 本代加载完（无论成败）⇒ 首屏预热样式让位：真实样式已由 injectStyles 注入；
        // 若主题插件被禁用 / 已卸载，缓存里的旧主题必须撤掉，否则「禁用」等于无效（rev135）。
        dropBootPluginStyles()
      }
    })
    pluginChainRef.current = run.catch(() => {})

    return () => {
      cancelled = true
      // 解绑激活器：它闭包着本次 effect 的 loaded/pending，留着会指向已失效的状态
      k.commands.setActivator(async () => {})
      // 静态声明的命令元数据是同步资源，当场清（那些插件可能从没被激活过）
      for (const id of declaredIds) k.commands.release(id)
      // 条目菜单动作同理（rev173.281）：卸载后菜单里不能留下点了报「命令不存在」的项
      for (const d of declaredItemMenus.splice(0)) d.dispose()
      setLoadedIds([])
      setPlatformSkipped([])
      // 实例的卸载**不在这里做**：交给链上的下一代开头统一处理（run 的 ① 步）。
      // 这样"卸完"与"开始加载新代"之间不会插进别的任务，也不再有
      // "cleanup 里 fire-and-forget 卸载 → 新代已经在注册命令"的窗口。
    }
    // 依赖只列真正该触发重载的：kernel / vault / reloadToken / enabled。
    // setters 都是稳定引用；disabledRef 是 ref（读 .current 最新值）—— 启用/禁用由调用方
    // bump reloadToken 触发重载，语义与迁出前一致。写成 .current 会随 Set 变化重建整代。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, vault, reloadToken, enabled])

  /**
   * 安装 `.znp` 插件包（2026-10-18 rev119）—— **从路径**安装的核心实现。
   *
   * 流程：Rust `read_znp` 预览 manifest → **确认框列出它自称要的能力**
   * （capability 只是自述、内核不拦截 —— 把"它要什么 + 有没有签名"摊开让用户决定）
   * → `install_znp` 解包到全局插件根 → 重扫插件。
   *
   * `confirmFirst: false` 只给自动化验收用（见下面的 `__znInstallZnp`）。
   */
  const installZnpFromPath = useCallback(
    async (picked: string, confirmFirst = true): Promise<string | null> => {
      try {
        /**
         * Android 的文件选择器返回的是 **`content://` SAF URI**，不是文件系统路径 ——
         * 直接交给 Rust 的 `std::fs` 会报「No such file or directory」（2026-10-18 真机实测）。
         * 交给原生插件 `uri-reader` 的 `read_content_uri`：用 ContentResolver 把内容
         * 复制进应用缓存并返回可读的绝对路径（与阅读器导入走同一套）。
         */
        let path = picked
        if (/^content:\/\//i.test(path)) {
          const copied = await invoke<{ path: string; name: string }>(
            'plugin:uri-reader|read_content_uri',
            { uri: path },
          )
          path = copied.path
        }
        const preview = await invoke<{
          manifest: {
            id: string
            name: string
            version: string
            capabilities?: string[]
            sha256?: string
          }
          files: string[]
        }>('read_znp', { path })
        const m = preview.manifest
        if (confirmFirst) {
          const caps = (m.capabilities ?? []).join('、') || '（未声明）'
          /**
           * rev173.77：`.znp` 里的 `signature.json` 会随文件一起装进插件目录，
           * 加载时由宿主验签 —— 所以这里把"真有签名"与"只有 sha256"分开说。
           */
          const hasSig = preview.files.includes('signature.json')
          const sign = hasSig
            ? '✓ 带签名（signature.json）：安装后会验签，通过才加载'
            : m.sha256
              ? '✓ 带完整性校验（sha256，只证明文件没坏）'
              : '⚠ 未签名：没有 sha256 / signature.json，安装后它会以你的权限执行任意代码'
          const ok = await confirm(
            `安装插件「${m.name}」v${m.version}？\n\n自称需要：${caps}\n文件：${preview.files.length} 个\n\n${sign}`,
            { title: '安装插件包', kind: 'warning' },
          )
          if (!ok) return null
        }
        // rev173.5：装到**全局插件根**（库内插件已取消）
        const root = await globalPluginRoot()
        const id = await invoke<string>('install_znp', { vault: root, path })
        setReloadToken((t) => t + 1)
        setToast(`插件已安装：${id}`)
        return id
      } catch (e) {
        setError(`安装插件失败：${String(e)}`)
        return null
      }
    },
    [setReloadToken, setToast, setError],
  )

  /**
   * 从**市场**安装 / 更新（rev173.148 · 插件市场阶段 1）。
   *
   * 与 `installZnpFromPath` 的区别：那边是「用户挑了一个本地文件」，这边是「索引里的一条」。
   * 下载、**整包 sha256**、解包都在 Rust（`install_znp_from_url`）一次完成 ——
   * 「校验的字节」就是「落盘的字节」，任一步失败都不落盘。
   */
  const installZnpFromUrl = useCallback(
    async (entry: MarketEntry): Promise<string | null> => {
      try {
        const root = await globalPluginRoot()
        const id = await installFromMarket(root, entry)
        setReloadToken((t) => t + 1)
        setToast(`插件已安装：${id}`)
        return id
      } catch (e) {
        setError(`安装插件失败：${String(e)}`)
        return null
      }
    },
    [setReloadToken, setToast, setError],
  )

  /** 插件管理页按钮：选文件 → 走上面的完整流程 */
  const installZnp = useCallback(async () => {
    const picked = await open({
      multiple: false,
      title: '选择插件包（.znp）',
      /**
       * ⚠️ **Android 一律不传 `filters`**（2026-10-18 真机实测）。
       *
       * `.znp` 没有对应的 MIME（`MimeTypeMap.getMimeTypeFromExtension` 返回 null），
       * 而 MIUI 的「安全访问」选择器一旦收到 filters，就把**未知类型**的文件（.znp / apk /
       * zip / json…）全部藏起来，只留图片 / 文档 / 媒体 ⇒ 用户在选择器里**根本看不到**插件包，
       * 表现就是「点安装无法生效」。不传 filters 时列表完整（与 `App.pickFile` 同一修法）。
       */
      ...(kernel?.host.platform === 'android'
        ? {}
        : { filters: [{ name: 'ZeroNote 插件包', extensions: ['znp'] }] }),
    })
    if (!picked || typeof picked !== 'string') return
    await installZnpFromPath(picked)
  }, [installZnpFromPath, kernel])

  /**
   * 把**库内旧插件**搬进全局根（rev173.5 引入 / rev173.6 改为整目录复制）。
   *
   * 取消库内插件后，装在 `<库>/.zn/plugins/` 的旧副本不会再被扫描 —— 这里整目录复制到全局根。
   * 为什么不用前端逐文件搬：插件会自己读**未声明**的资源（`outline-map` 的 vendor），
   * 只有 Rust 侧的整目录复制能把它们一起带走；目标已有文件不覆盖（内置 / 新版本优先）。
   */
  const migrateVaultPlugins = useCallback(async () => {
    const moved: string[] = []
    const failed: { id: string; reason: string }[] = []
    if (!vault) return { moved, failed }
    const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
    const globalRoot = await globalPluginRoot()
    /**
     * 读目录失败也要说 —— 原来 `.catch(() => [])` 把「库不可读」伪装成「没有旧插件」，
     * 用户看到的是"什么都没发生"（硬约束 4：静默失效比报错危险）。
     */
    let ids: string[] = []
    try {
      ids = await listPluginDirs(vault)
    } catch (e) {
      setPluginError(`读取库内插件目录失败：${reasonOf(e)}`)
      return { moved, failed }
    }
    for (const id of ids) {
      try {
        await invoke<number>('copy_plugin_dir', {
          fromVault: vault,
          toVault: globalRoot,
          pluginId: id,
        })
        moved.push(id)
      } catch (e) {
        // 单个插件失败（损坏 / 权限 / 撞名）⇒ 记下来，最后一次性报给用户
        failed.push({ id, reason: reasonOf(e) })
      }
    }
    if (failed.length > 0) {
      setPluginError(
        `有 ${failed.length} 个库内插件没搬到全局目录：` +
          failed.map((f) => `${f.id}（${f.reason}）`).join('；'),
      )
      setToast(`插件迁移：${failed.length} 个失败，详见插件页`)
    }
    setReloadToken((t) => t + 1)
    return { moved, failed }
  }, [vault, setReloadToken, setPluginError, setToast])

  /**
   * `.znp` 安装的**诊断出口**（2026-10-18 rev119）。
   *
   * 为什么需要：UI 用原生文件选择器，CDP 驱动不了它 ——「选文件 → 确认 → 安装 → 重扫」
   * 这条链路唯一可断言的入口就是这里。与 `__znExec` 同类：页面里本来就跑着内核本体，
   * 不多给任何主体任何能力。
   */
  useEffect(() => {
    const w = window as unknown as {
      __znInstallZnp?: (path: string, confirmFirst?: boolean) => Promise<string | null>
      __znMigratePlugins?: () => Promise<{
        moved: string[]
        failed: { id: string; reason: string }[]
      }>
    }
    w.__znInstallZnp = (path, confirmFirst) => installZnpFromPath(path, confirmFirst ?? true)
    // rev173.5：库内 → 全局的迁移口（真机上 UI 点不到「复制目录」，这条让脚本能跑同一段逻辑）
    w.__znMigratePlugins = () => migrateVaultPlugins()
    return () => {
      delete w.__znInstallZnp
      delete w.__znMigratePlugins
    }
  }, [installZnpFromPath, migrateVaultPlugins])

  /**
   * 按插件 id 取 **WebView 能力通道**（rev173.76 · 契约 §7.9）。
   *
   * 面板渲染时按 `panel.pluginId` 查；找不到（插件已卸载 / 纯样式 / 还没加载完）
   * 就返回 undefined —— 页面照常显示，只是 `zn:call` 一律得到错误应答，
   * 不会出现「静默调不通」。
   */
  const getWebviewBridge = useCallback(
    (pluginId: string) => loadedPluginsRef.current.find((l) => l.manifest.id === pluginId)?.webviewBridge,
    [],
  )

  /**
   * 按插件 id 查**签名状态**（rev173.77 · 契约 §7.4）：
   * `signed` = 有 `signature.json` 且验签通过；`unsigned` = 没签名文件；
   * `undefined` = 这个插件没加载（禁用 / 平台不符 / 纯样式）。
   */
  const getSignature = useCallback(
    (pluginId: string): 'signed' | 'unsigned' | undefined =>
      loadedPluginsRef.current.find((l) => l.manifest.id === pluginId)?.signature,
    [],
  )

  return {
    installZnpFromPath,
    installZnp,
    installZnpFromUrl,
    getWebviewBridge,
    getSignature,
    reloadPlugin: (pluginId: string) => reloadOneRef.current(pluginId),
  }
}
