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
import { TitleBar } from './components/TitleBar'
import {
  applyTheme,
  loadThemePref,
  saveThemePref,
  watchSystemTheme,
  type ThemePref,
} from './lib/theme'
import { renderPanelSafe } from './kernel/panel-safe'
import { bindCommandKeybindings } from './kernel/keybindings'
import { SearchPanel } from './components/SearchPanel'
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
      setError(String(e))
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
      setError(String(e))
    }
  }, [kernel])
  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

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
        setError(String(e))
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

  const pickVault = useCallback(async () => {
    try {
      const dir = await open({ directory: true, multiple: false, title: '选择笔记库文件夹' })
      if (typeof dir !== 'string') return
      if (dirtyRef.current) await saveNowRef.current()
      localStorage.setItem(LS_VAULT, dir)
      setActivePath(null)
      setContent('')
      setDirty(false)
      setSaveState('idle')
      setVault(dir)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const newNote = useCallback(async () => {
    const k = kernel
    if (!k) return
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const name = `untitled-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`
    try {
      await k.fs.createNote(name, '# 新笔记\n\n')
      await refresh()
      await openNoteRef.current(name)
    } catch (e) {
      setError(String(e))
    }
  }, [kernel, refresh])

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
        setError(String(e))
      }
    },
    [kernel, refresh],
  )

  /** 删除笔记 —— 删前先把未保存改动落盘，删掉的才是磁盘上的最新版本（Rust 侧是移入 .zn/trash/，不是物理删） */
  const deleteNote = useCallback(
    async (path: string) => {
      const k = kernel
      if (!k) return
      try {
        if (activeRef.current === path && dirtyRef.current) await saveNowRef.current()
        await k.fs.delete(path)
        if (activeRef.current === path) {
          setActivePath(null)
          setContent('')
          setDirty(false)
          setSaveState('idle')
        }
        await refresh()
        setError(null)
        setToast('已移入回收站（.zn/trash/）')
      } catch (e) {
        setError(String(e))
      }
    },
    [kernel, refresh],
  )

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
      kernel.commands.api.register({ id: 'core.newNote', title: '新建笔记', run: () => newNote() }),
      kernel.commands.api.register({
        id: 'core.pickVault',
        title: '切换笔记库…',
        run: () => pickVault(),
      }),
      kernel.commands.api.register({
        id: 'core.palette',
        title: '打开命令面板',
        keybinding: 'Mod+P',
        run: () => setPaletteOpen(true),
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
        run: () => setSettingsOpen(true),
      }),
      kernel.commands.api.register({
        id: 'core.search',
        title: '搜索笔记',
        keybinding: 'Mod+Shift+F',
        run: () => setSearchOpen(true),
      }),
      kernel.commands.api.register({
        id: 'core.closeNote',
        title: '关闭当前笔记',
        keybinding: 'Mod+W',
        run: () => void closeNote(),
      }),
    ]
    return () => subs.forEach((s) => s.dispose())
  }, [kernel, newNote, pickVault, closeNote])

  /* ── 插件扫描 + 加载 ── */
  useEffect(() => {
    const k = kernel
    if (!k || !vault) return
    let cancelled = false
    const loaded: LoadedPlugin[] = []
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
      onLog: (msg, level) => k.host.log(level ?? 'info', msg),
    }
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
      for (const l of loaded) void unloadPlugin(l, deps)
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

  /** Escape 统一关浮层（这条不交给命令表：它要一次关掉多个，且无需用户配置） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPaletteOpen(false)
      setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
  }, [settingsOpen, searchOpen, paletteOpen, sidebarOpen, mainView, closeNote])

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
    { label: '新建笔记', hint: 'Ctrl+N', onClick: () => void newNote() },
    // 移动端没有窗口装饰也没有菜单栏空间，单独给一条开抽屉的入口
    ...(isDesktop ? [] : [{ label: '笔记库', onClick: () => setSidebarOpen(true) }]),
    { label: '打开笔记库…', onClick: () => void pickVault() },
    {
      label: sidebarVisible ? '隐藏笔记库栏' : '显示笔记库栏',
      onClick: () => setSidebarVisible((v) => !v),
    },
    { label: '搜索笔记', hint: 'Ctrl+Shift+F', divider: true, onClick: () => setSearchOpen(true) },
    { label: '命令面板', hint: 'Ctrl+P', onClick: () => setPaletteOpen(true) },
    { label: '设置', hint: 'Ctrl+,', divider: true, onClick: () => setSettingsOpen(true) },
    // 右侧栏取消后，插件管理与各插件面板都在主区各占一个页面
    { label: '插件管理', onClick: () => setMainView('plugins') },
    ...panels
      .filter((p) => p.location !== 'statusbar' && p.location !== 'modal')
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

  const activePanel = panels.find((p) => p.id === mainView) ?? null
  const statusPanels = panels.filter((p) => p.location === 'statusbar')
  /* 能在主区当页面渲染的面板：main 与 sidebar 都归主区
     （右侧栏已取消，sidebar 不再有独立载体；契约里 location 仍然有效，只是宿主换了承载方式） */
  const pagePanel =
    activePanel && activePanel.location !== 'statusbar' && activePanel.location !== 'modal'
      ? activePanel
      : null
  const modalPanel = activePanel?.location === 'modal' ? activePanel : null
  /* 侧栏只在编辑器视图里出现 —— 插件管理 / 插件页面跟笔记无关，让主区占满更清爽 */
  const showSidebar = sidebarVisible && mainView === 'editor'

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
      <TitleBar
        title={titleText}
        saveLabel={saveLabel}
        saveError={saveState === 'error'}
        saveDirty={dirty}
        onMenu={setMenuAt}
        showWindowControls={isDesktop}
      />

      <div className="zn-body">
      {showSidebar && (
      <aside className={`zn-sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="zn-sidebar-head">
          <span className="zn-vault-name" title={vault ?? ''}>
            {vault ? vault.split(/[\\/]/).pop() : 'ZeroNote'}
          </span>
          <button
            type="button"
            className="zn-icon-btn"
            onClick={() => {
              setSidebarVisible(false)
              setSidebarOpen(false)
            }}
            title="关闭笔记库栏"
            aria-label="关闭笔记库栏"
          >
            ✕
          </button>
        </div>
        {vault ? (
          <FileTree
            notes={notes}
            activePath={activePath}
            onOpen={(p) => void openNote(p)}
            onRename={(from, to) => void renameNote(from, to)}
            onDelete={(p) => void deleteNote(p)}
          />
        ) : (
          <div
            className="zn-tree"
            style={{ fontSize: 'var(--zn-text-sm)', color: 'var(--zn-fg-subtle)' }}
          >
            还没选择笔记库
          </div>
        )}
      </aside>
      )}

      <main className="zn-main">
        {pagePanel || mainView === 'plugins' ? (
          /* 主区页面：插件管理 或 插件面板，顶部一条「返回编辑器」横条 */
          <div className="zn-main-panel">
            <div className="zn-main-panel-bar">
              <span>{pagePanel ? pagePanel.title : '插件管理'}</span>
              <button className="zn-btn" onClick={() => setMainView('editor')}>
                返回编辑器
              </button>
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
                  onReload={() => setReloadToken((t) => t + 1)}
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
            />
            {/* 「关闭这篇笔记」属于编辑页面，就放在编辑页面里 ——
                不放标题栏，免得跟窗口那个 × 挨着分不清 */}
            <button
              type="button"
              className="zn-editor-close"
              onClick={() => void closeNote()}
              title="关闭这篇笔记（Ctrl+W）"
              aria-label="关闭当前笔记"
            >
              ✕
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
                <Button variant="primary" size="lg" onClick={() => void newNote()}>
                  新建第一条
                </Button>
              </>
            ) : (
              <>
                <h1>选一篇开始</h1>
                <p>从左侧列表打开，或新建一篇。</p>
                <Button variant="primary" size="lg" onClick={() => void newNote()}>
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
          <span style={{ marginLeft: 'auto' }} title={vault ?? ''}>
            {vault ?? ''}
          </span>
          {error && <span style={{ color: 'var(--zn-danger)' }}>⚠ {error}</span>}
        </div>
      </main>
      </div>

      {sidebarOpen && (
        <div className="zn-scrim" onClick={() => setSidebarOpen(false)} />
      )}

      {/* 左上角菜单栏（记事本式 ☰，点击位置就地弹出） */}
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
        onRun={(id) => void kernel?.commands.api.execute(id)}
      />

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
        onReloadPlugins={() => setReloadToken((t) => t + 1)}
      />

      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenNote={(p) => void openNote(p)}
        index={kernel?.index ?? null}
      />

      {toast && (
        <div className="zn-toast" onClick={() => setToast(null)} role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
