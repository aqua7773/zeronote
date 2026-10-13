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
import {
  deletePluginDir,
  listPluginDirs,
  loadPlugin,
  platformOf,
  PlatformMismatch,
  readManifest,
  supportsPlatform,
  unloadPlugin,
  type LoadedPlugin,
  type PluginHostDeps,
} from './kernel/plugin-host'
import type {
  DocApi,
  DocEvent,
  NoteDoc,
  NoteMeta,
  PluginManifest,
  ShellMountCtx,
  TrashEntry,
} from './kernel/contract'
/* 2026-10-13 拆权限门：`./kernel/permissions` 的四个导入（isGranted / readPermissions /
 * setPermission / PermissionTable）**已全部移除** —— 内核不再做权限判定。
 * 同日清尾：`src/kernel/permissions.ts` 整个文件与 Rust 的 `read_permissions` /
 * `set_permission` 两条命令**已整体删除**（见 `docs/架构原则-2026-10-13.md` §6.1）。 */
import { FileTree } from './components/FileTree'
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
import {
  applyTheme,
  loadThemePref,
  saveThemePref,
  watchSystemTheme,
  type ThemePref,
} from './lib/theme'
import { setStatusBarVisible } from './lib/systemBar'
import { looksLikeStoragePermissionError, requestAllFilesAccess } from './lib/androidPerm'
import { mergeLines } from './lib/merge3'
import { renderPanelSafe } from './kernel/panel-safe'
import { bindCommandKeybindings, keyLabel } from './kernel/keybindings'
import { MARK_COMMANDS, registerMarkdownMarks } from './kernel/markdown-marks'
import { SearchPanel } from './components/SearchPanel'
import { WebViewFrame } from './components/WebViewFrame'
import { QuickSwitcher } from './components/QuickSwitcher'
import {
  Button,
  ContextMenu,
  Dialog,
  DialogBody,
  DialogHeader,
  type MenuItem,
} from '@/components/ui'

const LS_VAULT = 'zeronote.vault'
const LS_DISABLED = 'zeronote.plugins.disabled'
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
/** 命令面板的「最近使用」——持久化，重启后依然置顶（上限 8 条） */
const LS_RECENT_CMDS = 'zeronote.commands.recent'
const RECENT_CMDS_MAX = 8
/** 最近打开过的库（侧栏底部的「切换笔记库」菜单用；上限 8 条，最近在前） */
const LS_RECENT_VAULTS = 'zeronote.vaults.recent'
const RECENT_VAULTS_MAX = 8

/**
 * 库路径的去重口径：Windows 下大小写与斜杠方向都不敏感，
 * 同一个库写成 `C:\a\b` 和 `c:/a/b/` 得算同一条。
 */
function vaultKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 路径最后一段（库目录名）；末位斜杠先吃掉 */
function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

function loadRecentVaults(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_RECENT_VAULTS) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_VAULTS_MAX)
  } catch {
    return []
  }
}

/** 写回「最近打开过的库」（配额不足 / 隐私模式下写不进也不影响调用方） */
function persistRecentVaults(list: string[]): void {
  try {
    localStorage.setItem(LS_RECENT_VAULTS, JSON.stringify(list))
  } catch {
    /* 存不下就算了 —— 本次照常展示，只是重启后可能回到旧值 */
  }
}

/**
 * 库目录是否**仍然存在**（Rust 侧只读探测，什么都不建）。
 *
 * 失败时保守返回 `true`：宁可留着一条过期记录，也不要误删用户的库记录
 * —— 老内核没有这条命令、浏览器预览里也没有。
 */
async function vaultExists(dir: string): Promise<boolean> {
  try {
    return await invoke<boolean>('vault_exists', { vault: dir })
  } catch {
    return true
  }
}

function loadRecentCommands(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_RECENT_CMDS) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_CMDS_MAX)
  } catch {
    return []
  }
}

/**
 * 把底层异常翻译成用户能懂的话。
 *
 * 依据 NN/g Error-Message Guidelines：说清**具体出了什么问题**、给出**可执行的补救**，
 * 不罗列错误码、不指责用户、不过早报错。原始异常仍附在末尾括号里 ——
 * 排查时有用，但不占主位。
 */
type FailKind = 'read' | 'write' | 'create' | 'rename' | 'delete' | 'list' | 'vault'

const FAIL_BASE: Record<FailKind, string> = {
  read: '无法打开这篇笔记',
  write: '保存失败',
  create: '新建笔记失败',
  rename: '重命名失败',
  delete: '删除失败',
  list: '读取笔记库失败',
  vault: '这个文件夹无法作为笔记库',
}

const FAIL_HINT: Record<FailKind, string> = {
  read: '文件可能已被移动或删除，可点「重新扫描」。',
  write: '磁盘可能已满或文件被占用；内容仍在编辑器里，稍后重试即可。',
  create: '请确认笔记库可写。',
  rename: '请检查是否与现有文件重名。',
  delete: '文件可能正被其他程序占用。',
  list: '笔记库可能已被移动或删除，可重新选择一个文件夹。',
  vault: '请确认该文件夹有读写权限。',
}

