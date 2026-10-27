import { describe, expect, it } from 'vitest'
import {
  MAX_RUNS,
  createSerialQueue,
  matchTasks,
  normalizeTrigger,
  skipForTasks,
  triggerText,
  trimRuns,
} from '../examples/ai/index.js'

/**
 * 任务系统（rev173.201）的纯函数。
 *
 * 这组的共同点：**错了都不报错，只是悄悄不跑或多跑**。
 * · 路径排除漏一条 ⇒ 私密笔记被自动任务读走；
 * · 触发匹配错了 ⇒ 用户保存十篇，任务一次没跑（或每篇跑两次）；
 * · 队列不串行 ⇒ 两个任务同时改一篇，后写的覆盖先写的。
 */
describe('skipForTasks（Q24：哪些笔记不送给自动任务）', () => {
  it('普通笔记要跑', () => {
    expect(skipForTasks('根笔记.md')).toBe(false)
    expect(skipForTasks('工作/周报.md')).toBe(false)
    expect(skipForTasks('工作/2026/q4.md')).toBe(false)
  })

  it('私密 / 回收站 / 隐藏目录一律不跑', () => {
    expect(skipForTasks('.zn/private/notes/a.zn')).toBe(true)
    expect(skipForTasks('.zn/trash/123/x.md')).toBe(true)
    expect(skipForTasks('.git/x.md')).toBe(true)
    expect(skipForTasks('.隐藏/笔记.md')).toBe(true)
  })

  it('收件箱 / 导入目录不跑（含子目录）', () => {
    expect(skipForTasks('收件箱/随手记.md')).toBe(true)
    expect(skipForTasks('收件箱/2026/x.md')).toBe(true)
    expect(skipForTasks('Inbox/a.md')).toBe(true)
    expect(skipForTasks('导入/微信.md')).toBe(true)
  })

  it('名字里带"收件箱"但不是顶层目录 ⇒ 照跑', () => {
    expect(skipForTasks('工作/收件箱记录.md')).toBe(false)
  })

  it('非笔记与空路径直接跳过', () => {
    expect(skipForTasks('')).toBe(true)
    expect(skipForTasks(null)).toBe(true)
    expect(skipForTasks('图片.png')).toBe(true)
    expect(skipForTasks('附件/说明.txt')).toBe(true)
  })

  it('反斜杠路径也能识别（Windows 来的字符串）', () => {
    expect(skipForTasks('收件箱\\a.md')).toBe(true)
    expect(skipForTasks('工作\\周报.md')).toBe(false)
  })
})

describe('normalizeTrigger', () => {
  it('save 带目录', () => {
    expect(normalizeTrigger({ type: 'save', dir: '工作' })).toEqual({ type: 'save', dir: '工作' })
  })

  it('save 的目录为空 ⇒ 不收 dir 字段', () => {
    expect(normalizeTrigger({ type: 'save', dir: '' })).toEqual({ type: 'save' })
  })

  it('未知类型退化为 manual', () => {
    expect(normalizeTrigger({ type: '每天' })).toEqual({ type: 'manual' })
    expect(normalizeTrigger(undefined)).toEqual({ type: 'manual' })
  })

  it('manual 不收 dir（手动跑跟目录无关）', () => {
    expect(normalizeTrigger({ type: 'manual', dir: '工作' })).toEqual({ type: 'manual' })
  })
})

describe('matchTasks', () => {
  const tasks = [
    { id: 'a', enabled: true, trigger: { type: 'save' } },
    { id: 'b', enabled: true, trigger: { type: 'save', dir: '工作' } },
    { id: 'c', enabled: false, trigger: { type: 'save' } },
    { id: 'd', enabled: true, trigger: { type: 'manual' } },
  ]

  it('保存事件只命中启用的 save 任务', () => {
    expect(matchTasks(tasks, { type: 'save', path: '根笔记.md' }).map((t) => t.id)).toEqual(['a'])
  })

  it('目录过滤：工作在 工作/ 下才命中', () => {
    expect(matchTasks(tasks, { type: 'save', path: '工作/周报.md' }).map((t) => t.id)).toEqual(['a', 'b'])
    expect(matchTasks(tasks, { type: 'save', path: '工作日报.md' }).map((t) => t.id)).toEqual(['a'])
  })

  it('手动事件不命中 save 任务', () => {
    expect(matchTasks(tasks, { type: 'manual' }).map((t) => t.id)).toEqual(['d'])
  })

  it('停用的任务永不命中', () => {
    expect(matchTasks(tasks, { type: 'save', path: 'x.md' }).some((t) => t.id === 'c')).toBe(false)
  })

  it('空 / 脏输入不炸', () => {
    expect(matchTasks(null, { type: 'save' })).toEqual([])
    expect(matchTasks([null, undefined], { type: 'save' })).toEqual([])
  })
})

describe('trimRuns', () => {
  it('只留最近 10 条，新的在前', () => {
    const runs = Array.from({ length: 15 }, (_, i) => ({ at: 1000 - i }))
    const out = trimRuns(runs)
    expect(out).toHaveLength(MAX_RUNS)
    expect(out[0].at).toBe(1000)
    expect(out[9].at).toBe(991)
  })

  it('不足 10 条原样返回', () => {
    expect(trimRuns([{ at: 1 }])).toEqual([{ at: 1 }])
  })

  it('非数组返回空', () => {
    expect(trimRuns(null)).toEqual([])
    expect(trimRuns(undefined)).toEqual([])
  })
})

describe('triggerText', () => {
  it('三种触发方式的人话', () => {
    expect(triggerText({ trigger: { type: 'save' } })).toBe('任何笔记保存后')
    expect(triggerText({ trigger: { type: 'save', dir: '工作' } })).toBe('保存到 工作 后')
    expect(triggerText({ trigger: { type: 'manual' } })).toBe('仅手动')
    expect(triggerText({})).toBe('仅手动')
  })
})

describe('createSerialQueue', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  it('严格串行：后一个等前一个结束', async () => {
    const q = createSerialQueue()
    const order = []
    await Promise.all([
      q.push(async () => {
        order.push('a:start')
        await sleep(20)
        order.push('a:end')
      }),
      q.push(async () => {
        order.push('b:start')
        await sleep(1)
        order.push('b:end')
      }),
    ])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('一个失败不阻塞后面的', async () => {
    const q = createSerialQueue()
    const order = []
    await q.push(async () => {
      throw new Error('boom')
    })
    await q.push(async () => {
      order.push('after')
    })
    expect(order).toEqual(['after'])
  })

  it('depth 反映排队 + 执行中的数量，跑完归零', async () => {
    const q = createSerialQueue()
    expect(q.depth).toBe(0)
    const p1 = q.push(() => sleep(10))
    const p2 = q.push(() => sleep(1))
    expect(q.depth).toBe(2)
    await Promise.all([p1, p2])
    await q.idle()
    expect(q.depth).toBe(0)
  })

  it('idle 等到全部跑完', async () => {
    const q = createSerialQueue()
    let done = 0
    q.push(async () => {
      await sleep(10)
      done++
    })
    q.push(async () => {
      await sleep(5)
      done++
    })
    await q.idle()
    expect(done).toBe(2)
  })
})
