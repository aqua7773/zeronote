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
  listPluginDirs: vi.fn(),
  tryGlobalPluginRoot: vi.fn(async () => null),
  // rev173.5：插件只装全局根 —— 安装/迁移都要拿它（测试里固定一个路径）
  globalPluginRoot: vi.fn(async () => '/appdata'),
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
  listPluginDirs: mocks.listPluginDirs,
  PlatformMismatch: class PlatformMismatch extends Error {},
}))
vi.mock('../src/kernel/plugin-roots', () => ({
  collectPluginDirs: mocks.collectPluginDirs,
  tryGlobalPluginRoot: mocks.tryGlobalPluginRoot,
  globalPluginRoot: mocks.globalPluginRoot,
}))
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
    // rev173.231 核心能力接管：deps 里会透传 `k.capability`，卸载时调 `releaseCapabilities`
    capability: vi.fn(() => ({ provide: vi.fn(), status: () => [] })),
    releaseCapabilities: vi.fn(),
    // rev173.281 条目菜单动作：deps 里会透传 `k.itemMenu.scoped`，卸载时调 `releaseItemMenus`
    itemMenu: {
      api: { register: vi.fn() },
      scoped: vi.fn(() => ({ register: vi.fn() })),
      declare: vi.fn(() => ({ dispose: vi.fn() })),
      list: vi.fn(() => []),
      release: vi.fn(),
    },
    releaseItemMenus: vi.fn(),
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
  mocks.listPluginDirs.mockResolvedValue([])
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

  it('enabled=false（笔记独立窗口）：扫描 / 加载整段都不跑', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'p1', source: 'vault' }])
    const args = makeArgs({ enabled: false })
    renderHook(() => usePluginHost(args))
    await settle()
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

  /**
   * 条目菜单动作的**静态登记**（rev173.281 · J#18）。
   *
   * 语义与 `contributes.commands` 一致：manifest 里写了就进菜单，插件代码不用跑；
   * 点击时 `commands.execute` 才会激活懒插件。已被禁用 / 平台不符的插件不登记
   * （否则菜单里会出现一条永远跑不通的项）。
   */
  it('条目菜单动作：懒激活插件也静态登记，且不加载插件', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'io', source: 'vault' }])
    mocks.readManifest.mockResolvedValue(
      manifest('io', {
        activationEvents: ['onCommand:io.exportTxt'],
        contributes: {
          commands: [{ id: 'io.exportTxt', title: '导出为 txt…' }],
          itemMenus: [{ command: 'io.exportTxt', title: '导出为 txt…' }],
        },
      }),
    )
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    expect(mocks.loadPlugin).not.toHaveBeenCalled()
    expect(args.kernel.itemMenu.declare).toHaveBeenCalledWith(
      [{ command: 'io.exportTxt', title: '导出为 txt…' }],
      'io',
    )
  })

  it('条目菜单动作：非懒插件同样静态登记（manifest 声明即生效）', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'io2', source: 'vault' }])
    mocks.readManifest.mockResolvedValue(
      manifest('io2', {
        contributes: { itemMenus: [{ command: 'io2.export', title: '导出' }] },
      }),
    )
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    expect(args.kernel.itemMenu.declare).toHaveBeenCalledWith(
      [{ command: 'io2.export', title: '导出' }],
      'io2',
    )
    expect(mocks.loadPlugin).toHaveBeenCalledTimes(1)
  })

  it('条目菜单动作：禁用 / 平台不符的插件不登记', async () => {
    mocks.collectPluginDirs.mockResolvedValue([{ root: '/vault', dir: 'p9', source: 'vault' }])
    mocks.readManifest.mockResolvedValue(
      manifest('p9', { contributes: { itemMenus: [{ command: 'p9.x', title: 'X' }] } }),
    )
    // ⚠️ 用 Once：`clearAllMocks` 只清调用记录、不清实现 —— mockReturnValue(false)
    // 会漏给后面的用例（「重扫」「LS_LOADING」会因此全部跳过加载）
    mocks.supportsPlatform.mockImplementationOnce(() => false)
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    expect(args.kernel.itemMenu.declare).not.toHaveBeenCalled()
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

  /**
   * rev173.70：库内 → 全局的迁移口原来把失败全部吞掉（`catch {}`），
   * 用户看到的是"什么都没发生"。现在失败要能在插件页看到、并有 toast。
   */
  it('库内插件迁移：单个失败不再静默', async () => {
    mocks.listPluginDirs.mockResolvedValue(['ok', 'bad'])
    mocks.invoke.mockImplementation(async (cmd: string, payload: { pluginId?: string }) => {
      if (cmd === 'copy_plugin_dir' && payload.pluginId === 'bad') throw new Error('拒绝访问')
      return 1
    })
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    const w = window as unknown as {
      __znMigratePlugins?: () => Promise<{
        moved: string[]
        failed: { id: string; reason: string }[]
      }>
    }
    let out: { moved: string[]; failed: { id: string; reason: string }[] } | undefined
    await act(async () => {
      out = await w.__znMigratePlugins!()
    })
    expect(out?.moved).toEqual(['ok'])
    expect(out?.failed).toEqual([{ id: 'bad', reason: '拒绝访问' }])
    expect(args.setPluginError).toHaveBeenCalledWith(expect.stringContaining('bad'))
    expect(args.setPluginError).toHaveBeenCalledWith(expect.stringContaining('拒绝访问'))
    expect(args.setToast).toHaveBeenCalledWith(expect.stringContaining('1 个失败'))
  })

  it('库内插件迁移：全部成功不打扰用户', async () => {
    mocks.listPluginDirs.mockResolvedValue(['a', 'b'])
    mocks.invoke.mockResolvedValue(1)
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    // 加载链自己可能报过别的错（本测试只关心迁移那段）
    args.setPluginError.mockClear()
    args.setToast.mockClear()
    const w = window as unknown as { __znMigratePlugins?: () => Promise<{ moved: string[] }> }
    let out: { moved: string[] } | undefined
    await act(async () => {
      out = await w.__znMigratePlugins!()
    })
    expect(out?.moved).toEqual(['a', 'b'])
    expect(args.setPluginError).not.toHaveBeenCalled()
    expect(args.setToast).not.toHaveBeenCalled()
  })

  it('库内插件迁移：读目录失败要报出来（不伪装成「没有旧插件」）', async () => {
    mocks.listPluginDirs.mockRejectedValue(new Error('权限不足'))
    const args = makeArgs()
    renderHook(() => usePluginHost(args))
    await settle()
    const w = window as unknown as { __znMigratePlugins?: () => Promise<{ moved: string[] }> }
    await act(async () => {
      await w.__znMigratePlugins!()
    })
    expect(args.setPluginError).toHaveBeenCalledWith(expect.stringContaining('权限不足'))
    expect(mocks.invoke).not.toHaveBeenCalledWith('copy_plugin_dir', expect.anything())
  })
})
