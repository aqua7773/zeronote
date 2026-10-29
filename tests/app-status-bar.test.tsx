// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppStatusBar } from '../src/components/AppStatusBar'

afterEach(cleanup)

const base = {
  statusPanels: [],
  panelState: {},
  error: null as string | null,
  activePath: null as string | null,
  charCount: 0,
  onAction: () => {},
  onStateChange: () => {},
}

describe('AppStatusBar（B4 瘦身后：只放状态）', () => {
  it('不再显示篇数统计（那是侧栏文件树的信息）', () => {
    const { container } = render(<AppStatusBar {...base} />)
    expect(container.textContent).not.toMatch(/\d+\s*篇/)
  })

  it('打开文档时显示字数', () => {
    render(<AppStatusBar {...base} activePath="a.md" charCount={1234} />)
    expect(screen.getByTitle('当前文档字数（不含空白）').textContent).toMatch(/1,?234 字/)
  })

  it('没打开文档时不显示字数', () => {
    render(<AppStatusBar {...base} charCount={1234} />)
    expect(screen.getByTitle('当前文档字数（不含空白）').textContent).toBe('')
  })

  it('错误会在左侧显示', () => {
    render(<AppStatusBar {...base} error="保存失败" />)
    expect(screen.getByText(/保存失败/)).toBeTruthy()
  })
})
