import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { exit, onBackButtonPress } from '@tauri-apps/api/app'
/**
 * Android 的库路径（方案 D）—— 公共存储。
 * 好处：文件管理器能进、插件能直接拷进 `.zn/plugins/`、卸载不丢数据。
 * 前提：拿到「所有文件访问」（MANAGE_EXTERNAL_STORAGE）权限。
 */
const ANDROID_VAULT = '/storage/emulated/0/Documents/ZeroNote'
import { invoke } from '@tauri-apps/api/core'
import type { EditorView } from '@codemirror/view'
import { createKernel, type Kernel, type PanelRegistration } from './kernel/kernel'
import {
  deletePluginDir,
  listPluginDirs,
  loadPlugin,
  readManifest,
  unloadPlugin,
  type LoadedPlugin,
  type PluginHostDeps,
} from './kernel/plugin-host'
import type { DocApi, NoteMeta, PluginManifest } from './kernel/contract'
import { FileTree } from './components/FileTree'
import { MarkdownEditor } from './components/MarkdownEditor'
import { CommandPalette } from './components/CommandPalette'
import { PluginPanel, type PluginRow } from './components/PluginPanel'
import { UIRenderer } from './components/UIRenderer'
import { PanelBoundary } from './components/PanelBoundary'
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
import { renderPanelSafe } from './kernel/panel-safe'
import { bindCommandKeybindings } from './kernel/keybindings'
import { SearchPanel } from './components/SearchPanel'
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
/** 命令面板的「最近使用」——持久化，重启后依然置顶（上限 8 条） */
const LS_RECENT_CMDS = 'zeronote.commands.recent'
const RECENT_CMDS_MAX = 8

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
  return `${FAIL_BASE[kind]}：${FAIL_HINT[kind]}（${raw}）`
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function loadDisabled(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(LS_DISABLED) ?? '[]'))
  } catch {
    return new Set()
  }
}

