/**
 * 侧栏插件分组（UI 重布局 B6 · 方案 §7.2 A 案）。
 *
 * 背景：`location: 'sidebar'` 从 rev1 起就存在，但内核一直没有独立侧栏载体 ——
 * `sidebar` 与 `main` 一样渲染在主区（`contract.ts` 的 location 注释写过这段历史）。
 * B6 给侧栏一个**真实载体**：面板渲染在这里（文件树下方、回收站上方），高度受限、内部滚动。
 *
 * 零插件基线（方案 §1.3）：没有面板 / 全部禁用 ⇒ `App` 根本不传这个 slot，
 * 侧栏里连边框都不会多一条（不留空壳）。
 *
 * 手机不渲染：侧栏是抽屉、没有常驻空间 ⇒ `App` 让 sidebar 面板回退到主区（旧行为）。
 */
import type { PanelRegistration } from '../kernel/kernel'
import { renderPanelSafe } from '../kernel/panel-safe'
import { PanelBoundary } from './PanelBoundary'
import {
  UIRenderer,
  type UIActionHandler,
  type UIStateChangeHandler,
} from './UIRenderer'

export type SidebarPluginsProps = {
  panels: PanelRegistration[]
  panelState: Record<string, unknown>
  onAction: UIActionHandler
  onStateChange: UIStateChangeHandler
}

export function SidebarPlugins({
  panels,
  panelState,
  onAction,
  onStateChange,
}: SidebarPluginsProps) {
  return (
    <div className="zn-sidebar-plugins">
      {panels.map((p) => (
        <section key={p.id} className="zn-sidebar-plugin" aria-label={p.title}>
          {/* 标题条：面板叫什么（侧栏里没有标签条，标题是唯一的归属提示） */}
          <div className="zn-sidebar-plugin-head" title={p.id}>
            {p.title}
          </div>
          <PanelBoundary>
            <UIRenderer
              node={renderPanelSafe(p, panelState)}
              state={panelState}
              onAction={onAction}
              onStateChange={onStateChange}
            />
          </PanelBoundary>
        </section>
      ))}
    </div>
  )
}
