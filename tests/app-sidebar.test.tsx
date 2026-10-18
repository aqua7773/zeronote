// @vitest-environment happy-dom
/**
 * 侧栏头部（rev134 · 2026-10-18 用户要求）：ZeroNote 右侧有一个设置图标，点击打开设置。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from '../src/components/AppSidebar'

afterEach(cleanup)

function makeProps(over: Record<string, unknown> = {}) {
  return {
    vault: '/vault',
    notes: [],
    dirs: [],
    activePath: null,
    open: false,
    width: 260,
    layers: { current: [] },
    clipboard: null,
    onOpen: vi.fn(),
    onNewFile: vi.fn(async () => null),
    onNewDir: vi.fn(async () => null),
    onRename: vi.fn(),
    onDeleteMany: vi.fn(),
    onPurgeMany: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDuplicate: vi.fn(),
    onOpenTrash: vi.fn(),
    onOpenVaultMenu: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  }
}

describe('AppSidebar 头部', () => {
  it('设置图标在侧栏头部，点击打开设置', () => {
    const props = makeProps()
    render(<AppSidebar {...props} />)
    const btn = screen.getByRole('button', { name: '设置' })
    expect(btn.closest('.zn-sidebar-head')).toBeTruthy()
    fireEvent.click(btn)
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('没有库时设置图标也在（不依赖库）', () => {
    const props = makeProps({ vault: null })
    render(<AppSidebar {...props} />)
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
  })
})
