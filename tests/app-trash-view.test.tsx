// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppTrashView } from '../src/components/AppTrashView'

afterEach(cleanup)

const base = {
  confirmEmpty: false,
  confirmPurge: null as string | null,
  onEmpty: () => {},
  onConfirmEmpty: () => {},
  onRestore: () => {},
  onPurge: () => {},
  onConfirmPurge: () => {},
  onBack: () => {},
  fmtSize: (n: number) => `${n} B`,
}

const item = {
  id: 't1',
  name: 'a.md',
  isDir: false,
  originalPath: 'C:\\v\\a.md',
  deletedAt: 0,
  size: 10,
}

describe('AppTrashView', () => {
  it('空回收站 ⇒ 空态文案、没有「清空」按钮', () => {
    render(<AppTrashView {...base} trash={[]} />)
    expect(screen.getByText('回收站是空的')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清空回收站' })).toBeNull()
  })

  it('有条目 ⇒ 显示名称与操作按钮', () => {
    render(<AppTrashView {...base} trash={[item as never]} />)
    expect(screen.getByText('a.md')).toBeTruthy()
    expect(screen.getByRole('button', { name: '恢复' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '彻底删除' })).toBeTruthy()
  })

  it('彻底删除要点两次：第一次只进确认态', () => {
    const onPurge = vi.fn()
    const onConfirmPurge = vi.fn()
    render(
      <AppTrashView
        {...base}
        trash={[item as never]}
        onPurge={onPurge}
        onConfirmPurge={onConfirmPurge}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '彻底删除' }))
    expect(onConfirmPurge).toHaveBeenCalledWith('t1')
    expect(onPurge).not.toHaveBeenCalled()
  })

  it('已在确认态再点 ⇒ 真正删除', () => {
    const onPurge = vi.fn()
    render(
      <AppTrashView {...base} trash={[item as never]} confirmPurge="t1" onPurge={onPurge} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onPurge).toHaveBeenCalledWith('t1')
  })

  it('清空同样点两次', () => {
    const onEmpty = vi.fn()
    const onConfirmEmpty = vi.fn()
    render(
      <AppTrashView
        {...base}
        trash={[item as never]}
        onEmpty={onEmpty}
        onConfirmEmpty={onConfirmEmpty}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '清空回收站' }))
    expect(onConfirmEmpty).toHaveBeenCalledTimes(1)
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('返回编辑器触发回调', () => {
    const onBack = vi.fn()
    render(<AppTrashView {...base} trash={[]} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: '返回编辑器' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
