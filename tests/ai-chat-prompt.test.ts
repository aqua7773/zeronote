import { describe, expect, it } from 'vitest'
import { buildChatMessages, CHAT_SYSTEM_PROMPT, windowMessages } from '../examples/ai/index.js'

/**
 * 对话 system 提示（rev173.209）。
 *
 * rev197–208 的对话请求里**没有 system 消息**，模型不知道「写工具只出提案」的语义，
 * 实测两次「嘴上说任务建好了、其实没调 task_create」。
 * 这里钉住两件事：system 一定在首位；历史顺序与窗口裁剪不被破坏。
 */
describe('buildChatMessages', () => {
  it('system 在首位，历史顺序不变', () => {
    const api = buildChatMessages([
      { role: 'user', content: '甲' },
      { role: 'assistant', content: '乙' },
      { role: 'user', content: '丙' },
    ])
    expect(api[0].role).toBe('system')
    expect(api[0].content).toBe(CHAT_SYSTEM_PROMPT)
    expect(api.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(api.slice(1).map((m) => m.content)).toEqual(['甲', '乙', '丙'])
  })

  it('窗口裁剪与 windowMessages 一致（21 条只留最近 20）', () => {
    const history = Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: `第 ${i} 条` }))
    const api = buildChatMessages(history)
    expect(api).toHaveLength(21) // 1 system + 20
    expect(api[1].content).toBe('第 1 条')
    expect(api[0].role).toBe('system')
    expect(windowMessages(history)).toHaveLength(20)
  })

  it('system 传空串时只发历史（任务侧已有自己的 system）', () => {
    const api = buildChatMessages([{ role: 'user', content: '甲' }], '')
    expect(api).toEqual([{ role: 'user', content: '甲' }])
  })

  it('历史里的 content 统一转成字符串（坏数据不把请求打断）', () => {
    const api = buildChatMessages([{ role: 'user', content: null }], 'S')
    expect(api[1].content).toBe('')
  })
})

describe('CHAT_SYSTEM_PROMPT 的关键约束', () => {
  it('写明「pending 不等于完成」与「不要编造结果 / 任务 id」', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('status=pending')
    expect(CHAT_SYSTEM_PROMPT).toContain('不要凭记忆或历史编造结果')
    expect(CHAT_SYSTEM_PROMPT).toContain('任务 id')
  })

  it('写明 plugin_exec 只走授权命令', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('plugin_exec')
    expect(CHAT_SYSTEM_PROMPT).toContain('授权')
  })

  it('提到三个需要提案的写工具（名字必须是下划线）', () => {
    for (const name of ['note_write', 'note_move', 'note_trash']) {
      expect(CHAT_SYSTEM_PROMPT).toContain(name)
    }
  })
})
