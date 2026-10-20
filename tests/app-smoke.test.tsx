// @vitest-environment happy-dom
/**
 * App 编排层集成冒烟（rev131 · 工程债 #1）。
 *
 * 目的：173 条测试都在 hook / 组件 / 纯逻辑，**App.tsx 的接线**（state → hook → props → 渲染）
 * 没有回归网。这里挂载真实 App，只 mock 最外层 Tauri API 与两个平台副作用模块，
 * 断言三种启动分支都能渲染出正确内容。
 *
 * 不 mock kernel / fs：真实 `createKernel` + `createFsApi` 走 `invoke`，mock 的 invoke
 * 按命令返回假数据 —— 这样测的是「App 真实接线」，不是「假 kernel」。
 */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(async () => null),
  confirm: vi.fn(async () => true),
  listen: vi.fn(async () => () => {}),
  appDataDir: vi.fn(async () => '/appdata'),
  onCloseRequested: vi.fn(async () => () => {}),
  destroy: vi.fn(async () => {}),
  onBackButtonPress: vi.fn(async () => ({ unregister: vi.fn() })),
  exit: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: mocks.appDataDir }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@tauri-apps/api/app', () => ({ exit: mocks.exit, onBackButtonPress: mocks.onBackButtonPress }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: mocks.onCloseRequested, destroy: mocks.destroy }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, confirm: mocks.confirm }))
vi.mock('../src/lib/systemBar', () => ({ setStatusBarVisible: vi.fn() }))
vi.mock('../src/lib/androidPerm', () => ({ requestAllFilesAccess: vi.fn(async () => {}) }))
/**
 * 本测试不测编辑器渲染。
 * `@atomic-editor/editor` 的 dist 在 node 环境解析失败（`./AtomicCodeMirrorEditor` 无扩展名
 * 的 ESM 互操作问题）⇒ 换成空组件；MarkdownEditor 的其它行为不依赖它的运行时。
 */
vi.mock('@atomic-editor/editor', () => ({
  AtomicCodeMirrorEditor: () => null,
}))
vi.mock('@atomic-editor/editor/styles.css', () => ({}))

import App from '../src/App'

type Note = { path: string; title: string; id?: string }

function setupInvoke(notes: Note[] = []) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'list_notes':
        return notes
      case 'read_note':
        // note 窗口（?note=）挂载后会真读盘：给个字符串，别让 null 进 content（字数统计会崩）
        return '正文'
      case 'list_dirs':
        return []
      case 'list_plugins':
        return []
      case 'opened_urls':
        return []
      case 'vault_exists':
        return true
      default:
        return null
    }
  })
}

/** 让 App 里各 effect 的 promise 链跑完 */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setupInvoke()
})

describe('App 集成冒烟', () => {
  it('没有库 ⇒ 空态显示「ZeroNote」与「选择笔记库」', async () => {
    render(<App />)
    await settle()
    expect(screen.getByText('ZeroNote', { selector: 'h1' })).toBeTruthy()
    expect(screen.getByText('选择笔记库')).toBeTruthy()
  })

  it('有库但没笔记 ⇒ 显示「这个库还没有笔记」', async () => {
    localStorage.setItem('zeronote.vault', '/vault')
    render(<App />)
    await settle()
    expect(screen.getByText('这个库还没有笔记')).toBeTruthy()
  })

  it('有库且有笔记 ⇒ 文件树渲染笔记（显示磁盘文件名）', async () => {
    localStorage.setItem('zeronote.vault', '/vault')
    setupInvoke([{ path: 'a.md', title: '第一篇', id: 'n1' }])
    render(<App />)
    await settle()
    expect(screen.getByText('a.md')).toBeTruthy()
  })

  it('笔记独立窗口（?note=）：整条标题栏可按 deep 拖窗口，文档名标 false，无收回按钮', async () => {
    window.history.replaceState({}, '', '/?note=a.md&vault=/vault')
    try {
      render(<App />)
      await settle()
      const bar = document.querySelector('.zn-note-window .zn-plugin-window-bar')
      // Tauri 2.12 的 drag.js：裸属性只认直接点中自己，`deep` 才传给子树 ⇒ 整条标题栏可拖
      expect(bar?.getAttribute('data-tauri-drag-region')).toBe('deep')
      const title = document.querySelector('.zn-note-window .zn-plugin-window-title')
      // 文档名是「拖出窗口 = 收回主窗口」的手势把手：必须阻止系统拖动接管
      expect(title?.getAttribute('data-tauri-drag-region')).toBe('false')
      // rev173.67：取消左侧「收回主窗口」按钮（改由拖文档名出界收回）
      expect(document.querySelector('.zn-note-window-return')).toBeNull()
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })
})
