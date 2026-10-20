// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadPlugin: vi.fn(),
  unloadPlugin: vi.fn(async () => {}),
  readManifest: vi.fn(),
  platformOf: vi.fn(() => 'desktop'),
  supportsPlatform: vi.fn(() => true),
  collectPluginDirs: vi.fn(),
  tryGlobalPluginRoot: vi.fn(async () => null),
  // rev173.5：插件只装全局根 —— 安装/迁移都要拿它（测试里固定一个路径）
  globalPluginRoot: vi.fn(async () => '/appdata'),
  ensureBuiltinPlugins: vi.fn(async () => {}),
  invoke: vi.fn(),
  confirm: vi.fn(async () => true),
  open: vi.fn(async () => null),
}))

vi.mock('../src/kernel/plugin-host', () => ({
  loadPlugin: mocks.loadPlugin,
  unloadPlugin: mocks.unloadPlugin,
  readManifest: mocks.readManifest,
  platformOf: mocks.platformOf,
  supportsPlatform: mocks.supportsPlatform,
  PlatformMismatch: class PlatformMismatch extends Error {},
}))
vi.mock('../src/kernel/plugin-roots', () => ({
  collectPluginDirs: mocks.collectPluginDirs,
  tryGlobalPluginRoot: mocks.tryGlobalPluginRoot,
  globalPluginRoot: mocks.globalPluginRoot,
}))
vi.mock('../src/kernel/builtin-plugins', () => ({ ensureBuiltinPlugins: mocks.ensureBuiltinPlugins }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: mocks.confirm, open: mocks.open }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { usePluginHost } from '../src/hooks/usePluginHost'
import { LS_LOADING } from '../src/lib/boot-heal'

function makeKernel() {
  return {
    host: { platform: 'windows', log: vi.fn() },
    fs: {},
    doc: {},
    index: {},
    event: {},
    view: {},
    store: {},
    service: {},
    editor: {},
    commands: {
      setActivator: vi.fn(),
      declare: vi.fn(),
      release: vi.fn(),
      api: {},
    },
    releaseServices: vi.fn(),
    releaseEditorMarks: vi.fn(),
  }
}

function makeArgs(over: Record<string, unknown> = {}) {
  return {
    kernel: makeKernel() as never,
    vault: '/vault',
    reloadToken: 0,
    disabledRef: { current: new Set<string>() },
    setManifests: vi.fn(),
    setPluginEntries: vi.fn(),
    setGlobalRoot: vi.fn(),
    setLoadedIds: vi.fn(),
    setPlatformSkipped: vi.fn(),
    setPluginError: vi.fn(),
    setReloadToken: vi.fn(),
    setToast: vi.fn(),
    setError: vi.fn(),
    ...over,
  }
}

function manifest(id: string, over: Record<string, unknown> = {}) {
  return { id, name: id, version: '1.0.0', ...over }
}

/** 让加载链跑完（effect 里是 promise 链） */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.collectPluginDirs.mockResolvedValue([])
  mocks.readManifest.mockImplementation(async (_root: string, dir: string) => manifest(dir))
  mocks.loadPlugin.mockImplementation(async (entry: { dir: string }) => ({
    manifest: { id: entry.dir },
  }))
  localStorage.clear()
})