function failMsg(kind: FailKind, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  // 重名走同一句人话（重命名与新建都可能撞名）
  if ((kind === 'rename' || kind === 'create') && /exists|已?存在/i.test(raw)) {
    return '已存在同名笔记。'
  }
  /**
   * **缺「所有文件访问」权限**必须说清"怎么办"（rev64）。
   *
   * 原来只是干巴巴一句 `Permission denied (os error 13)`：用户既不知道是哪个权限、
   * 也不知道去哪开 —— 它是 Android 的特殊权限、**系统不弹窗申请**，猜是猜不到的。
   * 这里补上唯一可操作的那一步（命令面板入口已随 rev64 加进内核）。
   */
  if (looksLikeStoragePermissionError(raw)) {
    return '没有「所有文件访问」权限，读不到库里的文件。到 ☰ → 命令面板运行「请求『所有文件访问』权限」，在系统页面允许后再重新扫描插件。'
  }
  return `${FAIL_BASE[kind]}：${FAIL_HINT[kind]}（${raw}）`
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/* ── 文件关联（双击 .md / 「打开方式」递进来的路径）小工具 ── */

/** 只认 `.md` / `.markdown`（与 Rust 侧 `is_markdown` 同一口径） */
const MD_RE = /\.(md|markdown)$/i

/**
 * `file:///C:/a/b.md` → 本地路径。
 *
 * Rust 侧其实已经转过一道（`url_to_path`），这里是**第二道保险** ——
 * 系统递进来的 URI 形态随平台而变，前端不该假设它一定是干净的路径。
 * 非 file scheme（`content://…`）原样返回，交给调用方给出说明。
 */
function toLocalPath(raw: string): string {
  const s = raw.trim()
  if (!/^file:\/\//i.test(s)) return s
  let p = s.slice('file://'.length)
  try {
    p = decodeURIComponent(p)
  } catch {
    /* 含裸 `%` 的路径解不开就用原文 —— 总比抛异常强 */
  }
  // file:///C:/x ⇒ /C:/x；Windows 上得去掉盘符前那条斜杠
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  return p
}

/** 拆出父目录与文件名（两种分隔符都认：Android 是 POSIX 路径，桌面是 Windows 路径） */
function splitPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

/** 路径比较：统一分隔符、去尾斜杠、忽略大小写（Windows 不区分大小写；放宽比较在其它平台无害） */
function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * 若 `path` 落在库 `vault` 之内，返回**库内相对路径**（`/` 分隔）；否则 `null`。
 * 返回 `null` 的两种情况：不在库里，或它本身就是库目录。
 */
function relPathIn(vault: string, path: string): string | null {
  const v = vault.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = path.replace(/\\/g, '/')
  if (!v) return null
  const prefix = `${v.toLowerCase()}/`
  if (p.toLowerCase() === v.toLowerCase() || !p.toLowerCase().startsWith(prefix)) return null
  return p.slice(prefix.length) || null
}

/* ── 卡死兜底 C 段：启动自愈 ──
 *
 * `LS_LOADING` 是"即将加载某个插件"时落下的标记（见插件加载循环里那两行）：
 * 正常路径（加载成功 / 加载失败 / 正常关窗）都会清掉它。所以**启动时还能读到它**，
 * 只可能是**上一次进程在加载那个插件时死掉了** —— 主线程被占死（看门狗杀的），
 * 或用户/系统强杀（这两种情况分不出来，所以一律按前者处置）。
 *
 * 处置：并入禁用集合 —— **宁可少加载一个插件，也不要一开就再卡一次**。
 * 代价是"强杀应用"也会误伤一个插件，所以必须 **可见 + 可一键恢复 + 有日志**
 *（不许静默：静默失效比报错危险）。
 *
 * ⚠️ 为什么放在**模块级**而不是组件里：`toast` 的 `useState` 在 `disabled` 之前，
 * 组件里跑就没法同时喂给两个初值；模块级只在加载时跑一次，顺序与次数都确定
 *（本仓库已移除 StrictMode，不存在双跑）。
 */
const LS_LOADING = 'zeronote.plugins.loading'
/** 启动自愈认出的插件（`loadDisabled()` 与插件页共用） */
const bootAutoDisabled = new Set<string>()
/** 给用户看的那句话（`toast` 初值直接用） */
let bootAutoDisabledNotice: string | null = null

function bootSelfHeal() {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LS_LOADING)
  } catch {
    return
  }
  if (!raw) return
  try {
    localStorage.removeItem(LS_LOADING) // 用过即清：下次启动不再重复判定
  } catch {
    /* 清不掉也不影响本次判定 */
  }
  try {
    const id = (JSON.parse(raw) as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) return
    bootAutoDisabled.add(id)
    bootAutoDisabledNotice = `上次加载「${id}」时卡死，已自动禁用它（可在「插件管理」里重新启用）`
  } catch {
    /* 标记坏了就当没有 —— 不能因为一条坏标记卡住启动 */
  }
}
bootSelfHeal()

