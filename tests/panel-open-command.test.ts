// @vitest-environment happy-dom
/**
 * `registerPanel({ openCommand })`（rev173.410）：面板可选声明「从菜单打开时先执行哪条命令」。
 *
 * 起因：密码库改了「打开就先弹解锁框」，但从 ＋ / 更多菜单点「打开 · 密码库」是宿主直接开面板，
 * 绕过了插件命令 —— 用户看到的是面板里的锁定视图而不是弹窗。内核这一侧只需**如实保存**
 * 这个字段并透给宿主（执行动作在 `App.tsx` 的 `openPanelEntry`）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kernel } from '../src/kernel/kernel'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

import { createKernel } from '../src/kernel/kernel'

function makeKernel(onPanelsChange: (p: unknown[]) => void): Kernel {
  mocks.invoke.mockImplementation(async () => null)
  return createKernel('/vault', {} as never, {
    onPanelsChange,
    onNotify: () => {},
    onLog: () => {},
    onPanelStateChange: () => {},
  })
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.listen.mockClear()
})

const render = () => ({ type: 'text', value: 'x' }) as never

describe('面板的 openCommand', () => {
  it('注册时带 openCommand ⇒ 原样透给宿主', () => {
    const seen: Array<Array<{ id: string; openCommand?: string }>> = []
    const k = makeKernel((ps) => seen.push(ps as Array<{ id: string; openCommand?: string }>))
    k.view.registerPanel({ id: 'secrets.panel', title: '密码库', location: 'main', render, openCommand: 'secrets.open' })
    expect(seen.at(-1)?.[0]).toMatchObject({ id: 'secrets.panel', openCommand: 'secrets.open' })
  })

  it('不声明 ⇒ 字段保持 undefined（普通面板不受影响）', () => {
    const seen: Array<Array<{ id: string; openCommand?: string }>> = []
    const k = makeKernel((ps) => seen.push(ps as Array<{ id: string; openCommand?: string }>))
    k.view.registerPanel({ id: 'plain.panel', title: '普通', location: 'main', render })
    expect(seen.at(-1)?.[0]?.openCommand).toBeUndefined()
  })
})
