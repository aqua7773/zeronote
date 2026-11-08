/**
 * 安全插件 · 中间层 itemKey（rev173.447）的单测
 *
 * 这一层是为了「换环时不用解密全部明文」而加的（调研见 Standard Notes / Cryptomator）。
 * 关键断言有两条，缺一条就白做：
 *   ① 换环后**新环能解**、旧环解不开；
 *   ② 换环**只改包裹段**，数据段逐字节不变（证明正文没被重写、也没经过明文）。
 */
import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { argon2id } from '@noble/hashes/argon2.js'

import {
  open,
  openSelfContained,
  rewrapSelfContained,
  seal,
  sealSelfContained,
  sealItemKey,
  openItemKey,
} from '../examples/security/index.js'

const libs = { xchacha20poly1305, randomBytes, argon2id }
const decode = (b: Uint8Array) => new TextDecoder().decode(b)

describe('security · 中间层 itemKey', () => {
  const dekOld = randomBytes(32)
  const dekNew = randomBytes(32)

  it('自包含加密 → 解密回原文', () => {
    const payload = sealSelfContained(libs, dekOld, 'old', 'secrets', 'db', '平台 A / 账号 a')
    expect(payload.startsWith('zn2.')).toBe(true)
    expect(payload.split('.')).toHaveLength(5)
    expect(decode(openSelfContained(libs, dekOld, 'old', 'secrets', 'db', payload))).toBe(
      '平台 A / 账号 a',
    )
  })

  it('换环后：新环能解，旧环解不开', () => {
    const payload = sealSelfContained(libs, dekOld, 'old', 'secrets', 'db', 'secret')
    const rotated = rewrapSelfContained(libs, dekOld, 'old', dekNew, 'new', payload)

    expect(decode(openSelfContained(libs, dekNew, 'new', 'secrets', 'db', rotated))).toBe('secret')
    // 旧环 DEK 拿到重包后的文件必须失败（否则等于没换）
    expect(() => openSelfContained(libs, dekOld, 'old', 'secrets', 'db', rotated)).toThrow()
  })

  it('换环只改包裹段：数据段逐字节不变', () => {
    const payload = sealSelfContained(libs, dekOld, 'old', 'secrets', 'db', '不动')
    const rotated = rewrapSelfContained(libs, dekOld, 'old', dekNew, 'new', payload)
    const a = payload.split('.')
    const b = rotated.split('.')

    expect(b[3]).toBe(a[3]) // 数据 nonce 原样
    expect(b[4]).toBe(a[4]) // 数据密文原样 ⇒ 正文没被重新加密
    expect(b[1]).not.toBe(a[1]) // 包裹段必须换
    expect(b[2]).not.toBe(a[2])
  })

  it('包裹段绑定环：旧包裹块挂到新环下解不开', () => {
    const itemKey = randomBytes(32)
    const wrapped = sealItemKey(libs, dekOld, 'old', itemKey)
    expect(wrapped.startsWith('wk1.')).toBe(true)
    expect(openItemKey(libs, dekOld, 'old', wrapped)).toEqual(itemKey)
    expect(() => openItemKey(libs, dekNew, 'new', wrapped)).toThrow()
    // 环 id 参与 AAD：同一个 DEK 换个环名也解不开
    expect(() => openItemKey(libs, dekOld, 'another', wrapped)).toThrow()
  })

  it('旧 zn1 格式仍能解（兼容）', () => {
    const payload = seal(libs, dekOld, 'old|secrets|data', '老数据')
    expect(payload.startsWith('zn1.')).toBe(true)
    expect(decode(open(libs, dekOld, 'old|secrets|data', payload))).toBe('老数据')
  })

  it('坏格式直接抛错，不猜', () => {
    expect(() => openSelfContained(libs, dekOld, 'old', 'secrets', 'db', 'zn1.a.b')).toThrow()
    expect(() => openSelfContained(libs, dekOld, 'old', 'secrets', 'db', 'zn2.x.y.z')).toThrow()
  })
})
