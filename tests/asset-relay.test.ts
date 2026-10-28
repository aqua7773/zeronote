// @vitest-environment happy-dom
/**
 * 附件跨设备搬运（rev173.238 · 附件同步期 4）的**纯函数**：
 *  · 状态机：local → staged → landed → cleaned（cleaned 由「云端已删」体现）
 *  · 哪些能上传 / 接收 / 清理 —— 判定错一条就会「重复上传」或「删掉对端还没拿的文件」
 *  · 确认文案必须点名 + 写体积（需求 §5：每次触发前确认）
 */
import { describe, expect, it } from 'vitest'
import {
  cleanable,
  confirmText,
  hash16Of,
  receivableIds,
  relayStateLabel,
  relayStateOf,
  totalBytesOf,
  uploadableIds,
  type RelayPendingItem,
  type RelayRemoteItem,
} from '../src/kernel/asset-relay'

const ID = 'sha256:' + 'ab'.repeat(32)

function pending(over: Partial<RelayPendingItem> = {}): RelayPendingItem {
  return {
    id: ID,
    original: 'D:/media/clip.mp4',
    size: 2 * 1024 * 1024,
    storedInVault: null,
    preview: null,
    localPath: 'D:/media/clip.mp4',
    exists: true,
    devices: {},
    ...over,
  }
}

function remote(over: Partial<RelayRemoteItem> = {}): RelayRemoteItem {
  return { hash16: hash16Of(ID), name: 'clip.mp4', size: 2 * 1024 * 1024, acked: false, ...over }
}

describe('hash16Of', () => {
  it('取 sha256: 之后的前 16 位小写', () => {
    expect(hash16Of(ID)).toBe('abababababababab')
    expect(hash16Of('sha256:ABCDEF0123456789FFFF')).toBe('abcdef0123456789')
  })
})

describe('relayStateOf 状态机', () => {
  it('本机有、云端没有 ⇒ local（可上传）', () => {
    expect(relayStateOf(pending(), [], 'dev-a')).toBe('local')
  })

  it('本机没有、云端也没有 ⇒ absent（源文件被移走）', () => {
    expect(relayStateOf(pending({ exists: false }), [], 'dev-a')).toBe('absent')
  })

  it('云端有、无 ack ⇒ staged（等对端）', () => {
    expect(relayStateOf(pending(), [remote()], 'dev-a')).toBe('staged')
  })

  it('云端有、有 ack ⇒ landed（可清理）', () => {
    expect(relayStateOf(pending(), [remote({ acked: true })], 'dev-a')).toBe('landed')
  })

  it('本机已落地过 ⇒ pulled（不再拉）', () => {
    const item = pending({ devices: { 'dev-a': 'D:/vault/.zn-assets/external/x.mp4' } })
    expect(relayStateOf(item, [remote({ acked: true })], 'dev-a')).toBe('pulled')
    // 本机落地过、云端已清空 ⇒ 仍是 pulled（不需要再做什么）
    expect(relayStateOf(item, [], 'dev-a')).toBe('pulled')
  })

  it('别的设备落地过本机还没 ⇒ 不算 pulled', () => {
    const item = pending({ devices: { 'dev-b': '/storage/x.mp4' } })
    expect(relayStateOf(item, [remote({ acked: true })], 'dev-a')).toBe('landed')
  })
})

describe('可执行动作集合', () => {
  it('上传：只挑 local（没有云端副本且本机存在）', () => {
    const items = [
      pending({ id: 'sha256:' + '11'.repeat(32) }),
      pending({ id: 'sha256:' + '22'.repeat(32), exists: false }),
      pending({ id: 'sha256:' + '33'.repeat(32) }),
    ]
    const remotes = [{ hash16: hash16Of('sha256:' + '33'.repeat(32)), name: 'x', size: 1, acked: false }]
    expect(uploadableIds(items, remotes, 'dev-a')).toEqual(['sha256:' + '11'.repeat(32)])
  })

  it('接收：云端有、本机没落地过（staged / landed 都算）', () => {
    const id1 = 'sha256:' + '44'.repeat(32)
    const id2 = 'sha256:' + '55'.repeat(32)
    const items = [
      pending({ id: id1 }),
      pending({ id: id2, devices: { 'dev-a': '.zn-assets/external/y.mp4' } }),
    ]
    const remotes = [
      { hash16: hash16Of(id1), name: 'a', size: 1, acked: false },
      { hash16: hash16Of(id2), name: 'b', size: 1, acked: true },
    ]
    expect(receivableIds(items, remotes, 'dev-a')).toEqual([id1])
  })

  it('清理：只清已 ack 的', () => {
    expect(
      cleanable([
        { hash16: 'aaaa', name: 'a', size: 1, acked: true },
        { hash16: 'bbbb', name: 'b', size: 1, acked: false },
        { hash16: 'aaaa', name: 'c', size: 1, acked: true },
      ]),
    ).toEqual(['aaaa'])
  })
})

describe('确认文案（每次触发前都确认）', () => {
  it('上传点名前三个文件 + 总体积', () => {
    const text = confirmText('upload', [
      { size: 2 * 1024 * 1024, original: 'D:/media/a.mp4' },
      { size: 1024 * 1024, original: 'D:/media/b.mp4' },
    ])
    expect(text).toContain('a.mp4')
    expect(text).toContain('b.mp4')
    expect(text).toContain('3.0 MB')
    expect(text).toContain('继续？')
  })

  it('超过三个文件时写「等 N 个」', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ size: 1024 * 1024, original: `D:/m/${i}.mp4` }))
    expect(confirmText('upload', items)).toContain('等 5 个')
  })

  it('接收 / 清理都有确认语气与数量', () => {
    expect(confirmText('land', [{ size: 1024 * 1024 }])).toContain('接收 1 个文件')
    expect(confirmText('cleanup', [{ size: 1024 * 1024 }])).toContain('删除云端临时区')
    expect(confirmText('cleanup', [{ size: 1024 * 1024 }])).toContain('不再可取回')
  })
})

describe('展示辅助', () => {
  it('totalBytesOf 忽略非数字', () => {
    expect(totalBytesOf([{ size: 1 }, { size: Number.NaN }, { size: 2 }])).toBe(3)
  })

  it('五种状态都有中文标签', () => {
    const labels = (['local', 'staged', 'landed', 'pulled', 'absent'] as const).map(relayStateLabel)
    expect(labels.every((l) => l.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(5)
  })
})
