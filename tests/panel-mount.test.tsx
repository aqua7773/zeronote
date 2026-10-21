// @vitest-environment happy-dom
/**
 * 面板的 **DOM 直挂**（rev173.81 · `view.registerPanel({ mount })`）。
 *
 * 这条能力的来由：PDF（pdf.js + canvas）与思维导图（mind-elixir）要真 DOM 与脚本，
 * `render` 的 21 种 UINode 塞不进去，过去只能整窗接管（`overrideShell`），于是退出方式
 * 变成各插件自己的一件事。改成「面板 + mount」后，主区 / 独立窗口共用同一条渲染分支，
 * 返回键与顶栏都归内核管。
 *
 * 覆盖四件事：
 *   · 注册校验（render/mount 互斥、mount 只限 main/sidebar）
 *   · mount 被调用、插件的 DOM 真的出现
 *   · 卸载时 `dispose` 被调用（卸载即净）
 *   · `ctx.state` 是 getter（读最新值）但**不重挂**；mount 抛错不白屏
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => null),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

import { createKernel, type PanelRegistration } from '../src/kernel/kernel'
import { PanelMount } from '../src/components/PanelMount'

function makeKernel() {
  return createKernel('/vault', {} as never, {
    onPanelsChange: () => {},
    onNotify: () => {},
    onLog: () => {},
    onPanelStateChange: () => {},
  })
}

const textRender = () => ({ type: 'text' as const, value: '' })

afterEach(cleanup)

describe('registerPanel：三种渲染方式的校验', () => {
  it('render 与 mount 同时给 → 明确报错', () => {
    const k = makeKernel()
    expect(() =>
      k.view.registerPanel({
        id: 'p',
        title: '面板',
        location: 'main',
        render: textRender,
        mount: () => {},
      }),
    ).toThrow(/二选一/)
  })

  it('两个都不给 → 明确报错', () => {
    const k = makeKernel()
    expect(() =>
      k.view.registerPanel({ id: 'p', title: '面板', location: 'main' }),
    ).toThrow(/至少给一个/)
  })

  it('mount 配 statusbar 这类窄位置 → 明确报错（不静默画不出来）', () => {
    const k = makeKernel()
    expect(() =>
      k.view.registerPanel({ id: 'p', title: '面板', location: 'statusbar', mount: () => {} }),
    ).toThrow(/只支持/)
  })

  it('只给 mount（main）→ 注册成功，audit 能看到，dispose 后消失', () => {
    const k = makeKernel()
    const d = k.view.registerPanel({ id: 'dom-panel', title: '面板', location: 'main', mount: () => {} })
    expect(k.audit().panels.map((p) => p.id)).toContain('dom-panel')
    d.dispose()
    expect(k.audit().panels.map((p) => p.id)).not.toContain('dom-panel')
  })
})

describe('PanelMount：挂载与释放', () => {
  const panelOf = (over: Partial<PanelRegistration>): PanelRegistration => ({
    id: 'p',
    title: '面板',
    location: 'main',
    pluginId: 'demo',
    ...over,
  })

  it('mount 被调用一次，插件画的 DOM 真的出现', () => {
    const mount = vi.fn((el: HTMLElement) => {
      el.innerHTML = '<p>来自插件</p>'
    })
    const { container } = render(<PanelMount panel={panelOf({ mount })} state={{}} />)
    expect(mount).toHaveBeenCalledTimes(1)
    expect(screen.getByText('来自插件')).toBeTruthy()
    // 容器是内核给的 div，不是插件的
    expect(container.querySelector('.zn-panel-mount')).toBeTruthy()
  })

  it('卸载 → 先调 dispose，再清空容器', () => {
    const order: string[] = []
    const panel = panelOf({
      mount: (el) => {
        el.innerHTML = '<b>x</b>'
        return { dispose: () => order.push('dispose') }
      },
    })
    const { unmount, container } = render(<PanelMount panel={panel} state={{}} />)
    unmount()
    expect(order).toEqual(['dispose'])
    expect(container.textContent).toBe('')
  })

  it('ctx.state 读到最新值，但改 state 不会重挂', () => {
    const seen: unknown[] = []
    const panel = panelOf({
      mount: (_el, ctx) => {
        seen.push(ctx.state.n)
      },
    })
    const { rerender } = render(<PanelMount panel={panel} state={{ n: 1 }} />)
    rerender(<PanelMount panel={panel} state={{ n: 2 }} />)
    // 只挂了一次；第二次是同一 panel 对象，不是重挂
    expect(seen).toEqual([1])
  })

  it('mount 抛错 → 错误文本写进容器，不白屏', () => {
    const panel = panelOf({
      mount: () => {
        throw new Error('boom-mount')
      },
    })
    const { container } = render(<PanelMount panel={panel} state={{}} />)
    expect(container.textContent).toContain('boom-mount')
  })
})
