// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { ensureReplaceEntry, REPLACE_ENTRY_ATTR } from '../src/lib/find-replace-entry'

/**
 * rev173.71：查找面板里补「替换」入口。
 * 这里只测纯 DOM 逻辑（面板是 CM6 创建的，测试里手工搭一棵同构 DOM）。
 */
function makePanel(keyword = '') {
  const panel = document.createElement('div')
  panel.className = 'cm-search atomic-editor-search-panel'
  const input = document.createElement('input')
  input.className = 'cm-atomic-search-input'
  input.value = keyword
  const close = document.createElement('button')
  close.setAttribute('aria-label', 'Close')
  panel.append(input, close)
  return { panel, close }
}

describe('ensureReplaceEntry', () => {
  it('插入一个与 atomic 按钮同 class 的「替换」按钮，幂等', () => {
    const { panel } = makePanel()
    const onOpen = vi.fn()
    const btn = ensureReplaceEntry(panel, onOpen)
    expect(btn).not.toBeNull()
    expect(btn?.className).toContain('cm-atomic-search-btn')
    expect(btn?.textContent).toBe('替换')
    expect(panel.querySelectorAll(`[${REPLACE_ENTRY_ATTR}]`)).toHaveLength(1)

    // MutationObserver 会反复扫：第二次不应再插
    const again = ensureReplaceEntry(panel, onOpen)
    expect(again).toBeNull()
    expect(panel.querySelectorAll(`[${REPLACE_ENTRY_ATTR}]`)).toHaveLength(1)
  })

  it('点击：把关键词交回去，并点掉面板自带的关闭按钮', () => {
    const { panel, close } = makePanel('搜索词')
    const closed = vi.fn()
    close.addEventListener('click', closed)
    const onOpen = vi.fn()
    const btn = ensureReplaceEntry(panel, onOpen)!

    btn.click()

    expect(onOpen).toHaveBeenCalledWith('搜索词')
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('关键词为空也照常打开替换栏', () => {
    const { panel } = makePanel('')
    const onOpen = vi.fn()
    ensureReplaceEntry(panel, onOpen)!.click()
    expect(onOpen).toHaveBeenCalledWith('')
  })

  it('面板没有关闭按钮也不炸（只回调）', () => {
    const panel = document.createElement('div')
    panel.className = 'cm-search atomic-editor-search-panel'
    const onOpen = vi.fn()
    ensureReplaceEntry(panel, onOpen)!.click()
    expect(onOpen).toHaveBeenCalledWith('')
  })
})
