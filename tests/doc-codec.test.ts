/**
 * 文档内容转换器（`doc.registerCodec` · rev173.180）单测。
 *
 * 测的是**模块级注册表**的语义，不碰 React / Tauri：
 * 注册与注销 · 原样进出 · 打开过的路径在 codec 卸载后**拒绝读写**（这几条是安全线）·
 * transient 决定草稿 · match 抛错的隔离 · 同 id 覆盖 · 后注册优先。
 *
 * 覆盖原则（`docs/开发约定.md` §4）：每条正向断言配一条反向用例 ——
 * 最容易写错的是「codec 卸载后悄悄退回明文写盘」，那条单独立用例。
 */
import { describe, expect, it } from 'vitest'
import type { DocCodec } from '../src/kernel/contract'
import {
  codecDebugState,
  decodeForOpen,
  encodeForSave,
  forgetOpenedVia,
  isTransientPath,
  pickCodec,
  registerDocCodec,
} from '../src/kernel/doc-codec'

/** 造一个"密文格式 = CIPHER: 前缀"的假 codec */
function make(over: Partial<DocCodec> & { id: string }): DocCodec {
  return {
    id: over.id,
    match: (p) => p.startsWith('.zn/private/'),
    decode: async (raw) => raw.replace(/^CIPHER:/, ''),
    encode: async (plain) => `CIPHER:${plain}`,
    ...over,
  }
}

describe('doc codec', () => {
  it('没有匹配的 codec 时原样进出', async () => {
    expect(await decodeForOpen('abc', '普通笔记.md')).toBe('abc')
    expect(await encodeForSave('abc', '普通笔记.md')).toBe('abc')
  })

  it('匹配的路径走 decode / encode；不匹配的路径不受影响', async () => {
    const d = registerDocCodec(make({ id: 'test:basic' }))
    try {
      expect(await decodeForOpen('CIPHER:hello', '.zn/private/notes/a.zn')).toBe('hello')
      expect(await encodeForSave('hello', '.zn/private/notes/a.zn')).toBe('CIPHER:hello')
      expect(await decodeForOpen('CIPHER:x', '普通笔记.md')).toBe('CIPHER:x')
      expect(await encodeForSave('x', '普通笔记.md')).toBe('x')
    } finally {
      d.dispose()
      forgetOpenedVia('.zn/private/notes/a.zn')
    }
  })

  it('打开过的路径：codec 卸载后**拒绝保存**（绝不退回明文写盘）', async () => {
    const path = '.zn/private/notes/b.zn'
    const d = registerDocCodec(make({ id: 'test:unload-save' }))
    await decodeForOpen('CIPHER:secret', path)
    d.dispose()
    await expect(encodeForSave('secret', path)).rejects.toThrow(/已卸载/)
    // 反向对照：没被打开过的路径此时只是"没有转换器"，原样通过（不该误伤普通笔记）
    expect(await encodeForSave('plain', '普通笔记.md')).toBe('plain')
    forgetOpenedVia(path)
  })

  it('打开过的路径：codec 卸载后**拒绝打开**（不把密文喂给编辑器）', async () => {
    const path = '.zn/private/notes/c.zn'
    const d = registerDocCodec(make({ id: 'test:unload-open' }))
    await decodeForOpen('CIPHER:x', path)
    d.dispose()
    await expect(decodeForOpen('CIPHER:x', path)).rejects.toThrow(/已卸载/)
    forgetOpenedVia(path)
  })

  it('transient 决定写不写草稿（按路径命中）', async () => {
    const d = registerDocCodec(make({ id: 'test:transient', transient: true }))
    try {
      expect(isTransientPath('.zn/private/notes/d.zn')).toBe(true)
      expect(isTransientPath('普通笔记.md')).toBe(false)
      expect(isTransientPath(null)).toBe(false)
    } finally {
      d.dispose()
    }
  })

  it('match 抛错按"不匹配"处理，不拖垮其它 codec', async () => {
    const bad = registerDocCodec(
      make({
        id: 'test:bad-match',
        match: () => {
          throw new Error('boom')
        },
        encode: async (p) => `BAD:${p}`,
      }),
    )
    const good = registerDocCodec(make({ id: 'test:good-match' }))
    try {
      expect(pickCodec('.zn/private/notes/e.zn')?.id).toBe('test:good-match')
      expect(await encodeForSave('x', '.zn/private/notes/e.zn')).toBe('CIPHER:x')
      expect(pickCodec('普通笔记.md')).toBe(null)
    } finally {
      bad.dispose()
      good.dispose()
    }
  })

  it('同 id 重复注册 = 后者生效；旧的那个 dispose 不会把新的删掉', async () => {
    const a = registerDocCodec(make({ id: 'test:dup', encode: async (p) => `A:${p}` }))
    const b = registerDocCodec(make({ id: 'test:dup', encode: async (p) => `B:${p}` }))
    expect(await encodeForSave('x', '.zn/private/notes/f.zn')).toBe('B:x')
    a.dispose()
    expect(await encodeForSave('x', '.zn/private/notes/f.zn')).toBe('B:x')
    b.dispose()
  })

  it('后注册的优先（插件可以覆盖内置转换器）', async () => {
    const first = registerDocCodec(make({ id: 'test:first', encode: async (p) => `1:${p}` }))
    const second = registerDocCodec(make({ id: 'test:second', encode: async (p) => `2:${p}` }))
    try {
      expect(await encodeForSave('x', '.zn/private/notes/g.zn')).toBe('2:x')
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('注册表可诊断（codecDebugState 反映当前状态）', async () => {
    const before = codecDebugState()
    const d = registerDocCodec(make({ id: 'test:debug' }))
    try {
      expect(codecDebugState().codecs).toContain('test:debug')
      // 打开过的路径也记在里面
      await decodeForOpen('CIPHER:x', '.zn/private/notes/h.zn')
      expect(codecDebugState().openedVia['.zn/private/notes/h.zn']).toBe('test:debug')
    } finally {
      d.dispose()
      forgetOpenedVia('.zn/private/notes/h.zn')
    }
    expect(codecDebugState().codecs).toEqual(before.codecs)
  })
})
