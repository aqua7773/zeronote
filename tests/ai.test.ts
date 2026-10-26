import { describe, expect, it } from 'vitest'
import {
  accumulateToolCalls,
  finalizeToolCalls,
  parseSseBuffer,
  windowMessages,
} from '../examples/ai/index.js'

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

describe('工具调用分片（rev198）', () => {
  it('parseSseBuffer 提取 tool_calls 增量', () => {
    const r = parseSseBuffer(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_dirs","arguments":"{"}}]}}]}\n',
    )
    expect(r.toolDeltas).toHaveLength(1)
    expect(r.toolDeltas[0]).toMatchObject({
      index: 0,
      id: 'call_1',
      name: 'list_dirs',
      args: '{',
    })
    // 正文增量不受影响
    expect(r.deltas).toEqual([])
  })

  it('同一 index 的参数分片要拼起来再 parse', () => {
    const state = {}
    accumulateToolCalls(state, [{ index: 0, id: 'call_1', name: 'search_notes', args: '{"q":' }])
    accumulateToolCalls(state, [{ index: 0, args: '"周报"}' }])
    const calls = finalizeToolCalls(state)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('search_notes')
    expect(calls[0].id).toBe('call_1')
    expect(calls[0].arguments).toBe('{"q":"周报"}')
    expect(JSON.parse(calls[0].arguments)).toEqual({ q: '周报' })
  })

  it('多个 index 并行累积互不覆盖', () => {
    const state = {}
    accumulateToolCalls(state, [
      { index: 0, id: 'a', name: 'list_dirs', args: '{}' },
      { index: 1, id: 'b', name: 'list_tags', args: '{}' },
    ])
    expect(finalizeToolCalls(state).map((c) => `${c.id}:${c.name}`)).toEqual([
      'a:list_dirs',
      'b:list_tags',
    ])
  })

  it('没有 name 的残片被丢掉；缺 id 自动补一个', () => {
    const state = {
      0: { id: '', name: '', arguments: '{"x":1}' },
      1: { id: '', name: 'list_tags', arguments: '{}' },
    }
    const calls = finalizeToolCalls(state)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('list_tags')
    expect(calls[0].id.startsWith('call_')).toBe(true)
  })

  it('空 / 非数组输入不炸', () => {
    expect(finalizeToolCalls({})).toEqual([])
    expect(finalizeToolCalls(undefined)).toEqual([])
    expect(accumulateToolCalls({}, null)).toEqual({})
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