describe('usePluginHost', () => {
  it('扫描：读 manifest → 立即加载非懒插件 → setLoadedIds', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'p1', source: 'vault' }])
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    expect(args.setManifests).toHaveBeenCalledWith([manifest('p1')])
    expect(args.setPluginEntries).toHaveBeenCalled()
    expect(mocks.loadPlugin).toHaveBeenCalledTimes(1)
    expect(args.setLoadedIds).toHaveBeenCalledWith(['p1'])
  })

  it('enabled=false（笔记独立窗口）：预装 / 扫描 / 加载整段都不跑', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'p1', source: 'vault' }])
    const args = makeArgs({ enabled: false })
    renderHook(() => usePluginHost(args))
    await settle()
    // 不预装内置插件（每个 note 窗口都写一遍全局目录是无谓 IO，还会和主窗口并发写）
    expect(mocks.ensureBuiltinPlugins).not.toHaveBeenCalled()
    expect(mocks.collectPluginDirs).not.toHaveBeenCalled()
    expect(mocks.loadPlugin).not.toHaveBeenCalled()
    expect(args.setManifests).not.toHaveBeenCalled()
    expect(args.setLoadedIds).not.toHaveBeenCalled()
  })

  it('懒激活：只静态声明命令；activate 时才加载', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'p2', source: 'vault' }])
    mocks.readManifest.mockResolvedValue(
      manifest('p2', { activationEvents: ['onCommand:p2.run'], contributes: { commands: [{ id: 'p2.run' }] } }),
    )
    const args = makeArgs()
    const { result } = renderHook(() => usePluginHost(args))
    await settle()
    expect(mocks.loadPlugin).not.toHaveBeenCalled()
    expect(args.kernel.commands.declare).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p2.run', pluginId: 'p2' }),
    )
    expect(args.setLoadedIds).toHaveBeenCalledWith([])

    const activate = (args.kernel.commands.setActivator as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    await act(async () => {
      await activate('p2')
    })
    expect(mocks.loadPlugin).toHaveBeenCalledTimes(1)
    expect(args.setLoadedIds).toHaveBeenCalledWith(expect.any(Function))
    void result
  })

  it('已禁用 / 平台不符的插件都跳过', async () => {
    mocks.collectPluginDirs.mockResolvedValue([
      { root: '/vault', dir: 'p3', source: 'vault' },
      { root: '/vault', dir: 'p4', source: 'vault' },
    ])
    mocks.supportsPlatform.mockImplementation((m: { id: string }) => m.id !== 'p4')
    const args = makeArgs()
    args.disabledRef.current = new Set(['p3'])
    renderHook(() => usePluginHost(args))
    await settle()
    expect(mocks.loadPlugin).not.toHaveBeenCalled()
    expect(args.setPlatformSkipped).toHaveBeenCalledWith(['p4'])
  })

  it('加载前落 LS_LOADING 标记、加载后清掉（卡死兜底）', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'p5', source: 'vault' }])
    let during: string | null = null
    mocks.loadPlugin.mockImplementation(async (entry: { dir: string }) => {
      during = localStorage.getItem(LS_LOADING)
      return { manifest: { id: entry.dir } }
    })
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    expect(during).toContain('"id":"p5"')
    expect(localStorage.getItem(LS_LOADING)).toBeNull()
  })

  it('重扫：新一代先卸旧代再加载', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'p6', source: 'vault' }])
    const args = makeArgs()
    const { rerender } = renderHook((a) => usePluginHost(a), { initialProps: args })
    await settle()
    expect(mocks.unloadPlugin).not.toHaveBeenCalled()

    const next = { ...args, reloadToken: 1 }
    rerender(next)
    await settle()
    expect(mocks.unloadPlugin).toHaveBeenCalledTimes(1)
    expect(mocks.loadPlugin).toHaveBeenCalledTimes(2)
  })

  it('installZnpFromPath：预览 → 确认 → 安装 → 重扫 + toast', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_znp') {
        return {
          manifest: { id: 'demo', name: 'Demo', version: '1.0.0', capabilities: ['fs:read'], sha256: 'abc' },
          files: ['index.js', 'plugin.json'],
        }
      }
      return 'demo'
    })
    const args = makeArgs()
    const { result } = renderHook(() => usePluginHost(args))
    await settle()
    let id: string | null = null
    await act(async () => {
      id = await result.current.installZnpFromPath('/tmp/demo.znp')
    })
    expect(id).toBe('demo')
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Demo'),
      expect.objectContaining({ title: '安装插件包' }),
    )
    expect(mocks.invoke).toHaveBeenCalledWith('install_znp', {
      vault: '/appdata',
      path: '/tmp/demo.znp',
    })
    expect(args.setReloadToken).toHaveBeenCalled()
    expect(args.setToast).toHaveBeenCalledWith('插件已安装：demo')
  })

  it('installZnpFromPath：未签名包在确认框里明说', async () => {
    mocks.invoke.mockResolvedValue({
      manifest: { id: 'x', name: 'X', version: '0.1.0' },
      files: [],
    })
    const args = makeArgs()
    const { result } = renderHook(() => usePluginHost(args))
    await settle()
    await act(async () => {
      await result.current.installZnpFromPath('/tmp/x.znp')
    })
    const text = (mocks.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(text).toContain('未签名')
  })

  it('installZnpFromPath：用户取消 ⇒ 不安装', async () => {
    mocks.invoke.mockResolvedValue({ manifest: { id: 'y', name: 'Y', version: '1' }, files: [] })
    mocks.confirm.mockResolvedValueOnce(false)
    const args = makeArgs()
    const { result } = renderHook(() => usePluginHost(args))
    await settle()
    let id: string | null = 'unset'
    await act(async () => {
      id = await result.current.installZnpFromPath('/tmp/y.znp')
    })
    expect(id).toBeNull()
    expect(mocks.invoke).not.toHaveBeenCalledWith('install_znp', expect.anything())
  })

  it('installZnp：选文件后走同一个安装流程', async () => {
    mocks.open.mockResolvedValue('/tmp/z.znp')
    mocks.invoke.mockImplementation(async (cmd: string) =>
      cmd === 'read_znp' ? { manifest: { id: 'z', name: 'Z', version: '1' }, files: [] } : 'z',
    )
    const args = makeArgs()
    const { result } = renderHook(() => usePluginHost(args))
    await settle()
    await act(async () => {
      await result.current.installZnp()
    })
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ title: '选择插件包（.znp）' }))
    expect(mocks.invoke).toHaveBeenCalledWith('install_znp', { vault: '/appdata', path: '/tmp/z.znp' })
  })

  it('__znInstallZnp 诊断出口挂载/卸载', async () => {
    const args = makeArgs()
    const { unmount } = renderHook(() => usePluginHost(args))
    await settle()
    const w = window as unknown as { __znInstallZnp?: unknown }
    expect(typeof w.__znInstallZnp).toBe('function')
    unmount()
    expect(w.__znInstallZnp).toBeUndefined()
  })
})
