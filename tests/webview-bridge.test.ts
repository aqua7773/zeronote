/**
 * WebView 能力通道的纯逻辑（rev173.76 · 契约 §7.9）。
 *
 * 这里只测"宿主能否把页面发来的东西归一成合法请求"与限流 —— 能力本身在
 * `plugin-host.ts` 里按插件实例构建，端到端靠 CDP 实测（见 HANDOFF 该段）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BRIDGE_APIS,
  BRIDGE_MAX_ARGS,
  BRIDGE_MAX_REPLY_BYTES,
  ZN_BRIDGE_VERSION,
  createRateGate,
  createWebviewBridge,
  isBridgeApi,
  isReplyTooLarge,
  makeBridgeToken,
  parseBridgeCall,
} from '../src/kernel/webview-bridge'
import type { CommandApi, HostApi, StoreApi } from '../src/kernel/contract'

const call = (over: Record<string, unknown> = {}) => ({
  zn: ZN_BRIDGE_VERSION,
  type: 'zn:call',
  token: 'tok-1',
  id: 'r1',
  api: 'store.get',
  args: ['k'],
  ...over,
})

describe('白名单', () => {
  it('只放行 store / host.info / host.notify / 本插件命令', () => {
    expect([...BRIDGE_APIS].sort()).toEqual(
      ['command.execute', 'host.info', 'host.notify', 'store.all', 'store.delete', 'store.get', 'store.set'].sort(),
    )
  })

  it('不放 fs / doc —— 需要路径与编辑器上下文，不该从 opaque origin 进来', () => {
    expect(isBridgeApi('fs.read')).toBe(false)
    expect(isBridgeApi('doc.save')).toBe(false)
    expect(isBridgeApi('index.query')).toBe(false)
    expect(isBridgeApi('store.get')).toBe(true)
  })
})

describe('parseBridgeCall 归一化', () => {
  it('合法请求原样通过', () => {
    const r = parseBridgeCall(call())
    expect(r).not.toBeNull()
    expect(r?.api).toBe('store.get')
    expect(r?.args).toEqual(['k'])
  })

  it('不是给通道的消息一律忽略（返回 null，不抛错）', () => {
    expect(parseBridgeCall(null)).toBeNull()
    expect(parseBridgeCall('hello')).toBeNull()
    expect(parseBridgeCall({ type: 'zn:theme' })).toBeNull()
    expect(parseBridgeCall(call({ type: 'zn:other' }))).toBeNull()
    expect(parseBridgeCall(call({ zn: 2 }))).toBeNull()
  })

  it('缺 token / 缺 id / 超长 id 都拒', () => {
    expect(parseBridgeCall(call({ token: '' }))).toBeNull()
    expect(parseBridgeCall(call({ id: '' }))).toBeNull()
    expect(parseBridgeCall(call({ id: 'x'.repeat(65) }))).toBeNull()
  })

  it('不在白名单的 api 直接判非法（页面拿不到错误细节，只收不到应答）', () => {
    expect(parseBridgeCall(call({ api: 'fs.read' }))).toBeNull()
    expect(parseBridgeCall(call({ api: 'store.getX' }))).toBeNull()
  })

  it('args 非数组按空处理；超长 args 截断', () => {
    expect(parseBridgeCall(call({ args: 'nope' }))?.args).toEqual([])
    const many = Array.from({ length: 10 }, (_, i) => i)
    expect(parseBridgeCall(call({ args: many }))?.args).toHaveLength(BRIDGE_MAX_ARGS)
  })
})

describe('createRateGate 限流', () => {
  it('窗口内超过上限就拒', () => {
    let t = 0
    const gate = createRateGate(3, () => t)
    expect(gate()).toBe(true)
    expect(gate()).toBe(true)
    expect(gate()).toBe(true)
    expect(gate()).toBe(false)
  })

  it('满一秒重置', () => {
    let t = 0
    const gate = createRateGate(1, () => t)
    expect(gate()).toBe(true)
    expect(gate()).toBe(false)
    t = 1000
    expect(gate()).toBe(true)
  })

  it('不同 iframe 各自一份闸门（工厂返回独立计数）', () => {
    let t = 0
    const a = createRateGate(1, () => t)
    const b = createRateGate(1, () => t)
    expect(a()).toBe(true)
    expect(a()).toBe(false)
    expect(b()).toBe(true)
  })
})

describe('令牌与应答体积', () => {
  it('makeBridgeToken 非空且每次不同', () => {
    const a = makeBridgeToken()
    const b = makeBridgeToken()
    expect(a.length).toBeGreaterThan(0)
    expect(a).not.toBe(b)
  })

  it('应答超过 256 KB 判超限（按 UTF-8 字节算）', () => {
    const small = { zn: 1, type: 'zn:reply' as const, id: '1', ok: true, value: 'x'.repeat(1000) }
    expect(isReplyTooLarge(small)).toBe(false)
    const big = { ...small, value: '中'.repeat(BRIDGE_MAX_REPLY_BYTES / 3 + 10) }
    expect(isReplyTooLarge(big)).toBe(true)
  })

  it('无法序列化的值判超限（不让宿主尝试发送）', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(
      isReplyTooLarge({ zn: 1, type: 'zn:reply', id: '1', ok: true, value: loop }),
    ).toBe(true)
  })
})

describe('createWebviewBridge 执行器', () => {
  const makeStore = () => {
    const data: Record<string, unknown> = {}
    const store: StoreApi = {
      get: async <T>(k: string, def?: T) => (k in data ? (data[k] as T) : (def as T)),
      set: async (k, v) => {
        data[k] = v
      },
      delete: async (k) => {
        delete data[k]
      },
      all: async () => ({ ...data }),
    }
    return { store, data }
  }

  const makeBridge = (over: { owned?: string[]; notify?: ReturnType<typeof vi.fn> } = {}) => {
    const { store, data } = makeStore()
    const notify = over.notify ?? vi.fn()
    const execute = vi.fn(async () => 'ran')
    const host = {
      apiVersion: '0.2.0',
      appVersion: '0.3.0',
      platform: 'windows',
      log: vi.fn(),
      notify,
      assetUrl: (p: string) => `asset://${p}`,
      assetUrlAbs: (p: string) => `asset://${p}`,
      pickFile: async () => null,
      saveFile: async () => null,
      readContentUri: async () => ({ path: '' }),
      onRollback: () => ({ dispose() {} }),
    } as unknown as HostApi
    const command = {
      register: () => ({ dispose() {} }),
      bind: () => ({ dispose() {} }),
      execute,
      list: () => [],
    } as unknown as CommandApi
    const bridge = createWebviewBridge({
      pluginId: 'demo',
      store,
      host,
      command,
      ownedCommands: new Set(over.owned ?? ['demo.hello']),
    })
    return { bridge, data, notify, execute }
  }

  it('store.set → store.get 往返，store.delete 清掉', async () => {
    const { bridge, data } = makeBridge()
    await bridge('store.set', ['k', { a: 1 }])
    expect(data.k).toEqual({ a: 1 })
    expect(await bridge('store.get', ['k'])).toEqual({ a: 1 })
    await bridge('store.delete', ['k'])
    expect(data.k).toBeUndefined()
  })

  it('key 非法 / 值不可序列化 都明确抛错（不写进 store）', async () => {
    const { bridge, data } = makeBridge()
    await expect(bridge('store.set', ['', 1])).rejects.toThrow('key 必须是非空字符串')
    const loop: Record<string, unknown> = {}
    loop.self = loop
    await expect(bridge('store.set', ['k', loop])).rejects.toThrow('无法序列化')
    expect(Object.keys(data)).toHaveLength(0)
  })

  it('command.execute 只放行本插件注册的命令', async () => {
    const { bridge, execute } = makeBridge({ owned: ['demo.hello'] })
    await bridge('command.execute', ['demo.hello', { x: 1 }])
    expect(execute).toHaveBeenCalledWith('demo.hello', { x: 1 })
    await expect(bridge('command.execute', ['core.save'])).rejects.toThrow('不属于插件 demo')
  })

  it('host.notify 转发并按白名单收 level', async () => {
    const { bridge, notify } = makeBridge()
    await bridge('host.notify', ['hi', 'warn'])
    expect(notify).toHaveBeenCalledWith('hi', 'warn')
    await bridge('host.notify', ['hi', 'evil'])
    expect(notify).toHaveBeenLastCalledWith('hi', 'info')
  })

  it('host.info 只回插件身份与版本（不泄露别的）', async () => {
    const { bridge } = makeBridge()
    expect(await bridge('host.info', [])).toEqual({
      pluginId: 'demo',
      platform: 'windows',
      appVersion: '0.3.0',
      apiVersion: '0.2.0',
    })
  })
})