export default function App() {
  /* ── 库与文档 ── */
  // 库路径优先级：URL 参数 `?vault=<绝对路径>`（开发/快捷方式用） > 上次记住的
  const [vault, setVault] = useState<string | null>(() => {
    const fromUrl = new URLSearchParams(location.search).get('vault')
    return fromUrl && fromUrl.trim() ? fromUrl : localStorage.getItem(LS_VAULT)
  })
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** 移动端的「笔记库」面板（桌面走系统目录选择器，不用它） */
  const [vaultPanelOpen, setVaultPanelOpen] = useState(false)
  /** 删除后的「撤销」态 —— 记下原路径与回收站路径，几秒内可 rename 回来。
      删除本身是一步完成的（不弹确认框打断用户），可撤销性由这条提示提供。 */
  /** 最近一次删除（可能一次多篇），供撤销条在几秒内恢复 */
  const [undoDelete, setUndoDelete] = useState<{ path: string; trash: string }[] | null>(null)

  /* ── 插件 ── */
  const [manifests, setManifests] = useState<PluginManifest[]>([])
  const [disabled, setDisabled] = useState<Set<string>>(loadDisabled)
  const [reloadToken, setReloadToken] = useState(0)
  const [loadedIds, setLoadedIds] = useState<string[]>([])
  const [panels, setPanels] = useState<PanelRegistration[]>([])
  const [panelLog, setPanelLog] = useState<string[]>([])
  const [pluginError, setPluginError] = useState<string | null>(null)
  const [panelState, setPanelState] = useState<Record<string, unknown>>({})

  /* ── UI ── */
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** 快速打开笔记（Ctrl+O）—— 与命令面板分开：一个管"去哪篇"，一个管"做什么" */
  const [switcherOpen, setSwitcherOpen] = useState(false)
  /** 编辑器顶部的替换栏（Ctrl+H）—— 它不是浮层，所以不参与 openOverlay 的互斥 */
  const [replaceOpen, setReplaceOpen] = useState(false)
  /** 最近执行过的命令 id（命令面板置顶用；持久化在 localStorage） */
  const [recentCmds, setRecentCmds] = useState<string[]>(loadRecentCommands)

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
  const openNoteRef = useRef<(p: string) => Promise<void>>(async () => {})
  const saveNowRef = useRef<() => Promise<void>>(async () => {})

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

  /** 运行平台 —— Android 上应用能访问的文件范围与桌面不同 */
  const platform: 'android' | 'windows' = /Android/i.test(navigator.userAgent)
    ? 'android'
    : 'windows'

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
        setActivePath(null)
        setContent('')
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
      on: () => ({ dispose: () => {} }),
    }),
    [],
  )

  /* ── 内核（库变了才重建）── */
  const kernel: Kernel | null = useMemo(() => {
    if (!vault) return null
    return createKernel(vault, docApi, {
      onPanelsChange: setPanels,
      onNotify: (msg) => setToast(msg),
      onLog: (msg) => setPanelLog((l) => [...l.slice(-199), msg]),
      onPanelStateChange: (bind, value) => setPanelState((s) => ({ ...s, [bind]: value })),
    })
  }, [vault, docApi])

  /* ── 文件树 ── */
  const refresh = useCallback(async () => {
    if (!kernel) return
    try {
      setNotes(await kernel.fs.listNotes())
      setError(null)
    } catch (e) {
      setError(failMsg('list', e))
    }
  }, [kernel])

  useEffect(() => {
    if (!kernel) return
    void refresh()
    const sub = kernel.fs.watch(() => void refresh())
    return () => sub.dispose()
  }, [kernel, refresh])

  /* ── 保存：原子写，失败绝不显示「已保存」── */
  const saveNow = useCallback(async () => {
    const k = kernel
    const path = activeRef.current
    if (!k || !path) return
    setSaveState('saving')
    try {
      await k.fs.writeText(path, contentRef.current)
      setDirty(false)
      setSaveState('saved')
      setError(null)
    } catch (e) {
      setSaveState('error')
      setError(failMsg('write', e))
    }
  }, [kernel])
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
    let unlisten: (() => void) | null = null
    let disposed = false
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const fn = await win.onCloseRequested(async (e) => {
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
  }, [])

  const openNote = useCallback(
    async (path: string) => {
      const k = kernel
      if (!k || path === activeRef.current) return
      if (dirtyRef.current) await saveNowRef.current()
      try {
        setContent(await k.fs.readText(path))
        setActivePath(path)
        setDirty(false)
        setSaveState('idle')
        setError(null)
        setSidebarOpen(false) // 窄屏：选完笔记自动收抽屉
      } catch (e) {
        setError(failMsg('read', e))
      }
    },
    [kernel],
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
    setActivePath(null)
    setContent('')
    setDirty(false)
    setSaveState('idle')
    setError(null)
  }, [])

  /** 真正切库：未保存内容先落盘 → 记住 → 重置视图 → 换库。桌面与移动端共用 */
  const applyVault = useCallback(async (dir: string) => {
    if (dirtyRef.current) await saveNowRef.current()
    localStorage.setItem(LS_VAULT, dir)
    setActivePath(null)
    setContent('')
    setDirty(false)
    setSaveState('idle')
    setVault(dir)
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

  /** 重命名笔记 —— 当前打开的正是它时同步 activePath，否则编辑器还指着旧路径 */
  const renameNote = useCallback(
    async (from: string, to: string) => {
      const k = kernel
      if (!k) return
      try {
        await k.fs.rename(from, to)
        if (activeRef.current === from) setActivePath(to)
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
        if (paths.includes(activeRef.current ?? '')) {
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

  const onEditorChange = useCallback((next: string) => {
    setContent(next)
    setDirty(true)
    setSaveState('idle')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => void saveNowRef.current(), AUTOSAVE_MS)
  }, [])

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
    ]
    return () => subs.forEach((s) => s.dispose())
  }, [kernel, newNote, pickVault, closeNote, openOverlay])

  /* ── 插件扫描 + 加载（含**懒激活**）── */
  useEffect(() => {
    const k = kernel
    if (!k || !vault) return
    let cancelled = false
    const loaded: LoadedPlugin[] = []
    /** 静态声明了命令、但**还没加载**的插件：id → 目录（激活时用） */
    const pending = new Map<string, string>()
    /** 本次静态声明过命令的插件 id —— 卸载时要把它们的命令元数据也清掉 */
    const declaredIds = new Set<string>()
    const deps: PluginHostDeps = {
      vault,
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
    }

    /**
     * 懒激活入口：命令真的被执行时，宿主回调它把插件载进来。
     * 幂等 —— 重复点同一条命令不该加载两次。
     */
    const activate = async (pluginId: string) => {
      if (loaded.some((l) => l.manifest.id === pluginId)) return
      const dir = pending.get(pluginId)
      if (!dir) throw new Error(`找不到待激活的插件：${pluginId}`)
      const l = await loadPlugin(dir, deps)
      loaded.push(l)
      pending.delete(pluginId)
      if (!cancelled) setLoadedIds((ids) => (ids.includes(pluginId) ? ids : [...ids, pluginId]))
    }
    k.commands.setActivator(activate)

    setPluginError(null)
    void (async () => {
      try {
        const dirs = await listPluginDirs(vault)
        const list: PluginManifest[] = []
        for (const d of dirs) {
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
          if (disabledRef.current.has(m.id)) continue
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
          try {
            loaded.push(await loadPlugin(m.id, deps))
            ids.push(m.id)
          } catch (e) {
            setPluginError(`插件 ${m.id} 加载失败：${String(e)}`)
          }
        }
        if (!cancelled) setLoadedIds(ids)
      } catch (e) {
        if (!cancelled) setPluginError(String(e))
      }
    })()

    return () => {
      cancelled = true
      // 解绑激活器：它闭包着本次 effect 的 loaded/pending，留着会指向已失效的状态
      k.commands.setActivator(async () => {})
      for (const l of loaded) {
        void unloadPlugin(l, deps)
        // 强制回收它提供的服务 —— 不指望插件自己 dispose 掉 provide 的东西
        k.releaseServices(l.manifest.id)
        k.releaseEditorMarks(l.manifest.id)
      }
      // 静态声明的命令元数据也要清（那些插件可能从没被激活过）
      for (const id of declaredIds) k.commands.release(id)
      setLoadedIds([])
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
  useEffect(() => {
    backRef.current = () => {
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
    setReloadToken((t) => t + 1)
  }

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
  }))

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
          // 工具栏是"贴着编辑器"的辅助条，不该在菜单里单开一个页面
          p.location !== 'editor-toolbar',
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
  /* 编辑器底部工具栏：**空数组时一个 DOM 都不渲染** —— 没有插件用这个位置就没有开销 */
  const toolbarPanels = panels.filter((p) => p.location === 'editor-toolbar')
  /* 能在主区当页面渲染的面板：main 与 sidebar 都归主区
     （右侧栏已取消，sidebar 不再有独立载体；契约里 location 仍然有效，只是宿主换了承载方式） */
  const pagePanel =
    activePanel &&
    activePanel.location !== 'statusbar' &&
    activePanel.location !== 'modal' &&
    activePanel.location !== 'editor-toolbar'
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
            activePath={activePath}
            onOpen={(p) => void openNote(p)}
            onRename={(from, to) => void renameNote(from, to)}
            onDeleteMany={(paths) => void deleteNotes(paths)}
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
            这里显示库目录名，完整路径挂在 tooltip 上。 */}
        <div className="zn-sidebar-foot" title={vault ?? ''}>
          {vault ? vault.split(/[\\/]/).pop() : '未选择笔记库'}
        </div>
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
        {pagePanel || mainView === 'plugins' ? (
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
                  <UIRenderer
                    node={renderPanelSafe(pagePanel, panelState)}
                    state={panelState}
                    onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                    onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
                  />
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
              编辑器底部工具栏（`location: 'editor-toolbar'`）—— 手机端辅助输入、
              格式化按钮、快捷标签这类东西挂这里。
              **没有插件注册这个位置时 toolbarPanels 是空数组，一个 DOM 都不渲染**，
              所以无插件状态下不占空间、不耗性能。渲染沿用主区面板那一套
              （renderPanelSafe + PanelBoundary），坏面板只坏自己那一格。
            */}
            {toolbarPanels.length > 0 && (
              <div className="zn-editor-toolbar">
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
              </div>
            )}
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
            <UIRenderer
              node={renderPanelSafe(modalPanel, panelState)}
              state={panelState}
              onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
              onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
            />
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
