/**
 * 安全插件密码学核心的单测 —— rev173.160（方案 `docs/安全插件-方案-2026-10-25.md`）
 *
 * 只测 `examples/security/crypto.js` 的纯逻辑；插件与宿主 / store / UI 的交互靠桌面 CDP 实测。
 *
 * 覆盖原则（`docs/开发约定.md` §4）：每个断言都要有**反向用例** ——
 * 错密码、改一字节、跨容器、跨环，全部必须失败。只有"正向能解"不算测过。
 *
 * 测试用 `t=1, m=8` 的极小 Argon2 参数：生产是 `t=3, m=64MiB`（约 1 s），
 * 测试里每派生 64 MiB 会让 20 多个用例跑十几秒。**参数只影响强度，不影响逻辑**。
 */
import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { argon2id } from '@noble/hashes/argon2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import {
  DEFAULT_RINGS,
  bindBiometric,
  biometricErrorMessage,
  changePassword,
  createRing,
  createVault,
  decryptData,
  deviceBinding,
  dropRing,
  encryptData,
  fromB64url,
  fromBytes,
  generateRecoveryCode,
  getRing,
  migrateBiometrics,
  normalizeAnswer,
  normalizeCode,
  open,
  otherDeviceCount,
  planAutoUnlock,
  putRing,
  recoverWithAnswer,
  recoverWithCode,
  resetPasswordWithDek,
  seal,
  setupRecovery,
  signData,
  shouldWaitForFocus,
  toB64url,
  toBytes,
  unbindBiometric,
  unlockRing,
  unlockWithBiometric,
  verifyData,
  windowsHelloAdapter,
  vaultFileOf,
  vaultPartPayload,
  parseVaultPart,
  LEGACY_VAULT_FILE,
  legacyPurgeWarning,
  VAULT_DIR,
} from '../examples/security/index.js'

/** 生产端从 `/vendor/noble/…` 注入，测试端直接用 node_modules 的同版本 */
const libs = { xchacha20poly1305, randomBytes, argon2id, sha256, hmac, hkdf }
const FAST = { t: 1, m: 8, p: 1 }

describe('base64url 编解码', () => {
  it('各种长度往返一致（含 0 / 1 / 2 字节的尾巴）', () => {
    for (let n = 0; n <= 17; n++) {
      const raw = randomBytes(n)
      const back = fromB64url(toB64url(raw))
      expect(back.length).toBe(n)
      expect(Array.from(back)).toEqual(Array.from(raw))
    }
  })

  it('不含 padding、不含 +/（URL 安全）', () => {
    const s = toB64url(randomBytes(64))
    expect(s).not.toContain('=')
    expect(s).not.toContain('+')
    expect(s).not.toContain('/')
  })

  it('非法字符直接抛错，不静默返回空', () => {
    expect(() => fromB64url('abc$')).toThrow(/非法字符/)
  })
})

