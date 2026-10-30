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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(async () => null),
  confirm: vi.fn(async () => true),
  listen: vi.fn(async () => () => {}),
  /** 跨窗口事件（`zn:note-return` 用）—— rev173.68 断言「关闭 = 交回主窗口」 */
  emit: vi.fn(async () => {}),
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
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen, emit: mocks.emit }))
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

/* 每轮卸载上一个 App：不带 cleanup 时 DOM 会累积（实测 4 个 `.zn-app` 同时挂着），
   后一个测试的点按会命中别的实例。 */
afterEach(cleanup)

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

  it('笔记独立窗口（?note=）：整条标题栏可拖窗口；点关闭 = 交回主窗口', async () => {
    window.history.replaceState({}, '', '/?note=a.md&vault=/vault')
    try {
      render(<App />)
      await settle()
      const bar = document.querySelector('.zn-note-window .zn-plugin-window-bar') as HTMLElement
      // 标题栏是系统拖动区：`deep` 才传给子树（标题 / 状态文字也能拖窗口）；三键是 button 自动排除
      expect(bar.getAttribute('data-tauri-drag-region')).toBe('deep')
      // rev173.68：拖拽收回的手势类 / 提示已移除（用户「不需要拖拽放回」）
      expect(document.querySelector('.zn-note-window-handle')).toBeNull()
      expect(document.querySelector('.zn-note-window-hint')).toBeNull()
      expect(document.querySelector('.zn-note-window-return')).toBeNull()

      // 点关闭 = 交回主窗口（保存 → emit → 关窗），而不是直接 close 把这篇留在窗口外
      fireEvent.click(screen.getByLabelText('关闭窗口'))
      await settle()
      expect(mocks.emit).toHaveBeenCalledWith('zn:note-return', { path: 'a.md' })
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('移动端（Android UA）不渲染多标签页（没有 TabBar）', async () => {
    const ua = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0',
      configurable: true,
    })
    try {
      expect(navigator.userAgent).toContain('Android') // 诊断：确认 UA 改写生效
      localStorage.setItem('zeronote.vault', '/vault')
      setupInvoke([{ path: 'a.md', title: '第一篇', id: 'n1' }])
      render(<App />)
      await settle()
      // 手机起始页 = 卡片流 ⇒ 此时已是手机布局（isDesktop 为 false）
      expect(document.querySelector('.zn-mobile-cards')).not.toBeNull()
      // 点卡片打开笔记 ⇒ 桌面才有的标签条不应出现
      fireEvent.click(document.querySelector('.zn-mobile-card') as HTMLElement)
      await settle()
      expect(document.querySelector('.zn-tabs')).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
    }
  })

  /**
   * 抽屉遮罩跟着抽屉本体卸载（rev173.277 · 真人使用测试 #10）。
   *
   * 现场：手机先拉开文件树抽屉，再从设置里点「打开插件中心」⇒ 抽屉 DOM 卸载了，
   * 但 `.zn-scrim` 只看 `sidebarOpen` ⇒ 整页变暗、点不动。用户截图 161613。
   */
  it('移动端：抽屉开着切到插件中心 ⇒ 遮罩跟着消失', async () => {
    const ua = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0',
      configurable: true,
    })
    try {
      localStorage.setItem('zeronote.vault', '/vault')
      setupInvoke([{ path: 'a.md', title: '第一篇', id: 'n1' }])
      render(<App />)
      await settle()

      // ☰ = 抽屉开关（手机起始页不是编辑态）
      fireEvent.click(screen.getByLabelText('切换文件树栏'))
      await settle()
      expect(document.querySelector('.zn-scrim')).not.toBeNull()

      // 底栏「插件」⇒ mainView=plugins，`sidebarAllowed` 变 false
      const pluginsTab = [...document.querySelectorAll('.zn-tabbar button, .zn-mobile-tab-bar button')].find(
        (b) => (b.textContent ?? '').trim() === '插件',
      ) as HTMLElement
      fireEvent.click(pluginsTab)
      await settle()

      expect(document.querySelector('.zn-swap')?.getAttribute('data-main')).toBe('plugins')
      expect(document.querySelector('.zn-scrim')).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
    }
  })
})
