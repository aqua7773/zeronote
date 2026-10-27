import { describe, expect, it } from 'vitest'
import {
  auditTaskRun,
  claimAudit,
  claimWarningText,
  historyContent,
  stripHostNotes,
  windowMessages,
} from '../examples/ai/index.js'

/**
 * 完成声明审计（rev173.215 · 调研 `docs/AI不可信-调研-2026-10-27.md` §4-F）。
 *
 * 背景：rev173.209 真模型下模型说「任务建好了」却没调 `task_create`（面板 0 个、store 空），
 * 208 还编造了已删除任务的旧 id。system 提示只能改善、不能保证 —— 这里把「回复里的完成声明」
 * 与「本轮真实工具调用」对账，对不上就在界面标出来（宿主说的事实，不是模型自评）。
 *
 * 判据刻意做窄：宁可漏报，不要误报 —— 误报一次，用户就不再信这条提示了。
 */
describe('claimAudit：声称完成 × 本轮工具调用', () => {
  it('没调任何工具却说「任务已经建好了」⇒ 报 create', () => {
    const r = claimAudit('任务已经建好了，每天 23:00 自动跑。', [])
    expect(r.warnings.map((w) => w.kind)).toEqual(['create'])
    expect(r.okTools).toEqual([])
  })

  it('真的调了 task_create 并成功 ⇒ 不报', () => {
    const r = claimAudit('任务已经建好了。', [{ name: 'task_create', ok: true, text: 'ok' }])
    expect(r.warnings).toEqual([])
  })

  it('调了工具但失败（ok:false）⇒ 仍然报', () => {
    const r = claimAudit('任务已经建好了。', [{ name: 'task_create', ok: false, text: '参数错误' }])
    expect(r.warnings.map((w) => w.kind)).toEqual(['create'])
  })

  it('只调了 list_notes 却说「已删除」⇒ 类别不匹配，报 trash', () => {
    const r = claimAudit('那篇笔记已经删除了。', [{ name: 'list_notes', ok: true, text: '3 篇' }])
    expect(r.warnings.map((w) => w.kind)).toEqual(['trash'])
  })

  it('同一类别只说一次（不重复刷屏）', () => {
    const r = claimAudit('已经建好了。也创建好了。', [])
    expect(r.warnings).toHaveLength(1)
  })

  it('否定 / 待确认语境 ⇒ 不报（那是在说还没做）', () => {
    expect(claimAudit('创建任务需要你确认一下，点「采用」才会生效。', []).warnings).toEqual([])
    expect(claimAudit('还没执行，等你确认。', []).warnings).toEqual([])
    expect(claimAudit('我不能直接删除，会先给你预览。', []).warnings).toEqual([])
  })

  it('普通对话 / 提问 ⇒ 不报', () => {
    expect(claimAudit('你好，想整理哪部分笔记？', []).warnings).toEqual([])
    expect(claimAudit('', []).warnings).toEqual([])
    expect(claimAudit(null, null).warnings).toEqual([])
  })

  it('一个工具都没调却说「搞定了」⇒ 兜底报 done', () => {
    const r = claimAudit('搞定了，都处理好了。', [])
    expect(r.warnings.map((w) => w.kind)).toContain('done')
  })

  it('有成功的工具调用时，泛泛的「搞定」不触发兜底', () => {
    const r = claimAudit('搞定了。', [{ name: 'note_move', ok: true, text: 'ok' }])
    expect(r.warnings).toEqual([])
  })
})

describe('claimWarningText：给人看的一行', () => {
  it('无警告返回空串', () => {
    expect(claimWarningText([])).toBe('')
  })

  it('把类别合并进一句，并说明下面有真实记录', () => {
    const text = claimWarningText([
      { kind: 'create', label: '创建' },
      { kind: 'move', label: '移动' },
    ])
    expect(text).toContain('创建 / 移动')
    expect(text).toContain('没有实际依据')
  })
})

describe('auditTaskRun：自动任务也审计（rev173.215 第二步）', () => {
  it('模型收尾说「已打上标签」但本轮没调 tag_add ⇒ 有警告', () => {
    const warn = auditTaskRun({ reply: '已给这篇打上「工作」标签。', steps: [] })
    expect(warn).toContain('标签')
  })

  it('真的调了 tag_add 并成功 ⇒ 不报', () => {
    const warn = auditTaskRun({
      reply: '已给这篇打上「工作」标签。',
      steps: [{ name: 'tag_add', ok: true, text: 'ok' }],
    })
    expect(warn).toBeNull()
  })

  it('fixed 模式（没有 reply）⇒ 不审计', () => {
    expect(auditTaskRun({ steps: [{ name: 'tag_add', ok: true, text: 'ok' }] })).toBeNull()
    expect(auditTaskRun({})).toBeNull()
  })
})

describe('stripHostNotes：模型伪造的「系统记录」要剥掉（rev173.216 真模型实测）', () => {
  it('剥掉 <系统记录> 段（这是宿主自己的标记）', () => {
    const out = stripHostNotes('任务已建好。\n\n<系统记录 上一轮工具调用>\n✓ task_create → ok\n</系统记录>')
    expect(out).toBe('任务已建好。')
  })

  it('剥掉模型照抄的旧方括号格式', () => {
    expect(stripHostNotes('已建好。\n\n[上一轮工具调用]\n✓ task_create')).toBe('已建好。')
    expect(stripHostNotes('已建好。\n[较早轮次的工具] ✓task_create')).toBe('已建好。')
  })

  it('正常文本原样保留（含 ✓ 但不在宿主标记里）', () => {
    const text = '已完成 3 件事：\n✓ 打标签\n✓ 移动笔记'
    expect(stripHostNotes(text)).toBe(text)
  })

  it('空输入 / null 不炸', () => {
    expect(stripHostNotes('')).toBe('')
    expect(stripHostNotes(null)).toBe('')
  })
})

describe('历史压缩保结构（rev173.215）', () => {
  const turn = (n) => ({
    role: 'assistant',
    content: `第 ${n} 轮`,
    steps: [{ name: `tool_${n}`, ok: true, text: `结果 ${n}` }],
  })

  it('brief：只留工具名与成败，不留结果正文', () => {
    const text = historyContent(turn(1), { detail: 'brief' })
    expect(text).toContain('<系统记录 较早轮次的工具> ✓tool_1')
    expect(text).not.toContain('结果 1')
  })

  it('默认（full）保持原行为：带结果摘要', () => {
    expect(historyContent(turn(1))).toContain('✓ tool_1 → 结果 1')
  })

  it('windowMessages：最近 3 条完整，更早的只留名字', () => {
    const list = [turn(1), turn(2), turn(3), turn(4), turn(5)]
    const api = windowMessages(list)
    expect(api[0].content).toContain('<系统记录 较早轮次的工具>')
    expect(api[0].content).not.toContain('结果 1')
    // 最后三条（3/4/5）保留完整结果
    for (const i of [2, 3, 4]) expect(api[i].content).toContain('→ 结果')
  })

  it('无 steps 的消息不被改写', () => {
    const api = windowMessages([{ role: 'assistant', content: '纯文本' }])
    expect(api[0].content).toBe('纯文本')
  })
})