describe('密钥环：建立 / 解锁', () => {
  /**
   * rev173.165 · 期 2a：默认 KDF 档 = RFC 9106 推荐档（t=3 / m=64 MiB），**定死不动**。
   *
   * 手机真机实测三档后才敢定：t=2/19MiB 165 ms · **t=3/64MiB 812 ms** · t=1/128MiB 574 ms
   * （三档各 3 次取中位数；手机比桌面 Node 还快约 0.8×，推翻了「手机 1–4× 慢」的估算）。
   * 方案原本留的降档条件是「手机 > 5 s」，实测 0.81 s ⇒ 不降。
   *
   * 这条用例是**锁**：以后谁把默认档调小（比如为了跑得快），这里立刻红 ——
   * 降档等于削弱抗离线爆破强度，必须是显式决策而不是顺手改。
   */
  it('默认 KDF 档是 RFC 9106 推荐档（rev173.165 手机实测后定死）', () => {
    expect(DEFAULT_RINGS.notes.kdf).toEqual({ t: 3, m: 65536, p: 1 })
    expect(DEFAULT_RINGS.secrets.kdf).toEqual({ t: 3, m: 65536, p: 1 })
    // 反向：两个环的 kdf 是**各自的对象**，改一个不能串到另一个
    expect(DEFAULT_RINGS.notes.kdf).not.toBe(DEFAULT_RINGS.secrets.kdf)
  })

  it('首次建立后能用同一把密码解出同一把 DEK', () => {
    const { ring, dek } = createRing(libs, 'notes', '主密码-A', { kdf: FAST })
    const got = unlockRing(libs, ring, '主密码-A')
    expect(Array.from(got.dek)).toEqual(Array.from(dek))
    expect(ring.wrapped.notes).toMatch(/^zn1\./)
  })

  it('密码错就解不开（AEAD 认证失败，不是返回空）', () => {
    const { ring } = createRing(libs, 'notes', '主密码-A', { kdf: FAST })
    expect(() => unlockRing(libs, ring, '主密码-B')).toThrow()
  })

  it('vault.json 里没有任何明文密钥（只有 salt 与密文）', () => {
    const { ring } = createRing(libs, 'notes', '主密码-A', { kdf: FAST })
    const text = JSON.stringify(ring)
    expect(text).toContain('argon2id') // kdf 自述在
    expect(text).not.toContain('主密码-A'.slice(0, 3))
    // salt 与 wrapped 都是 base64url，长度固定；密钥本体 32B 无处可藏
    expect(Object.keys(ring.wrapped)).toEqual(['notes'])
    expect(ring.wrapped.notes.split('.').length).toBe(3)
  })
})

describe('双密钥环：互不串（2026-10-25 用户拍板的核心）', () => {
  it('A 环的密码解不开 B 环', () => {
    const notes = createRing(libs, 'notes', '笔记密码', { kdf: FAST }).ring
    const secrets = createRing(libs, 'secrets', '账号密码', { kdf: FAST }).ring
    expect(() => unlockRing(libs, secrets, '笔记密码')).toThrow()
    expect(() => unlockRing(libs, notes, '账号密码')).toThrow()
  })

  it('就算两环用同一个密码，DEK 也不同、密文互不可解（AAD 绑定环 id）', () => {
    const same = '同一个密码'
    const a = createRing(libs, 'notes', same, { kdf: FAST })
    const b = createRing(libs, 'secrets', same, { kdf: FAST })
    expect(Array.from(a.dek)).not.toEqual(Array.from(b.dek))

    const fromA = encryptData(libs, a.dek, 'notes', 'notes', '笔记正文')
    expect(fromBytes(decryptData(libs, a.dek, 'notes', 'notes', fromA))).toBe('笔记正文')

    // 用 A 的 DEK 解 B 的容器密文（跨环）⇒ 必须失败
    const fromB = encryptData(libs, b.dek, 'secrets', 'secrets', '{"p":"secret"}')
    expect(() => decryptData(libs, a.dek, 'secrets', 'secrets', fromB)).toThrow()
  })
})

describe('数据加解密', () => {
  it('字符串与二进制都能往返', () => {
    const { dek } = createRing(libs, 'notes', 'pw', { kdf: FAST })
    const text = encryptData(libs, dek, 'notes', 'notes', '一段中文正文 😀')
    expect(fromBytes(decryptData(libs, dek, 'notes', 'notes', text))).toBe('一段中文正文 😀')

    const bin = randomBytes(1024)
    const enc = encryptData(libs, dek, 'notes', 'notes', bin)
    expect(Array.from(decryptData(libs, dek, 'notes', 'notes', enc))).toEqual(Array.from(bin))
  })

  it('密文改一个字节 ⇒ 解密失败（AEAD，不返回部分明文）', () => {
    const { dek } = createRing(libs, 'notes', 'pw', { kdf: FAST })
    const payload = encryptData(libs, dek, 'notes', 'notes', '原文')
    const [version, nonce, ct] = payload.split('.')
    const bytes = fromB64url(ct)
    bytes[Math.floor(bytes.length / 2)] ^= 0x01 // 改一个字节
    const tampered = `${version}.${nonce}.${toB64url(bytes)}`
    expect(() => decryptData(libs, dek, 'notes', 'notes', tampered)).toThrow()
  })

  it('AAD 绑定容器：A 容器的密文贴上 B 容器标签解不开', () => {
    const { dek } = createRing(libs, 'notes', 'pw', { kdf: FAST })
    const payload = encryptData(libs, dek, 'notes', 'notes', '只在 notes 容器')
    expect(() => decryptData(libs, dek, 'notes', 'private', payload)).toThrow()
  })

  it('格式不对的密文给出明确报错（不猜、不静默）', () => {
    const { dek } = createRing(libs, 'notes', 'pw', { kdf: FAST })
    expect(() => decryptData(libs, dek, 'notes', 'notes', 'zn0.aaa.bbb')).toThrow(/格式不认识/)
    expect(() => decryptData(libs, dek, 'notes', 'notes', '随便一串')).toThrow(/格式不认识/)
  })
})

