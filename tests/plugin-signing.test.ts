/**
 * 插件签名的共享约定（rev173.77 起 · 契约 §7.4；rev173.142 升到 v2）。
 *
 * 验签本体在 Rust（`verify_plugin_signature`），这里测的是「payload 构造 / 文件解析 /
 * 信任根查找」—— 三处实现（`scripts/sign.mjs` / 前端 / Rust）必须对同一份字符串达成一致，
 * 所以用 Node 自己的 Ed25519 做一次真实往返，防止哪边改了格式却没人发现。
 */
import { createHash } from 'node:crypto'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  PLUGIN_SIGNATURE_PREFIX,
  findTrustedKey,
  parsePluginSignature,
  parseTrustedKeys,
  signingPayload,
} from '../src/lib/plugin-signing'

describe('signingPayload 格式（v2：入口 + 声明文件）', () => {
  it('固定前缀 + id + version + 入口 sha256 + 空文件段', () => {
    expect(signingPayload('demo', '1.2.3', 'abc123')).toBe('zn-plugin-v2|demo|1.2.3|abc123|')
    expect(PLUGIN_SIGNATURE_PREFIX).toBe('zn-plugin-v2')
  })

  it('文件按路径排序 —— 传入顺序不影响结果', () => {
    const a = signingPayload('demo', '1.0.0', 'entry', [
      { path: 'lib/b.js', sha256: 'bbb' },
      { path: 'lib/a.js', sha256: 'aaa' },
    ])
    const b = signingPayload('demo', '1.0.0', 'entry', [
      { path: 'lib/a.js', sha256: 'aaa' },
      { path: 'lib/b.js', sha256: 'bbb' },
    ])
    expect(a).toBe(b)
    expect(a).toBe('zn-plugin-v2|demo|1.0.0|entry|lib/a.js:aaa|lib/b.js:bbb')
  })

  it('任何一段变了 payload 就变（签名因此失效）', () => {
    const base = signingPayload('demo', '1.0.0', 'sha')
    expect(signingPayload('demo2', '1.0.0', 'sha')).not.toBe(base)
    expect(signingPayload('demo', '1.0.1', 'sha')).not.toBe(base)
    expect(signingPayload('demo', '1.0.0', 'sha2')).not.toBe(base)
  })

  it('v2 的核心：换掉一个声明文件 / 改文件名 / 删文件都会让 payload 变', () => {
    const base = signingPayload('demo', '1.0.0', 'sha', [
      { path: 'lib/a.js', sha256: 'aaa' },
      { path: 'lib/b.js', sha256: 'bbb' },
    ])
    // ① 换内容
    expect(
      signingPayload('demo', '1.0.0', 'sha', [
        { path: 'lib/a.js', sha256: 'evil' },
        { path: 'lib/b.js', sha256: 'bbb' },
      ]),
    ).not.toBe(base)
    // ② 换文件名（同名同内容搬到别的路径）
    expect(
      signingPayload('demo', '1.0.0', 'sha', [
        { path: 'lib/evil.js', sha256: 'aaa' },
        { path: 'lib/b.js', sha256: 'bbb' },
      ]),
    ).not.toBe(base)
    // ③ 删掉一个声明文件
    expect(signingPayload('demo', '1.0.0', 'sha', [{ path: 'lib/a.js', sha256: 'aaa' }])).not.toBe(base)
    // ④ 多塞一个声明文件
    expect(
      signingPayload('demo', '1.0.0', 'sha', [
        { path: 'lib/a.js', sha256: 'aaa' },
        { path: 'lib/b.js', sha256: 'bbb' },
        { path: 'lib/c.js', sha256: 'ccc' },
      ]),
    ).not.toBe(base)
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
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')

  it('多文件插件：签名能验过；换掉一个 lib 文件后验不过', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const entrySha = sha('export default { apply(){} }')
    const files = [
      { path: 'lib/a.js', sha256: sha('module.exports = 1') },
      { path: 'lib/b.js', sha256: sha('module.exports = 2') },
    ]
    const payload = signingPayload('demo', '1.0.0', entrySha, files)
    const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey)
    expect(sig.length).toBe(64)
    expect(verify(null, Buffer.from(payload, 'utf8'), publicKey, sig)).toBe(true)

    // 攻击者保留入口与签名，只换 lib/a.js 的内容 ⇒ 重算出的 payload 不同 ⇒ 验签失败
    const tampered = signingPayload('demo', '1.0.0', entrySha, [
      { path: 'lib/a.js', sha256: sha('module.exports = 666') },
      files[1],
    ])
    expect(verify(null, Buffer.from(tampered, 'utf8'), publicKey, sig)).toBe(false)
  })

  it('v1 格式的 payload 在 v2 下一律验不过（升级即失效，实测 0 个已签名插件）', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const v1 = 'zn-plugin-v1|demo|1.0.0|' + sha('x')
    const sig = sign(null, Buffer.from(v1, 'utf8'), privateKey)
    const v2 = signingPayload('demo', '1.0.0', sha('x'))
    expect(verify(null, Buffer.from(v2, 'utf8'), publicKey, sig)).toBe(false)
  })
})