function loadDisabled(): Set<string> {
  let set: Set<string>
  try {
    set = new Set<string>(JSON.parse(localStorage.getItem(LS_DISABLED) ?? '[]'))
  } catch {
    set = new Set()
  }
  // C 段：把启动自愈认出的插件并进去，**并落盘** —— 否则用户下次刷新它又被加载（又卡一次）
  if (bootAutoDisabled.size) {
    for (const id of bootAutoDisabled) set.add(id)
    try {
      localStorage.setItem(LS_DISABLED, JSON.stringify([...set]))
    } catch {
      /* 写不进去就只在本次会话生效（总比再卡一次好） */
    }
  }
  return set
}

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
  const [undoDelete, setUndoDelete] = useState<{ path: string; trash: string }[] | null>(null)

  /* ── 插件 ── */
  const [manifests, setManifests] = useState<PluginManifest[]>([])
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

  /* ── doc 事件广播（U3b）── */
  /**
   * 把文档事件广播给所有订阅者。
   *
   * **为什么显式传 path/content/dirty 而不是读 ref**：四个 fire 点里有三个（`open`/`save`/`change`）
   * 都发生在 `setContent` / `setActivePath` **之后**，而 `contentRef` / `activeRef` 是在
   * `useEffect` 里同步的 —— 那一刻 ref 还停在**旧值**。读 ref 会广播出"上一秒的文档"，
   * 这种错法不报错、极难查（正是 U3 这次要修的那类静默失效）。所以快照由调用方显式给出。
   *
   * 单个订阅者抛错**不影响**其它订阅者，也不会把编辑动作带崩：逐个 try/catch 后 `console.error`。
   */
  const fireDoc = useCallback(
    (ev: DocEvent, path: string | null, content: string, dirty: boolean) => {
      const subs = docSubsRef.current.get(ev)
      if (!subs || subs.size === 0 || !path) return
      const d: NoteDoc = { path, content, frontmatter: {}, dirty }
      for (const cb of [...subs]) {
        try {
          cb(d)
        } catch (e) {
          console.error(`[doc.on:${ev}] 插件回调抛错（已隔离）`, e)
        }
      }
    },
    [],
  )

  /**
   * 兑现去抖窗口里挂起的 `change`（切笔记 / 关笔记前调用）。
   *
   * 不兑现的话会**乱序**：`change(old)` 落在 `open(new)` 之后才广播，插件会拿旧内容去改新文档。
   * 所以切走之前先把"这篇笔记的最后状态"播出去，再播 `open` / `close`。
   */
  const flushDocChange = useCallback(() => {
    if (docChangeTimerRef.current !== null) {
      window.clearTimeout(docChangeTimerRef.current)
      docChangeTimerRef.current = null
    }
    const pending = docPendingRef.current
    docPendingRef.current = null
    if (pending) fireDoc('change', pending.path, pending.content, true)
  }, [fireDoc])

  /* ── doc 原语：React 状态 + CM6 实例 → 契约形状 ── */
  const docApi: DocApi = useMemo(
    () => ({
      active: () =>
        activeRef.current
          ? {
              path: activeRef.current,
              content: contentRef.current,
              frontmatter: {},
              dirty: dirtyRef.current,
            }
          : null,
      open: (p) => openNoteRef.current(p),
      close: () => {
        // 与 closeNote 同一套语义：快照必须**在清空之前**取，否则订阅者拿到的是空文档
        const p = activeRef.current
        const c = contentRef.current
        flushDocChange()
        setActivePath(null)
        setContent('')
        baseRef.current = '' // 关掉了：没有"与磁盘一致的那份"可言
        setDirty(false)
        fireDoc('close', p, c, false)
      },
      save: () => saveNowRef.current(),
      selection: () => {
        const v = editorRef.current
        if (!v) return null
        const { from, to } = v.state.selection.main
        return { from, to, text: v.state.sliceDoc(from, to) }
      },
      replaceSelection: (text) => {
        const v = editorRef.current
        if (!v) return
        const { from, to } = v.state.selection.main
        v.dispatch({ changes: { from, to, insert: text } })
        v.focus()
      },
      insertAtCursor: (text) => {
        const v = editorRef.current
        if (!v) return
        const pos = v.state.selection.main.head
        v.dispatch({
          changes: { from: pos, insert: text },
          selection: { anchor: pos + text.length },
        })
        v.focus()
      },
      /**
       * 按**偏移**插入 —— 行首标记（`# ` 标题）与成对标记（`**粗体**` 光标落中间）都靠它。
       * 偏移一律夹进 `[0, doc.length]`：插件自己算行首时偶尔会差一两个字符（比如文档刚被改过），
       * 那种情况该"尽力插进去"，而不是抛错把整条命令打断。
       */
      insertAt: (pos, text, cursorOffset) => {
        const v = editorRef.current
        if (!v) return
        const len = v.state.doc.length
        const at = Math.min(Math.max(pos, 0), len)
        const caret = at + Math.min(Math.max(cursorOffset ?? text.length, 0), text.length)
        v.dispatch({
          changes: { from: at, insert: text },
          selection: { anchor: caret },
        })
        v.focus()
      },
      /**
       * 按**区间**替换 —— 结构化编辑（导图 ⇄ 大纲双向回写、表格单元格、任务勾选）靠它。
       * `from` / `to` 顺序颠倒自动交换；两端夹进 `[0, doc.length]`；`text === ''` 即删除该区间。
       * 与 `insertAt` 同一套"尽力而为、不抛错"策略：插件算出的偏移差一两个字符时，
       * 该把改动落下去，而不是抛错把整条命令打断。
       */
      replaceRange: (from, to, text, cursorOffset) => {
        const v = editorRef.current
        if (!v) return
        const len = v.state.doc.length
        const a = Math.min(Math.max(Math.min(from, to), 0), len)
        const b = Math.min(Math.max(Math.max(from, to), 0), len)
        const caret = a + Math.min(Math.max(cursorOffset ?? text.length, 0), text.length)
        v.dispatch({
          changes: { from: a, to: b, insert: text },
          selection: { anchor: caret },
        })
        v.focus()
      },
      /**
       * 订阅文档事件（U3b —— 此前这里返回的是永远不触发的空桩）。
       * 注册进 `docSubsRef`；`dispose` 幂等，集合空了就把 key 删掉（不给长会话留泄漏）。
       */
      on: (ev, cb) => {
        let set = docSubsRef.current.get(ev)
        if (!set) {
          set = new Set()
          docSubsRef.current.set(ev, set)
        }
        set.add(cb)
        const owner = set
        return {
          dispose: () => {
            owner.delete(cb)
            if (owner.size === 0) docSubsRef.current.delete(ev)
          },
        }
      },
    }),
    /**
     * `fireDoc` / `flushDocChange` 都是 `useCallback` 的稳定引用（依赖链只到 ref），
     * 进依赖数组**不会**导致 docApi 重建、更不会连带重建 kernel。
     * 但还是必须写全：漏依赖 = "docApi 里读到上一代的 fire"，这类错法不报错、极难查
     * （正是本轮 U3 要修的那类静默失效）。oxlint 的 exhaustive-deps 也会拦。
     */
    [fireDoc, flushDocChange],
  )

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
    const w = window as unknown as { __znKernelAudit?: () => KernelAudit }
    w.__znKernelAudit = () => kernel.audit()
    return () => {
      delete w.__znKernelAudit
    }
  }, [kernel])

  /* ── 文件树 ── */
  const refresh = useCallback(async () => {
    if (!kernel) return
    try {
      const [list, dirList] = await Promise.all([
        kernel.fs.listNotes(),
        kernel.fs.listDirs(),
      ])
      setNotes(list)
      setDirs(dirList)
      setError(null)
    } catch (e) {
      setError(failMsg('list', e))
    }
  }, [kernel])

  /**
   * 从磁盘重新加载当前笔记 —— **"实时跟上"的那一半**。
   *
   * 背景（用户 2026-10-13 报）：导图/插件是直接 `fs.writeText` 写盘的，而编辑器持有的是
   * **内存里的文档** ⇒「导图改了、笔记里还是旧的，得关掉再开」。这里补上回灌：
   * 磁盘变了就重读、整篇替换（`MarkdownEditor` 的 `value` 同步 effect 会落到 CM6）。
   *
   * 两道保护：
   *  · `text === contentRef.current`（内容没变 —— 包含"自己刚保存完触发的 watch"）⇒ 什么都不做；
   *  · **自动路径**只在编辑器没有未保存修改时才调（`fs.watch` 那段）；
   *    有手改就不覆盖，留给用户走右键「从磁盘重新加载」。
   */
  /**
   * 把磁盘与编辑器**合并**（三方：`baseRef` / 编辑器内存 / 磁盘）。
   *
   * 这是 rev62「自动合并」的核心。为什么必须三方、而不是二选一：
   * 导图写盘与用户手改**各自改的可能不是同一块地方** —— 整篇覆盖任一方都会丢内容。
   * 规则与冲突策略见 `lib/merge3.ts`（冲突 ⇒ 保留编辑器那份：**手写优先**）。
   *
   * `applied` = 磁盘确实被外部改过、且已经算过合并；`merged` 是合并结果
   * （**可能等于 `contentRef.current`** —— 那表示外部改动全落在冲突区、被放弃了）。
   */
  const mergeWithDisk = useCallback(async () => {
    const k = kernel
    const path = activeRef.current
    if (!k || !path) return { ok: false as const }
    let theirs: string
    try {
      theirs = await k.fs.readText(path)
    } catch {
      return { ok: false as const }
    }
    const base = baseRef.current
    const mine = contentRef.current
    if (theirs === base) return { ok: true as const, applied: false as const } // 磁盘没动，不用合并
    if (theirs === mine) {
      baseRef.current = theirs // 磁盘和我们完全一样：把 base 对齐上去就好
      return { ok: true as const, applied: false as const }
    }
    const r = mergeLines(base, mine, theirs)
    // 诊断出口（CDP）：每次**真合并**留一条 —— 冲突几处、各方多长，界面上看不出来
    const w = window as unknown as { __znMergeLog?: unknown[] }
    const log = (w.__znMergeLog ??= [])
    log.push({
      at: new Date().toISOString().slice(11, 23),
      base: base.length,
      mine: mine.length,
      theirs: theirs.length,
      conflicts: r.conflicts,
    })
    if (log.length > 12) log.shift()
    return { ok: true as const, applied: true as const, merged: r.text, conflicts: r.conflicts }
  }, [kernel])

  /**
   * 有手改时被 `fs.watch` 叫起来：**把外部改动合进编辑器**，而不是覆盖。
   *
   * 合完仍是"脏"的（结果还没落盘），那一步交给 800ms 的自动保存 ——
   * 而 `saveNow` **在写盘前还会再合并一次**（真正的防线在那边，watch 只是让画面早点跟上）。
   */
  const mergeIntoEditor = useCallback(async () => {
    const m = await mergeWithDisk()
    if (!m.ok || !m.applied) return
    if (m.conflicts) setToast(`已自动合并磁盘上的改动（${m.conflicts} 处冲突保留了你这边）`)
    if (m.merged !== undefined && m.merged !== contentRef.current) {
      externalReloadRef.current = true
      setContent(m.merged)
      setDirty(true) // 合并结果还没落盘
      setSaveState('idle')
    }
  }, [mergeWithDisk, setToast])

  const reloadActiveFromDisk = useCallback(async () => {
    const k = kernel
    const path = activeRef.current
    /**
     * 诊断出口（CDP / 排查"为什么不刷新"）：最近 12 次尝试与结果。
     * 起因：「磁盘变了但界面没动」这种静默失效只能靠读数定位 —— 是 watch 没来、
     * 内容被判成一样、还是读了盘失败，三种原因从界面上一模一样。
     */
    const trace = (why: string) => {
      const w = window as unknown as { __znReloadLog?: unknown[] }
      const log = (w.__znReloadLog ??= [])
      log.push({ at: new Date().toISOString().slice(11, 23), why, path })
      if (log.length > 12) log.shift()
    }
    if (!k || !path) return false
    let text: string
    try {
      text = await k.fs.readText(path)
    } catch {
      trace('read-fail')
      return false // 文件被删/读不了：**不动编辑器**（免得把用户的文档清空）
    }
    if (text === contentRef.current) {
      trace('same')
      return false
    }
    trace('reloaded')
    baseRef.current = text // 整篇替换过 ⇒ 内存与磁盘又一致了
    externalReloadRef.current = true // 接下来那次 onChange 是本次替换的副产物，不算用户编辑
    setContent(text)
    setDirty(false)
    setSaveState('idle')
    setError(null)
    // 广播 open：插件（大纲 / 导图）跟着重读，否则它们手里还是旧内容
    fireDoc('open', path, text, false)
    return true
  }, [kernel, fireDoc])

  useEffect(() => {
    if (!kernel) return
    void refresh()
    const sub = kernel.fs.watch(() => {
      void refresh()
      /**
       * 磁盘变了，分两条路（rev61 / rev62）：
       *   · **没有未保存手改** ⇒ 整篇跟上（"导图写回 → 笔记立刻可见"的主路径）；
       *   · **有手改** ⇒ 走三方合并，把外部改动**并进来**，而不是覆盖（用户在打字，手写优先）。
       *
       * ⚠️ watch 只是"让画面早点跟上"；**真正的防线在 `saveNow`** 里写盘前那次合并 ——
       * 实测 watch 会迟到好几秒，那时 800ms 的自动保存早就把插件写的内容盖掉了。
       */
      if (dirtyRef.current) void mergeIntoEditor()
      else void reloadActiveFromDisk()
    })
    return () => sub.dispose()
  }, [kernel, refresh, reloadActiveFromDisk, mergeIntoEditor])

  /* ── 保存：原子写，失败绝不显示「已保存」── */
  const saveNow = useCallback(async () => {
    const k = kernel
    const path = activeRef.current
    if (!k || !path) return
    setSaveState('saving')
    try {
      /**
       * **写盘之前先合并** —— 自动合并真正生效的地方。
       *
       * 不能只靠 `fs.watch`：实测它会迟到好几秒，而这里 800ms 就落盘，
       * 那一下会把插件刚写进磁盘的内容**整篇盖掉**（这正是"改了没回传"的另一面：
       * 反过来也会发生 —— 用户的自动保存把导图的改动抹了）。
       * 合并之后写的是"两边改动都在"的那一份，磁盘与内存重新一致。
       */
      const m = await mergeWithDisk()
      let text = contentRef.current
      if (m.ok && m.applied && m.merged !== undefined) {
        text = m.merged
        if (m.conflicts) setToast(`保存前已与磁盘合并（${m.conflicts} 处冲突保留了你这边）`)
        if (text !== contentRef.current) {
          externalReloadRef.current = true
          setContent(text)
        }
      }
      await k.fs.writeText(path, text)
      baseRef.current = text
      setDirty(false)
      setSaveState('saved')
      setError(null)
      // 落盘成功才广播 —— 失败时插件不该以为内容安全了（与"失败绝不显示已保存"同一原则）
      fireDoc('save', path, text, false)
    } catch (e) {
      setSaveState('error')
      setError(failMsg('write', e))
    }
  }, [kernel, fireDoc, mergeWithDisk, setToast])
  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

  /**
   * 兜底 flush 之一：**失焦 / 页面隐藏**立即落盘。
   *
   * 除了「停止输入 800ms」自动保存之外再补这两道 —— 对应 VS Code 的
   * onFocusChange / onWindowChange 语义：自动保存产品最怕「已经切走了还没写盘」。
   */
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void saveNowRef.current()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('blur', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  /**
   * 兜底 flush 之二：**关窗前**先落盘再放行。
   *
   * 有个未保存内容就拦一次关闭：写盘完成后调 `close()`，第二次进来直接放行
   * （`closingRef` 做闸门），避免死循环；也不用申请 `window:allow-destroy` 权限。
   */
  const closingRef = useRef(false)
  useEffect(() => {
    /**
     * 插件独立窗口**跳过这层"关窗前落盘"**：它不承载编辑器、没有未保存内容要兜底。
     *
     * ⚠️ 但**不能因此让插件窗口一个 close 监听器都没有**（rev53 更正）——
     * `Window.close()` 只发 `tauri://close-requested` 事件，**真正销毁窗口的是监听器里的
     * `destroy()`**（`@tauri-apps/api` 的 `onCloseRequested` 在未 preventDefault 时就是这么做的）。
     * 一个监听器都没有 ⇒ 没人调 destroy ⇒ `close()` 返回 ok 但窗口不关。
     * 窗口模式因此**另注册一个极简监听器**（见下面那个 effect）。
     */
    if (pluginWindowId) return
    let unlisten: (() => void) | null = null
    let disposed = false
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const fn = await win.onCloseRequested(async (e) => {
          // 卡死兜底 C 段：正常关窗 ⇒ 清掉"正在加载"标记。
          // 否则"加载途中用户自己关窗"会留下标记，下次启动就被误判成卡死（白误伤一个插件）。
          try {
            localStorage.removeItem(LS_LOADING)
          } catch {
            /* 无所谓 */
          }
          if (closingRef.current || !dirtyRef.current) return // 放行
          e.preventDefault()
          try {
            await saveNowRef.current()
          } finally {
            closingRef.current = true
            await win.close()
          }
        })
        if (disposed) fn()
        else unlisten = fn
      } catch {
        /* 非 Tauri 环境（浏览器预览）没有这个 API —— 忽略即可 */
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [pluginWindowId])

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

  const openNote = useCallback(
    async (path: string) => {
      const k = kernel
      if (!k || path === activeRef.current) return
      flushDocChange() // 上一篇挂起的 change 先兑现，别让它落在 open(new) 之后（会乱序）
      if (dirtyRef.current) await saveNowRef.current()
      try {
        const text = await k.fs.readText(path)
        baseRef.current = text // 三方合并的 BASE = 刚读到的这份
        setContent(text)
        setActivePath(path)
        setDirty(false)
        setSaveState('idle')
        setError(null)
        setSidebarOpen(false) // 窄屏：选完笔记自动收抽屉
        fireDoc('open', path, text, false)
      } catch (e) {
        setError(failMsg('read', e))
      }
    },
    [kernel, fireDoc, flushDocChange],
  )
  useEffect(() => {
    openNoteRef.current = openNote
  }, [openNote])

  /**
   * 关闭当前笔记，回到「未打开」的空态。
   * 有未保存内容先落盘（与切笔记、切库同一套语义）。
   * 此前**完全没有这个动作** —— 库里只有一篇笔记时，文件树点它还是它，等于出不去。
   */
  const closeNote = useCallback(async () => {
    if (dirtyRef.current) await saveNowRef.current()
    // 顺序：兑现挂起的 change → 取快照（清空之前！）→ 清空 → 广播 close
    flushDocChange()
    const p = activeRef.current
    const c = contentRef.current
    setActivePath(null)
    setContent('')
    baseRef.current = '' // 关掉了：没有"与磁盘一致的那份"可言
    setDirty(false)
    setSaveState('idle')
    setError(null)
    fireDoc('close', p, c, false)
  }, [fireDoc, flushDocChange])

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

  /**
   * 「打开一个外部文件」—— 三条入口共用：Windows 的命令行参数 / 单实例转发、
   * Android 的「打开方式」（Rust 侧 `RunEvent::Opened` → `zn:open-file`）、
   * 以及 ☰ 菜单的「打开文件…」。
   *
   * **方案 A（已定）**：内核 `resolve()` 只接受**库内相对路径**（目前唯一真正落地的安全裁剪），
   * 所以库外的文件不直接读，而是**把它的父目录当成库打开**（复用 `applyVault`），
   * 切库完成后再打开那个文件（见下面的「待打开」effect）。
   * 已经在当前库内的，直接开、不切库。
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
      // 非 markdown **静默忽略**（与 Rust 侧同一口径，不弹错）
      if (!MD_RE.test(path)) return
      if (/^content:\/\//i.test(path)) {
        // Android SAF：这是**内容 URI**，`std::fs` 读不了（本项目 `host.saveFile` 踩过同一个坑）。
        // 如实说清，而不是假装打开了一个不存在的文件。
        setToast('系统递进来的是 SAF 内容 URI（content://…），当前版本读不了它；请在应用内打开笔记库。')
        return
      }
      const cur = vaultRef.current
      const rel = cur ? relPathIn(cur, path) : null
      if (rel) {
        // 已在当前库内 ⇒ 直接开这篇，不必切库
        await openNoteRef.current(rel)
        return
      }
      const { dir, name } = splitPath(path)
      if (!dir || !name) return
      pendingOpenRef.current = { vault: dir, name }
      // 目录不存在时 `applyVault` 会拒绝切库（并说明原因）—— 那就别把「待打开」留在 ref 里：
      // 它会一直等着那个库，等用户哪天又建出同名目录、切过去时突然弹出一篇笔记。
      if (!(await applyVault(dir))) pendingOpenRef.current = null
    },
    [applyVault],
  )
  useEffect(() => {
    openExternalFileRef.current = openExternalFile
  }, [openExternalFile])

  /**
   * 待打开的文件：**等目标库就绪**再 `openNote`。
   *
   * `applyVault` 是异步的 —— 它只换掉 `vault` 状态，真正的 `ensure_vault` + 笔记列表刷新
   * 发生在 kernel 重建之后的 effect 里；切库前就 openNote 会读到**旧库**。
   * 所以用 ref 记着它，等 `vault` 与 kernel 对齐了再开，用掉即清空。
   *
   * 本 effect 必须排在上面 `openNoteRef` 的同步 effect **之后**：同一轮 commit 里
   * effect 按声明顺序执行，排在后面才拿得到新 kernel 的 `openNote`。
   */
  useEffect(() => {
    const pending = pendingOpenRef.current
    if (!pending || !vault || !kernel) return
    if (!samePath(vault, pending.vault)) return
    pendingOpenRef.current = null
    void openNoteRef.current(pending.name)
  }, [vault, kernel])

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
  }, [])

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
        title: '打开 Markdown 文件',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      })
      if (typeof picked !== 'string') return
      await openExternalFileRef.current(picked)
    } catch (e) {
      setToast(`系统文件选择器打不开（${String(e)}）。可改用系统的「打开方式」并选 ZeroNote。`)
    }
  }, [])

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
      : `untitled-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`
    try {
      await k.fs.createNote(name, '# 新笔记\n\n')
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
        setToast(`已重命名：${to}`)
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
      const stamp = `untitled-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
      try {
        let name = `${stamp}.md`
        let i = 2
        while (await k.fs.exists(dir ? `${dir}/${name}` : name)) {
          name = `${stamp}-${i}.md`
          i += 1
        }
        const path = dir ? `${dir}/${name}` : name
        await k.fs.createNote(path, '# 新笔记\n\n')
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

  /* ── 文件树的剪贴板：剪切 / 复制 / 粘贴 / 创建副本 ──
     状态放**应用级**而不是文件树内部：粘贴后要 refresh，剪切态在树重渲染之间要保持。 */
  const [clipboard, setClipboard] = useState<{ mode: 'cut' | 'copy'; paths: string[] } | null>(null)

  const cutPaths = useCallback((paths: string[]) => {
    if (!paths.length) return
    setClipboard({ mode: 'cut', paths })
    setToast(paths.length > 1 ? `已剪切 ${paths.length} 项` : '已剪切')
  }, [])

  const copyPaths = useCallback((paths: string[]) => {
    if (!paths.length) return
    setClipboard({ mode: 'copy', paths })
    setToast(paths.length > 1 ? `已复制 ${paths.length} 项` : '已复制')
  }, [])

  /** 同目录下的不撞名副本名：`a.md` → `a 副本.md` → `a 副本 2.md`…（目录同理，不拆后缀） */
  const uniqueCopyTarget = useCallback(
    async (path: string): Promise<string> => {
      const k = kernel
      const slash = path.lastIndexOf('/')
      const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
      const name = slash >= 0 ? path.slice(slash + 1) : path
      const ext = /\.(md|markdown)$/i.exec(name)?.[0] ?? ''
      const stem = ext ? name.slice(0, -ext.length) : name
      let cand = `${dir}${stem} 副本${ext}`
      let i = 2
      while (k && (await k.fs.exists(cand))) {
        cand = `${dir}${stem} 副本 ${i}${ext}`
        i += 1
      }
      return cand
    },
    [kernel],
  )

  /**
   * 粘贴到 `dir`（`''` = 库根）：剪切走 `move`、复制走 `copy`。
   * 撞名不是一律报错：**复制**自动退成「 副本」，**剪切**才报错（移动没有合理的改名策略）；
   * 粘回原位时剪切静默跳过（等价于什么都没做），复制则生成副本 —— 与资源管理器一致。
   */
  const pasteInto = useCallback(
    async (dir: string) => {
      const k = kernel
      if (!k || !clipboard?.paths.length) return
      const { mode, paths } = clipboard
      try {
        for (const p of paths) {
          const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p
          let target = dir ? `${dir}/${name}` : name
          if (target === p) {
            if (mode === 'cut') continue
            target = await uniqueCopyTarget(p)
          } else if (await k.fs.exists(target)) {
            if (mode === 'cut') throw new Error(`目标已存在，不覆盖：${target}`)
            target = await uniqueCopyTarget(target)
          }
          await (mode === 'cut' ? k.fs.move(p, target) : k.fs.copy(p, target))
        }
        if (mode === 'cut') setClipboard(null)
        await refresh()
        setError(null)
        setToast(mode === 'cut' ? '已移动' : '已粘贴')
      } catch (e) {
        // 中途失败：已经搬过去的那些要保持可见，先刷新再报错
        await refresh()
        setError(failMsg(mode === 'cut' ? 'rename' : 'create', e))
      }
    },
    [kernel, refresh, clipboard, uniqueCopyTarget],
  )

  /** 创建副本（同目录 + 「 副本」）—— 文件与目录都支持（内核 `copy_entry` 是递归的） */
  const duplicateEntry = useCallback(
    async (path: string) => {
      const k = kernel
      if (!k) return
      try {
        const target = await uniqueCopyTarget(path)
        await k.fs.copy(path, target)
        await refresh()
        setError(null)
        setToast(`已创建副本：${target}`)
      } catch (e) {
        setError(failMsg('create', e))
      }
    },
    [kernel, refresh, uniqueCopyTarget],
  )

  /* ── 回收站（主区整页视图）──
     删除一直是进 `.zn/trash/` 的，但此前**只有 5 秒撤销条**这一个入口，一过就够不到。
     这里给它一个常驻入口：侧栏底部 + 主区页面（列表 / 恢复 / 彻底删除 / 清空）。 */
  const [trash, setTrash] = useState<TrashEntry[]>([])
  /** 待二次确认的条目 id —— 「彻底删除」是不可撤销的，点两次才执行 */
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null)
  /** 「清空回收站」同理，也是不可撤销的 */
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const loadTrash = useCallback(async () => {
    const k = kernel
    if (!k) return
    try {
      setTrash(await k.fs.listTrash())
      setError(null)
    } catch (e) {
      setError(failMsg('list', e))
    }
  }, [kernel])

  /**
   * 打开回收站。**在入口处取数据，而不是在 effect 里**：
   * ① lint 的 `set-state-in-effect` 盯着这条（加载即 setState，等于用 effect 做事件的事）；
   * ② 语义上它本来就是个"打开这一页"的事件 —— 谁打开谁去取。
   */
  const openTrash = useCallback(() => {
    setMainView('trash')
    if (kernel) void loadTrash()
  }, [kernel, loadTrash])

  const restoreTrashItem = useCallback(
    async (id: string) => {
      const k = kernel
      if (!k) return
      try {
        const back = await k.fs.restoreTrash(id)
        await loadTrash()
        await refresh()
        setError(null)
        setToast(`已恢复：${back}`)
      } catch (e) {
        setError(failMsg('rename', e))
      }
    },
    [kernel, loadTrash, refresh],
  )

  const purgeTrashItem = useCallback(
    async (id: string) => {
      const k = kernel
      if (!k) return
      try {
        await k.fs.purgeTrash(id)
        setConfirmPurge(null)
        await loadTrash()
        setError(null)
        setToast('已彻底删除')
      } catch (e) {
        setError(failMsg('delete', e))
      }
    },
    [kernel, loadTrash],
  )

  const emptyTrashAll = useCallback(async () => {
    const k = kernel
    if (!k) return
    try {
      const n = await k.fs.emptyTrash()
      setConfirmEmpty(false)
      await loadTrash()
      setError(null)
      setToast(`已清空回收站（${n} 项）`)
    } catch (e) {
      setError(failMsg('delete', e))
    }
  }, [kernel, loadTrash])

  /** 列表里的字节数（只求"大概多大"，不追求精确） */
  const fmtSize = (n: number) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`

  /**
   * 删除笔记，**支持一次多篇**（笔记库栏的多选走这条）。
   * 删前先把未保存改动落盘，删掉的才是磁盘上的最新版本（Rust 侧是移入 .zn/trash/，不是物理删）。
   * 一步删掉 + 一次撤销机会、不弹确认框 —— 依据 Apple HIG：
   * 「常见且可撤销的破坏操作不该弹窗，只有不可逆的才必须确认」。
   */
  const deleteNotes = useCallback(
    async (paths: string[]) => {
      const k = kernel
      if (!k || !paths.length) return
      const done: { path: string; trash: string }[] = []
      try {
        if (paths.includes(activeRef.current ?? '') && dirtyRef.current) {
          await saveNowRef.current()
        }
        for (const path of paths) {
          done.push({ path, trash: await k.fs.delete(path) })
        }
        // 打开的笔记被删，或它**所在的目录**被删 ⇒ 编辑器必须清空，
        // 否则界面还留着一篇"磁盘上已经没有了"的笔记，下一次自动保存直接报错
        const cur = activeRef.current
        const gone = !!cur && paths.some((p) => cur === p || cur.startsWith(`${p}/`))
        if (gone) {
          setActivePath(null)
          setContent('')
          setDirty(false)
          setSaveState('idle')
        }
        await refresh()
        setError(null)
        setUndoDelete(done)
        setToast(null)
      } catch (e) {
        // 中途失败：前面几篇已经进回收站了，仍然把撤销条挂上，别让它们找不回来
        await refresh()
        if (done.length) setUndoDelete(done)
        setError(failMsg('delete', e))
      }
    },
    [kernel, refresh],
  )

  /** 撤销删除：把回收站里的文件逐个 rename 回原位 */
  const undoDeleteNote = useCallback(async () => {
    const k = kernel
    if (!k || !undoDelete) return
    try {
      for (const it of undoDelete) await k.fs.rename(it.trash, it.path)
      await refresh()
      setError(null)
      setToast(undoDelete.length > 1 ? `已恢复 ${undoDelete.length} 篇` : '已恢复')
    } catch (e) {
      setError(failMsg('rename', e))
    } finally {
      setUndoDelete(null)
    }
  }, [kernel, refresh, undoDelete])

  // 撤销条 5 秒后自动消失
  useEffect(() => {
    if (!undoDelete) return
    const t = window.setTimeout(() => setUndoDelete(null), 5000)
    return () => window.clearTimeout(t)
  }, [undoDelete])

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

  const onEditorChange = useCallback(
    (next: string) => {
      // 外部重载引起的那一次回调：文档已经被我们替换过了，不算用户编辑
      // （见 `externalReloadRef` 的注释 —— 不拦就会白闪一次"未保存"、再把同样内容写一遍）
      if (externalReloadRef.current) {
        externalReloadRef.current = false
        return
      }
      setContent(next)
      setDirty(true)
      setSaveState('idle')
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void saveNowRef.current(), AUTOSAVE_MS)
      /**
       * `doc.on('change')` 广播（U3b）—— trailing 去抖，与上面 800ms 的自动保存**互相独立**：
       * change 先到（插件看到新内容）、save 后到（内容已落盘），顺序稳定。
       * `activeRef.current` 为空时（没打开笔记）不广播 —— 没有"哪篇"可言。
       */
      const path = activeRef.current
      if (path) {
        docPendingRef.current = { path, content: next }
        if (docChangeTimerRef.current !== null) window.clearTimeout(docChangeTimerRef.current)
        docChangeTimerRef.current = window.setTimeout(() => {
          docChangeTimerRef.current = null
          flushDocChange()
        }, DOC_CHANGE_DEBOUNCE_MS)
      }
    },
    [flushDocChange],
  )

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

  /* ── 插件扫描 + 加载（含**懒激活**）── */

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
    /** 静态声明了命令、但**还没加载**的插件：id → 目录（激活时用） */
    const pending = new Map<string, string>()
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
      const dir = pending.get(pluginId)
      if (!dir) throw new Error(`找不到待激活的插件：${pluginId}`)
      const l = await loadPlugin(dir, deps)
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
        const dirs = await listPluginDirs(vault)
        const list: PluginManifest[] = []
        for (const d of dirs) {
          if (cancelled) return
          try {
            list.push(await readManifest(vault, d))
          } catch (e) {
            setPluginError(`读取插件 ${d} 失败：${String(e)}`)
          }
        }
        if (cancelled) return
        setManifests(list)
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
            pending.set(m.id, m.id)
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
            const l = await loadPlugin(m.id, deps)
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
  }, [kernel, vault, reloadToken])

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
    try {
      await deletePluginDir(v, id)
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
    // 平台不符 ⇒ 一行说明它只支持哪端（「桌面」/「移动」两类人话，不暴露 desktop/android 字面量）
    platformNote: platformSkipped.includes(m.id)
      ? `不适用 · 仅${(m.platforms ?? [])
          .map((p) => (p === 'desktop' ? '桌面' : '移动'))
          .join(' / ')}端`
      : undefined,
    // 卡死兜底 C 段：被启动自愈关掉的插件 —— 明确标注，别让它静默消失
    autoDisabledNote: autoDisabled.has(m.id) ? '因上次加载未完成已自动禁用' : undefined,
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

  /* ── 窗口模式：只渲染那一个面板（插件已在上面那套 effect 里加载完） ── */
  if (pluginWindowId) {
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
          <WindowControls onClose={() => void getCurrentWindow().destroy()} />
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
      <aside className={`zn-sidebar${sidebarOpen ? ' is-open' : ''}`} style={{ width: sidebarWidth }}>
        <div className="zn-sidebar-head">
          {/* 固定显示应用名；具体是哪个库看状态栏右侧的完整路径（那儿更准确）。
              悬停在这行上仍能看到库路径，信息没丢。 */}
          <span className="zn-vault-name" title={vault ?? ''}>
            ZeroNote
          </span>
        </div>
        {vault ? (
          <FileTree
            notes={notes}
            dirs={dirs}
            activePath={activePath}
            onOpen={(p) => void openNote(p)}
            onNewFile={newNoteIn}
            onNewDir={newDirIn}
            onRename={(from, to, isDir) => void renameNote(from, to, isDir)}
            onDeleteMany={(paths) => void deleteNotes(paths)}
            clipboard={clipboard}
            onCut={cutPaths}
            onCopy={copyPaths}
            onPaste={(dir) => void pasteInto(dir)}
            onDuplicate={(path) => void duplicateEntry(path)}
            layers={layerExitsRef}
          />
        ) : (
          <div
            className="zn-tree"
            style={{ fontSize: 'var(--zn-text-sm)', color: 'var(--zn-fg-subtle)' }}
          >
            还没选择笔记库
          </div>
        )}
        {/* 库信息归侧栏底部（用户要求）；状态栏留给文档级信息。
            这里显示库目录名，完整路径挂在 tooltip 上。
            它是一个**按钮**：点一下弹「切换笔记库」（最近打开过的库 + 打开其它文件夹…），
            不必再绕系统目录选择器。菜单贴在按钮上方展开（见 openVaultMenu）。 */}
        {/* 回收站入口（常驻）—— 删除一直是进 `.zn/trash/` 的，这是唯一能再拿到它们的地方 */}
        <button
          type="button"
          className="zn-sidebar-foot"
          onClick={openTrash}
          title="回收站：删除的笔记都在这里，可恢复"
        >
          🗑 回收站
        </button>
        <button
          type="button"
          className="zn-sidebar-foot"
          title={vault ?? ''}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            void openVaultMenu(r.left, r.top)
          }}
        >
          {vault ? baseName(vault) : '未选择笔记库'}
        </button>
      </aside>
      )}

      {showSidebar && isDesktop && (
        /* 分隔线：拖它调左右占比。事件挂在 document 上 —— 指针拖快时会跑出这条
           5px 的窄线，只绑在自己身上会丢事件。拖拽期间临时锁掉文字选择与光标。
           只在桌面渲染：移动端侧栏是抽屉，宽度由抽屉自己定，没有"调占比"这回事。 */
        <div
          className="zn-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整笔记库栏宽度"
          onPointerDown={(e) => {
            // 用 Pointer Events 而不是 mouse 系列：鼠标、触摸、触控笔一套搞定，
            // Android 上没有 mousedown，用 mouse 事件这条分隔线在手机上根本拖不动。
            e.preventDefault()
            const startX = e.clientX
            const startW = sidebarWidth
            const onMove = (ev: PointerEvent) => {
              setSidebarWidth(Math.min(560, Math.max(160, startW + (ev.clientX - startX))))
            }
            const onUp = () => {
              document.removeEventListener('pointermove', onMove)
              document.removeEventListener('pointerup', onUp)
              document.body.classList.remove('is-resizing')
            }
            document.addEventListener('pointermove', onMove)
            document.addEventListener('pointerup', onUp)
            // 用 class 而不是 inline style：拖快时指针会甩到编辑器上，
            // 而 CodeMirror 内部有自己的 user-select，光设 body 的 inline 压不住它。
            document.body.classList.add('is-resizing')
          }}
        />
      )}

      <main className="zn-main">
        {mainView === 'trash' ? (
          /* 回收站：整页视图（与插件管理共用同一套主区骨架） */
          <div className="zn-main-panel">
            <div className="zn-main-panel-bar">
              <span>回收站</span>
              <div className="zn-main-panel-actions">
                {trash.length > 0 && (
                  <button
                    type="button"
                    className={`zn-plain-btn${confirmEmpty ? ' is-danger' : ''}`}
                    onClick={() => {
                      // 不可撤销 ⇒ 点两次
                      if (confirmEmpty) void emptyTrashAll()
                      else setConfirmEmpty(true)
                    }}
                    title="清空回收站（不可撤销）"
                  >
                    {confirmEmpty ? `确认清空 ${trash.length} 项？` : '清空回收站'}
                  </button>
                )}
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
              {trash.length === 0 ? (
                <div className="zn-trash-empty">回收站是空的</div>
              ) : (
                <ul className="zn-trash-list">
                  {trash.map((t) => (
                    <li key={t.id} className="zn-trash-row">
                      <div className="zn-trash-main">
                        <span className="zn-trash-name">
                          {t.isDir ? '📁 ' : ''}
                          {t.name}
                        </span>
                        <span className="zn-trash-meta">
                          {t.originalPath ?? '原位置未知（旧格式条目）'} ·{' '}
                          {new Date(t.deletedAt).toLocaleString()} · {fmtSize(t.size)}
                        </span>
                      </div>
                      <div className="zn-trash-actions">
                        <button
                          type="button"
                          className="zn-plain-btn"
                          onClick={() => void restoreTrashItem(t.id)}
                          title={t.originalPath ? `恢复到 ${t.originalPath}` : '恢复到库根'}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          className={`zn-plain-btn${confirmPurge === t.id ? ' is-danger' : ''}`}
                          onClick={() => {
                            // 不可撤销 ⇒ 点两次
                            if (confirmPurge === t.id) void purgeTrashItem(t.id)
                            else setConfirmPurge(t.id)
                          }}
                          title="彻底删除（不可撤销）"
                        >
                          {confirmPurge === t.id ? '确认删除' : '彻底删除'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
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
                  onToggle={togglePlugin}
                  onDelete={(id) => void deletePlugin(id)}
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
          <div className="zn-empty">
            {!vault ? (
              <>
                <h1>ZeroNote</h1>
                <p>
                  还没有打开笔记库。选一个文件夹 —— 里面的 <code>.md</code> 就是你的笔记；
                  内核只负责 <b>读写</b>、<b>编辑</b>、<b>本地存储</b> 与 <b>插件宿主</b>。
                </p>
                <Button variant="primary" size="lg" onClick={() => void pickVault()}>
                  选择笔记库
                </Button>
              </>
            ) : notes.length === 0 ? (
              <>
                <h1>这个库还没有笔记</h1>
                <p>
                  <code>{vault.split(/[\\/]/).pop()}</code> 里还没有 <code>.md</code> 文件。
                </p>
                <Button variant="primary" size="lg" onClick={() => runCore('core.newNote')}>
                  新建第一条
                </Button>
              </>
            ) : (
              <>
                <h1>选一篇开始</h1>
                <p>从左侧列表打开，或新建一篇。</p>
                <Button variant="primary" size="lg" onClick={() => runCore('core.newNote')}>
                  新建笔记
                </Button>
              </>
            )}
            <div className="zn-empty-keys">
              <span>
                <kbd>Ctrl</kbd>+<kbd>N</kbd> 新建
              </span>
              <span>
                <kbd>Ctrl</kbd>+<kbd>P</kbd> 命令面板
              </span>
              <span>
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> 搜索
              </span>
            </div>
          </div>
        )}

        <div className="zn-statusbar">
          {/* 左半：库信息与常驻面板。整块包一层，保证从最左开始 ——
              之前只靠末尾一个 margin-left:auto 的空元素压尾，内容为空时排版会漂。 */}
          <div className="zn-statusbar-left">
            <span>{notes.length} 篇</span>
            {/* location: 'statusbar' 的面板常驻状态栏（小部件），不进右栏 tab */}
            {statusPanels.map((p) => (
              <PanelBoundary key={p.id}>
                <UIRenderer
                  node={renderPanelSafe(p, panelState)}
                  state={panelState}
                  onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                  onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
                />
              </PanelBoundary>
            ))}
            {error && <span style={{ color: 'var(--zn-danger)' }}>⚠ {error}</span>}
          </div>
          {/* 右下角：当前文档字数（不含空白） */}
          <span title="当前文档字数（不含空白）">
            {activePath ? `${charCount.toLocaleString()} 字` : ''}
          </span>
        </div>
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
