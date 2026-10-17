// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, listenMock, addPluginListenerMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  addPluginListenerMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  addPluginListener: addPluginListenerMock,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

import { useExternalFile } from '../src/hooks/useExternalFile'

function makeKernel(tag = 'plugin:doc-reader') {
  return {
    commands: {
      implTag: vi.fn(() => tag),
      api: { execute: vi.fn(async () => 'ok') },
    },
  }
}

function makeArgs(kernel = makeKernel(), over: Record<string, unknown> = {}) {
  const refs = {
    vaultRef: { current: null as string | null },
    pendingOpenRef: { current: null as { vault: string; name: string } | null },
    recentOpenRef: { current: new Map<string, number>() },
    openExternalFileRef: { current: async () => {} },
    openNoteRef: { current: vi.fn(async () => {}) },
  }
  return {
    platform: 'windows' as const,
    kernel: kernel as never,
    vault: null as string | null,
    applyVault: vi.fn(async () => true),
    setToast: vi.fn(),
    refs,
    ...over,
  }
}

function render(args: ReturnType<typeof makeArgs>) {
  return renderHook(() => useExternalFile(args as never)).result
}

beforeEach(() => {
  vi.clearAllMocks()
  invokeMock.mockResolvedValue(undefined)
  listenMock.mockResolvedValue(() => {})
  addPluginListenerMock.mockResolvedValue({ unregister: vi.fn() })
})

describe('useExternalFile', () => {
  it('waitDocHandler：插件已接管 ⇒ 立刻 true', async () => {
    const args = makeArgs()
    const r = render(args)
    await expect(r.current.waitDocHandler()).resolves.toBe(true)
  })

  it('waitDocHandler：始终没人接管 ⇒ 超时返回 false', async () => {
    const args = makeArgs(makeKernel('core'))
    const r = render(args)
    await expect(r.current.waitDocHandler(30)).resolves.toBe(false)
  })

  it('openExternalFile：空路径 ⇒ 什么都不做', async () => {
    const args = makeArgs()
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('   ')
    })
    expect(args.refs.openNoteRef.current).not.toHaveBeenCalled()
    expect(args.applyVault).not.toHaveBeenCalled()
  })

  it('去重：3 秒内同一路径只处理一次', async () => {
    const args = makeArgs()
    args.refs.vaultRef.current = '/vault'
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('/vault/a.md')
      await r.current.openExternalFile('/vault/a.md')
    })
    expect(args.refs.openNoteRef.current).toHaveBeenCalledTimes(1)
  })

  it('content:// 不可阅读的类型 ⇒ toast，不派发', async () => {
    invokeMock.mockResolvedValue({ path: '/cache/x', name: 'photo.jpg' })
    const args = makeArgs()
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('content://media/external/file/1')
    })
    expect(args.setToast).toHaveBeenCalled()
    expect(args.kernel.commands.api.execute).not.toHaveBeenCalled()
  })

  it('content:// 可阅读的类型 ⇒ 等接管后派发 openDocument', async () => {
    invokeMock.mockResolvedValue({ path: '/cache/a.pdf', name: 'a.pdf' })
    const args = makeArgs()
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('content://media/external/file/2')
    })
    expect(args.kernel.commands.api.execute).toHaveBeenCalledWith('core.openDocument', {
      abs: '/cache/a.pdf',
      name: 'a.pdf',
    })
  })

  it('库内笔记 ⇒ openNote；库内文档 ⇒ 直接派发 { path: 相对路径 }', async () => {
    const args = makeArgs()
    args.refs.vaultRef.current = '/vault'
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('/vault/a.md')
    })
    expect(args.refs.openNoteRef.current).toHaveBeenCalledWith('a.md')
    await act(async () => {
      await r.current.openExternalFile('/vault/b.pdf')
    })
    expect(args.kernel.commands.api.execute).toHaveBeenCalledWith('core.openDocument', {
      path: 'b.pdf',
    })
  })

  it('库外文档 ⇒ 直接交给阅读器（绝对路径），绝不切库', async () => {
    const args = makeArgs()
    args.refs.vaultRef.current = '/vault'
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('/other/b.pdf')
    })
    expect(args.applyVault).not.toHaveBeenCalled()
    expect(args.kernel.commands.api.execute).toHaveBeenCalledWith('core.openDocument', {
      abs: '/other/b.pdf',
      name: 'b.pdf',
    })
  })

  it('库外笔记 ⇒ 切父目录为库，并留「待打开」', async () => {
    const args = makeArgs()
    args.refs.vaultRef.current = '/vault'
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('/other/a.md')
    })
    expect(args.applyVault).toHaveBeenCalledWith('/other')
    expect(args.refs.pendingOpenRef.current).toEqual({ vault: '/other', name: 'a.md' })
  })

  it('切库失败（目录不存在）⇒ 不留「待打开」', async () => {
    const args = makeArgs()
    args.applyVault = vi.fn(async () => false)
    args.refs.vaultRef.current = '/vault'
    const r = render(args)
    await act(async () => {
      await r.current.openExternalFile('/gone/a.md')
    })
    expect(args.refs.pendingOpenRef.current).toBeNull()
  })

  it('待打开 effect：库就绪后 openNote 并清空 pending', async () => {
    const args = makeArgs()
    args.vault = '/other'
    args.refs.pendingOpenRef.current = { vault: '/other', name: 'a.md' }
    render(args)
    await act(async () => {})
    expect(args.refs.openNoteRef.current).toHaveBeenCalledWith('a.md')
    expect(args.refs.pendingOpenRef.current).toBeNull()
  })

  it('待打开 effect：库还没对齐 ⇒ 留到下一轮', async () => {
    const args = makeArgs()
    args.vault = '/vault'
    args.refs.pendingOpenRef.current = { vault: '/other', name: 'a.md' }
    render(args)
    await act(async () => {})
    expect(args.refs.openNoteRef.current).not.toHaveBeenCalled()
    expect(args.refs.pendingOpenRef.current).toEqual({ vault: '/other', name: 'a.md' })
  })

  it('文件关联：挂载后 listen 注册 + 拉 opened_urls 并逐个打开', async () => {
    const args = makeArgs()
    args.refs.vaultRef.current = '/vault'
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'opened_urls' ? ['/vault/a.md'] : undefined,
    )
    render(args)
    await act(async () => {})
    expect(listenMock).toHaveBeenCalledWith('zn:open-file', expect.any(Function))
    expect(args.refs.openNoteRef.current).toHaveBeenCalledWith('a.md')
  })

  it('Android：热启动监听在 android 平台注册、桌面不注册', async () => {
    const desktop = makeArgs()
    render(desktop)
    await act(async () => {})
    expect(addPluginListenerMock).not.toHaveBeenCalled()

    const android = makeArgs(makeKernel(), { platform: 'android' })
    render(android)
    await act(async () => {})
    expect(addPluginListenerMock).toHaveBeenCalledWith('uri-reader', 'open-uri', expect.any(Function))
  })
})
