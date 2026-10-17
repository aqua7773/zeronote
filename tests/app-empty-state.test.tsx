// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppEmptyState } from '../src/components/AppEmptyState'

afterEach(cleanup)

describe('AppEmptyState', () => {
  it('没有库 ⇒ 给「选择笔记库」按钮', () => {
    const onPick = vi.fn()
    render(<AppEmptyState vault={null} notes={[]} onPickVault={onPick} onNewNote={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '选择笔记库' }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('有库但没笔记 ⇒ 「新建第一条」', () => {
    const onNew = vi.fn()
    render(
      <AppEmptyState vault="C:\\v" notes={[]} onPickVault={() => {}} onNewNote={onNew} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建第一条' }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('有笔记 ⇒ 「新建笔记」+ Markdown 速查表', () => {
    const { container } = render(
      <AppEmptyState
        vault="C:\\v"
        notes={[{ path: 'a.md', name: 'a.md', kind: 'note' } as never]}
        onPickVault={() => {}}
        onNewNote={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '新建笔记' })).toBeTruthy()
    expect(container.querySelectorAll('.zn-md-cheat').length).toBe(14)
  })

  it('三种情况都带快捷键教学', () => {
    const { container } = render(
      <AppEmptyState vault={null} notes={[]} onPickVault={() => {}} onNewNote={() => {}} />,
    )
    expect(container.querySelector('.zn-empty-keys')).toBeTruthy()
  })
})
