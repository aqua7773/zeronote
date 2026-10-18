/**
 * 列表缩进 / 反缩进的行编辑（rev173.8 · 用户「手机端键盘上的快捷列表加个缩进和取消缩进按键」）。
 *
 * 判据（与编辑器里 Tab / Shift+Tab 的行为一致）：
 *  · 只对**列表行**（`- ` / `* ` / `+ ` / `1. ` / `1) `）生效，其它行返回 null；
 *  · 缩进 = 行首加 2 个空格；反缩进 = 去掉行首 1–2 个空格，没空格则 null。
 */
import { describe, expect, it } from 'vitest'
import { indentEdit, LIST_LINE_RE } from '../src/lib/indent'

describe('LIST_LINE_RE', () => {
  it('认常见的列表标记（含缩进）', () => {
    expect(LIST_LINE_RE.test('- 一项')).toBe(true)
    expect(LIST_LINE_RE.test('  - 缩进的一项')).toBe(true)
    expect(LIST_LINE_RE.test('1. 有序')).toBe(true)
    expect(LIST_LINE_RE.test('2) 有序')).toBe(true)
    expect(LIST_LINE_RE.test('+ 加号')).toBe(true)
  })

  it('不认普通段落 / 标题 / 代码', () => {
    expect(LIST_LINE_RE.test('普通段落')).toBe(false)
    expect(LIST_LINE_RE.test('# 标题')).toBe(false)
    expect(LIST_LINE_RE.test('```js')).toBe(false)
  })
})

describe('indentEdit', () => {
  it('列表行缩进 = 行首插两个空格', () => {
    expect(indentEdit('- 一项', 1)).toEqual({ from: 0, to: 0, insert: '  ' })
    expect(indentEdit('  - 已缩进', 1)).toEqual({ from: 0, to: 0, insert: '  ' })
  })

  it('列表行反缩进 = 去掉行首 1–2 个空格', () => {
    expect(indentEdit('  - 两项缩进', -1)).toEqual({ from: 0, to: 2, insert: '' })
    expect(indentEdit(' - 一个空格', -1)).toEqual({ from: 0, to: 1, insert: '' })
  })

  it('顶格列表反缩进 ⇒ null（没有可回退的缩进）', () => {
    expect(indentEdit('- 顶格', -1)).toBeNull()
  })

  it('非列表行一律 null（Tab 交给 CM6 原生处理）', () => {
    expect(indentEdit('普通段落', 1)).toBeNull()
    expect(indentEdit('普通段落', -1)).toBeNull()
  })
})
