/**
 * 插件签名的共享约定（rev173.77 · 契约 §7.4）。
 *
 * 验签本体在 Rust（`verify_plugin_signature`），这里测的是「payload 构造 / 文件解析 /
 * 信任根查找」—— 三处实现（`scripts/sign.mjs` / 前端 / Rust）必须对同一份字符串达成一致，
 * 所以用 Node 自己的 Ed25519 做一次真实往返，防止哪边改了格式却没人发现。
 */
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  PLUGIN_SIGNATURE_PREFIX,
  findTrustedKey,
  parsePluginSignature,
  parseTrustedKeys,
  signingPayload,
} from '../src/lib/plugin-signing'

describe('signingPayload 格式', () => {
  it('固定前缀 + id + version + 入口 sha256，用 | 分隔', () => {
    expect(signingPayload('demo', '1.2.3', 'abc123')).toBe('zn-plugin-v1|demo|1.2.3|abc123')
    expect(PLUGIN_SIGNATURE_PREFIX).toBe('zn-plugin-v1')
  })

  it('任何一段变了 payload 就变（签名因此失效）', () => {
    const a = signingPayload('demo', '1.0.0', 'sha')
    expect(signingPayload('demo2', '1.0.0', 'sha')).not.toBe(a)
    expect(signingPayload('demo', '1.0.1', 'sha')).not.toBe(a)
    expect(signingPayload('demo', '1.0.0', 'sha2')).not.toBe(a)
  })
})

describe('parsePluginSignature', () => {
  it('合法签名文件通过', () => {
    const sig = parsePluginSignature(
      JSON.stringify({ alg: 'ed25519', keyId: 'aqua-2026', sig: 'AAAA' }),
    )
    expect(sig).toEqual({ alg: 'ed25519', keyId: 'aqua-2026', sig: 'AAAA' })
  })

  it('坏 JSON / 缺字段 / 错算法 → null', () => {
    expect(parsePluginSignature('not json')).toBeNull()
    expect(parsePluginSignature('{}')).toBeNull()
    expect(parsePluginSignature(JSON.stringify({ alg: 'rsa', keyId: 'k', sig: 's' }))).toBeNull()
    expect(parsePluginSignature(JSON.stringify({ alg: 'ed25519', keyId: '', sig: 's' }))).toBeNull()
    expect(parsePluginSignature(JSON.stringify({ alg: 'ed25519', keyId: 'k', sig: '' }))).toBeNull()
  })
})

describe('信任根', () => {
  it('解析 keys 数组；坏条目跳过', () => {
    const t = parseTrustedKeys(
      JSON.stringify({
        keys: [
          { keyId: 'a', publicKey: 'k1' },
          { keyId: '', publicKey: 'k2' },
          { keyId: 'c' },
          'nope',
          { keyId: 'd', publicKey: 'k4' },
        ],
      }),
    )
    expect(t?.keys).toEqual([
      { keyId: 'a', publicKey: 'k1' },
      { keyId: 'd', publicKey: 'k4' },
    ])
  })

  it('非 JSON / 没有 keys 数组 → null', () => {
    expect(parseTrustedKeys('oops')).toBeNull()
    expect(parseTrustedKeys('{}')).toBeNull()
  })

  it('按 keyId 取公钥；不存在返回 undefined', () => {
    const t = { keys: [{ keyId: 'a', publicKey: 'pk' }] }
    expect(findTrustedKey(t, 'a')).toBe('pk')
    expect(findTrustedKey(t, 'b')).toBeUndefined()
    expect(findTrustedKey(null, 'a')).toBeUndefined()
  })
})

describe('真实 Ed25519 往返（与 Rust 侧同一套 payload）', () => {
  it('签名能验过；改 payload 后验不过', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const payload = signingPayload('demo', '1.0.0', 'f'.repeat(64))
    const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey)

    expect(sig.length).toBe(64)
    expect(verify(null, Buffer.from(payload, 'utf8'), publicKey, sig)).toBe(true)
    expect(verify(null, Buffer.from(payload + 'x', 'utf8'), publicKey, sig)).toBe(false)
  })
})
