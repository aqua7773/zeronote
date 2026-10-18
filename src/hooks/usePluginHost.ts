/**
 * 插件宿主（扫描 / 加载 / 懒激活 / `.znp` 安装）—— 从 `App.tsx` 原样迁出（rev128 · L3 第六刀）。
 *
 * 覆盖：
 *  - **加载链 effect**：两个来源（库内 + 全局插件根）扫描 → 预装内置插件 → 静态声明 /
 *    懒激活 / 立即加载 → 平台门 → 卡死兜底标记（`LS_LOADING`）。
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
import {
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
import { collectPluginDirs, tryGlobalPluginRoot } from '../kernel/plugin-roots'
import { ensureBuiltinPlugins } from '../kernel/builtin-plugins'
import type { PluginManifest } from '../kernel/contract'
import { LS_LOADING } from '../lib/boot-heal'
import { dropBootPluginStyles } from '../lib/boot-plugin-styles'

export type UsePluginHostArgs = {
  kernel: Kernel | null
  vault: string | null
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
}

export function usePluginHost({
  kernel,
  vault,
  reloadToken,
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

  useEffect(() => {
    const k = kernel
    if (!k || !vault) return
    let cancelled = false
    // 用 ref 里那份（跨 effect 可见）：中途被打断时 cleanup 也能清到正在加载的插件
    const loaded = loadedPluginsRef.current
    /** 静态声明了命令、但**还没加载**的插件：id → 条目（激活时用；条目带根，全局/库内都找得对） */
    const pending = new Map<string, PluginDirEntry>()
    /** 本次静态声明过命令的插件 id —— 卸载时要把它们的命令元数据也清掉 */
    const declaredIds = new Set<string>()
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
      service: k.service,
      editor: k.editor,
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
      }
      if (cancelled) return

      // ② 再加载本代
      k.commands.setActivator(activate)
      setPluginError(null)
      try {
        // 2026-10-17 rev94：**两个来源** —— 当前库 + 全局插件根（`appDataDir()`），
        // 同名目录库内优先。切库只换掉"库内"那半，全局那半永远在 ⇒ 插件跨库生效。
        // 0. 内置插件预装（2026-10-17）：APK 里带的几个插件先写进私有目录，
        //    之后扫描才能看到它们。用户自己加的插件不受影响。
        await ensureBuiltinPlugins(vault)
        if (cancelled) return
        const entries = await collectPluginDirs(vault)
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
        setGlobalRoot(await tryGlobalPluginRoot())
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
      setLoadedIds([])
      setPlatformSkipped([])
      // 实例的卸载**不在这里做**：交给链上的下一代开头统一处理（run 的 ① 步）。
      // 这样"卸完"与"开始加载新代"之间不会插进别的任务，也不再有
      // "cleanup 里 fire-and-forget 卸载 → 新代已经在注册命令"的窗口。
    }
    // 依赖只列真正该触发重载的三个：kernel / vault / reloadToken。
    // setters 都是稳定引用；disabledRef 是 ref（读 .current 最新值）—— 启用/禁用由调用方
    // bump reloadToken 触发重载，语义与迁出前一致。写成 .current 会随 Set 变化重建整代。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, vault, reloadToken])

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
        const preview = await invoke<{
          manifest: {
            id: string
            name: string
            version: string
            capabilities?: string[]
            sha256?: string
          }
          files: string[]
        }>('read_znp', { path: picked })
        const m = preview.manifest
        if (confirmFirst) {
          const caps = (m.capabilities ?? []).join('、') || '（未声明）'
          const sign = m.sha256
            ? '✓ 带完整性校验（sha256）'
            : '⚠ 未签名：没有 sha256，安装后它会以你的权限执行任意代码'
          const ok = await confirm(
            `安装插件「${m.name}」v${m.version}？\n\n自称需要：${caps}\n文件：${preview.files.length} 个\n\n${sign}`,
            { title: '安装插件包', kind: 'warning' },
          )
          if (!ok) return null
        }
        const id = await invoke<string>('install_znp', { vault, path: picked })
        setReloadToken((t) => t + 1)
        setToast(`插件已安装：${id}`)
        return id
      } catch (e) {
        setError(`安装插件失败：${String(e)}`)
        return null
      }
    },
    [vault, setReloadToken, setToast, setError],
  )

  /** 插件管理页按钮：选文件 → 走上面的完整流程 */
  const installZnp = useCallback(async () => {
    const picked = await open({
      multiple: false,
      title: '选择插件包（.znp）',
      filters: [{ name: 'ZeroNote 插件包', extensions: ['znp'] }],
    })
    if (!picked || typeof picked !== 'string') return
    await installZnpFromPath(picked)
  }, [installZnpFromPath])

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
    }
    w.__znInstallZnp = (path, confirmFirst) => installZnpFromPath(path, confirmFirst ?? true)
    return () => {
      delete w.__znInstallZnp
    }
  }, [installZnpFromPath])

  return { installZnpFromPath, installZnp }
}
