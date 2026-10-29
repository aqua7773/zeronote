// @vitest-environment happy-dom
/**
 * 手机底部四项导航（UI 重布局 B2 · 方案 §2.2）。
 *
 * 验收口径：固定四项与顺序（home / search / plugins / more）、当前项 aria-current、
 * 点击回调携带正确的 tab。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileTabBar } from '../src/components/MobileTabBar'

afterEach(cleanup)

describe('MobileTabBar', () => {
  it('固定四项、固定顺序：首页 / 搜索 / 插件 / 更多', () => {
    render(<MobileTabBar tab="home" onChange={vi.fn()} />)
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['首页', '搜索', '插件', '更多'])
  })

  it('当前项带 aria-current=page', () => {
    const { rerender } = render(<MobileTabBar tab="home" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '首页' }).getAttribute('aria-current')).toBe('page')
    rerender(<MobileTabBar tab="more" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '更多' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '首页' }).getAttribute('aria-current')).toBeNull()
  })

  it('点击回调携带对应 tab', () => {
    const onChange = vi.fn()
    render(<MobileTabBar tab="home" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.click(screen.getByRole('button', { name: '插件' }))
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(onChange.mock.calls).toEqual([['search'], ['plugins'], ['more']])
  })
})
