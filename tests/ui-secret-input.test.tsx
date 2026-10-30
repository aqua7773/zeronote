// @vitest-environment happy-dom
/**
 * 密码框渲染（rev173.275 · 真人使用测试 #14）。
 *
 * 契约 `input.secret: true` ⇒ `type="password"`（rev173.163 为 `secrets` 密码库加的）。
 * 这条锁的是**内核侧渲染**：插件只要声明 secret，密码就不该以明文摊在屏幕上。
 * 插件侧字段有没有声明，由 `tests/example-manifests.test.ts` 那条锁。
 */
import { cleanup, render } from '@testing-library/react'
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
})
