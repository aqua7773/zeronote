import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { createFsApi } from './kernel/fs'
import type { FsApi, NoteMeta } from './kernel/contract'
import { FileTree } from './components/FileTree'
import { MarkdownEditor } from './components/MarkdownEditor'

const LS_VAULT = 'zeronote.vault'
const AUTOSAVE_MS = 800

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function App() {
  const [vault, setVault] = useState<string | null>(() => localStorage.getItem(LS_VAULT))
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  const fs: FsApi | null = useMemo(() => (vault ? createFsApi(vault) : null), [vault])

  const contentRef = useRef(content)
  const activeRef = useRef(activePath)
  const dirtyRef = useRef(dirty)
  const timerRef = useRef<number | null>(null)

  // 最新值同步进 ref，供事件回调与定时器读取（在 effect 里写，避免渲染期间改 ref）
  useEffect(() => {
    contentRef.current = content
  }, [content])
  useEffect(() => {
    activeRef.current = activePath
  }, [activePath])
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const refresh = useCallback(async () => {
    if (!fs) return
    try {
      setNotes(await fs.listNotes())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [fs])

  /** 原子写；失败绝不显示「已保存」 */
  const saveNow = useCallback(async () => {
    const api = fs
    const path = activeRef.current
    if (!api || !path) return
    setSaveState('saving')
    try {
      await api.writeText(path, contentRef.current)
      setDirty(false)
      setSaveState('saved')
      setError(null)
    } catch (e) {
      setSaveState('error')
      setError(String(e))
    }
  }, [fs])

  // 打开库：拉清单 + 订阅文件变更（含外部编辑器改动）
  useEffect(() => {
    if (!fs) return
    void refresh()
    const sub = fs.watch(() => void refresh())
    return () => sub.dispose()
  }, [fs, refresh])

  // 关窗前保底保存一次
  useEffect(() => {
    const beforeUnload = () => {
      if (dirtyRef.current) void saveNow()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [saveNow])

  const pickVault = async () => {
    try {
      const dir = await open({ directory: true, multiple: false, title: '选择笔记库文件夹' })
      if (typeof dir !== 'string') return
      if (dirtyRef.current) await saveNow()
      localStorage.setItem(LS_VAULT, dir)
      setActivePath(null)
      setContent('')
      setDirty(false)
      setSaveState('idle')
      setVault(dir)
    } catch (e) {
      setError(String(e))
    }
  }

  const openNote = async (path: string) => {
    const api = fs
    if (!api || path === activeRef.current) return
    if (dirtyRef.current) await saveNow()
    try {
      const text = await api.readText(path)
      setActivePath(path)
      setContent(text)
      setDirty(false)
      setSaveState('idle')
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  const newNote = async () => {
    const api = fs
    if (!api) return
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const name = `untitled-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`
    try {
      await api.createNote(name, '# 新笔记\n\n')
      await refresh()
      await openNote(name)
    } catch (e) {
      setError(String(e))
    }
  }

  const onEditorChange = (next: string) => {
    setContent(next)
    setDirty(true)
    setSaveState('idle')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => void saveNow(), AUTOSAVE_MS)
  }

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
      <aside className="zn-sidebar">
        <div className="zn-sidebar-head">
          <span className="zn-vault-name" title={vault ?? ''}>
            {vault ? vault.split(/[\\/]/).pop() : 'ZeroNote'}
          </span>
          <button className="zn-btn" onClick={() => void newNote()} disabled={!vault} title="新建笔记">
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
        {activePath ? (
          <>
            <div className="zn-titlebar">
              <span className="zn-path" title={activePath}>
                {activePath}
              </span>
              <span
                className={`zn-save-state${saveState === 'error' ? ' is-error' : dirty ? ' is-dirty' : ''}`}
              >
                {saveLabel}
              </span>
              <button className="zn-btn" onClick={() => void saveNow()} disabled={!dirty}>
                保存
              </button>
            </div>
            <MarkdownEditor
              path={activePath}
              value={content}
              onChange={onEditorChange}
              onSave={() => void saveNow()}
            />
          </>
        ) : (
          <div className="zn-empty">
            <h1>ZeroNote</h1>
            <p>
              内核只做四件事：<b>.md 读写</b>、<b>编辑</b>、<b>本地存储</b>、<b>插件宿主</b>。
              <br />
              选一个文件夹当笔记库 —— 里面的 <code>.md</code> 就是你的笔记，外部编辑器改了这里会立刻看到。
            </p>
            <button className="zn-btn is-primary" onClick={() => void pickVault()}>
              选择笔记库
            </button>
          </div>
        )}

        <div className="zn-statusbar">
          <span>{notes.length} 篇</span>
          {vault && <span title={vault}>{vault}</span>}
          {error && <span style={{ color: 'var(--zn-danger)' }}>⚠ {error}</span>}
        </div>
      </main>
    </div>
  )
}
