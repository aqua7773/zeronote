import { describe, expect, it } from 'vitest'
import {
  addUsage,
  emptyUsage,
  formatTokens,
  normalizeUsage,
  parseSseBuffer,
  usageText,
} from '../examples/ai/index.js'

/**
 * token 统计（rev173.203）。
 *
 * 这组的共同点：**统计错了没人会发现** —— 面板上只是显示一个数字，
 * 用户没法验证它。所以两种字段名（OpenAI / 兼容实现）、流式与非流式两条路都要钉住。
 */
describe('normalizeUsage', () => {
  it('OpenAI 字段名', () => {
    expect(normalizeUsage({ prompt_tokens: 120, completion_tokens: 30 })).toEqual({ prompt: 120, completion: 30 })
  })

  it('兼容实现的 input/output 字段名也认', () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({ prompt: 10, completion: 5 })
  })

  it('缺字段按 0 补，两个都缺 / 全 0 ⇒ null（别记一条 0 token 的调用）', () => {
    expect(normalizeUsage({ prompt_tokens: 7 })).toEqual({ prompt: 7, completion: 0 })
    expect(normalizeUsage({})).toBeNull()
    expect(normalizeUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBeNull()
    expect(normalizeUsage(null)).toBeNull()
  })

  it('幂等：已经是 {prompt, completion} 形状时原样通过（流式那条路会 normalize 两次）', () => {
    expect(normalizeUsage({ prompt: 120, completion: 30 })).toEqual({ prompt: 120, completion: 30 })
    // 第一版没认这两个字段 ⇒ 流式统计永远是 0 次（rev203 实测踩到）
    let acc = emptyUsage()
    acc = addUsage(acc, { prompt: 120, completion: 30 })
    expect(acc.calls).toBe(1)
  })
})

describe('addUsage', () => {
  it('累加调用次数与两个方向的 token', () => {
    let acc = emptyUsage()
    acc = addUsage(acc, { prompt_tokens: 100, completion_tokens: 20 })
    acc = addUsage(acc, { prompt_tokens: 50, completion_tokens: 10 })
    expect(acc.calls).toBe(2)
    expect(acc.prompt).toBe(150)
    expect(acc.completion).toBe(30)
    expect(acc.taskCalls).toBe(0)
  })

  it('任务调用单独记一列', () => {
    let acc = emptyUsage()
    acc = addUsage(acc, { prompt_tokens: 100, completion_tokens: 20 }, true)
    expect(acc.calls).toBe(1)
    expect(acc.taskCalls).toBe(1)
    expect(acc.taskPrompt).toBe(100)
    expect(acc.taskCompletion).toBe(20)
  })

  it('没有 usage 时原样返回（不 +1 次）', () => {
    const acc = addUsage(emptyUsage(), null)
    expect(acc.calls).toBe(0)
  })

  it('传入旧数据缺字段时补齐（store 里的老格式）', () => {
    const acc = addUsage({ calls: 3, prompt: 10 }, { prompt_tokens: 1, completion_tokens: 1 })
    expect(acc.calls).toBe(4)
    expect(acc.completion).toBe(1)
    expect(acc.taskCalls).toBe(0)
  })
})

describe('formatTokens', () => {
  it('千 / 万 / 百万的写法', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(12000)).toBe('12k')
    expect(formatTokens(1500000)).toBe('1.5M')
  })

  it('脏输入不炸', () => {
    expect(formatTokens(null as unknown as number)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
  })
})

describe('usageText', () => {
  it('没调用过时的人话', () => {
    expect(usageText(emptyUsage())).toBe('还没调用过模型')
  })

  it('有调用时给出次数与两个方向', () => {
    const acc = addUsage(emptyUsage(), { prompt_tokens: 3200, completion_tokens: 1100 })
    expect(usageText(acc)).toBe('1 次 · 输入 3.2k / 输出 1.1k tokens')
  })
})

describe('parseSseBuffer 提取 usage（流式那条路）', () => {
  it('最后一块带 usage 时能取到', () => {
    const buf = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":3}}',
      '',
    ].join('\n')
    const r = parseSseBuffer(buf)
    expect(r.deltas).toEqual(['你好'])
    expect(r.usage).toEqual({ prompt: 11, completion: 3 })
  })

  it('没有 usage 时是 null（不能记成 0 次）', () => {
    const r = parseSseBuffer('data: {"choices":[{"delta":{"content":"x"}}]}\n')
    expect(r.usage).toBeNull()
  })

  it('坏 usage 不影响正文解析', () => {
    const r = parseSseBuffer('data: {"choices":[{"delta":{"content":"x"}}],"usage":"oops"}\n')
    expect(r.deltas).toEqual(['x'])
    expect(r.usage).toBeNull()
  })
})
