// @vitest-environment happy-dom
/**
 * `net` 原语与二进制读写的前端接线（rev173.106 · 同步插件地基）。
 *
 * 这一层负责的是**过桥格式**，不是协议语义，所以每条都盯着一个具体的翻车点：
 *  · 文本 body 必须按 UTF-8 编码再 base64 —— 直接 `btoa(中文字符串)` 会抛 InvalidCharacterError；
 *  · `Uint8Array` 不能原样当 IPC 参数（Tauri 会序列化成 JSON 数字数组，1 MB × 8 体积）；
 *  · 响应体**懒解码** —— HEAD / PROPFIND 只看 status 时不该解析 body；
 *  · 4xx / 5xx 不能抛错 —— 401 要读 `WWW-Authenticate` 决定重试，抛错就把这条路堵死了。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))

import { base64ToBytes, bytesToBase64 } from '../src/kernel/base64-codec'
import { createNetApi } from '../src/kernel/net'
import { createFsApi } from '../src/kernel/fs'

/** 模拟 Rust 侧 `net_request` 的返回 */
function reply(payload: { status: number; headers?: Record<string, string>; body?: Uint8Array }) {
  mocks.invoke.mockResolvedValueOnce({
    status: payload.status,
    headers: payload.headers ?? {},
    body_b64: bytesToBase64(payload.body ?? new Uint8Array()),
  })
}

describe('base64 编解码', () => {
  it('空字节 → 空串（不是 undefined）', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
    expect(base64ToBytes('').length).toBe(0)
  })

  it('256 种字节值往返一致', () => {
    const src = new Uint8Array(256).map((_, i) => i)
    expect(Array.from(base64ToBytes(bytesToBase64(src)))).toEqual(Array.from(src))
  })

  it('300 KB 分块不爆栈（一次性展开会 RangeError）', () => {
    const src = new Uint8Array(300 * 1024)
    for (let i = 0; i < src.length; i += 1) src[i] = i % 251
    const round = base64ToBytes(bytesToBase64(src))
    expect(round.length).toBe(src.length)
    expect(round[0]).toBe(0)
    expect(round[123_456]).toBe(123_456 % 251)
  })
})

describe('net.fetch', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('GET 缺省：method / headers / body 一律 null（Rust 侧自己填默认值）', async () => {
    reply({ status: 200, body: new TextEncoder().encode('ok') })
    const api = createNetApi()
    const res = await api.fetch({ url: 'https://dav.example.com/a.md' })

    expect(mocks.invoke).toHaveBeenCalledWith('net_request', {
      req: {
        url: 'https://dav.example.com/a.md',
        method: null,
        headers: null,
        bodyB64: null,
        timeoutMs: null,
      },
    })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('ok')
  })

  it('中文文本 body 走 UTF-8 再 base64（直接 btoa 会抛错）', async () => {
    reply({ status: 201 })
    const api = createNetApi()
    await api.fetch({ url: 'https://x/y.md', method: 'PUT', body: '笔记内容' })

    const req = mocks.invoke.mock.calls[0][1].req
    expect(req.method).toBe('PUT')
    expect(base64ToBytes(req.bodyB64)).toEqual(new TextEncoder().encode('笔记内容'))
  })

  it('Uint8Array body 原样发送（二进制附件）', async () => {
    reply({ status: 201 })
    const api = createNetApi()
    await api.fetch({ url: 'https://x/a.png', method: 'PUT', body: new Uint8Array([0xff, 0x00, 0x10]) })

    const req = mocks.invoke.mock.calls[0][1].req
    expect(Array.from(base64ToBytes(req.bodyB64))).toEqual([0xff, 0x00, 0x10])
  })

  it('WebDAV 自定义方法（PROPFIND）与请求头原样透传', async () => {
    reply({ status: 207, headers: { 'content-type': 'application/xml' } })
    const api = createNetApi()
    const res = await api.fetch({
      url: 'https://dav.example.com/remote.php/dav/files/me/',
      method: 'PROPFIND',
      headers: { Depth: '1', Authorization: 'Basic abc' },
      timeoutMs: 8000,
    })

    const req = mocks.invoke.mock.calls[0][1].req
    expect(req.method).toBe('PROPFIND')
    expect(req.headers).toEqual({ Depth: '1', Authorization: 'Basic abc' })
    expect(req.timeoutMs).toBe(8000)
    expect(res.status).toBe(207)
    expect(res.headers['content-type']).toBe('application/xml')
  })

  it('4xx 不抛错 —— 401 的 WWW-Authenticate 要能被读到', async () => {
    reply({
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="dav"' },
      body: new TextEncoder().encode('unauthorized'),
    })
    const api = createNetApi()
    const res = await api.fetch({ url: 'https://dav.example.com/' })

    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toBe('Basic realm="dav"')
    expect(res.text()).toBe('unauthorized')
  })

  it('响应头缺失时给空对象（插件可以无脑取 headers.etag）', async () => {
    mocks.invoke.mockResolvedValueOnce({ status: 204, headers: undefined, body_b64: '' })
    const api = createNetApi()
    const res = await api.fetch({ url: 'https://dav.example.com/x' })
    expect(res.headers).toEqual({})
    expect(res.status).toBe(204)
  })

  it('bytes() 与 text() 读的是同一份解码结果（缓存）', async () => {
    reply({ status: 200, body: new TextEncoder().encode('abc') })
    const api = createNetApi()
    const res = await api.fetch({ url: 'https://x/y' })
    const a = res.bytes()
    const b = res.bytes()
    expect(a).toBe(b)
    expect(res.text()).toBe('abc')
  })
})

describe('fs 二进制读写', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('readBytes 解 base64 → Uint8Array', async () => {
    mocks.invoke.mockResolvedValueOnce(bytesToBase64(new Uint8Array([1, 2, 3])))
    const fs = createFsApi('C:/vault')
    const bytes = await fs.readBytes('attachments/a.png')

    expect(mocks.invoke).toHaveBeenCalledWith('read_note_bytes', {
      vault: 'C:/vault',
      path: 'attachments/a.png',
    })
    expect(Array.from(bytes)).toEqual([1, 2, 3])
  })

  it('writeBytes 编 base64 再提交（不传 Uint8Array）', async () => {
    mocks.invoke.mockResolvedValueOnce(undefined)
    const fs = createFsApi('C:/vault')
    await fs.writeBytes('attachments/b.png', new Uint8Array([9, 8, 7]))

    expect(mocks.invoke).toHaveBeenCalledWith('write_note_bytes', {
      vault: 'C:/vault',
      path: 'attachments/b.png',
      base64: bytesToBase64(new Uint8Array([9, 8, 7])),
    })
  })
})
