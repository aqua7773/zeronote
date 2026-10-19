/**
 * 标签画廊（展示案例）纯函数单测（rev173.28.2）。
 *
 * 覆盖：`payload.text` 里的标签解析（带/不带 #、多余空格）、命中行文案兜底。
 */
import { describe, expect, it } from 'vitest'
import { hitLabel, parseTag } from '../examples/tag-showcase/index.js'

describe('parseTag', () => {
  it('带 # 的文本', () => {
    expect(parseTag('#工作')).toBe('工作')
    expect(parseTag('# 工作')).toBe('工作')
    expect(parseTag('##工作')).toBe('工作')
  })

  it('不带 # 也能解析（面板里直接传词）', () => {
    expect(parseTag('工作')).toBe('工作')
    expect(parseTag('  学习  ')).toBe('学习')
  })

  it('空值兜底', () => {
    expect(parseTag(null)).toBe('')
    expect(parseTag(undefined)).toBe('')
    expect(parseTag('#')).toBe('')
  })
})

describe('hitLabel', () => {
  it('优先标题，其次路径', () => {
    expect(hitLabel({ title: '周会记录', path: '工作/周会.md' })).toBe('周会记录')
    expect(hitLabel({ title: '', path: '工作/周会.md' })).toBe('工作/周会.md')
    expect(hitLabel({})).toBe('（未命名）')
  })
})
