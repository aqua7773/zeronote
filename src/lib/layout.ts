/**
 * 壳布局常量（B1）。
 *
 * 侧栏宽度的上下限同时被三处使用：App 的 `sidebarWidth` 初值夹限、持久化读取、
 * `AppResizer` 的拖拽 / 键盘夹限。以前这些数字（160 / 560）在 `App.tsx` 里各写一遍，
 * 改了容易漏一处 —— 集中到这里。
 */
export const MIN_SIDEBAR_W = 160
export const MAX_SIDEBAR_W = 560
