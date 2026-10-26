import { describe, expect, it } from 'vitest'
import { parseSseBuffer, windowMessages } from '../examples/ai/index.js'

/**
 * SSE 解析是本刀最容易悄悄错的地方：半包会在 chunk 边界丢字，
 * 坏行会让整段回复消失，而这两种错误**界面上看起来都只是"没回复完"**。
 * 所以这里把边界钉死。
 */
describe('parseSseBuffer', () => {
  it('单个事件', () => {
    const r = parseSseBuffer('data: {"choices":[{"delta":{"content":"你好"}}]}\n')
    expect(r.deltas).toEqual(['你好'])
    expect(r.done).toBe(false)
    expect(r.rest).toBe('')
  })

  it('一次多事件', () => {
    const buf = [
      'data: {"choices":[{"delta":{"content":"A"}}]}',
      'data: {"choices":[{"delta":{"content":"B"}}]}',
      '',
    ].join('\n')
    const r = parseSseBuffer(buf)
    expect(r.deltas).toEqual(['A', 'B'])
  })

  it('半包留在 rest 里，不丢字', () => {
    const r = parseSseBuffer('data: {"choices":[{"delta":{"content":"A"}}]}\ndata: {"cho')
    expect(r.deltas).toEqual(['A'])
    expect(r.rest).toBe('data: {"cho')
  })

  it('[DONE] 标记结束', () => {
    const r = parseSseBuffer('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: [DONE]\n')
    expect(r.done).toBe(true)
    expect(r.deltas).toEqual(['x'])
  })

  it('坏行不炸，后面的好行照常解析', () => {
    const r = parseSseBuffer('data: {坏 JSON}\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n')
    expect(r.deltas).toEqual(['ok'])
  })

  it('忽略注释行、空 delta、finish_reason 帧', () => {
    const buf = [
      ': ping',
      '',
      'data: {"choices":[{"delta":{}}]}',
      'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
      '',
    ].join('\n')
    expect(parseSseBuffer(buf).deltas).toEqual([])
  })
})

describe('windowMessages', () => {
  it('只留最近 N 条', () => {
    const list = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: String(i) }))
    const out = windowMessages(list, 5)
    expect(out).toHaveLength(5)
    expect(out[0]).toEqual({ role: 'user', content: '25' })
    expect(out[4]).toEqual({ role: 'user', content: '29' })
  })

  it('少于 N 条时原样返回', () => {
    const out = windowMessages([{ role: 'user', content: 'hi' }], 5)
    expect(out).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('非数组 / 缺字段不炸', () => {
    expect(windowMessages(null, 5)).toEqual([])
    expect(windowMessages(undefined, 5)).toEqual([])
    expect(windowMessages([{ role: 'user' }], 5)).toEqual([{ role: 'user', content: '' }])
  })
})