describe('换主密码', () => {
  it('旧密文仍可解、旧密码失效、新密码可用（数据一个字节没动）', () => {
    const { ring, dek } = createRing(libs, 'notes', '旧密码', { kdf: FAST })
    const payload = encryptData(libs, dek, 'notes', 'notes', '换密码前写的')

    const next = changePassword(libs, ring, '旧密码', '新密码')

    // 旧密码不再能解锁
    expect(() => unlockRing(libs, next, '旧密码')).toThrow()
    // 新密码能解出同一把 DEK ⇒ 旧密文照旧可解
    const got = unlockRing(libs, next, '新密码')
    expect(Array.from(got.dek)).toEqual(Array.from(dek))
    expect(fromBytes(decryptData(libs, got.dek, 'notes', 'notes', payload))).toBe('换密码前写的')
    // salt 换了（否则换了密码等于没换 salt）
    expect(next.kdf.salt).not.toBe(ring.kdf.salt)
  })
})

describe('恢复：安全问题 + 恢复码双路径', () => {
  const build = () => {
    const { ring, dek } = createRing(libs, 'secrets', '主密码', { kdf: FAST })
    const code = generateRecoveryCode(libs)
    const withRecovery = setupRecovery(libs, ring, dek, {
      question: '第一只猫叫什么',
      answer: '  MiuMiu  ',
      code,
    })
    return { ring: withRecovery, dek, code }
  }

  it('只给恢复码也能设（不强制填安全问题）', () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const code = generateRecoveryCode(libs)
    const r = setupRecovery(libs, ring, dek, { code })

    expect(r.recovery.answerWrap).toBeUndefined()
    expect(Array.from(recoverWithCode(libs, r, code))).toEqual(Array.from(dek))
    // 没设问题 ⇒ 走问题路径要明确报错，不能静默给出空 DEK
    expect(() => recoverWithAnswer(libs, r, '随便')).toThrow(/没有设置恢复问题/)
  })

  it('两条都不给 ⇒ 当场抛错（不能建出一个永远恢复不了的环）', () => {
    const { ring, dek } = createRing(libs, 'notes', 'pw', { kdf: FAST })
    expect(() => setupRecovery(libs, ring, dek, { question: '只有问题没有答案' })).toThrow(
      /恢复设置不完整/,
    )
  })

  it('恢复码是 24 个字符 + 4 段分隔（去掉 0/O/1/I）', () => {
    const code = generateRecoveryCode(libs)
    expect(normalizeCode(code).length).toBe(24)
    expect(normalizeCode(code)).not.toMatch(/[0O1I]/)
    expect(code.split('-').length).toBe(6)
  })

  it('答案宽松匹配：大小写不同、前后带空格也认', () => {
    const { ring, dek } = build()
    const got = recoverWithAnswer(libs, ring, 'miumiu')
    expect(Array.from(got)).toEqual(Array.from(dek))
    expect(Array.from(recoverWithAnswer(libs, ring, '  MiUmIu  '))).toEqual(Array.from(dek))
  })

  it('恢复码宽松匹配：漏横杠 / 小写也能用', () => {
    const { ring, dek, code } = build()
    expect(Array.from(recoverWithCode(libs, ring, code))).toEqual(Array.from(dek))
    expect(Array.from(recoverWithCode(libs, ring, code.replace(/-/g, '').toLowerCase()))).toEqual(
      Array.from(dek),
    )
  })

  it('答案错就解不开（恢复路径也是 AEAD 保护的）', () => {
    const { ring } = build()
    expect(() => recoverWithAnswer(libs, ring, '不是这只猫')).toThrow()
    expect(() => recoverWithCode(libs, ring, 'AAAAAAAAAAAAAAAAAAAAAAAA')).toThrow()
  })

  it('恢复后重设主密码：不需要旧密码，新密码能解、旧密文不变', () => {
    const { ring, dek } = build()
    const payload = encryptData(libs, dek, 'secrets', 'secrets', '{"site":"github.com"}')
    const recovered = recoverWithAnswer(libs, ring, 'miumiu')
    const next = resetPasswordWithDek(libs, ring, recovered, '全新密码')

    expect(() => unlockRing(libs, next, '主密码')).toThrow()
    const got = unlockRing(libs, next, '全新密码')
    expect(fromBytes(decryptData(libs, got.dek, 'secrets', 'secrets', payload))).toBe(
      '{"site":"github.com"}',
    )
  })
})

