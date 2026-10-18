import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { exit, onBackButtonPress } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
/**
 * Android 的库路径（方案 D）—— 公共存储。
 * 好处：文件管理器能进、插件能直接拷进 `.zn/plugins/`、卸载不丢数据。
 * 前提：拿到「所有文件访问」（MANAGE_EXTERNAL_STORAGE）权限。
 */
const ANDROID_VAULT = '/storage/emulated/0/Documents/ZeroNote'
import { invoke } from '@tauri-apps/api/core'
import type { EditorView } from '@codemirror/view'
import { createKernel, type Kernel, type KernelAudit, type PanelRegistration } from './kernel/kernel'
import { deletePluginDir, type PluginDirEntry } from './kernel/plugin-host'
import type {
  DocEvent,
  NoteDoc,
  NoteMeta,
  PluginManifest,
  ShellMountCtx,
} from './kernel/contract'
/* 2026-10-13 拆权限门：`./kernel/permissions` 的四个导入（isGranted / readPermissions /
 * setPermission / PermissionTable）**已全部移除** —— 内核不再做权限判定。
 * 同日清尾：`src/kernel/permissions.ts` 整个文件与 Rust 的 `read_permissions` /
 * `set_permission` 两条命令**已整体删除**（见 `docs/架构原则-2026-10-13.md` §6.1）。 */
import { MarkdownEditor } from './components/MarkdownEditor'
import { MarkToolbar } from './components/MarkToolbar'
import { CommandPalette } from './components/CommandPalette'
import { PluginPanel, type PluginRow } from './components/PluginPanel'
import { UIRenderer } from './components/UIRenderer'
import { PanelBoundary } from './components/PanelBoundary'
import { ShellMount } from './components/ShellMount'
import { WindowControls } from './components/WindowControls'
import { Settings } from './components/Settings'
import { VaultPanel } from './components/VaultPanel'
import { TitleBar } from './components/TitleBar'
/* rev122 拆分 L2：侧栏 / 回收站 / 空态 / 状态栏 —— 原样迁到 components/ */
import { AppSidebar } from './components/AppSidebar'
import { AppTrashView } from './components/AppTrashView'
import { AppEmptyState } from './components/AppEmptyState'
import { AppResizer } from './components/AppResizer'
import { AppStatusBar } from './components/AppStatusBar'
import {
  applyTheme,
  loadThemePref,
  saveThemePref,
  watchSystemTheme,
  type ThemePref,
} from './lib/theme'
import { setStatusBarVisible } from './lib/systemBar'
import { requestAllFilesAccess } from './lib/androidPerm'
/* rev123 拆分 L3：文件操作域（剪贴板 / 回收站 / 删除）抽成 hook */
import { useFileOps } from './hooks/useFileOps'
/* rev124 拆分 L3：文档读写域（刷新 / 合并 / 保存 / 编辑器变更）抽成 hook */
import { useDocIO } from './hooks/useDocIO'
/* rev125 拆分 L3：文档会话（打开 / 关闭 / [[链接]]）抽成 hook */
import { useDocSession } from './hooks/useDocSession'
/* rev126 拆分 L3：文档原语 + 事件广播（docApi / fireDoc / flushDocChange）抽成 hook */
import { useDocApi } from './hooks/useDocApi'
/* rev127 拆分 L3：外部文件（打开文件 / SAF / 待打开 / 文件关联接线）抽成 hook */
import { useExternalFile } from './hooks/useExternalFile'
/* rev128 拆分 L3：插件宿主（扫描 / 加载 / 懒激活 / .znp 安装）抽成 hook */
import { usePluginHost } from './hooks/usePluginHost'
/* rev122 拆分 L1：路径工具 / 最近库与命令 / 错误话术 / 启动自愈 —— 全部原样迁到 lib/ */
import {
  baseName,
  vaultKey,
} from './lib/app-paths'
import {
  loadRecentCommands,
  loadRecentVaults,
  LS_RECENT_CMDS,
  persistRecentVaults,
  RECENT_CMDS_MAX,
  RECENT_VAULTS_MAX,
  vaultExists,
} from './lib/recent'
import { failMsg, type SaveState } from './lib/fail-msg'
import {
  bootAutoDisabled,
  bootAutoDisabledNotice,
  loadDisabled,
  LS_DISABLED,
  LS_LOADING,
} from './lib/boot-heal'
import { renderPanelSafe } from './kernel/panel-safe'
import { bindCommandKeybindings, keyLabel } from './kernel/keybindings'
import { MARK_COMMANDS, registerMarkdownMarks } from './kernel/markdown-marks'
import { SearchPanel } from './components/SearchPanel'
import { WebViewFrame } from './components/WebViewFrame'
import { QuickSwitcher } from './components/QuickSwitcher'
import {
  ContextMenu,
  Dialog,
  DialogBody,
  DialogHeader,
  type MenuItem,
} from '@/components/ui'

const LS_VAULT = 'zeronote.vault'
const AUTOSAVE_MS = 800
/**
 * `doc.on('change')` 的**去抖窗口**（U3b 决策，2026-10-13）。
 *
 * 每次击键都回调会把插件打爆（导图插件重排一次就是几十毫秒），所以 `change` 走 **trailing 去抖**：
 * 停止输入 200ms 后广播**一次**，payload 是最新内容。选 200ms 的理由：
 *  - 低于 `AUTOSAVE_MS`(800) ⇒ 插件总能**先**看到 change、**后**看到 save（顺序稳定）；
 *  - 与 60fps 手感的"停一下"重合，用户停手即同步，导图不会看起来卡；
 *  - 再短（<150ms）在连续打字时几乎等于每键一次，去抖就白做了。
 *
 * 注意：**结构性变更不额外区分** —— 内核不解析 Markdown，分不清"打字"与"改结构"，
 * 硬分会把判据塞进内核（违背"内核保持薄"）。要更细的粒度由插件自己再压一层。
 */
const DOC_CHANGE_DEBOUNCE_MS = 200

