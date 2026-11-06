/**
 * 面板打开接线回归（用户反馈 #19「导入导出窗口无法关闭」/ #3 同因 · rev173.270；
 * rev173.410 / 173.411 加「菜单入口先跑 openCommand」这一层）。
 *
 * 两条规矩，互相约束：
 *   1. **用户可见入口**走 `openPanelEntry` —— 面板声明了 `openCommand`（密码库 `secrets.open`）
 *      就先执行命令（先弹解锁框），没声明才落到 `openPanelInTab`（= `addTab` + `setMainView`）。
 *      走裸 `setMainView` 的入口只切主区、标签条里没有它 ⇒ 没有 ×（#19 / #3）。
 *   2. **命令入口**（`core.panel.<id>`）与 `onOpenPanelInMain` 仍走 `openPanelInTab` ——
 *      插件命令 → 打开面板 → 又执行命令会死循环（rev173.410 的边界）。
 *
 * 另锁一条顺序约束：`openPanelInTab` 必须在 `createKernel` 之前定义；`openPanelEntry`
 * 必须在 `const kernel` 之后定义（写在前面 TDZ 崩整页，2026-11-07 实踩）。
 *
 * 静态检查：真机 / CDP 的点按验收在批次收尾时做（`_shots/`），这里只防「接线被手改回去」。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')

describe('面板打开的接线（#19 / #3 · rev173.410 / 411）', () => {
  it('用户可见入口（插件中心「打开」/ 标签条 ＋ 菜单）走 openPanelEntry', () => {
    expect(app).toContain('onOpenPanel={openPanelEntry}')
    expect(app).not.toContain('onOpenPanel={openPanelInTab}')
    expect(app).not.toContain('onOpenPanel={(id) => setMainView(id)}')
  })

  it('手机「更多 → 插件」/ 图标栏 pin / 起始页环形入口也走 openPanelEntry', () => {
    // 三处都是用户点出来的入口；漏一处 = 从那条路进密码库仍看到锁定视图（rev173.411 的起因）
    expect(app).toContain('openPanelEntry(e.panelId)')
    expect(app).toContain('openPanelEntry(first.id)')
    expect(app).toContain('onClick: () => openPanelEntry(panel.id)')
  })

  it('内核 onOpenPanelInMain（手机 view.openWindow 降级）走 openPanelInTab', () => {
    expect(app).toContain('onOpenPanelInMain: (id) => openPanelInTab(id)')
    expect(app).not.toContain('onOpenPanelInMain: (id) => setMainView(id)')
  })

  it('`core.panel.<id>` 命令保持直接 openPanelInTab（不能改走 entry，否则命令 → 命令死循环）', () => {
    const start = app.indexOf('id: `core.panel.${p.id}`')
    expect(start).toBeGreaterThan(-1)
    const chunk = app.slice(start, start + 900)
    expect(chunk).toContain('openPanelInTab(p.id)')
    expect(chunk).not.toContain('openPanelEntry(p.id)')
  })

  it('定义顺序：openPanelInTab 在 createKernel 之前、openPanelEntry 在 const kernel 之后', () => {
    const inTab = app.indexOf('const openPanelInTab = useCallback')
    const used = app.indexOf('onOpenPanelInMain: (id) => openPanelInTab(id)')
    expect(inTab).toBeGreaterThan(-1)
    expect(used).toBeGreaterThan(-1)
    expect(inTab).toBeLessThan(used)

    const kernel = app.indexOf('const kernel = kernelSlot.vault')
    const entry = app.indexOf('const openPanelEntry = useCallback')
    expect(kernel).toBeGreaterThan(-1)
    expect(entry).toBeGreaterThan(-1)
    // 写在 kernel 之前 ⇒ TDZ ReferenceError 整页白屏（rev173.410 踩过）
    expect(kernel).toBeLessThan(entry)
  })
})