describe('签名（crypto.sign / verify）', () => {
  it('往返通过；改数据 / 跨容器 / 格式不对都返回 false（不抛）', () => {
    const { dek } = createRing(libs, 'notes', 'pw', { kdf: FAST })
    const data = toBytes('要签名的内容')
    const sig = signData(libs, dek, 'notes', 'notes', data)

    expect(sig).toMatch(/^hs1\./)
    expect(verifyData(libs, dek, 'notes', 'notes', data, sig)).toBe(true)
    expect(verifyData(libs, dek, 'notes', 'notes', toBytes('改过的内容'), sig)).toBe(false)
    expect(verifyData(libs, dek, 'notes', 'other', data, sig)).toBe(false)
    expect(verifyData(libs, dek, 'notes', 'notes', data, 'hs1.不是base64')).toBe(false)
    expect(verifyData(libs, dek, 'notes', 'notes', data, 'hs0.abc')).toBe(false)
  })

  it('换一把 DEK 就验不过（签名不是全局密钥）', () => {
    const a = createRing(libs, 'notes', 'pw', { kdf: FAST })
    const b = createRing(libs, 'notes', 'pw', { kdf: FAST })
    const data = toBytes('x')
    const sig = signData(libs, a.dek, 'notes', 'notes', data)
    expect(verifyData(libs, b.dek, 'notes', 'notes', data, sig)).toBe(false)
  })
})

describe('vault 文件操作（纯函数，不改入参）', () => {
  it('createVault / putRing / getRing / dropRing', () => {
    const empty = createVault()
    expect(empty).toEqual({ v: 1, rings: {} })

    const ring = createRing(libs, 'notes', 'pw', { kdf: FAST }).ring
    const withRing = putRing(empty, ring)

    expect(getRing(withRing, 'notes')).toBe(ring)
    expect(getRing(withRing, 'secrets')).toBeNull()
    // 入参没被改
    expect(Object.keys(empty.rings)).toEqual([])

    const dropped = dropRing(withRing, 'notes')
    expect(getRing(dropped, 'notes')).toBeNull()
    expect(Object.keys(withRing.rings)).toEqual(['notes'])
  })
})

describe('小工具', () => {
  it('normalizeAnswer 去前后空格 + 转小写', () => {
    expect(normalizeAnswer('  Hello World  ')).toBe('hello world')
    expect(normalizeAnswer('中文答案 ')).toBe('中文答案')
  })

  it('normalizeCode 去空白与横杠 + 转大写', () => {
    expect(normalizeCode(' abcd-efgh 1234 ')).toBe('ABCDEFGH1234')
  })
})

