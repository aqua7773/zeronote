import { describe, expect, it } from 'vitest'
import { diffBlocks, mergeLines, splitLines } from '../src/lib/merge3'

describe('splitLines', () => {
  it('保留末尾空串，join 能原样还原', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b', ''])
    expect(splitLines('a\nb\n').join('\n')).toBe('a\nb\n')
  })

  it('无尾换行时不补空串', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
  })

  it('空串是单元素数组', () => {
    expect(splitLines('')).toEqual([''])
  })

  it('CRLF 不作为换行切（本项目统一 LF 落盘）', () => {
    expect(splitLines('a\r\nb')).toEqual(['a\r', 'b'])
  })
})

describe('diffBlocks', () => {
  it('完全一样 ⇒ 没有变更块', () => {
    expect(diffBlocks(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([])
  })

  it('中间插一行 ⇒ 纯插入块（start === end）', () => {
    expect(diffBlocks(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ start: 1, end: 1, rep: ['b'] }])
  })

  it('删一行 ⇒ 纯删除块（rep 为空）', () => {
    expect(diffBlocks(['a', 'b', 'c'], ['a', 'c'])).toEqual([{ start: 1, end: 2, rep: [] }])
  })

  it('改一行 ⇒ 单行替换块', () => {
    expect(diffBlocks(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([
      { start: 1, end: 2, rep: ['B'] },
    ])
  })

  it('两处分开的改动 ⇒ 两个块', () => {
    expect(diffBlocks(['a', 'b', 'c', 'd', 'e'], ['A', 'b', 'c', 'd', 'E'])).toEqual([
      { start: 0, end: 1, rep: ['A'] },
      { start: 4, end: 5, rep: ['E'] },
    ])
  })

  it('DP 规模超限（2500×2500）⇒ 退化成整段替换一个块', () => {
    const base = Array.from({ length: 2500 }, (_, i) => `base-${i}`)
    const other = Array.from({ length: 2500 }, (_, i) => `other-${i}`)
    const blocks = diffBlocks(base, other)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ start: 0, end: 2500 })
  })
})

describe('mergeLines', () => {
  it('mine === theirs ⇒ 直接返回，无冲突', () => {
    const r = mergeLines('a\n', 'x\n', 'x\n')
    expect(r).toMatchObject({ text: 'x\n', conflicts: 0, mineBlocks: 0, theirsBlocks: 0 })
  })

  it('base === mine ⇒ 只有 theirs 动了，取 theirs', () => {
    const r = mergeLines('a\n', 'a\n', 'b\n')
    expect(r.text).toBe('b\n')
    expect(r.conflicts).toBe(0)
  })

  it('base === theirs ⇒ 只有 mine 动了，取 mine', () => {
    const r = mergeLines('a\n', 'b\n', 'a\n')
    expect(r.text).toBe('b\n')
    expect(r.conflicts).toBe(0)
  })

  it('两边改不同行 ⇒ 都保留，零冲突', () => {
    const r = mergeLines('a\nb\nc\nd\n', 'A\nb\nc\nd\n', 'a\nb\nc\nD\n')
    expect(r.text).toBe('A\nb\nc\nD\n')
    expect(r.conflicts).toBe(0)
    expect(r.mineBlocks).toBe(1)
    expect(r.theirsBlocks).toBe(1)
  })

  it('两边改同一行 ⇒ 保留 mine，冲突计 1，不写 <<<<<<< 标记', () => {
    const r = mergeLines('a\nb\nc\n', 'a\nMINE\nc\n', 'a\nTHEIRS\nc\n')
    expect(r.text).toBe('a\nMINE\nc\n')
    expect(r.conflicts).toBe(1)
    expect(r.text).not.toContain('<<<<<<<')
  })

  it('两边都在末尾追加不同内容 ⇒ 同点插入判冲突，mine 赢', () => {
    // rev121 修：两边块都是 base 末尾的零长度插入（start === end === 1），
    // 原来按 `cm.end <= ct.start` 判"不交叠"⇒ 两段都保留、conflicts = 0（用户看不到提示）。
    // 现在 `samePointInsert` 把同点插入判为冲突：mine 赢、theirs 那段丢弃、conflicts 计数。
    const r = mergeLines('a\n', 'a\nmine\n', 'a\ntheirs\n')
    expect(r.text).toBe('a\nmine\n')
    expect(r.conflicts).toBe(1)
  })

  it('同点插入冲突后，theirs 在别处的块照常合并', () => {
    // mine 在 y 前插 M；theirs 在 y 前插 T（同点 ⇒ 冲突、T 丢弃）并在末尾插 W（别处 ⇒ 保留）
    const r = mergeLines('x\ny\nz\n', 'x\nM\ny\nz\n', 'x\nT\ny\nz\nW\n')
    expect(r.text).toBe('x\nM\ny\nz\nW\n')
    expect(r.conflicts).toBe(1)
  })

  it('尾换行在合并结果里保留', () => {
    const r = mergeLines('a\nb\n', 'a\nb\nc\n', 'a\nB\n')
    expect(r.text.endsWith('\n')).toBe(true)
    expect(r.text).toBe('a\nB\nc\n')
  })

  it('中文笔记按行合并正常', () => {
    const r = mergeLines('标题\n第一段\n第二段\n', '标题\n第一段改\n第二段\n', '标题\n第一段\n第二段改\n')
    expect(r.text).toBe('标题\n第一段改\n第二段改\n')
    expect(r.conflicts).toBe(0)
  })

  it('空 base 两边都写 ⇒ 视为同一行替换 ⇒ 冲突，mine 赢', () => {
    // base 为空字符串时 splitLines 得到 [''] —— 两边都是"替换第 0 行"，
    // 块 {start:0,end:1} 真实交叠，所以走冲突分支。
    const r = mergeLines('', 'x', 'y')
    expect(r.text).toBe('x')
    expect(r.conflicts).toBe(1)
  })
})
