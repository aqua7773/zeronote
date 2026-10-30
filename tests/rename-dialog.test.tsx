// @vitest-environment happy-dom
/**
 * 重命名对话框（rev173.276 · 真人使用测试 #16 / #17）。
 *
 * 锁四件事 —— 都是 `window.prompt` 做不到、用户直接踩到的：
 *   1. 打开时**预填**当前文件名（wry 的 onJsPrompt 不用 defaultValue ⇒ 以前永远空框）；
 *   2. 只选中**主名**（不含 `.md`），光标落在主名末尾（#17：能点中间插入）；
 *   3. 回车 = 确定，空名 / 全空白不提交；
 *   4. 取消走 onCancel（Esc / 遮罩 / 取消按钮都归到这里）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenameDialog } from '../src/components/RenameDialog'

afterEach(cleanup)

function setup(initial = '手机媒体.md') {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <RenameDialog open initial={initial} onCancel={onCancel} onConfirm={onConfirm} />,
  )
  return { onCancel, onConfirm }
}

describe('RenameDialog', () => {
  it('预填当前文件名，只选主名（不含 .md）', async () => {
    setup('手机媒体.md')
    const input = screen.getByLabelText('新文件名') as HTMLInputElement
    expect(input.value).toBe('手机媒体.md')
    // 聚焦在 setTimeout(0) 里做
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('手机媒体'.length)
  })

  it('回车提交输入值（不自己补扩展名，交给宿主）', () => {
    const { onConfirm } = setup('手机媒体.md')
    const input = screen.getByLabelText('新文件名') as HTMLInputElement
    fireEvent.change(input, { target: { value: '手机媒体-改' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith('手机媒体-改')
  })

  it('空名 / 全空白不提交（按钮也禁用）', () => {
    const { onConfirm } = setup('a.md')
    const input = screen.getByLabelText('新文件名') as HTMLInputElement
    const ok = screen.getByRole('button', { name: '确定' })
    fireEvent.change(input, { target: { value: '   ' } })
    expect((ok as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('取消按钮走 onCancel', () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