/**
 * 期 2b / 2c：生物识别绑定（2026-10-26）
 *
 * 纯函数层只认「适配器」：Android 是 Keystore 的 AES-GCM（实测 2026-10-26 三次弹窗后
 * 加密 → 解密 → 篡改被拒），Windows 是 hello_sign → HKDF → KEK。这里用**真的 XChaCha**
 * 做假适配器，而不是"交换字节"—— 篡改用例才能真的被 AEAD 拦住。
 */
describe('生物识别绑定（适配器注入 · rev173.173 起按设备）', () => {
  /** 假设备：一把随机 key + 真 AEAD；seal/open 必须用同一个实例 */
  const fakeDevice = (platform = 'test') => {
    const key = randomBytes(32)
    return {
      platform,
      async seal(dek: Uint8Array) {
        return `wrap.${seal(libs, key, 'bio', dek)}`
      },
      async open(wrapped: string) {
        return open(libs, key, 'bio', String(wrapped).slice('wrap.'.length))
      },
    }
  }

  it('绑定只写本机那份，主密码容器一个字节不动（纯函数）', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const next = await bindBiometric(ring, dek, fakeDevice(), 'dev-a')
    expect(next.wrapped).toEqual(ring.wrapped)
    expect(next.biometrics['dev-a'].platform).toBe('test')
    expect(next.biometrics['dev-a'].wrapped).toMatch(/^wrap\.zn1\./)
    // 旧单段不再写；原对象没被改
    expect(next.biometric).toBeUndefined()
    expect(ring.biometrics).toBeUndefined()
  })

  it('能解出同一把 DEK（逐字节）', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const device = fakeDevice()
    const next = await bindBiometric(ring, dek, device, 'dev-a')
    const got = await unlockWithBiometric(next, device, 'dev-a')
    expect(Array.from(got)).toEqual(Array.from(dek))
  })

  it('换主密码后生物识别仍解出同一把 DEK（DEK 没变，只重包主密码那份）', async () => {
    const { ring, dek } = createRing(libs, 'secrets', '旧密码', { kdf: FAST })
    const device = fakeDevice()
    const bound = await bindBiometric(ring, dek, device, 'dev-a')
    const next = changePassword(libs, bound, '旧密码', '新密码')
    expect(next.biometrics['dev-a']).toEqual(bound.biometrics['dev-a'])
    expect(Array.from(await unlockWithBiometric(next, device, 'dev-a'))).toEqual(Array.from(dek))
  })

  it('解除绑定后没有 biometric 段，再用生物识别解锁必须抛错', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const device = fakeDevice()
    const next = unbindBiometric(await bindBiometric(ring, dek, device, 'dev-a'), 'dev-a')
    expect(next.biometrics).toBeUndefined()
    expect(next.biometric).toBeUndefined()
    await expect(unlockWithBiometric(next, device, 'dev-a')).rejects.toThrow(/没有绑定生物识别/)
  })

  it('没有适配器时绑定 / 解锁都抛错（不静默降级）', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    await expect(bindBiometric(ring, dek, null)).rejects.toThrow(/没有可用的生物识别/)
    // 没绑定 ⇒ 先报"没绑定"（比"没适配器"更贴近事实）
    await expect(unlockWithBiometric(ring, null)).rejects.toThrow(/没有绑定生物识别/)
    // 有绑定但没适配器 ⇒ 报"没有可用的生物识别"
    await expect(
      unlockWithBiometric({ ...ring, biometrics: { local: { wrapped: 'x' } } }, null),
    ).rejects.toThrow(/没有可用的生物识别/)
  })

  it('包裹被改一个字节 ⇒ AEAD 抛错（真机上是 AEADBadTagException）', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const device = fakeDevice()
    const next = await bindBiometric(ring, dek, device, 'dev-a')
    const w = next.biometrics['dev-a'].wrapped
    const tampered = {
      ...next,
      biometrics: {
        ...next.biometrics,
        'dev-a': {
          ...next.biometrics['dev-a'],
          wrapped: w.slice(0, -2) + (w.endsWith('AA') ? 'BB' : 'AA'),
        },
      },
    }
    await expect(unlockWithBiometric(tampered, device, 'dev-a')).rejects.toThrow()
  })

  it('解出的密钥长度不对（适配器返回 16 字节）⇒ 拒绝，不交给上层当 DEK 用', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const short = {
      platform: 'test',
      async seal() {
        return 'x'
      },
      async open() {
        return new Uint8Array(16)
      },
    }
    const next = await bindBiometric(ring, dek, short, 'dev-a')
    await expect(unlockWithBiometric(next, short, 'dev-a')).rejects.toThrow(/长度不对/)
  })

  it('两台设备各绑各的：都能解出同一把 DEK，跨设备开不开（rev173.173）', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const devA = fakeDevice('android')
    const devB = fakeDevice('windows')
    const one = await bindBiometric(ring, dek, devA, 'dev-a')
    const two = await bindBiometric(one, dek, devB, 'dev-b')
    expect(Object.keys(two.biometrics).sort()).toEqual(['dev-a', 'dev-b'])
    // 各自用自己那把能解
    expect(Array.from(await unlockWithBiometric(two, devA, 'dev-a'))).toEqual(Array.from(dek))
    expect(Array.from(await unlockWithBiometric(two, devB, 'dev-b'))).toEqual(Array.from(dek))
    // 拿 B 的适配器去开 A 那份 ⇒ AEAD 拒（不同设备密钥不同）
    await expect(unlockWithBiometric(two, devB, 'dev-a')).rejects.toThrow()
    expect(deviceBinding(two, 'dev-a').platform).toBe('android')
    expect(otherDeviceCount(two, 'dev-b')).toBe(1)
  })

  it('解除只删本机那份，别的设备仍能解（换机只失效那一台）', async () => {
    const { ring, dek } = createRing(libs, 'secrets', 'pw', { kdf: FAST })
    const devA = fakeDevice()
    const devB = fakeDevice()
    const both = await bindBiometric(await bindBiometric(ring, dek, devA, 'dev-a'), dek, devB, 'dev-b')
    const cleared = unbindBiometric(both, 'dev-b')
    expect(cleared.biometrics['dev-a']).toBeTruthy()
    expect(cleared.biometrics['dev-b']).toBeUndefined()
    await expect(unlockWithBiometric(cleared, devB, 'dev-b')).rejects.toThrow(/没有绑定生物识别/)
    expect(Array.from(await unlockWithBiometric(cleared, devA, 'dev-a'))).toEqual(Array.from(dek))
    expect(otherDeviceCount(cleared, 'dev-b')).toBe(1)
  })

  it('旧单段迁移：biometric → biometrics[<本机>]，别的环原样不动；没东西可迁返回 null', () => {
    const legacy = {
      rings: {
        secrets: { id: 'secrets', biometric: { platform: 'android', wrapped: 'wrap.x', at: 1 }, wrapped: {} },
        notes: { id: 'notes', wrapped: {} },
      },
    }
    const next = migrateBiometrics(legacy, 'dev-a')
    expect(next.rings.secrets.biometric).toBeUndefined()
    expect(next.rings.secrets.biometrics['dev-a']).toEqual({ platform: 'android', wrapped: 'wrap.x', at: 1 })
    expect(next.rings.notes).toBe(legacy.rings.notes)
    // 已经迁过 / 本来就没有 ⇒ 不返回新对象（避免每次启动白写盘）
    expect(migrateBiometrics(next, 'dev-a')).toBeNull()
    expect(migrateBiometrics({ rings: {} }, 'dev-a')).toBeNull()
  })
})