export default function App() {
  /* ── 库与文档 ── */
  // 库路径优先级：URL 参数 `?vault=<绝对路径>`（开发/快捷方式用） > 上次记住的
  const [vault, setVault] = useState<string | null>(() => {
    const fromUrl = new URLSearchParams(location.search).get('vault')
    return fromUrl && fromUrl.trim() ? fromUrl : localStorage.getItem(LS_VAULT)
  })
  const [notes, setNotes] = useState<NoteMeta[]>([])
  /** 目录清单（含**空目录**）—— 文件树显示空文件夹的依据，与 notes 同一趟刷新 */
  const [dirs, setDirs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)

  /**
   * 插件独立窗口模式（U1 · 2026-10-13 rev50）：URL 带 `?pluginWindow=<panelId>`。
   *
   * 独立窗口是**新的 webview**（自己的 JS 上下文），所以它照样跑完整的插件加载流程 ——
   * 只是渲染时**只画那一个面板**：没有侧栏、没有编辑器、没有插件管理页。
   *
   * ⚠️ 定义必须放在组件**顶部**：下面几处 effect（尤其是"关窗前落盘"那个拦截器）
   * 要靠它判断当前是不是插件窗口 —— 放在渲染前定义就会踩 TDZ。
   */
  const pluginWindowId = useMemo(
    () => new URLSearchParams(location.search).get('pluginWindow'),
    [],
  )

  /**
   * 「这个窗口已经被关掉了」—— **只在"用同一个 webview 承载窗口"的平台上用到**（Android）。
   *
   * 为什么不重载页面：`location.replace()` 是**整页重载**，重载后库要重新从 URL / 常量解析。
   * **rev80 真机实测**：重载后应用退回**默认库**，界面变成「这个库还没有笔记 / 0 篇」
   * （数据没丢，真库在 `/storage/emulated/0/Documents/ZeroNote`，只是应用指错了地方）。
   * ⚠️ 那一次重载后 URL 里 `vault` 参数为何没起作用**未核实** —— 所以这里不去依赖"URL 里到底有没有它"，
   * 直接**不重载**：翻一个 state 就只是"不画那一个面板"，库 / 编辑器状态 / 插件全都不用重建。
   * 桌面端不受影响：它那边的窗口是**真窗口**，走 `destroy()`（见下面 `onClose` 的两条分支）。
   */
  const [winClosed, setWinClosed] = useState(false)

  /**
   * **整窗接管**（U2 · rev51）：只留一个"重渲染计数器"，真正的账在**内核**里
   * （`kernel.shellOwner()`，渲染时直接读）。
   *
   * 为什么不自己镜像一份 state：内核被重建（切库 / docApi 换代）时那本账随旧内核消失，
   * 宿主这边**不可能**留下"接管者已经不存在"的幻影 —— 少一类同步 bug，也少一个 effect。
   */
  const [, setShellTick] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  /* 卡死兜底 C 段：启动自愈若认出了"上次卡死的插件"，**第一眼就告诉用户**（不许静默）。
     初值直接取模块级结论 —— 不写 effect，免得踩 `set-state-in-effect`（本仓库 lint 基线是恰好 4 条） */
  const [toast, setToast] = useState<string | null>(bootAutoDisabledNotice)
  /** 移动端的「笔记库」面板（桌面走系统目录选择器，不用它） */
  const [vaultPanelOpen, setVaultPanelOpen] = useState(false)
  /** 删除后的「撤销」态 —— 记下原路径与回收站路径，几秒内可 rename 回来。
      删除本身是一步完成的（不弹确认框打断用户），可撤销性由这条提示提供。 */
  /** 最近一次删除（可能一次多篇），供撤销条在几秒内恢复 */

  /* ── 插件 ── */
  const [manifests, setManifests] = useState<PluginManifest[]>([])
  /**
   * 每个插件的**来源**（manifest id → 条目）—— 2026-10-17 rev94 加。
   * 同一份插件可能来自全局根，也可能来自当前库；删除 / 懒激活必须按来源找对的根，
   * 插件页也靠它显示「全局 / 本库」徽标。
   */
  const [pluginEntries, setPluginEntries] = useState<Record<string, PluginDirEntry>>({})
  /** 全局插件根（插件页展示用；拿不到就是 null） */
  const [globalRoot, setGlobalRoot] = useState<string | null>(null)
  const [disabled, setDisabled] = useState<Set<string>>(loadDisabled)
  /**
   * 因**上次加载未完成**被自动禁用的插件（启动自愈的结论，见模块级的 `bootSelfHeal`）。
   * 插件页据此显示明确标记 —— 与"用户自己关的"区分开，并且在用户重新启用后消失。
   */
  const [autoDisabled, setAutoDisabled] = useState<Set<string>>(() => new Set(bootAutoDisabled))
  const [reloadToken, setReloadToken] = useState(0)
  const [loadedIds, setLoadedIds] = useState<string[]>([])
  /**
   * 因 **平台不符**被跳过的插件 id（`manifest.platforms` 跟当前平台对不上）。
   * 这不是错误 —— 插件页把它们标成「不适用」，不进错误横幅。
   */
  const [platformSkipped, setPlatformSkipped] = useState<string[]>([])
  const [panels, setPanels] = useState<PanelRegistration[]>([])
  const [panelLog, setPanelLog] = useState<string[]>([])
  const [pluginError, setPluginError] = useState<string | null>(null)
  const [panelState, setPanelState] = useState<Record<string, unknown>>({})
  /* 2026-10-13 拆权限门：这里原本是 `permissions` state（读 `.zn/permissions.json`
   * 的授权记录）。**已删除** —— 内核不设防，不查授权。设置页那一块改成只读展示
   * `manifest.capabilities` 的**自述**（见下面的 `declNetPlugins`）。 */

  /* ── UI ── */
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** 快速打开笔记（Ctrl+O）—— 与命令面板分开：一个管"去哪篇"，一个管"做什么" */
  const [switcherOpen, setSwitcherOpen] = useState(false)
  /** 编辑器顶部的替换栏（Ctrl+H）—— 它不是浮层，所以不参与 openOverlay 的互斥 */
  const [replaceOpen, setReplaceOpen] = useState(false)
  /** 最近执行过的命令 id（命令面板置顶用；持久化在 localStorage） */
  const [recentCmds, setRecentCmds] = useState<string[]>(loadRecentCommands)
  /** 最近打开过的库（侧栏底部「切换笔记库」菜单的数据源；持久化在 localStorage） */
  const [recentVaults, setRecentVaults] = useState<string[]>(loadRecentVaults)
  /** 「切换笔记库」菜单的弹出位置与条目（null = 关着）；条目在事件处理里现算，与 mainMenu 同一套做法 */
  const [vaultMenu, setVaultMenu] = useState<{
    x: number
    y: number
    items: MenuItem[]
  } | null>(null)

  const rememberCommand = useCallback((id: string) => {
    setRecentCmds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_CMDS_MAX)
      try {
        localStorage.setItem(LS_RECENT_CMDS, JSON.stringify(next))
      } catch {
        /* 配额不足或隐私模式失败都不该影响命令本身 */
      }
      return next
    })
  }, [])

  /**
   * 打开某个浮层时**关掉其余的** —— 它们都是模态，同时开着会叠层。
   *
   * 实测踩到过：命令面板里执行「快速打开笔记」后（命令面板已关、快速切换打开），
   * 再按一次 Ctrl+P，就变成「命令面板压在快速切换上」。
   * 用一次 setState 同时决定四个开关，天然互斥，也不用在 effect 里 setState。
   */
  /**
   * 主区当前显示的页面：`'editor'`（编辑器）| `'plugins'`（插件管理）| `<插件面板 id>`。
   * 插件管理原先挂在右侧栏，用户要求「不做侧栏，单开一个页面」——
   * 于是右侧栏取消，主区变成页面容器（编辑器 / 插件管理 / 插件面板 / 弹窗仍走 Dialog）。
   */
  const [mainView, setMainView] = useState<string>('editor')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /** 左上角菜单栏的弹出位置；null = 关闭 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [themePref, setThemePref] = useState<ThemePref>(loadThemePref)

  /**
   * 打开某个浮层时**关掉其余的** —— 它们都是模态，同时开着会叠层。
   *
   * 实测踩到过：命令面板里执行「快速打开笔记」后（命令面板已关、快速切换打开），
   * 再按一次 Ctrl+P，就变成「命令面板压在快速切换上」。
   * 用一次 setState 同时决定四个开关，天然互斥，也不用在 effect 里 setState。
   *
   * ⚠️ 必须放在四个开关的 `useState` **之后**：否则 lint 会报
   * `react(immutability): Cannot access variable while it is being initialized`。
   */
  const openOverlay = useCallback(
    (which: 'palette' | 'switcher' | 'search' | 'settings') => {
      setPaletteOpen(which === 'palette')
      setSwitcherOpen(which === 'switcher')
      setSearchOpen(which === 'search')
      setSettingsOpen(which === 'settings')
    },
    [],
  )

  /**
   * 标题栏自动隐藏。
   *
   * 鼠标靠近窗口顶部（≤6px）滑出显示，离开标题栏区域（>44px）再收起；
   * 标题栏自己的 onMouseEnter / onFocus 也会把它按住不放（见 TitleBar 的 props）。
   * 32px 的栏 + 12px 缓冲 = 44px，避免贴着边缘抖动。
   */
  const [titlebarVisible, setTitlebarVisible] = useState(true)
  useEffect(() => {
    // 鼠标离开顶部后**先停留 0.5 秒**再收（用户要求）——
    // 期间只要回到顶部就取消，免得"手一抖就收走"。
    let hideTimer: number | null = null
    const cancelHide = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer)
        hideTimer = null
      }
    }
    const onMove = (e: MouseEvent) => {
      // 触屏设备（Android）没有鼠标指针：这套"指针接近顶部才显示标题栏"的逻辑不适用 ——
      // 收不到 mousemove 时标题栏会永远停在初始状态，所以触屏上一律常驻显示。
      if (window.matchMedia('(pointer: coarse)').matches) return
      // 菜单开着时必须留着标题栏 —— 菜单挂在 ☰ 上，☰ 跟着收起的话菜单就"悬空"了。
      if (menuAt) {
        cancelHide()
        setTitlebarVisible(true)
        return
      }
      // 顶部 **10px** 内算"要标题栏"（用户要求减小触发距离）。
      // 注意别低于这个量级：早先设过 6px —— 唤不出来，因为自绘窗口最上面几像素
      // 收不到 WebView 的 mousemove（属系统边界）。64px 之下才算真正离开，中间是缓冲带。
      if (e.clientY <= 10) {
        cancelHide()
        setTitlebarVisible(true)
      } else if (e.clientY > 64 && hideTimer === null) {
        hideTimer = window.setTimeout(() => {
          hideTimer = null
          setTitlebarVisible(false)
        }, 500)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      cancelHide()
      window.removeEventListener('mousemove', onMove)
    }
  }, [menuAt])

  /**
   * 键盘焦点进入标题栏时也保持显示。
   * 用 document 级 `focusin` 而不是在 `<header>` 上挂 React 的 `onFocus` ——
   * 实测后者在这个自绘标题栏上不触发（Tab 到 ☰ 后状态仍是 false）。
   */
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.zn-titlebar')) setTitlebarVisible(true)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  /** 主题：偏好一变就应用 + 持久化；选「跟随系统」时还要订阅系统深浅色变化 */
  useEffect(() => {
    applyTheme(themePref)
    saveThemePref(themePref)
    if (themePref !== 'system') return
    return watchSystemTheme(() => applyTheme('system'))
  }, [themePref])
  /** 窄屏抽屉：宽屏侧栏常驻，窄屏由顶栏 ☰ 滑出 */
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** 桌面侧栏是否显示：进插件管理/插件页面时自动让位，也可手动关掉 */
  const [sidebarVisible, setSidebarVisible] = useState(true)
  /** 笔记库栏宽度 —— 拖分隔线可调，持久化 */
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = Number(window.localStorage.getItem('zeronote.sidebar.w'))
    return Number.isFinite(v) && v >= 160 && v <= 560 ? v : 260
  })
  /**
   * 主区右键菜单 —— 原生菜单已被禁用，编辑操作得自己提供。
   * `items` 一并存在 state 里：菜单项要按"有没有选区 / 有没有打开笔记"现算，而这些信息
   * 来自 `editorRef`。在**事件处理时**构建（而不是渲染期读 ref）既过得了 lint，
   * 也省掉每次无关重渲染的重算。
   */
  const [mainMenu, setMainMenu] = useState<{
    x: number
    y: number
    items: MenuItem[]
  } | null>(null)

  useEffect(() => {
    window.localStorage.setItem('zeronote.sidebar.w', String(sidebarWidth))
  }, [sidebarWidth])

  /**
   * 移动端：侧栏（抽屉）打开时隐藏状态栏、收起（首页）时显示。
   * 桌面端由 systemBar.ts 用 Android UA 自行跳过，这里不必分支。
   * 原生实现：src-tauri/plugins/tauri-plugin-statusbar/
   */
  useEffect(() => {
    void setStatusBarVisible(!sidebarOpen)
  }, [sidebarOpen])

  const contentRef = useRef(content)
  const activeRef = useRef(activePath)
  const dirtyRef = useRef(dirty)
  const disabledRef = useRef(disabled)
  const editorRef = useRef<EditorView | null>(null)
  const timerRef = useRef<number | null>(null)
  /**
   * `doc.on` 订阅表（U3b）。
   *
   * 为什么放 ref 而不是 state：`docApi` 的 `useMemo` 依赖是 `[]`（它靠 `activeRef` /
   * `editorRef` 拿实时值），而 fire 点分散在 `openNote` / `saveNow` / `closeNote` /
   * `onEditorChange` 四处 —— 只有放进 ref，注册（`docApi.on`）与广播（fire 点）才
   * **指向同一份表**，且都不触发重渲染。
   */
  const docSubsRef = useRef<Map<DocEvent, Set<(d: NoteDoc) => void>>>(new Map())
  /**
   * 当前打开笔记的 **frontmatter**（P1-2 · 2026-10-18）。
   *
   * Rust 侧 `list_notes` / `read_note` 早就解析好了，但广播文档事件时写死 `{}` ——
   * 标签 / 密级 / 创建时间这些"跟随 md 文件但不在正文里"的信息因此没有任何落点，
   * 插件只能自己重解析正文。这里在 `openNote` 时从列表 meta 抄一份，`fireDoc` 与
   * `doc.active()` 都读它。放 ref：`docApi` 的 `useMemo` 依赖是 `[]`。
   */
  const frontmatterRef = useRef<Record<string, unknown>>({})
  /** `notes` 的最新值（`openNote` 不在 `notes` 的依赖里，靠这个 ref 拿 meta） */
  const notesRef = useRef<NoteMeta[]>([])
  /** `change` 去抖计时器（见 `DOC_CHANGE_DEBOUNCE_MS`） */
  const docChangeTimerRef = useRef<number | null>(null)
  /** 去抖窗口里待广播的内容 —— 用户在 200ms 内又敲了一下就覆盖它，最后只广播一次 */
  const docPendingRef = useRef<{ path: string; content: string } | null>(null)
  const openNoteRef = useRef<(p: string) => Promise<void>>(async () => {})
  const saveNowRef = useRef<() => Promise<void>>(async () => {})
  /** 当前库（文件关联要用：判断递进来的文件是否已在库里，而 effect 里不想重挂监听） */
  const vaultRef = useRef(vault)
  /** 待打开的文件 —— 切库是异步的，等目标库就绪再开（见下面的「待打开」effect） */
  const pendingOpenRef = useRef<{ vault: string; name: string } | null>(null)
  /** 同一路径短时间去重：启动那条会「存状态 + 广播事件」，两条投递有重叠窗口 */
  const recentOpenRef = useRef<Map<string, number>>(new Map())
  /** `openExternalFile` 的稳定引用 —— 挂载时的监听只注册一次，不随库重建 */
  const openExternalFileRef = useRef<(raw: string) => Promise<void>>(async () => {})
  /**
   * 「外部重载」标记：磁盘内容变了（导图 / 插件写盘、用户点「从磁盘重新加载」）⇒
   * 我们主动整篇替换编辑器文档。那次替换会**同步**触发一次 `onEditorChange`
   * （编辑器把外部 value 当成变化报上来），于是那边看到这个标记就直接返回 ——
   * 不拦的话会白设一次 dirty、800ms 后再把同样的内容写回磁盘（幂等，但状态栏会闪"未保存/已保存"）。
   */
  const externalReloadRef = useRef(false)
  /**
   * 三方合并的 **BASE**：这份内容"最后一次与磁盘一致"的时刻。
   *
   * 维护点只有这四处（漏一个合并就会算错，所以专门列在这儿）：
   *   · `openNote` 读盘成功 ⇒ base = 刚读到的
   *   · `saveNow` 写盘成功 ⇒ base = 刚写下去的（包含合并后的结果）
   *   · `reloadActiveFromDisk` 整篇替换 ⇒ base = 替换后的
   *   · `mergeWithDisk` 发现"磁盘与我们完全一样" ⇒ 顺手对齐
   */
  const baseRef = useRef('')

  useEffect(() => {
    contentRef.current = content
  }, [content])
  useEffect(() => {
    activeRef.current = activePath
  }, [activePath])
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  useEffect(() => {
    disabledRef.current = disabled
    localStorage.setItem(LS_DISABLED, JSON.stringify([...disabled]))
  }, [disabled])

  useEffect(() => {
    vaultRef.current = vault
  }, [vault])

  /* 2026-10-13 拆权限门：这里原本是「换库时读一次授权记录」的 effect
   * （`readPermissions` + fail-closed 注释）。**已删除** —— 没有表可读了。
   * ⚠️ 它的旧注释里那句「读失败不能当成全都授权了」值得记住：那是在**为一道
   * 能被子进程/裸 IPC 绕过的门写防御逻辑**，成本全花在纸上（见 docs/架构原则-2026-10-13.md §2）。 */

  /** 运行平台 —— Android 上应用能访问的文件范围与桌面不同 */
  const platform: 'android' | 'windows' = /Android/i.test(navigator.userAgent)
    ? 'android'
    : 'windows'

  /**
   * 软键盘弹起时，把根容器钉到**可见视口**的高度。
   *
   * 为什么非自己来不可（真机实测，不是猜的）：`gen/android` 的 AndroidManifest 里写了
   * `windowSoftInputMode="adjustResize"`，但在 targetSdk 35（edge-to-edge 强制）之后，
   * 系统**不再自动把 WebView 压矮** —— 键盘是"盖"在页面上的，于是编辑器底部那条
   * Markdown 快捷输入栏（`view` 的 `editor-toolbar`）被整个挡住。
   *
   * `visualViewport` 是唯一跨版本/跨机型都准的「键盘上方还剩多少」来源：
   * 它一变矮就把高度写进 `--zn-viewport-h`，`.zn-app` 跟着缩 ⇒ 工具栏正好落在键盘上沿。
   * 与 manifest 的 `adjustResize` **不冲突**：那条在旧机型上生效时两边会收敛到同一个高度。
   *
   * 桌面端无副作用 —— 没有软键盘时 `visualViewport.height` 就是窗口高度。
   */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const apply = () => {
      document.documentElement.style.setProperty('--zn-viewport-h', `${Math.round(vv.height)}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    // 键盘弹起/收起时，部分机型只发 scroll 不发 resize
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      document.documentElement.style.removeProperty('--zn-viewport-h')
    }
  }, [])

  /* ── Android：没指定库时用「应用数据目录/vault」──
     手机上的应用访问不了任意文件夹（SAF 限制），所以默认库落在私有目录里。 */
  useEffect(() => {
    if (vault || platform !== 'android') return
    let cancelled = false
    void (async () => {
      try {
        // 方案 D：先把公共库目录建出来（缺「所有文件访问」权限时这一步会失败）
        await invoke('ensure_vault', { vault: ANDROID_VAULT })
        if (!cancelled) setVault(ANDROID_VAULT)
      } catch (e) {
        setError(`创建公共库失败（多半是缺「所有文件访问」权限）：${String(e)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [vault, platform])

  /* ── doc 原语 + 事件广播（rev126 · L3 第四刀）—— 见 hooks/useDocApi.ts ── */
  const { fireDoc, flushDocChange, docApi } = useDocApi({
    refs: {
      docSubsRef,
      frontmatterRef,
      activeRef,
      contentRef,
      dirtyRef,
      baseRef,
      editorRef,
      docPendingRef,
      docChangeTimerRef,
      saveNowRef,
      openNoteRef,
    },
    setActivePath,
    setContent,
    setDirty,
  })

  /* ── 内核（库变了才重建）── */
  const kernel: Kernel | null = useMemo(() => {
    if (!vault) return null
    return createKernel(vault, docApi, {
      onPanelsChange: setPanels,
      onNotify: (msg) => setToast(msg),
      onLog: (msg) => setPanelLog((l) => [...l.slice(-199), msg]),
      onPanelStateChange: (bind, value) => setPanelState((s) => ({ ...s, [bind]: value })),
      // U2：整窗接管变化 ⇒ 触发一次重渲染（账在内核里，渲染时读 `kernel.shellOwner()`）
      onShellChange: () => setShellTick((t) => t + 1),
    })
  }, [vault, docApi])

  /** 当前整窗接管者（`null` = 内核 UI 正常）—— 直接读内核那本账，引用在接管期间稳定 */
  const shellTakeover = kernel?.shellOwner() ?? null

  /** `ShellMount` 的挂载上下文 —— 必须是稳定引用（它是 mount 的 effect 依赖，变一次就会重挂载） */
  const shellCtx = useMemo<ShellMountCtx | null>(
    () =>
      shellTakeover
        ? {
            pluginId: shellTakeover.pluginId,
            vault: vault ?? '',
            platform: kernel?.host.platform ?? 'other',
          }
        : null,
    [shellTakeover, vault, kernel],
  )

  /**
   * 接管期间的**内核逃生口**（U2）—— 键盘那半。
   *
   * 接管状态下内核 UI 全部不在渲染树里（连插件管理页都点不到），所以必须留一条
   * "回到内核"的路：否则插件不给退出入口、或崩在半路，用户就被锁死了。
   * 另一半是右下角那颗可见的小按钮（见渲染分支）；两个入口覆盖"按钮被插件盖住"的情况。
   */
  useEffect(() => {
    if (!shellTakeover) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        kernel?.clearShell()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shellTakeover, kernel])

  /**
   * 内核审计出口（**只读诊断**）—— 接管协议验收判据的载体（2026-10-13 rev49）。
   *
   * 挂 `window.__znKernelAudit()`：CDP 在「加载插件前 / 卸载插件后」各读一次，
   * 比较命令表、订阅表、面板、服务、编辑器规则、插件样式是否回到基线。
   * 生产留着无害：它只读内核自己的登记表，不暴露库数据、不提供任何写入路径。
   * （它与 `__docProbeDiag` 同属"给静默失效一个出口"的做法 —— 那时是靠诊断出口
   *   一步定位，而不是靠猜。）
   */
  useEffect(() => {
    if (!kernel) return
    const w = window as unknown as {
      __znKernelAudit?: () => KernelAudit
      __znExec?: (id: string, payload?: unknown) => Promise<unknown>
    }
    w.__znKernelAudit = () => kernel.audit()
    /**
     * 命令执行出口（**给自动化验收用**，2026-10-15 加）。
     *
     * 为什么需要：`__znKernelAudit` 只读；而"带 payload 执行一条命令"此前**没有任何入口** ——
     * 命令面板不带参数、UINode 按钮的 payload 写死在清单里。于是像
     * `io.importFile({ path: 'content://…' })` 这种**必须传参**的命令，CDP 侧无从触发
     * （原生文件对话框也没法脚本化点选）⇒ 端到端验收就断在这里。
     *
     * 与 `__znKernelAudit` / `__znBackPress` 同属诊断出口：页面里本来就跑着内核本体，
     * 这里不多给任何主体任何能力（插件自己就能 `execute`）。
     */
    w.__znExec = (id, payload) => kernel.commands.api.execute(id, payload)
    return () => {
      delete w.__znKernelAudit
      delete w.__znExec
    }
  }, [kernel])

  /* ── 文件树 ── */
  /* ── 文档读写域（rev124 · L3）：刷新 / 合并 / 保存 / 编辑器变更 —— 见 hooks/useDocIO.ts ── */
  const { refresh, saveNow, reloadActiveFromDisk, onEditorChange } = useDocIO({
    kernel,
    fireDoc,
    flushDocChange,
    pluginWindowId,
    refs: {
      notesRef,
      contentRef,
      activeRef,
      dirtyRef,
      baseRef,
      saveNowRef,
      timerRef,
      docChangeTimerRef,
      docPendingRef,
      externalReloadRef,
    },
    setNotes,
    setDirs,
    setError,
    setContent,
    setDirty,
    setSaveState,
    setToast,
    autosaveMs: AUTOSAVE_MS,
    docChangeDebounceMs: DOC_CHANGE_DEBOUNCE_MS,
  })


  /**
   * **插件窗口的极简 close 监听器**（rev53）—— 存在的唯一意义是让 `close()` 这条语义能工作。
   *
   * 机制（读本地 `@tauri-apps/api/window.js` + 两个对照实验确认，别再猜）：
   *   · `Window.close()` → 只 `invoke('plugin:window|close')`，**发 `tauri://close-requested` 事件**，
   *     **自己不销毁窗口**（`destroy()` 的 API 注释原文：close 是 "emitting a closeRequested
   *     event" 而不是 "forces the window close"）；
   *   · 真正销毁由前端监听器负责 —— API 的 `onCloseRequested(handler)` 包装里写着：
   *     `if (!evt.isPreventDefault()) await this.destroy()`；
   *   · ⇒ **窗口里一个 close 监听器都没有时，没人调 destroy，`close()` 返回 ok 但窗口不关**。
   *
   * 实验证据：E1（无监听器 ⇒ close 返回 ok、窗口仍在）· E2（注册"不 preventDefault 就 destroy"
   * 的监听器后 ⇒ close 正常关窗）。主窗口一直能关，正是因为它有这个拦截器监听器。
   *
   * 插件窗口没有"未保存内容"要兜底，所以这里**什么都不做** —— 不 preventDefault ⇒ API 层 destroy ⇒ 关。
   */
  useEffect(() => {
    if (!pluginWindowId) return
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        unlisten = await getCurrentWindow().onCloseRequested(() => {
          /* 故意留空：不 preventDefault ⇒ 关闭照常进行 */
        })
        // 注册完成的可断言标记：注册是**异步**的（动态 import + await），
        // 早于它调 close 会"没人 destroy"⇒ 窗口不关。验收脚本等这个标记，而不是猜时间。
        ;(window as unknown as { __znCloseListener?: boolean }).__znCloseListener = true
      } catch {
        /* 非 Tauri 环境（浏览器预览）—— 忽略 */
      }
    })()
    return () => unlisten?.()
  }, [pluginWindowId])

  /* ── 文档会话（rev125 · L3）：打开 / 关闭 / [[链接]] —— 见 hooks/useDocSession.ts ── */
  const { openNote, openWikiLink, closeNote } = useDocSession({
    kernel,
    notes,
    fireDoc,
    flushDocChange,
    refs: {
      activeRef,
      contentRef,
      dirtyRef,
      baseRef,
      frontmatterRef,
      notesRef,
      saveNowRef,
      openNoteRef,
    },
    setActivePath,
    setContent,
    setDirty,
    setSaveState,
    setError,
    setToast,
    setSidebarOpen,
  })


  /**
   * 把一个库从「最近打开过的库」里剔掉（含持久化）。
   *
   * 场景：库目录已经被删除 / 换了盘 —— 此前这条记录会一直留在菜单里，
   * 点它只会得到「库目录不存在」，而用户**没有任何清掉它的入口**。
   */
  const forgetVault = useCallback((dir: string) => {
    setRecentVaults((prev) => {
      const next = prev.filter((p) => vaultKey(p) !== vaultKey(dir))
      if (next.length === prev.length) return prev
      persistRecentVaults(next)
      return next
    })
  }, [])

  /**
   * 真正切库：未保存内容先落盘 → 记住 → 重置视图 → 换库。桌面与移动端共用。
   *
   * 返回**是否真的切了**：目录不存在时（被删 / 换盘没挂上）拒绝切换，并剔掉那条记录 ——
   * 切过去只会让文件树报「库目录不存在」，还把一条死记录继续留在最近列表里。
   */
  const applyVault = useCallback(
    async (dir: string): Promise<boolean> => {
      if (!(await vaultExists(dir))) {
        forgetVault(dir)
        setToast(`「${baseName(dir)}」已不存在，已从最近笔记库移除。`)
        return false
      }
      if (dirtyRef.current) await saveNowRef.current()
      localStorage.setItem(LS_VAULT, dir)
      // 记入「最近打开过的库」：最近在前、按归一化路径去重、上限 8 条。
      // 只在此处写 —— 切库成功的唯一定义点（桌面目录选择器 / 侧栏库切换 / 移动端面板都走它）。
      setRecentVaults((prev) => {
        const next = [dir, ...prev.filter((p) => vaultKey(p) !== vaultKey(dir))].slice(
          0,
          RECENT_VAULTS_MAX,
        )
        persistRecentVaults(next)
        return next
      })
      setActivePath(null)
      setContent('')
      setDirty(false)
      setSaveState('idle')
      setVault(dir)
      return true
    },
    [forgetVault],
  )

  /* ── 外部文件（打开文件 / SAF / 待打开 / 文件关联接线）（rev127 · L3 第五刀）—— 见 hooks/useExternalFile.ts ── */
  useExternalFile({
    platform,
    kernel,
    vault,
    applyVault,
    setToast,
    refs: {
      vaultRef,
      pendingOpenRef,
      recentOpenRef,
      openExternalFileRef,
      openNoteRef,
    },
  })

  /**
   * ☰ 菜单的「打开文件…」。
   * 桌面端这是**不装安装包也能验收**的入口（`bundle.fileAssociations` 只在安装包里写注册表）；
   * Android 上文件选择器能否用**因平台而异**（目录选择器是源码级
   * `FolderPickerNotImplemented`），所以失败必须兜住并给出可执行的替代路径。
   */
  const pickFile = useCallback(async () => {
    try {
      const picked = await open({
        multiple: false,
        title: '打开文件',
        /**
         * ⚠️ **Android 一律不传 `filters`**（2026-10-15 真机实测，用户报「打开文件，访问不到手机文件」）。
         *
         * 手机上弹的是 **MIUI 的「安全访问」**选择器，它按 **MIME** 过滤自己那四个分类
         * （文档 / 图片 / 视频 / 音乐），而 `text/markdown` **不在它的白名单**里
         * ⇒ 传 filter 的结果是**一个文件都列不出来**（只有目录能进，进去是空的 —— 用户的原话）。
         * 桌面端保留（原生对话框认扩展名），并放宽到阅读器真正支持的格式
         * （与 `openExternalFile` 的 `SAF_READABLE_RE` 同一份清单）。
         */
        ...(platform === 'android'
          ? {}
          : {
              filters: [
                {
                  name: '文档',
                  extensions: [
                    'md',
                    'markdown',
                    'pdf',
                    'epub',
                    'mobi',
                    'azw3',
                    'azw',
                    'fb2',
                    'cbz',
                    'txt',
                  ],
                },
              ],
            }),
      })
      if (typeof picked !== 'string') return
      await openExternalFileRef.current(picked)
    } catch (e) {
      setToast(`系统文件选择器打不开（${String(e)}）。可改用系统的「打开方式」并选 ZeroNote。`)
    }
    // `platform` 进依赖：Android 分支不传 filters（见上面的注释），桌面分支才传
  }, [platform])

  const pickVault = useCallback(async () => {
    // 安卓**没有目录选择器**：Tauri 的 dialog.open({directory:true}) 在移动端
    // 源码级返回 FolderPickerNotImplemented（以前这里会报"请确认读写权限"，是误报）。
    // 所以手机端改走应用内面板：默认库 + 库根下 .vaults/ 里的其它库。
    if (platform === 'android') {
      setVaultPanelOpen(true)
      return
    }
    try {
      const dir = await open({ directory: true, multiple: false, title: '选择笔记库文件夹' })
      if (typeof dir !== 'string') return
      await applyVault(dir)
    } catch (e) {
      setError(failMsg('vault', e))
    }
  }, [platform, applyVault])

  /**
   * 「切换笔记库」菜单 —— 侧栏底部的库名、以及侧栏空白区的右键菜单共用这一个入口。
   *
   * 桌面端此前切库只有系统目录选择器一条路：想切回上个库得在文件对话框里一路点过去。
   * 这里把**打开过的库**列出来，点一下即切；切换动作仍走 `applyVault`
   * （ensure_vault、笔记刷新、localStorage 一套逻辑不重写）。
   *
   * **过期记录自动清理**：目录已被删除（或盘没挂上）的库不再列出来，并当场提示一句 ——
   * 此前它们留在列表里，点一下只会报「库目录不存在」，用户没有别的办法清掉。
   * 探测走只读的 `vault_exists`，**不会把库目录建出来**；当前库不探测、照常显示。
   */
  const openVaultMenu = async (clientX: number, clientY: number) => {
    // 当前库可能还没进「最近」（首次选中、或被清过 localStorage）—— 展示时补在最前。
    // 只补展示，**不写回**持久化：写入点只有 applyVault 一处。
    const shown =
      vault && !recentVaults.some((p) => vaultKey(p) === vaultKey(vault))
        ? [vault, ...recentVaults].slice(0, RECENT_VAULTS_MAX)
        : recentVaults.slice(0, RECENT_VAULTS_MAX)
    // 并行探测（8 条 × 微秒级 is_dir，串行是白等）。当前库跳过：它正在用，
    // 即便目录被删也先据实显示，由文件树的报错去说 —— 这里只管"最近列表里的死记录"。
    const alive = await Promise.all(
      shown.map((dir) =>
        vault !== null && vaultKey(dir) === vaultKey(vault) ? true : vaultExists(dir),
      ),
    )
    const gone = shown.filter((_, i) => !alive[i])
    const live = shown.filter((_, i) => alive[i])
    if (gone.length > 0) {
      for (const dir of gone) forgetVault(dir)
      setToast(
        `「${gone.map(baseName).join('、')}」已不存在，已从最近笔记库移除（想加回来用「打开其它文件夹…」）。`,
      )
    }
    // 不同目录下的同名库（两个 Desktop）光看名字分不开，补一格父目录名
    const nameCount = new Map<string, number>()
    for (const dir of live) {
      const n = baseName(dir)
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1)
    }
    const items: MenuItem[] = live.map((dir) => {
      const name = baseName(dir)
      const isCurrent = vault !== null && vaultKey(dir) === vaultKey(vault)
      const parts = dir.split(/[\\/]/).filter(Boolean)
      const hint =
        !isCurrent && (nameCount.get(name) ?? 0) > 1 && parts.length >= 2
          ? parts[parts.length - 2]
          : undefined
      return {
        label: isCurrent ? `${name} · 当前` : name,
        hint,
        onClick: () => {
          // 点当前库 = 什么都不做（菜单自己会关）
          if (!isCurrent) void applyVault(dir)
        },
      }
    })
    items.push({ label: '打开其它文件夹…', divider: true, onClick: () => void pickVault() })
    setVaultMenu({ x: clientX, y: clientY, items })
  }

  const newNote = useCallback(async (nameArg?: string) => {
    const k = kernel
    if (!k) return
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    // 快速切换里输入了名字就直接用它（缺 .md 自动补）；否则给一个时间戳默认名
    const given = nameArg?.trim()
    const name = given
      ? /\.md$/i.test(given)
        ? given
        : `${given}.md`
      : `新笔记-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.md`
    try {
      await k.fs.createNote(name, '')
      await refresh()
      await openNoteRef.current(name)
    } catch (e) {
      setError(failMsg('create', e))
    }
  }, [kernel, refresh])

  /**
   * 跑一个**内核命令**。
   *
   * 界面上所有"新建笔记 / 保存 / 切换库"这类入口一律走命令、而不是直接调函数 ——
   * 因为**命令表是插件唯一能接管内核行为的地方**（`command.bind(id, run)` 会覆盖
   * 已存在条目的实现）。直接调函数的话插件永远接不上：规格 §2.2 那条
   * 「'笔记'目录下只能在当天时间目录新建」就是卡在这里。
   */
  const runCore = useCallback(
    (id: string, payload?: Record<string, unknown>) => {
      void kernel?.commands.api.execute(id, payload).catch((e) => setError(String(e)))
    },
    [kernel],
  )

  /**
   * 重命名 / 移动（文件或**整个目录树**）。
   *  · 文件走 `rename`，目录走 `move`（只有它能搬目录）
   *  · 改的正是打开的笔记 ⇒ 同步 activePath；打开的笔记在**被改名的目录里** ⇒ 前缀一起换，
   *    否则编辑器还指着一条已经不存在的路径（下一次自动保存就会写失败）
   */
  const renameNote = useCallback(
    async (from: string, to: string, isDir = false) => {
      const k = kernel
      if (!k) return
      try {
        await (isDir ? k.fs.move(from, to) : k.fs.rename(from, to))
        const cur = activeRef.current
        if (cur === from) setActivePath(to)
        else if (isDir && cur?.startsWith(`${from}/`))
          setActivePath(`${to}${cur.slice(from.length)}`)
        await refresh()
        setError(null)
        // 不再弹「已重命名：<路径>」—— 列表里那一行已经变了，路径又长又挡视线（用户 2026-10-17 要求）
      } catch (e) {
        setError(failMsg('rename', e))
      }
    },
    [kernel, refresh],
  )

  /**
   * 在指定目录（`''` = 库根）新建笔记，返回**落盘后的库内路径**（失败 null）。
   * 名字先探测再落盘：`create_note` 不覆盖已存在文件，撞名会直接报错，
   * 所以这里自己避重 —— 否则"新建"会变成一个看不懂的错误。
   */
  const newNoteIn = useCallback(
    async (dir: string): Promise<string | null> => {
      const k = kernel
      if (!k) return null
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      /**
       * 默认文件名 = `新笔记-时-分-秒`（用户 2026-10-17 定）。
       * 此前是 `untitled-<年月日时分秒>` —— 文件树又显示正文首行的「新笔记」，
       * 结果一排文件长得一模一样、分不出哪篇是哪篇。
       */
      const stamp = `新笔记-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
      try {
        let name = `${stamp}.md`
        let i = 2
        while (await k.fs.exists(dir ? `${dir}/${name}` : name)) {
          name = `${stamp}-${i}.md`
          i += 1
        }
        const path = dir ? `${dir}/${name}` : name
        await k.fs.createNote(path, '')
        await refresh()
        setError(null)
        return path
      } catch (e) {
        setError(failMsg('create', e))
        return null
      }
    },
    [kernel, refresh],
  )

  /** 在指定目录下新建文件夹（`新建文件夹` / `新建文件夹 2` …），返回库内路径 */
  const newDirIn = useCallback(
    async (dir: string): Promise<string | null> => {
      const k = kernel
      if (!k) return null
      try {
        let name = '新建文件夹'
        let i = 2
        while (await k.fs.exists(dir ? `${dir}/${name}` : name)) {
          name = `新建文件夹 ${i}`
          i += 1
        }
        const path = dir ? `${dir}/${name}` : name
        await k.fs.mkdir(path)
        await refresh()
        setError(null)
        return path
      } catch (e) {
        setError(failMsg('create', e))
        return null
      }
    },
    [kernel, refresh],
  )

  /* ── 文件操作域（rev123 · L3）：剪贴板 / 回收站 / 删除 —— 实现见 hooks/useFileOps.ts ── */
  const {
    clipboard,
    cutPaths,
    copyPaths,
    pasteInto,
    duplicateEntry,
    trash,
    confirmPurge,
    confirmEmpty,
    setConfirmPurge,
    setConfirmEmpty,
    openTrash,
    restoreTrashItem,
    purgeTrashItem,
    emptyTrashAll,
    deleteNotes,
    purgeNotes,
    undoDelete,
    undoDeleteNote,
    fmtSize,
  } = useFileOps({
    kernel,
    refresh,
    activeRef,
    dirtyRef,
    saveNowRef,
    setActivePath,
    setContent,
    setDirty,
    setSaveState,
    setError,
    setToast,
    setMainView,
  })

  /**
   * toast 到点自动消失（用户 2026-10-12 报：那个「已彻底删除」一直挂着不走）。
   * 时长按长度给 —— 「已恢复」这类两秒半够读，SAF 那种长说明得留足时间；上限 8 秒。
   * 渲染处的点击立即关闭（`onClick={() => setToast(null)}`）保留。
   * ⚠️ setState 写在 setTimeout 的**回调**里：同步写在 effect 里会触发 lint 的
   * `set-state-in-effect`（本项目基线恰好 4 warnings，多一条都算回归）。
   */
  useEffect(() => {
    if (!toast) return
    const ms = Math.min(8000, 2500 + toast.length * 60)
    const t = window.setTimeout(() => setToast(null), ms)
    return () => window.clearTimeout(t)
  }, [toast])


  /* ── 内置命令：和插件命令走完全同一套 API ── */
  useEffect(() => {
    if (!kernel) return
    const subs = [
      kernel.commands.api.register({
        id: 'core.save',
        title: '保存当前笔记',
        keybinding: 'Mod+S',
        run: () => saveNowRef.current(),
      }),
      kernel.commands.api.register({
        id: 'core.newNote',
        title: '新建笔记',
        keybinding: 'Mod+N',
        /**
         * 接受可选参数 `{ name }`（快速切换里输入的名字）。
         *
         * **这条命令是可以被插件接管的** —— 插件在 `apply()` 里
         * `command.bind('core.newNote', …)` 就会覆盖掉上面这个 `run`
         * （`bind` 对已存在的 id 只换实现、不动元数据）。
         * 规格 §2.2 的「'笔记'目录下只能在当天时间目录新建」正是靠这个接管点实现，
         * 见 `examples/daily-note/`。
         */
        run: (payload) => {
          const p = (payload ?? {}) as { name?: string }
          return newNote(p.name)
        },
      }),
      kernel.commands.api.register({
        id: 'core.pickVault',
        title: '切换笔记库…',
        run: () => pickVault(),
      }),
      kernel.commands.api.register({
        id: 'core.palette',
        title: '打开命令面板',
        keybinding: 'Mod+P',
        run: () => openOverlay('palette'),
      }),
      kernel.commands.api.register({
        id: 'core.quickOpen',
        title: '快速打开笔记…',
        keybinding: 'Mod+O',
        run: () => openOverlay('switcher'),
      }),
      kernel.commands.api.register({
        id: 'core.plugins',
        title: '打开插件管理',
        run: () => setMainView('plugins'),
      }),
      kernel.commands.api.register({
        id: 'core.settings',
        title: '打开设置',
        keybinding: 'Mod+,',
        run: () => openOverlay('settings'),
      }),
      kernel.commands.api.register({
        id: 'core.search',
        title: '搜索笔记',
        keybinding: 'Mod+Shift+F',
        run: () => openOverlay('search'),
      }),
      kernel.commands.api.register({
        id: 'core.replace',
        title: '查找并替换…',
        keybinding: 'Mod+H',
        run: () => setReplaceOpen(true),
      }),
      kernel.commands.api.register({
        id: 'core.closeNote',
        title: '关闭当前笔记',
        keybinding: 'Mod+W',
        run: () => void closeNote(),
      }),
      /**
       * 「打开只读文档」的**派发点**（2026-10-13 加，配合文档阅读器插件）。
       *
       * 内核只认识"这是一份只读文档"（`NoteMeta.kind === 'doc'`），**不认识 pdf/epub**：
       * 怎么渲染是插件的事。所以这里只放一个**默认实现**（如实告诉用户"没有插件能开"），
       * 插件用 `command.bind('core.openDocument', …)` 接管 —— 与 `core.newNote` 同一套机制
       * （`bind` 只换实现、不动元数据；**卸载时自动还原**，见契约 §2.1.1）。
       *
       * payload：`{ path: string }`（库内相对路径）
       */
      kernel.commands.api.register({
        id: 'core.openDocument',
        title: '打开文档（PDF / EPUB 等）',
        run: (payload) => {
          const p = (payload ?? {}) as { path?: string }
          const ext = p.path ? p.path.slice(p.path.lastIndexOf('.') + 1).toLowerCase() : '该'
          setToast(`没有能打开 .${ext} 的插件 —— 到「插件管理」装一个文档阅读器`)
        },
      }),
      /**
       * 请求 Android 的「所有文件访问」权限（rev64）。
       *
       * 只在 Android 上真正跳系统页，桌面是 no-op（Rust 侧返回 Ok）⇒ 这里不需要平台分支。
       * 为什么必须有这个入口：库放公共存储时，缺它的表现只是 `Permission denied (os error 13)`，
       * 而它属于 Android 的**特殊权限、系统不弹窗申请** ⇒ 用户猜不到该去哪开。
       */
      kernel.commands.api.register({
        id: 'core.requestStoragePermission',
        title: '请求「所有文件访问」权限（Android）',
        run: async () => {
          try {
            await requestAllFilesAccess()
            setToast('已打开系统授权页：找到「所有文件访问」并允许，然后回来重新扫描插件')
          } catch (e) {
            setToast(`打不开系统授权页：${String(e)}`)
          }
        },
      }),
      /**
       * 12 个 Markdown 标记（2026-10-12 从 `examples/md-toolbar` **收进内核**）
       * —— 语法规则只存在一份，三处入口共用同一批命令：
       * 手机底栏 / 桌面顶部提示条 / 编辑器右键的「标记」子菜单。
       */
      ...registerMarkdownMarks(kernel.commands, docApi),
    ]
    return () => subs.forEach((s) => s.dispose())
  }, [kernel, docApi, newNote, pickVault, closeNote, openOverlay])

  /**
   * 为**每个插件面板**注册一条命令：`core.panel.<面板 id>` ⇒ 打开它。
   *
   * 为什么要有：面板此前**只能从 ☰ 菜单进**，而那个按钮贴在窗口最上面 20px
   * （`.zn-titlebar-hotzone` 会吃掉那里的点击，且标题栏只在鼠标悬停顶部时显形）
   * —— 既不好点、也没法脚本化。命令面板是键盘可达的，给面板一条命令，
   * 它就有了第二个**可搜索、可键盘触发**的入口（本次验收就是靠它打开的）。
   *
   * 单独一个 effect，不并进上面那批核心命令：那样 `panels` 一变就要重注册整批命令，
   * 连带重复绑定键位（`bindCommandKeybindings` 是另一条链）。
   */
  useEffect(() => {
    if (!kernel) return
    const offs = panels.map((p) =>
      kernel.commands.api.register({
        id: `core.panel.${p.id}`,
        title: `打开面板：${p.title}`,
        run: () => setMainView(p.id),
      }),
    )
    return () => {
      for (const off of offs) off.dispose()
    }
  }, [kernel, panels])

  /* ── 插件宿主（扫描 / 加载 / 懒激活 / .znp 安装）（rev128 · L3 第六刀）—— 见 hooks/usePluginHost.ts ── */
  const { installZnp } = usePluginHost({
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
  })

  /* ── 全局快捷键 ──
     命令表里声明的 keybinding 由派发器统一绑定。此前它们被完全忽略 ——
     只硬编码了 Ctrl+K，插件和内核声明的键位全部静默失效。
     依赖 loadedIds：插件装卸会增删命令，加载完成后必须重绑。 */
  useEffect(() => {
    if (!kernel) return
    return bindCommandKeybindings(kernel.commands)
  }, [kernel, loadedIds])

  /**
   * Escape 兜底：**一次只吃一层**（调研结论：Esc 应从内到外逐层退出）。
   *
   * 各浮层（命令面板 / 搜索 / 设置 / 右键菜单 / 文件夹重命名）自己也会处理 Esc，
   * 这里只给「它们没拦住」的情况兜底 —— 所以按层级判断、命中即 return，
   * 不再像以前那样一次把 palette 和 search 都关掉。
   * 不交给命令表：它要读实时状态，且不该让用户自定义。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (switcherOpen) {
        setSwitcherOpen(false)
        return
      }
      if (paletteOpen) {
        setPaletteOpen(false)
        return
      }
      if (searchOpen) {
        setSearchOpen(false)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, searchOpen, switcherOpen])

  /**
   * Android 返回键该做什么：从最上面那层开始关；全都没得关，才允许退出。
   * 用 ref 传当前逻辑，免得每次状态变化都重新注册返回键监听。
   */
  const backRef = useRef<() => boolean>(() => false)
  /**
   * 「层出口」栈 —— 菜单 / 文件树多选这类**状态由组件自持**的浮层，打开时把自己的关闭函数
   * 压进来；返回键**最先**关它们，再往下才是设置 / 搜索 / 侧栏 / 笔记。
   *
   * 为什么要这一层（2026-10-13 rev68 补的缺口）：此前菜单不在链条里 ——
   * 菜单打开时按返回键会被判成"都没得关" ⇒ 直接 `exit(0)`，**应用退出而菜单还开着**。
   * 用栈而不是逐个 `if`：这些层的状态不在 App 里，逐个提升 state 会把一个组件的交互拆到两处；
   * 栈还能自动保证"后开的先关"。
   */
  const layerExitsRef = useRef<Array<() => boolean>>([])
  useEffect(() => {
    backRef.current = () => {
      // ① 最先：自持浮层（☰ 菜单 / 库菜单 / 主区·侧栏右键菜单 / 文件树多选）
      const stack = layerExitsRef.current
      if (stack.length && stack[stack.length - 1]()) return true
      if (settingsOpen) {
        setSettingsOpen(false)
        return true
      }
      if (searchOpen) {
        setSearchOpen(false)
        return true
      }
      if (switcherOpen) {
        setSwitcherOpen(false)
        return true
      }
      if (paletteOpen) {
        setPaletteOpen(false)
        return true
      }
      if (mainView !== 'editor') {
        setMainView('editor')
        return true
      }
      if (sidebarOpen) {
        setSidebarOpen(false)
        return true
      }
      if (activeRef.current) {
        void closeNote()
        return true
      }
      return false
    }
  }, [settingsOpen, searchOpen, switcherOpen, paletteOpen, sidebarOpen, mainView, closeNote])

  /* App 自己持有的三个菜单（☰ 菜单 / 库菜单 / 主区·侧栏右键菜单）也压进层出口栈 ——
     它们既是"返回键该先关掉的一层"，也是 rev68 补掉的那个缺口。 */
  useEffect(() => {
    const stack = layerExitsRef.current
    const close = mainMenu
      ? () => setMainMenu(null)
      : vaultMenu
        ? () => setVaultMenu(null)
        : menuAt
          ? () => setMenuAt(null)
          : null
    if (!close) return
    const fn = () => {
      close()
      return true
    }
    stack.push(fn)
    return () => {
      const i = stack.indexOf(fn)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [mainMenu, vaultMenu, menuAt])

  /* 诊断出口（与 `__znKernelAudit` / `__znReloadLog` 同一套路，只读、生产留着无害）：
     Android 上返回键的触发源是 `onBackButtonPress`，桌面跑不了真机 ——
     这两个口让脚本能直接跑同一段逻辑并读层数，用来验证"后开的先关"。 */
  useEffect(() => {
    const w = window as unknown as {
      __znBackPress?: () => boolean
      __znBackLayers?: () => number
    }
    w.__znBackPress = () => backRef.current()
    w.__znBackLayers = () => layerExitsRef.current.length
    return () => {
      delete w.__znBackPress
      delete w.__znBackLayers
    }
  }, [])

  /**
   * 卡死兜底：**前端心跳**（判超时的一方在 Rust 的原生看门狗线程里，见 `src-tauri/src/lib.rs`
   * 的 `spawn_watchdog`）。设计取舍与验收判据见 `docs/卡死兜底方案-2026-10-13.md`。
   *
   * 机制很朴素 —— 心跳就是"主线程还活着"的凭据：插件用 `while(true)` 占死主线程后，
   * 这个 `setInterval` 不再执行，Rust 侧连续超时即判卡死。
   * （**前端自己判不了**：主线程死了，任何前端定时器都停 —— 这正是要有原生侧的原因。）
   *
   * 三个必须的细节：
   *  · **挂载即 resume**：Rust 侧初始是"暂停"态，不主动恢复就永远不判超时。
   *  · **不可见就 pause**：手机切后台时 WebView 被系统暂停、心跳自然停 —— 不暂停会被误杀。
   *  · **pagehide 也 pause**：正常关窗/刷新前先暂停，免得"正在关闭"被当成卡死。
   */
  useEffect(() => {
    if (!vault) return
    const beat = () => {
      void invoke('zn_heartbeat', { vault }).catch(() => {})
    }
    const syncVisibility = () => {
      if (document.visibilityState === 'visible') {
        void invoke('zn_watchdog_resume').catch(() => {})
        beat()
      } else {
        void invoke('zn_watchdog_pause').catch(() => {})
      }
    }
    const pause = () => {
      void invoke('zn_watchdog_pause').catch(() => {})
      // 关窗 / 刷新都算"正常离开"：顺手清掉"正在加载"标记。
      // ⚠️ 必须在这里清，别指望关窗监听器 —— 项目的 ✕ 走的是 `getCurrentWindow().destroy()`
      //（`WindowControls` 的 onClose），**不触发** `onCloseRequested`；只有 `pagehide` 一定会跑到。
      // 不清的话："加载途中用户关了应用"的标记会留到下次启动 ⇒ 白误伤一个插件。
      try {
        localStorage.removeItem(LS_LOADING)
      } catch {
        /* 无所谓 */
      }
    }
    syncVisibility()
    const timer = window.setInterval(beat, 1000)
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('pagehide', pause)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('pagehide', pause)
    }
  }, [vault])

  /**
   * Android 系统返回键接管。
   *
   * 不接管的后果（用户实测「手机也无法返回，只会直接退出」）：
   *   Tauri 的 AppPlugin 在没有监听者时执行
   *   `webView.canGoBack() ? goBack() : activity.onBackPressed()`，
   *   而我们的页面没有浏览器历史 ⇒ 直接 finish 掉整个应用。
   *
   * 官方 API（@tauri-apps/api/app，since 2.9.0）文档原话：**注册 handler 即完全接管默认行为**。
   * 于是这里自己决定：先关最上面那层 UI，实在没得关才 exit(0)。
   * 桌面端 handler 永不触发，因此不需要平台判断。
   */
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void (async () => {
      try {
        const listener = await onBackButtonPress(() => {
          if (!backRef.current()) void exit(0)
        })
        if (cancelled) void listener.unregister()
        else unlisten = () => void listener.unregister()
      } catch {
        /* 非 Android 或 API 不可用：保持系统默认行为 */
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const togglePlugin = (id: string, enabled: boolean) => {
    setDisabled((prev) => {
      const next = new Set(prev)
      if (enabled) next.delete(id)
      else next.add(id)
      return next
    })
    // 用户自己动手恢复 ⇒ "我替你关的"这条标记使命结束（变成"你重新开的"）
    if (enabled) {
      setAutoDisabled((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
    setReloadToken((t) => t + 1)
  }

  /* 2026-10-13 拆权限门：这里原本是 `toggleNetwork()`（写 `.zn/permissions.json`
   * 并重扫）。**已删除** —— 没有"授权"这回事了，插件声明的能力不再需要用户点头。 */

  /**
   * 删除插件：删掉插件目录 → 把它从 disabled 集合里摘掉 → 改 reloadToken
   * 触发一次完整重扫（先卸载已加载的实例，再按新目录列表重新加载）。
   *
   * 失败时只报错、**不动界面状态** —— 磁盘上没删掉，界面就不该假装删了。
   */
  const deletePlugin = async (id: string) => {
    const v = vault
    if (!v) return
    // 按**来源**删：全局插件删全局那份，库内插件删库内那份 —— 删错根要么删错位置、要么报"不存在"
    const root = pluginEntries[id]?.root ?? v
    try {
      await deletePluginDir(root, id)
      setDisabled((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setReloadToken((t) => t + 1)
      setToast('插件已删除')
    } catch (e) {
      setError(`删除插件失败：${String(e)}`)
    }
  }


  const rows: PluginRow[] = manifests.map((m) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    enabled: loadedIds.includes(m.id),
    capabilities: m.capabilities ?? [],
    // 2026-10-17 rev94：这个插件从哪来 —— 全局的那份换库也在，库内的那份跟着库走
    source: pluginEntries[m.id]?.source,
    // 平台不符 ⇒ 一行说明它只支持哪端（「桌面」/「移动」两类人话，不暴露 desktop/android 字面量）
    platformNote: platformSkipped.includes(m.id)
      ? `不适用 · 仅${(m.platforms ?? [])
          .map((p) => (p === 'desktop' ? '桌面' : '移动'))
          .join(' / ')}端`
      : undefined,
    // 卡死兜底 C 段：被启动自愈关掉的插件 —— 明确标注，别让它静默消失
    autoDisabledNote: autoDisabled.has(m.id) ? '因上次加载未完成已自动禁用' : undefined,
    // rev119：入口带 sha256 ⇒ 已校验；没有 ⇒ 未校验（安装 .znp 时也会提示未签名）
    integrity: m.sha256 ? 'verified' : 'none',
  }))

  /**
   * 设置页「网络与进程」区块用的清单（2026-10-13 拆门后**只读展示**）。
   *
   * 读的是 **manifest 的自述**（`capabilities`），不再是授权记录 ——
   * 内核不做权限判定，所以这一块的性质从"开关"变成了"告诉你这个插件自称要什么"。
   * `proc` 一起列：它和 `net` 以前同属"默认拒"，现在同样只是自述。
   */
  const declNetPlugins = rows
    .filter((r) => r.capabilities.includes('net') || r.capabilities.includes('proc'))
    .map((r) => ({ id: r.id, name: r.name, version: r.version, caps: r.capabilities }))

  /** 标题栏上显示的名字：优先当前笔记，其次库名 */
  const titleText = activePath
    ? (activePath.split(/[\\/]/).pop() ?? '').replace(/\.md$/i, '')
    : vault
      ? (vault.split(/[\\/]/).pop() ?? 'ZeroNote')
      : 'ZeroNote'
  /** 桌面端才画窗口控制按钮（移动端没有窗口装饰这回事） */
  const isDesktop = kernel?.host.platform !== 'android'

  /** 左上角 ☰ 菜单的条目 —— 把散落在顶栏的动作收进一个入口（记事本式布局） */
  const menuItems: MenuItem[] = [
    { label: '新建笔记', hint: 'Ctrl+N', onClick: () => void runCore('core.newNote') },
    { label: '打开笔记库…', onClick: () => void pickVault() },
    // 文件关联的**桌面验收入口**（不装安装包也能试）：选一个 .md → 把它的父目录当库打开并打开它
    { label: '打开文件…', onClick: () => void pickFile() },
    // 笔记库栏的开关：
    //  · 桌面 —— 侧栏常驻，收起后菜单这条是唯一的**重开**入口
    //    （避免同一动作两处可点、让用户猜该用哪个）
    //  · 移动端 —— 侧栏是抽屉，☰ 菜单就是它的主要入口（用户要求「侧栏集成到菜单」）
    ...(isDesktop
      ? sidebarVisible
        ? []
        : [{ label: '显示笔记库栏', onClick: () => setSidebarVisible(true) }]
      : [
          {
            label: sidebarOpen ? '关闭笔记库栏' : '笔记库',
            onClick: () => setSidebarOpen((v) => !v),
          },
        ]),
    { label: '搜索笔记', hint: 'Ctrl+Shift+F', divider: true, onClick: () => openOverlay('search') },
    { label: '命令面板', hint: 'Ctrl+P', onClick: () => openOverlay('palette') },
    { label: '设置', hint: 'Ctrl+,', divider: true, onClick: () => openOverlay('settings') },
    // 右侧栏取消后，插件管理与各插件面板都在主区各占一个页面
    { label: '插件管理', onClick: () => setMainView('plugins') },
    ...panels
      .filter(
        (p) =>
          p.location !== 'statusbar' &&
          p.location !== 'modal' &&
          // 工具栏 / 顶部提示条是"贴着编辑器"的辅助条，不该在菜单里单开一个页面
          p.location !== 'editor-toolbar' &&
          p.location !== 'editor-topbar',
      )
      .map((p) => ({ label: p.title, onClick: () => setMainView(p.id) })),
    ...(mainView === 'editor'
      ? []
      : [{ label: '返回编辑器', divider: true, onClick: () => setMainView('editor') }]),
    ...(activePath
      ? [
          {
            label: '关闭当前笔记',
            hint: 'Ctrl+W',
            divider: true,
            onClick: () => void closeNote(),
          },
        ]
      : []),
  ]

  /**
   * 禁用 WebView 的原生右键菜单（那个「返回 / 刷新 / 打印 / 检查」）。
   * 用**捕获阶段**：树项的 onContextMenu 里有 stopPropagation，挂在冒泡阶段会漏掉它。
   */
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', onCtx, true)
    return () => document.removeEventListener('contextmenu', onCtx, true)
  }, [])

  /**
   * 给编辑器发一个合成按键。
   * 撤销/重做只能走这条路 —— `@codemirror/commands`（undo/redo 命令所在）不在顶层依赖里，
   * 拿不到；而 CM6 的 keymap 本来就监听 keydown，合成事件同样有效。
   */
  const synthKey = (key: string) => {
    const dom = editorRef.current?.contentDOM
    if (!dom) return
    for (const type of ['keydown', 'keyup'] as const) {
      dom.dispatchEvent(
        new KeyboardEvent(type, { key, ctrlKey: true, bubbles: true, cancelable: true }),
      )
    }
  }

  /** 复制选区并返回文本（剪切复用它，只有真复制成功才删选区，免得剪贴板失败把内容吃掉） */
  const copySelection = async (): Promise<string> => {
    const view = editorRef.current
    if (!view) return ''
    const sel = view.state.selection.main
    if (sel.empty) return ''
    const text = view.state.sliceDoc(sel.from, sel.to)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 剪贴板不可写时忽略；系统快捷键仍然可用 */
    }
    return text
  }

  /** 打开主区右键菜单（在事件处理里现算菜单项，按上下文决定给哪些） */
  const openMainMenu = (clientX: number, clientY: number) => {
    const view = editorRef.current
    const items: MenuItem[] = []

    // ── 新建（永远第一项，最顺手）──
    items.push({ label: '新建笔记', hint: 'Ctrl+N', onClick: () => void runCore('core.newNote') })

    // ── 编辑（编辑器就绪时）──
    if (view) {
      items.push(
        { label: '复制', hint: 'Ctrl+C', divider: true, onClick: () => void copySelection() },
        {
          label: '粘贴',
          hint: 'Ctrl+V',
          onClick: () => {
            void navigator.clipboard
              .readText()
              .then((text) => {
                if (!text) return
                const sel = view.state.selection.main
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: text },
                  selection: { anchor: sel.from + text.length },
                })
              })
              .catch(() => {
                /* 读剪贴板被拒（权限/焦点）时静默；用户仍可用 Ctrl+V */
              })
          },
        },
        { label: '查找…', hint: 'Ctrl+F', divider: true, onClick: () => synthKey('f') },
      )

      /**
       * Markdown 标记 —— 12 条直接铺在主菜单里会把它撑成十几行（滚都滚不完），
       * 所以收进一个「标记」子菜单（鼠标悬停展开）。命令是**内核自带**的
       * （`core.mark.*`，见 `kernel/markdown-marks.ts`）—— 桌面端**只有这一处入口**
       * （用户 2026-10-12 定：桌面只留右键菜单，顶部提示条与底部工具栏都不做）。
       */
      items.push({
        label: '标记',
        children: MARK_COMMANDS.map((m) => ({
          label: m.name,
          ...(m.keybinding ? { hint: keyLabel(m.keybinding) } : {}),
          onClick: () => void kernel?.commands.api.execute(m.id),
        })),
      })
    }

    // ── 笔记（打开了笔记时）──
    if (activePath) {
      items.push(
        {
          label: '复制笔记路径',
          // 编辑器项不存在时它就是第一项，不该再画分隔线（首项不画由 ContextMenu 兜着）
          divider: Boolean(view),
          onClick: () => void navigator.clipboard.writeText(activePath).catch(() => {}),
        },
        {
          /**
           * 磁盘被外部改过（导图写回、别的编辑器、脚本）而编辑器里还是旧内容时的手动出口。
           * 自动路径见 `fs.watch` 那段：**没有未保存修改**时会自己跟上；
           * 这里是"有手改、但我就想丢掉、以磁盘为准"的那一条路。
           */
          label: '从磁盘重新加载',
          onClick: () => {
            void reloadActiveFromDisk().then((changed) => {
              setToast(changed ? '已从磁盘重新加载' : '磁盘内容与编辑器一致，无需重载')
            })
          },
        },
        { label: '关闭当前笔记', hint: 'Ctrl+W', onClick: () => void closeNote() },
      )
    }

    // ── 设置 ──
    items.push({
      label: '设置',
      hint: 'Ctrl+,',
      divider: true,
      onClick: () => openOverlay('settings'),
    })

    // ── 侧栏：开关项 ──
    if (mainView === 'editor') {
      // 移动端侧栏是抽屉，"显示了没"由 sidebarOpen 决定（那边 sidebarVisible 恒为 true）
      const shown = isDesktop ? sidebarVisible : sidebarOpen
      items.push({
        label: shown ? '关闭笔记库栏' : '打开笔记库栏',
        onClick: () => {
          if (shown) {
            setSidebarVisible(false)
            setSidebarOpen(false)
          } else {
            // 窄屏下侧栏是抽屉，得同时置 open 才看得见；宽屏下 open 无副作用
            setSidebarVisible(true)
            setSidebarOpen(true)
          }
        },
      })
      // 侧栏底部的库名按钮是主入口；这条让右键侧栏空白区也能到同一个菜单
      items.push({
        label: '切换笔记库…',
        onClick: () => void openVaultMenu(clientX, clientY),
      })
    }

    setMainMenu({ x: clientX, y: clientY, items })
  }

  /**
   * 当前文档字数（不含空白）。
   * 数的是**纯文本**：先把 Markdown 标记剥掉再统计，否则「#」「**」「[](url)」这些
   * 也算进去，字数会虚高（用户要求：不统计 markdown 标记）。
   * 用正则而不是解析器 —— 状态栏只要"大致准"，不值得为此给内核加一个 Markdown 依赖。
   */
  const charCount = useMemo(() => {
    const plain = content
      // 围栏行（``` 与语言名）：只去掉围栏本身，代码内容仍算字
      .replace(/^[ \t]*```.*$/gm, '')
      // 行首标记：标题 #、引用 >、无序列表 - * +、有序列表 1.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
      .replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '')
      .replace(/^[ \t]{0,3}\d+\.[ \t]+/gm, '')
      // 分隔线整行（--- / *** / ___）
      .replace(/^[ \t]{0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/gm, '')
      // 图片 ![alt](url) → alt；链接 [text](url) → text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // 行内代码的反引号
      .replace(/`+/g, '')
      // 强调与删除线的标记符
      .replace(/(\*\*|__|~~|\*|_)/g, '')
      // 残留的 HTML 标签
      .replace(/<[^>]*>/g, '')
    return plain.replace(/\s/g, '').length
  }, [content])

  const activePanel = panels.find((p) => p.id === mainView) ?? null
  const statusPanels = panels.filter((p) => p.location === 'statusbar')
  /* 编辑器底部工具栏：内核自带的 Markdown 标记（**移动端才有**）在前，插件注册的同位置面板跟在后面 */
  const toolbarPanels = panels.filter((p) => p.location === 'editor-toolbar')
  /* 插件注册到编辑器顶部提示条的面板 —— 内核自己不往那儿放东西（见下方渲染处的说明） */
  const topbarPanels = panels.filter((p) => p.location === 'editor-topbar')
  /* 能在主区当页面渲染的面板：main 与 sidebar 都归主区
     （右侧栏已取消，sidebar 不再有独立载体；契约里 location 仍然有效，只是宿主换了承载方式） */
  const pagePanel =
    activePanel &&
    activePanel.location !== 'statusbar' &&
    activePanel.location !== 'modal' &&
    activePanel.location !== 'editor-toolbar' &&
    activePanel.location !== 'editor-topbar'
      ? activePanel
      : null
  const modalPanel = activePanel?.location === 'modal' ? activePanel : null
  /* 侧栏只在编辑器视图里出现 —— 插件管理 / 插件页面跟笔记无关，让主区占满更清爽 */
  /* 侧栏什么时候渲染：
      · 桌面 —— sidebarVisible（常驻，可手动收起）
      · 移动端 —— 只看抽屉开没开。
     用「是不是桌面」而不是媒体查询的宽度来判断：手机横屏、平板都会超过窄屏断点，
     那时 media query 就不准了（Android 上侧栏会突然变成常驻并占掉半个屏幕）。 */
  const showSidebar = mainView === 'editor' && (isDesktop ? sidebarVisible : sidebarOpen)

  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '已保存'
        : saveState === 'error'
          ? '保存失败'
          : dirty
            ? '未保存'
            : ''

  /* ── 窗口模式：只渲染那一个面板（插件已在上面那套 effect 里加载完） ──
     `winClosed` 只服务于 Android 那条"没有真窗口可关"的路径：关掉窗口 UI 后落回主界面，
     **不重载页面**（重载会把库退回默认库 —— 见 `winClosed` 的注释）。 */
  if (pluginWindowId && !winClosed) {
    const winPanel = panels.find((p) => p.id === pluginWindowId)
    return (
      <div className="zn-plugin-window">
        {/* 自绘标题条：拖动区 + 三键（最小化 / 最大化还原 / 关闭）。
            `data-tauri-drag-region` 不继承给子元素，所以标题文字单独标一次；按钮绝不标。
            关闭走 `destroy()` —— 点"关闭"就是明确的关，不必再走 close 的请求-应答流程
            （机制见下面那个极简 close 监听器的注释）。 */}
        <div className="zn-plugin-window-bar" data-tauri-drag-region>
          <span className="zn-plugin-window-title" data-tauri-drag-region>
            {winPanel?.title ?? pluginWindowId}
            {winPanel?.pluginId ? <span className="zn-plugin-window-src">{winPanel.pluginId}</span> : null}
          </span>
          <WindowControls
            onClose={() => {
              /**
               * ⚠️ **Android 上不能用 `destroy()`**（2026-10-14 用户实测「关闭按钮不起作用」）。
               *
               * 为什么：桌面端的"插件独立窗口"是**真窗口**（`WebviewWindow`），`destroy()` 关掉它天经地义；
               * 而 **Android 上没有多窗口这回事** —— 那个"导图窗口"其实是**同一个 webview 换成了
               * `?pluginWindow=<panelId>` 的 UI**（截图里它占满整屏、只有自绘标题条）
               * ⇒ `destroy()` 没有独立窗口可销毁，点了当然没反应。
               *
               * 所以 Android 上"关闭"的语义 = **回到主界面**。但**不能用 `location.replace()` 重载**：
               * rev80 真机实测它会让应用**退回默认库**（界面「0 篇」，数据其实没丢）
               * ⇒ 改成翻 `winClosed` 这一个 state，库 / 编辑器 / 插件全部原样留着。
               * 桌面保持 `destroy()`（关掉真窗口）。
               */
              if (platform === 'android') {
                /**
                 * **URL 也要清掉，但只能用 `history.replaceState`（它不加载页面）。**
                 * 为什么非清不可：`winClosed` 是内存状态，而 `pluginWindow` 还挂在 URL 上 ——
                 * 之后任何一次**整页重载**（刷新 / HMR 全量更新 / 系统回收后重建）都会重新读到它，
                 * 于是"已经关掉的窗口"复活（2026-10-14 真机实测：改一行 `src/**` 触发 HMR 全量重载，
                 * 屏幕又变回那个导图窗口）。清掉 URL ⇒ 重载后自然回主界面。
                 */
                const url = new URL(location.href)
                url.searchParams.delete('pluginWindow')
                history.replaceState(null, '', url.toString())
                /**
                 * 同时**释放整窗接管**（U2）：窗口里插件常把整个界面接管成自己的画布（导图就是），
                 * 而那本账记在**内核**里，不随"窗口 UI 不画了"一起消失 ⇒
                 * 不清的话主界面仍被它遮满，用户看到的是"点了 ✕ 什么都没变"
                 * （同日实测：只翻 state 时，关窗后屏幕上仍是导图，得再点一次右下角「释放接管」）。
                 * 这里用内核逃生口 `clearShell()` —— 它的语义正是"用户强关，接管一起下场"。
                 */
                kernel?.clearShell()
                setWinClosed(true)
                return
              }
              void getCurrentWindow().destroy()
            }}
          />
        </div>
        <div className="zn-plugin-window-body">
          {/* U2：窗口里同样允许接管 —— 但**标题条与关闭按钮保留**（否则窗口关不掉） */}
          {shellTakeover && shellCtx ? (
            <ShellMount spec={shellTakeover.spec} ctx={shellCtx} />
          ) : winPanel ? (
            <PanelBoundary key={winPanel.id}>
              {winPanel.webview ? (
                <WebViewFrame url={winPanel.webview.url} title={winPanel.title} />
              ) : (
                <UIRenderer
                  node={renderPanelSafe(winPanel, panelState)}
                  state={panelState}
                  onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                  onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
                />
              )}
            </PanelBoundary>
          ) : (
            <div className="zn-plugin-window-empty">
              面板 <code>{pluginWindowId}</code> 还没出现
              <p className="zn-plugin-window-hint">
                {pluginError
                  ? `插件加载报错：${pluginError}`
                  : '插件可能仍在加载；若一直这样，检查插件是否装在当前库里（.zn/plugins/）。'}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ── 整窗接管（U2 · rev51）：插件把内核 UI 整个请下场，自己画 ──
     两条内核侧的兜底：① 拖动区保留（主窗口 decorations:false，否则接管后窗口拖不动）
     ② 接管只靠插件自己的 UI 退出，或卸载插件 —— 卸载即复原（subscriptions 自动登记）。 */
  if (shellTakeover && shellCtx) {
    return (
      <div className="zn-app zn-shell-host">
        <div className="zn-titlebar-hotzone" data-tauri-drag-region />
        <ShellMount spec={shellTakeover.spec} ctx={shellCtx} />
        {/* 内核逃生口（可见那半）：接管把内核 UI 全挡住了，这颗小按钮是"回到内核"的入口。
            z-index 拉高 + 固定在右下角，插件在容器里怎么画都盖不住它（除非它故意改内核 DOM）。 */}
        <button
          type="button"
          className="zn-shell-escape"
          title="内核：释放该插件的整窗接管（快捷键 Ctrl+Alt+Z）"
          onClick={() => kernel?.clearShell()}
        >
          释放接管
        </button>
      </div>
    )
  }

  return (
    <div className="zn-app">
      {/* 顶部热区：标题栏隐藏时，鼠标碰到窗口最上面几像素即可唤出；
          它同时兼任拖动区 —— 标题栏藏起来时窗口也要拖得动。 */}
      <div className="zn-titlebar-hotzone" data-tauri-drag-region />
      <TitleBar
        title={titleText}
        saveLabel={saveLabel}
        saveError={saveState === 'error'}
        saveDirty={dirty}
        onMenu={setMenuAt}
        // 2026-10-18 用户要求：☰ = 文件树栏开关（桌面切常驻侧栏、移动端切抽屉）；
        // 桌面用右键 ☰ 弹菜单，移动端另给一个「⋯」菜单按钮（见 showMenuButton）。
        onToggleSidebar={() => (isDesktop ? setSidebarVisible((v) => !v) : setSidebarOpen((v) => !v))}
        showMenuButton={!isDesktop}
        showWindowControls={isDesktop}
        visible={titlebarVisible}
        onHoverChange={setTitlebarVisible}
      />

      <div
        className="zn-body"
        onContextMenuCapture={(e) => {
          // 侧栏与主区统一走自制右键菜单（原生那个"返回/刷新/检查"已被全局禁掉）。
          // 用 **Capture** 版是必需的：CodeMirror 会处理 contentDOM 上的 contextmenu，
          // 挂在冒泡阶段的话在编辑器正文里右键根本收不到。
          e.preventDefault()
          // 树项自带「重命名 / 删除」菜单，别抢它
          const el = e.target
          if (el instanceof HTMLElement && el.closest('.zn-tree-item')) return
          // 文件列表区域的**空白处**也归文件树 —— 它要在库根「新建文件 / 新建文件夹」。
          // 侧栏其余空白（头部、底部库名那行）仍走这个应用级菜单（切库入口在那儿）。
          if (el instanceof HTMLElement && el.closest('.zn-filetree')) return
          openMainMenu(e.clientX, e.clientY)
        }}
      >
      {showSidebar && (
        <AppSidebar
          vault={vault}
          notes={notes}
          dirs={dirs}
          activePath={activePath}
          open={sidebarOpen}
          width={sidebarWidth}
          layers={layerExitsRef}
          clipboard={clipboard}
          onOpen={(p) => {
            /* 文档（pdf/epub/…）**不能**走 `openNote`：它 `readText` 二进制，必然读成乱码/失败。
               走内核的派发点 `core.openDocument` —— 插件 bind 了它就能渲染，没插件则给出提示。 */
            const meta = notes.find((n) => n.path === p)
            if (meta?.kind === 'doc') runCore('core.openDocument', { path: p })
            else void openNote(p)
          }}
          onNewFile={newNoteIn}
          onNewDir={newDirIn}
          onRename={(from, to, isDir) => void renameNote(from, to, isDir)}
          onDeleteMany={(paths) => void deleteNotes(paths)}
          onPurgeMany={(paths) => void purgeNotes(paths)}
          onCut={cutPaths}
          onCopy={copyPaths}
          onPaste={(dir) => void pasteInto(dir)}
          onDuplicate={(path) => void duplicateEntry(path)}
          onOpenTrash={openTrash}
          onOpenVaultMenu={(x, y) => void openVaultMenu(x, y)}
          onOpenSettings={() => openOverlay('settings')}
        />
      )}

      {showSidebar && isDesktop && (
        /* 分隔线：拖它调左右占比（实现见 AppResizer，含 document 级事件与夹限） */
        <AppResizer width={sidebarWidth} onResize={setSidebarWidth} />
      )}

      <main className="zn-main">
        {mainView === 'trash' ? (
          <AppTrashView
            trash={trash}
            confirmEmpty={confirmEmpty}
            confirmPurge={confirmPurge}
            onEmpty={() => void emptyTrashAll()}
            onConfirmEmpty={() => setConfirmEmpty(true)}
            onRestore={(id) => void restoreTrashItem(id)}
            onPurge={(id) => void purgeTrashItem(id)}
            onConfirmPurge={(id) => setConfirmPurge(id)}
            onBack={() => setMainView('editor')}
            fmtSize={fmtSize}
          />
        ) : pagePanel || mainView === 'plugins' ? (
          /* 主区页面：插件管理 或 插件面板，顶部一条「返回编辑器」横条 */
          <div className="zn-main-panel">
            <div className="zn-main-panel-bar">
              <span>{pagePanel ? pagePanel.title : '插件管理'}</span>
              <div className="zn-main-panel-actions">
                {/* 「重新扫描」原本在插件面板的标题栏里，用户要求挪到这条顶栏上 */}
                {!pagePanel && (
                  <button
                    type="button"
                    className="zn-plain-btn"
                    onClick={() => setReloadToken((t) => t + 1)}
                    title="重新扫描插件目录"
                  >
                    重新扫描
                  </button>
                )}
                {/* 与编辑页那个「关闭」同款：纯净文字按钮 */}
                <button
                  type="button"
                  className="zn-plain-btn"
                  onClick={() => setMainView('editor')}
                  title="返回编辑器"
                >
                  返回编辑器
                </button>
              </div>
            </div>
            <div className="zn-main-panel-body">
              {pagePanel ? (
                <PanelBoundary key={pagePanel.id}>
                  {pagePanel.webview ? (
                    /* WebView 逃生口（契约 §2.2）：sandbox iframe + postMessage 送主题令牌 */
                    <WebViewFrame url={pagePanel.webview.url} title={pagePanel.title} />
                  ) : (
                    <UIRenderer
                      node={renderPanelSafe(pagePanel, panelState)}
                      state={panelState}
                      onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                      onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
                    />
                  )}
                </PanelBoundary>
              ) : (
                <PluginPanel
                  plugins={rows}
                  error={pluginError}
                  log={panelLog}
                  globalRoot={globalRoot}
                  onToggle={togglePlugin}
                  onDelete={(id) => void deletePlugin(id)}
                  onInstall={() => void installZnp()}
                />
              )}
            </div>
          </div>
        ) : activePath ? (
          <div className="zn-editor-wrap">
            {/*
              编辑器**顶部**面板（`location: 'editor-topbar'`）—— 只放**插件**注册的东西。
              内核自己**不往这儿放任何内容**（用户 2026-10-12 定：桌面端只有右键菜单的「标记」）。
              仍然是"没人注册就一个 DOM 都不渲染"。
            */}
            {topbarPanels.length > 0 && (
              <div className="zn-editor-topbar">
                {topbarPanels.map((p) => (
                  <PanelBoundary key={p.id}>
                    <UIRenderer
                      node={renderPanelSafe(p, panelState)}
                      state={panelState}
                      onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                      onStateChange={(bind, value) =>
                        setPanelState((s) => ({ ...s, [bind]: value }))
                      }
                    />
                  </PanelBoundary>
                ))}
              </div>
            )}
            <MarkdownEditor
              path={activePath}
              value={content}
              onChange={onEditorChange}
              onSave={() => void saveNow()}
              onReady={(v) => {
                editorRef.current = v
              }}
              replaceOpen={replaceOpen}
              onCloseReplace={() => setReplaceOpen(false)}
              onCommand={(id, payload) => void kernel?.commands.api.execute(id, payload)}
              onWikiLinkOpen={openWikiLink}
            />
            {/*
              编辑器底部工具栏 —— **内核那一条只有移动端有**（用户 2026-10-12 定：
              桌面端只留右键菜单的「标记」子菜单，移动端只留键盘正上方这条快捷栏）。
              手机上软键盘弹起时视口被压缩，这条正好落在**键盘正上方**
              （不是浮动定位，是布局的自然结果）。
              插件注册到 `location: 'editor-toolbar'` 的面板跟在后面一起横滑
              （沿用 renderPanelSafe + PanelBoundary，坏面板只坏自己那一格）。
            */}
            {platform === 'android' || toolbarPanels.length > 0 ? (
              <MarkToolbar
                marks={platform === 'android' ? MARK_COMMANDS : []}
                onRun={(id) => void kernel?.commands.api.execute(id)}
              >
                {toolbarPanels.map((p) => (
                  <PanelBoundary key={p.id}>
                    <UIRenderer
                      node={renderPanelSafe(p, panelState)}
                      state={panelState}
                      onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                      onStateChange={(bind, value) =>
                        setPanelState((s) => ({ ...s, [bind]: value }))
                      }
                    />
                  </PanelBoundary>
                ))}
              </MarkToolbar>
            ) : null}
            {/* 「关闭这篇笔记」属于编辑页面，就放在编辑页面里 ——
                不放标题栏，免得跟窗口那个 × 挨着分不清 */}
            <button
              type="button"
              className="zn-editor-close"
              onClick={() => void closeNote()}
              title="关闭这篇笔记（Ctrl+W）"
              aria-label="关闭当前笔记"
            >
              关闭
            </button>
          </div>
        ) : (
          /* 空态：按 NN/g「空态三原则」组织 ——
             ① 说清当前状态（是"还没打开"，不是"加载中"）
             ② 给学习线索（快捷键就地教学）
             ③ 给一个真正能点的开始动作
             分三种情况，不用同一句话糊弄「有库但没打开」的场景。 */
          <AppEmptyState
            vault={vault}
            notes={notes}
            onPickVault={() => void pickVault()}
            onNewNote={() => runCore('core.newNote')}
          />
        )}

        <AppStatusBar
          notes={notes}
          statusPanels={statusPanels}
          panelState={panelState}
          error={error}
          activePath={activePath}
          charCount={charCount}
          onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
          onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
        />
      </main>
      </div>

      {sidebarOpen && (
        <div className="zn-scrim" onClick={() => setSidebarOpen(false)} />
      )}

      {/* 左上角菜单栏（记事本式 ☰，点击位置就地弹出） */}
      {mainMenu && (
        <ContextMenu
          x={mainMenu.x}
          y={mainMenu.y}
          items={mainMenu.items}
          onClose={() => setMainMenu(null)}
        />
      )}

      {/* 侧栏底部库名（或侧栏右键的「切换笔记库…」）→ 最近打开过的库 + 打开其它文件夹… */}
      {vaultMenu && (
        <ContextMenu
          x={vaultMenu.x}
          y={vaultMenu.y}
          items={vaultMenu.items}
          onClose={() => setVaultMenu(null)}
        />
      )}

      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          onClose={() => setMenuAt(null)}
          items={menuItems}
        />
      )}

      {/* location: 'modal' 的面板以弹窗呈现（复用设置页同一个 Dialog 原语） */}
      <Dialog
        open={!!modalPanel}
        onOpenChange={(next) => {
          if (!next) setMainView('editor')
        }}
        width={520}
      >
        <DialogHeader title={modalPanel?.title ?? ''} />
        <DialogBody>
          {modalPanel && (
            modalPanel.webview ? (
              <WebViewFrame url={modalPanel.webview.url} title={modalPanel.title} />
            ) : (
              <UIRenderer
                node={renderPanelSafe(modalPanel, panelState)}
                state={panelState}
                onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
              />
            )
          )}
        </DialogBody>
      </Dialog>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={kernel ? kernel.commands.api.list() : []}
        recent={recentCmds}
        onRun={(id) => {
          rememberCommand(id)
          void kernel?.commands.api.execute(id)
        }}
      />

      {/* 条件渲染：关掉即卸载，query/cursor 天然清零（见 QuickSwitcher 的注释） */}
      {switcherOpen && (
        <QuickSwitcher
          notes={notes}
          onClose={() => setSwitcherOpen(false)}
          onOpenNote={(p) => void openNote(p)}
          onCreateNote={(n) => runCore('core.newNote', { name: n })}
        />
      )}

      <Settings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        vault={vault}
        apiVersion={kernel?.host.apiVersion}
        appVersion={kernel?.host.appVersion}
        platform={kernel?.host.platform}
        onPickVault={() => void pickVault()}
        themePref={themePref}
        onThemeChange={setThemePref}
        plugins={rows}
        pluginError={pluginError}
        pluginLog={panelLog}
        onTogglePlugin={togglePlugin}
        onDeletePlugin={(id) => void deletePlugin(id)}
        onReloadPlugins={() => setReloadToken((t) => t + 1)}
        declaredNet={declNetPlugins}
      />

      {/* 移动端的「笔记库」面板：手机没有目录选择器，改用应用内多库 */}
      {platform === 'android' && (
        <VaultPanel
          open={vaultPanelOpen}
          onOpenChange={setVaultPanelOpen}
          root={ANDROID_VAULT}
          current={vault ?? ANDROID_VAULT}
          onPick={(p) => void applyVault(p)}
        />
      )}

      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenNote={(p) => void openNote(p)}
        index={kernel?.index ?? null}
        notes={notes}
      />

      {undoDelete ? (
        <div className="zn-undo" role="status">
          <span>{undoDelete.length > 1 ? `${undoDelete.length} 篇已移入回收站` : '已移入回收站'}</span>
          <button type="button" className="zn-undo-btn" onClick={() => void undoDeleteNote()}>
            撤销
          </button>
        </div>
      ) : toast ? (
        <div className="zn-toast" onClick={() => setToast(null)} role="status">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
