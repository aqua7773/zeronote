/**
 * 手机常驻沉浸式（rev173.279 · 真人使用测试 #11）。
 *
 * 用户原话：「不需要留系统状态栏，要么就把系统状态栏颜色设置成跟下面衔接在一起」。
 * 以前是「抽屉开才隐藏、收起就显示」⇒ 首页顶部一直挂一条系统状态栏（时间 / 电量），
 * 底色与应用自己的顶栏对不上，视觉割裂。
 *
 * 判据（每条对应一个真实回退）：
 *  · 挂载时**下发隐藏**，不再跟着 `sidebarOpen` 反复切；
 *  · 旧的 `!sidebarOpen` 接线必须消失 —— 否则一收抽屉状态栏又回来；
 *  · 卸载时显回来 —— 别把状态栏留在隐藏态（HMR / 退出后系统 UI 不该是残的）；
 *  · 原生侧必须保留「从顶部下拉临时唤出」，否则用户够不着时间与电量。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
const kotlin = readFileSync(
  join(root, 'src-tauri/plugins/tauri-plugin-statusbar/android/src/main/java/StatusBarPlugin.kt'),
  'utf8',
)

describe('手机常驻沉浸式（#11）', () => {
  it('挂载时隐藏状态栏', () => {
    expect(app).toContain('void setStatusBarVisible(false)')
  })

  it('不再跟着抽屉开合切换（旧的 !sidebarOpen 接线已消失）', () => {
    expect(app).not.toContain('setStatusBarVisible(!sidebarOpen)')
  })

  it('卸载时显回来', () => {
    expect(app).toContain('return () => void setStatusBarVisible(true)')
  })

  it('原生保留「顶部下拉临时唤出」（否则够不着时间电量）', () => {
    expect(kotlin).toContain('BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE')
  })
})