describe('Windows Hello 适配器（rev173.169）', () => {
  /** 假 invoke：hello_sign 返回**确定性**的假签名（真机是 RSA-PKCS1 v1.5，同为确定性） */
  const fakeInvoke = (signature = new Uint8Array(32).fill(7)) => async (cmd: string) => {
    if (cmd === 'hello_enroll') return undefined
    if (cmd === 'hello_sign') return toB64url(signature)
    throw new Error(`unexpected command: ${cmd}`)
  }

  it('seal → open 往返解出同一把 DEK，包裹格式是 hello1.<challenge>.<zn1…>', async () => {
    const adapter = windowsHelloAdapter(fakeInvoke() as never, libs)
    const dek = randomBytes(32)
    const blob = await adapter.seal(dek, 'secrets')
    expect(adapter.platform).toBe('windows')
    expect(blob).toMatch(/^hello1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const back = await adapter.open(blob, 'secrets')
    expect(Array.from(back)).toEqual(Array.from(dek))
  })

  it('换一份签名（模拟"签名不确定"）⇒ 解不开', async () => {
    const sealer = windowsHelloAdapter(fakeInvoke(new Uint8Array(32).fill(7)) as never, libs)
    const dek = randomBytes(32)
    const blob = await sealer.seal(dek, 'secrets')
    const other = windowsHelloAdapter(fakeInvoke(new Uint8Array(32).fill(8)) as never, libs)
    await expect(other.open(blob, 'secrets')).rejects.toThrow()
  })

  it('篡改包裹 / 格式不认识都拒绝', async () => {
    const adapter = windowsHelloAdapter(fakeInvoke() as never, libs)
    const dek = randomBytes(32)
    const blob = await adapter.seal(dek, 'secrets')
    const parts = blob.split('.')
    // 改最后一段的最后一个字符
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1) + (parts[parts.length - 1].endsWith('A') ? 'B' : 'A')
    await expect(adapter.open(parts.join('.'), 'secrets')).rejects.toThrow()
    await expect(adapter.open('hello1.short', 'secrets')).rejects.toThrow(/格式不认识/)
    await expect(adapter.open('android1.abc.def', 'secrets')).rejects.toThrow(/格式不认识/)
  })
})

