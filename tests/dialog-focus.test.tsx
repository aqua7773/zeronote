// @vitest-environment happy-dom
/**
 * Dialog 原语的焦点稳定性（rev173.399 · 用户 2026-11-06 实测 bug）。
 *
 * 症状：私密笔记右键「重命名」，输入框里每敲**一个字符**就失焦一次，
 * 后面打的字全落到对话框外 ⇒ 用户描述「输入会被截断，输入一次就会断一次」。
 *
 * 根因：`Dialog` 的 ESC effect 依赖 `[open, onOpenChange]`，而调用方一律传内联箭头
 * （每次渲染新引用）⇒ 受控输入框每变一次（自身重渲染）就重跑一次 cleanup，
 * cleanup 里「把焦点还给打开前的元素」把焦点抢走。
 *
 * 这两条锁住：① 输入不丢焦点、值正常累积；② 关掉时焦点仍会还回去（别为了修①把③弄坏）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../src/components/ui/dialog'

afterEach(cleanup)

/** 复刻真实调用方：`onOpenChange` 是内联箭头（每次渲染新引用）+ 对话框里有受控输入框 */
function Harness({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <input
        ref={inputRef}
        aria-label="名字"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Dialog>
  )
}

describe('Dialog 焦点稳定性', () => {
  it('受控输入框连续输入：每敲一个字都不失焦，值正常累积', async () => {
    render(<Harness onClose={vi.fn()} />)
    const input = screen.getByLabelText('名字') as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(input))

    fireEvent.change(input, { target: { value: 'a' } })
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'ab' } })
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('ab')
  })

  it('关掉时焦点还给打开前的元素（原有行为不退化）', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = '打开'
    document.body.append(trigger)
    trigger.focus()

    const onClose = vi.fn()
    const { unmount } = render(<Harness onClose={onClose} />)
    await waitFor(() => expect(screen.getByLabelText('名字')).toBeTruthy())

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
