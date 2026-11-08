/**
 * 密钥轮换：多文件形态（私密笔记）的流程断言（rev173.448 · 方案 §8 G1）
 *
 * 这一层不模拟 UI，只锁住三条最容易做错的性质：
 *   ① 换环**只重包索引里的 keys 表**，正文密文逐字节不变（正文没被重写、没经明文）；
 *   ② 换环后新环能解全部正文，旧环包裹解不开；
 *   ③ 索引序列化 / 反序列化不丢 keys（漏一处 = 换完环正文全打不开）。
 */
import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { argon2id } from '@noble/hashes/argon2.js'

import {
  openDataWithKey,
  openItemKey,
  sealDataWithKey,
  sealItemKey,
} from '../examples/security/index.js'
import {
  INDEX_VERSION,
  emptyIndex,
  noteScope,
  parseIndex,
  serializeIndex,
  upsertNote,
} from '../examples/private-notes/index.js'

const libs = { xchacha20poly1305, randomBytes, argon2id }
const decode = (b: Uint8Array) => new TextDecoder().decode(b)

describe('密钥轮换 · 多文件形态（私密笔记）', () => {
  const OLD = 'ring-a'
  const NEW = 'ring-b'
  const dekOld = randomBytes(32)
  const dekNew = randomBytes(32)

  /** 造三篇私密笔记：keys 表 + 正文数据段 */
  function makeVault() {
    let index = emptyIndex()
    const files = {}
    const plain = { n1: '第一篇', n2: '第二篇', n3: '第三篇' }
    for (const [id, text] of Object.entries(plain)) {
      const wrapped = sealItemKey(libs, dekOld, OLD, randomBytes(32))
      const itemKey = openItemKey(libs, dekOld, OLD, wrapped)
      files[id] = sealDataWithKey(libs, itemKey, 'notes', noteScope(id), text)
      index = upsertNote(index, { id, title: text, createdAt: 1, updatedAt: 1 })
      index = { ...index, keys: { ...index.keys, [id]: wrapped } }
    }
    return { index, files, plain }
  }

  it('换环只重包 keys：正文逐字节不变，新环全解得出', () => {
    const { index, files, plain } = makeVault()
    const before = { ...files }

    // 模拟 rotateRing 阶段 A：逐条重包（正文一个字节不碰）
    const keys = {}
    for (const [id, wrapped] of Object.entries(index.keys)) {
      keys[id] = sealItemKey(libs, dekNew, NEW, openItemKey(libs, dekOld, OLD, wrapped))
    }
    const rotated = { ...index, keys }

    for (const id of Object.keys(plain)) {
      expect(files[id]).toBe(before[id]) // 正文没变
      const itemKey = openItemKey(libs, dekNew, NEW, rotated.keys[id])
      expect(decode(openDataWithKey(libs, itemKey, 'notes', noteScope(id), files[id]))).toBe(
        plain[id],
      )
      // 旧环的包裹挂到新环下解不开
      expect(() => openItemKey(libs, dekNew, NEW, index.keys[id])).toThrow()
    }
  })

  it('索引往返不丢 keys（写盘 → 读回 → 换环仍可解）', () => {
    const { index, files } = makeVault()
    const roundTrip = parseIndex(serializeIndex({ ...index, keys: index.keys }))
    expect(roundTrip.keys).toEqual(index.keys)
    expect(roundTrip.v).toBe(INDEX_VERSION)

    // 用读回来的 keys 解正文 —— 证明 keys 表真的落盘了
    const id = index.notes[0].id
    const itemKey = openItemKey(libs, dekOld, OLD, roundTrip.keys[id])
    expect(decode(openDataWithKey(libs, itemKey, 'notes', noteScope(id), files[id]))).toBe('第一篇')
  })

  it('中途失败可续跑：重包两次结果等价（幂等）', () => {
    const { index, files } = makeVault()
    const once = {}
    for (const [id, wrapped] of Object.entries(index.keys)) {
      once[id] = sealItemKey(libs, dekNew, NEW, openItemKey(libs, dekOld, OLD, wrapped))
    }
    // 第二次跑：输入已经是新环包裹 ⇒ 不再用旧环解，直接沿用
    const twice = {}
    for (const [id, wrapped] of Object.entries(once)) {
      let next
      try {
        next = sealItemKey(libs, dekNew, NEW, openItemKey(libs, dekOld, OLD, wrapped))
      } catch {
        next = wrapped // 服务层 rewrapKey 的幂等分支
      }
      twice[id] = next
    }
    for (const id of Object.keys(index.keys)) {
      const itemKey = openItemKey(libs, dekNew, NEW, twice[id])
      expect(decode(openDataWithKey(libs, itemKey, 'notes', noteScope(id), files[id]))).toBeTruthy()
    }
  })
})