describe('生物识别错误翻译（给用户看的文案）', () => {
  it('AEAD 失败 → 提示多半是换过指纹', () => {
    expect(biometricErrorMessage(new Error('Failed to decrypt the data: AEADBadTagException'))).toMatch(
      /换过/,
    )
    expect(biometricErrorMessage('AEADBadTagException')).toMatch(/重新绑定/)
  })

  it('取消 / 锁定 / 没录指纹 各自翻成人话', () => {
    expect(biometricErrorMessage(new Error('userCancel'))).toBe('已取消')
    expect(biometricErrorMessage('biometryLockout')).toMatch(/次数过多/)
    expect(biometricErrorMessage('biometryNotEnrolled')).toMatch(/没有录入指纹/)
    expect(biometricErrorMessage('biometryNotAvailable')).toMatch(/用不了指纹/)
  })

  it('认不出的错误原样带出来（不吞）', () => {
    expect(biometricErrorMessage(new Error('weird-error-42'))).toContain('weird-error-42')
  })
})

describe('锁定后自动弹生物识别（rev173.171）', () => {
  /** 一旦条件完美：桌面、窗口在前台、有绑定、没解锁、没在派生 */
  const ready = {
    hasBiometric: true,
    adapterReady: true,
    unlocked: false,
    busy: false,
    reason: 'idle',
    platform: 'windows',
    visibility: 'visible',
    hasFocus: true,
  }

  it('桌面在场 + 已绑定 ⇒ 立刻弹', () => {
    expect(planAutoUnlock(ready)).toBe('go')
  })

  it('桌面窗口失焦 ⇒ 挂起，等用户点回窗口再弹（Hello 不抢焦点）', () => {
    expect(planAutoUnlock({ ...ready, hasFocus: false })).toBe('wait')
  })

  it('手机：切后台挂起；WebView 没有键焦点但可见时照弹', () => {
    expect(planAutoUnlock({ ...ready, platform: 'android', visibility: 'hidden', hasFocus: false })).toBe(
      'wait',
    )
    expect(planAutoUnlock({ ...ready, platform: 'android', hasFocus: false })).toBe('go')
  })

  it('没绑 / 没适配器 / 已解锁 / 正在派生 / 别的插件锁的 ⇒ 一概不弹', () => {
    expect(planAutoUnlock({ ...ready, hasBiometric: false })).toBe('skip')
    expect(planAutoUnlock({ ...ready, adapterReady: false })).toBe('skip')
    expect(planAutoUnlock({ ...ready, unlocked: true })).toBe('skip')
    expect(planAutoUnlock({ ...ready, busy: true })).toBe('skip')
    expect(planAutoUnlock({ ...ready, reason: 'service' })).toBe('skip')
  })

  it('手动锁定也弹（用户刚锁定、人在场）；前后台只看可见性与桌面焦点', () => {
    expect(planAutoUnlock({ ...ready, reason: 'manual' })).toBe('go')
    expect(shouldWaitForFocus({ platform: 'android', visibility: 'hidden', hasFocus: true })).toBe(true)
    expect(shouldWaitForFocus({ platform: 'android', visibility: 'visible', hasFocus: false })).toBe(false)
    expect(shouldWaitForFocus({ platform: 'windows', visibility: 'visible', hasFocus: false })).toBe(true)
    expect(shouldWaitForFocus({ platform: 'windows', visibility: 'visible', hasFocus: true })).toBe(false)
  })
})

