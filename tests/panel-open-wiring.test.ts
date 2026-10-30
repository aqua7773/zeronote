/**
 * 面板打开接线回归（用户反馈 #19「导入导出窗口无法关闭」/ #3 同因 · rev173.270）。
 *
 * 三条入口都必须走 `openPanelInTab`（= `addTab` + `setMainView`）：
 *   · 插件中心每行「打开」—— 裸 `setMainView` 只切主区，标签条里没有它 ⇒ 没有 ×；
 *   · 内核 `onOpenPanelInMain`（插件 `view.openWindow` 在 Android 上的降级）；
 *   · 标签条 `＋` 菜单（B5 起本来就走对的那条，锁住别被改回去）。
 *
 * 另锁一条顺序约束：`openPanelInTab` 必须在 `createKernel` 之前定义 —— 后者是
 * render 期同步调用的，回调闭包里引用更晚的 `const` 属于隐性 TDZ 风险。
 *
 * 静态检查：真机 / CDP 的点按验收在批次收尾时做（`_shots/`），这里只防「接线被手改回去」。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')

describe('面板打开一律进标签条（#19 / #3）', () => {
  it('插件中心「打开」走 openPanelInTab，且旧的裸 setMainView 接线已消失', () => {
    expect(app).toContain('onOpenPanel={openPanelInTab}')
    expect(app).not.toContain('onOpenPanel={(id) => setMainView(id)}')
  })

  it('内核 onOpenPanelInMain（手机 view.openWindow 降级）走 openPanelInTab', () => {
    expect(app).toContain('onOpenPanelInMain: (id) => openPanelInTab(id)')
    expect(app).not.toContain('onOpenPanelInMain: (id) => setMainView(id)')
  })

  it('openPanelInTab 定义在内核创建之前（闭包不越过声明）', () => {
    const defined = app.indexOf('const openPanelInTab = useCallback')
    const used = app.indexOf('onOpenPanelInMain: (id) => openPanelInTab(id)')
    expect(defined).toBeGreaterThan(-1)
    expect(used).toBeGreaterThan(-1)
    expect(defined).toBeLessThan(used)
  })
})
