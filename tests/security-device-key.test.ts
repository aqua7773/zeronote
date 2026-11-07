/**
 * 安全插件 · 设备级指纹 DK（期 3 · 一次绑定多环继承）的单测 —— rev173.413
 *
 * 只测纯函数（包裹 / 解包 / 设备文件解析）；指纹弹窗与 Keystore 走真机 G2。
 * 关键断言是**反向用例**：跨环搬移、换 DK、坏文件，必须失败而不是静默串数据。
 */
import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { argon2id } from '@noble/hashes/argon2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { hkdf } from '@noble/hashes/hkdf.js'

import {
  deviceFileContent,
  deviceFileOf,
  parseDeviceFile,
  unwrapDeviceDek,
  wrapDeviceDek,
} from '../examples/security/index.js'

const libs = { xchacha20poly1305, randomBytes, argon2id, sha256, hmac, hkdf }

describe('security · 设备级指纹 DK', () => {
  it('同一个 DK 解两个环的 DEK，各解各的', () => {
    const dk = randomBytes(32)
    const dekA = randomBytes(32)
    const dekB = randomBytes(32)
    const a = wrapDeviceDek(libs, dk, 'notes', dekA)
    const b = wrapDeviceDek(libs, dk, 'secrets', dekB)
    expect(Array.from(unwrapDeviceDek(libs, dk, 'notes', a))).toEqual(Array.from(dekA))
    expect(Array.from(unwrapDeviceDek(libs, dk, 'secrets', b))).toEqual(Array.from(dekB))
  })

  it('AAD 绑环：把 notes 的包裹拿到 secrets 下解必须失败（不静默串数据）', () => {
    const dk = randomBytes(32)
    const wrapped = wrapDeviceDek(libs, dk, 'notes', randomBytes(32))
    expect(() => unwrapDeviceDek(libs, dk, 'secrets', wrapped)).toThrow()
  })

  it('换一把 DK ⇒ 解不开（重新绑定不会复活旧包裹）', () => {
    const wrapped = wrapDeviceDek(libs, randomBytes(32), 'notes', randomBytes(32))
    expect(() => unwrapDeviceDek(libs, randomBytes(32), 'notes', wrapped)).toThrow()
  })

  it('设备文件路径 / 内容 / 解析往返', () => {
    expect(deviceFileOf('abc')).toContain('device.abc.json')
    const text = deviceFileContent('windows', 'hello1.xxx', 123)
    expect(parseDeviceFile(text)).toEqual({ platform: 'windows', wrapped: 'hello1.xxx', at: 123 })
  })

  it('坏设备文件 ⇒ null（面板不显示指纹入口，不崩）', () => {
    expect(parseDeviceFile('{bad')).toBeNull()
    expect(parseDeviceFile('null')).toBeNull()
    expect(parseDeviceFile('{"platform":"x"}')).toBeNull()
  })
})
