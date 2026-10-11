import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
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
  const [rightOpen, setRightOpen] = useState(false)
  const [rightTab, setRightTab] = useState<string>('plugins')
  /** 窄屏抽屉：宽屏侧栏常驻，窄屏由顶栏 ☰ 滑出 */
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
        keybinding: 'Mod+K',
        run: () => setPaletteOpen(true),
      }),
      kernel.commands.api.register({
        id: 'core.plugins',
        title: '打开插件管理',
        run: () => {
          setRightOpen(true)
          setRightTab('plugins')
        },
      }),
    ]
    return () => subs.forEach((s) => s.dispose())
  }, [kernel, newNote, pickVault])

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

  /* ── 全局快捷键 ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  const activePanel = panels.find((p) => p.id === rightTab) ?? null

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
      <aside className={`zn-sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="zn-sidebar-head">
          <span className="zn-vault-name" title={vault ?? ''}>
            {vault ? vault.split(/[\\/]/).pop() : 'ZeroNote'}
          </span>
          <button
            className="zn-btn"
            onClick={() => void newNote()}
            disabled={!vault}
            title="新建笔记"
          >
            ＋
          </button>
        </div>
        {vault ? (
          <FileTree notes={notes} activePath={activePath} onOpen={(p) => void openNote(p)} />
        ) : (
          <div
            className="zn-tree"
            style={{ fontSize: 'var(--zn-text-sm)', color: 'var(--zn-fg-subtle)' }}
          >
            还没选择笔记库
          </div>
        )}
      </aside>

      <main className="zn-main">
        <div className="zn-titlebar">
          <button
            type="button"
            className="zn-btn zn-mobile-only"
            onClick={() => setSidebarOpen((v) => !v)}
            title="笔记库"
            aria-label="笔记库"
          >
            ☰
          </button>
          <span className="zn-path" title={activePath ?? ''}>
            {activePath ?? '没有打开笔记'}
          </span>
          <span
            className={`zn-save-state${saveState === 'error' ? ' is-error' : dirty ? ' is-dirty' : ''}`}
          >
            {saveLabel}
          </span>
          <button className="zn-btn" onClick={() => setPaletteOpen(true)} title="命令面板 (Ctrl+K)">
            命令
          </button>
          <button
            className="zn-btn"
            onClick={() => setRightOpen((v) => !v)}
            title="插件与插件面板"
          >
            插件{panels.length ? ` · ${panels.length}` : ''}
          </button>
          <button className="zn-btn" onClick={() => void saveNow()} disabled={!dirty}>
            保存
          </button>
        </div>

        {activePath ? (
          <MarkdownEditor
            path={activePath}
            value={content}
            onChange={onEditorChange}
            onSave={() => void saveNow()}
            onReady={(v) => {
              editorRef.current = v
            }}
          />
        ) : (
          <div className="zn-empty">
            <h1>ZeroNote</h1>
            <p>
              内核只做四件事：<b>.md 读写</b>、<b>编辑</b>、<b>本地存储</b>、<b>插件宿主</b>。
              <br />
              选一个文件夹当笔记库 —— 里面的 <code>.md</code> 就是你的笔记。
            </p>
            <button className="zn-btn is-primary" onClick={() => void pickVault()}>
              选择笔记库
            </button>
          </div>
        )}

        <div className="zn-statusbar">
          <span>{notes.length} 篇</span>
          {vault && <span title={vault}>{vault}</span>}
          <span style={{ marginLeft: 'auto' }}>
            插件 {loadedIds.length}/{manifests.length}
          </span>
          {error && <span style={{ color: 'var(--zn-danger)' }}>⚠ {error}</span>}
        </div>
      </main>

      {rightOpen && (
        <aside className="zn-rightbar">
          <div className="zn-rightbar-tabs">
            <button
              className={`zn-rightbar-tab${rightTab === 'plugins' ? ' is-active' : ''}`}
              onClick={() => setRightTab('plugins')}
            >
              插件
            </button>
            {panels.map((p) => (
              <button
                key={p.id}
                className={`zn-rightbar-tab${rightTab === p.id ? ' is-active' : ''}`}
                onClick={() => setRightTab(p.id)}
                title={p.pluginId ? `来自插件 ${p.pluginId}` : p.id}
              >
                {p.title}
              </button>
            ))}
          </div>
          <div className="zn-rightbar-body">
            {activePanel ? (
              <UIRenderer
                node={activePanel.render({
                  pluginId: activePanel.pluginId ?? '',
                  state: panelState,
                })}
                state={panelState}
                onAction={(id, payload) => void kernel?.commands.api.execute(id, payload)}
                onStateChange={(bind, value) => setPanelState((s) => ({ ...s, [bind]: value }))}
              />
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
        </aside>
      )}

      {(sidebarOpen || rightOpen) && (
        <div
          className="zn-scrim"
          onClick={() => {
            setSidebarOpen(false)
            setRightOpen(false)
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={kernel ? kernel.commands.api.list() : []}
        onRun={(id) => void kernel?.commands.api.execute(id)}
      />

      {toast && (
        <div className="zn-toast" onClick={() => setToast(null)} role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
