// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppStatusBar } from '../src/components/AppStatusBar'

afterEach(cleanup)

const notes = [
  { path: 'a.md', name: 'a', kind: 'note' },
  { path: 'b.md', name: 'b', kind: 'note' },
  { path: 'c.pdf', name: 'c', kind: 'doc' },
]

const base = {
  statusPanels: [],
  panelState: {},
  error: null as string | null,
  activePath: null as string | null,
  charCount: 0,
  onAction: () => {},
  onStateChange: () => {},
}

describe('AppStatusBar', () => {
  it('只数笔记，文档单独列', () => {
    render(<AppStatusBar {...base} notes={notes as never} />)
    expect(screen.getByText('2 篇 · 1 文档')).toBeTruthy()
  })

  it('没有文档时不显示「文档」', () => {
    render(<AppStatusBar {...base} notes={notes.slice(0, 2) as never} />)
    expect(screen.getByText('2 篇')).toBeTruthy()
    expect(screen.queryByText(/文档/)).toBeNull()
  })

  it('打开文档时显示字数', () => {
    render(
      <AppStatusBar {...base} notes={[] as never} activePath="a.md" charCount={1234} />,
    )
    expect(screen.getByTitle('当前文档字数（不含空白）').textContent).toMatch(/1,?234 字/)
  })

  it('没打开文档时不显示字数', () => {
    render(<AppStatusBar {...base} notes={[] as never} charCount={1234} />)
    expect(screen.getByTitle('当前文档字数（不含空白）').textContent).toBe('')
  })

  it('错误会在左侧显示', () => {
    render(<AppStatusBar {...base} notes={[] as never} error="保存失败" />)
    expect(screen.getByText(/保存失败/)).toBeTruthy()
  })
})
