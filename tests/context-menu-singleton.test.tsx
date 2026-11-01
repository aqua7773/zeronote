// @vitest-environment happy-dom
/**
 * 右键菜单**全局互斥**（rev173.317 · 真人测试5 #2 #3）。
 *
 * 现场：左侧栏先长按文件弹出文件菜单，再长按空白 ⇒ 又弹一个应用级菜单，两层叠在一起；
 * 时间流页长按卡片也一样（卡片菜单 + 主菜单）。
 *
 * 根因：各组件各持一个 `menu` state，互不知情。修法收在原语里 —— 新菜单挂载时
 * 先把上一个关掉。这里锁住这条约定，防止以后有人删掉它又回到叠菜单。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextMenu } from '../src/components/ui/context-menu'

afterEach(cleanup)

/** 模拟 App 的真实结构：**两个独立的菜单 state**，像 FileTree 的 menu 与 App 的 mainMenu */
function TwoMenus() {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setB(true)}>
        开第二个
      </button>
      {a && (
        <ContextMenu x={10} y={10} items={[{ label: '第一层' }]} onClose={() => setA(false)} />
      )}
      {b && (
        <ContextMenu x={20} y={20} items={[{ label: '第二层' }]} onClose={() => setB(false)} />
      )}
    </>
  )
}

describe('ContextMenu 全局互斥', () => {
  it('打开第二个菜单时，第一个自动关闭（屏幕只剩一层）', () => {
    render(<TwoMenus />)
    expect(screen.getByText('第一层')).toBeTruthy()

    fireEvent.click(screen.getByText('开第二个'))
    expect(screen.getByText('第二层')).toBeTruthy()
    expect(screen.queryByText('第一层')).toBeNull()
  })

  it('同一时刻只有一个遮罩（点一次外面不会连续关两层）', () => {
    render(<TwoMenus />)
    fireEvent.click(screen.getByText('开第二个'))
    expect(document.querySelectorAll('.zn-menu-scrim').length).toBe(1)
  })
})