describe('vault 按环拆文件（rev173.182 · 私密文件夹期 3）', () => {
  it('每个环一个固定文件名（同步插件靠固定清单搬，不能是动态扫描）', () => {
    expect(VAULT_DIR).toBe('.zn/security')
    expect(vaultFileOf('notes')).toBe('.zn/security/vault.notes.json')
    expect(vaultFileOf('secrets')).toBe('.zn/security/vault.secrets.json')
    expect(LEGACY_VAULT_FILE).toBe('.zn/security/vault.json')
  })

  it('单环文件往返：payload → parse 回来是同一把环', () => {
    const ring = { id: 'notes', kdf: { t: 1, m: 8, p: 1, salt: 'abc' }, wrapped: { notes: 'zn1.x' } }
    expect(parseVaultPart(vaultPartPayload(ring))).toEqual(ring)
  })

  it('删不掉旧 vault.json 时给的是「要手动删」的提示（rev173.184 · 失败不静默）', () => {
    const withErr = legacyPurgeWarning('权限不足')
    expect(withErr).toContain('.zn/security/vault.json')
    expect(withErr).toContain('权限不足')
    expect(withErr).toContain('手动删除')

    // 删除调用没报错、文件却还在（被同步 / 备份写回）也要说清楚
    const noErr = legacyPurgeWarning('')
    expect(noErr).toContain('.zn/security/vault.json')
    expect(noErr).toContain('删除调用没报错')
    expect(noErr).toContain('手动删除')
  })

  it('坏内容一律抛错（调用方据此标 corrupt、**不覆盖**原文件）', () => {
    expect(() => parseVaultPart('不是 JSON')).toThrow()
    expect(() => parseVaultPart('null')).toThrow()
    expect(() => parseVaultPart(JSON.stringify({ v: 2 }))).toThrow(/缺 ring.id/)
    expect(() => parseVaultPart(JSON.stringify({ v: 2, ring: {} }))).toThrow(/缺 ring.id/)
  })

  it('**两个环的文件互不包含**（拆开的目的：各改各的不会交叉冲突）', () => {
    const notesRing = { id: 'notes', kdf: {}, wrapped: { notes: 'a' } }
    const secretsRing = { id: 'secrets', kdf: {}, wrapped: { secrets: 'b' } }
    const notesText = vaultPartPayload(notesRing)
    const secretsText = vaultPartPayload(secretsRing)
    expect(notesText).not.toContain('secrets')
    expect(secretsText).not.toContain('notes')
    expect(Object.keys(parseVaultPart(notesText).wrapped)).toEqual(['notes'])
  })
})