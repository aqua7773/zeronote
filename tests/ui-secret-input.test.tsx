// @vitest-environment happy-dom
/**
 * 密码框渲染（rev173.275 · 真人使用测试 #14）。
 *
 * 契约 `input.secret: true` ⇒ `type="password"`（rev173.163 为 `secrets` 密码库加的）。
 * 这条锁的是**内核侧渲染**：插件只要声明 secret，密码就不该以明文摊在屏幕上。
 * 插件侧字段有没有声明，由 `tests/example-manifests.test.ts` 那条锁。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UIRenderer } from '../src/components/UIRenderer'
import type { UINode } from '../src/kernel/contract'

afterEach(cleanup)

const noop = vi.fn()

function renderInput(node: UINode, state: Record<string, unknown> = {}) {
  return render(<UIRenderer node={node} onAction={noop} state={state} onStateChange={noop} />)
}

describe('UIRenderer 密码框', () => {
  it('secret: true 渲染成 password，并关掉自动填充', () => {
    const { container } = renderInput({
      type: 'input',
      bind: 'sync.password',
      secret: true,
      placeholder: '不改就留空',
    } as UINode)
    const input = container.querySelector('input')
    expect(input).toBeTruthy()
    expect(input?.getAttribute('type')).toBe('password')
    expect(input?.getAttribute('autocomplete')).toBe('off')
  })

  it('不写 secret 仍是普通文本框（老插件不受影响）', () => {
    const { container } = renderInput({ type: 'input', bind: 'sync.username' } as UINode)
    expect(container.querySelector('input')?.getAttribute('type')).toBe('text')
  })

  /* rev173.378 · 2026-11-05 用户要求：所有密码框都能「点击显示 / 隐藏」 */

  it('secret 框带眼睛按钮，点击在明文与圆点之间切换且不丢值', () => {
    const state = { 'security.pw1': 'hunter2' }
    const { container } = renderInput(
      { type: 'input', bind: 'security.pw1', secret: true, placeholder: '主密码' } as UINode,
      state,
    )
    const toggle = container.querySelector('.zn-ui-secret-toggle')
    expect(toggle).toBeTruthy()
    expect(container.querySelector('input')?.getAttribute('type')).toBe('password')
    expect(toggle?.getAttribute('aria-label')).toBe('显示密码')

    fireEvent.click(toggle as Element)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('type')).toBe('text')
    expect(input.value).toBe('hunter2')
    expect(toggle?.getAttribute('aria-label')).toBe('隐藏密码')

    fireEvent.click(toggle as Element)
    expect(container.querySelector('input')?.getAttribute('type')).toBe('password')
  })

  it('普通文本输入没有眼睛按钮', () => {
    const { container } = renderInput({ type: 'input', bind: 'sync.username' } as UINode)
    expect(container.querySelector('.zn-ui-secret-toggle')).toBeNull()
  })
})
