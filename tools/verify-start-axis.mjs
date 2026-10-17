#!/usr/bin/env node
/**
 * 起始页「三元素同轴」验收 —— 跑的是**不变量**，不是某个像素数字。
 *
 * 为什么要这样验（2026-10-17 用户质问「侧栏长度能改、窗口大小能缩放，
 * 获取这些会变化的信息有什么作用？」）：
 *   · 侧栏可拖（160–560，`App.tsx` 的 sidebarWidth + localStorage）
 *   · 窗口可缩放（Tauri 窗口任意尺寸）
 *   ⇒ 「中心 = 1235」这种单点读数**今天对、明天错**，没有判据价值。
 *   真正的判据是：**无论侧栏多宽、视口多大，三元素中心 − 编辑区中心 ≡ 0**。
 *   布局靠 `.zn-empty { align-items: center }`（flex 交叉轴居中）保证 ——
 *   这是规则级的不变量，不是写死的坐标。
 *
 * 本脚本枚举「视口宽 × 侧栏宽」网格，逐格量差值，任何一格超差值就 FAIL。
 * 退出码 0 = 全部通过；1 = 有不满足的格。
 *
 * 用法：
 *   node tools/verify-start-axis.mjs
 *   node tools/verify-start-axis.mjs --tolerance 1   # 允许 1px 亚像素误差（默认 0.5）
 *
 * 前提：dev 窗口开着、停在**空态**（没打开笔记）。打开着笔记时 `.zn-empty` 不在，
 * 脚本会明确报错而不是假装通过。
 */

import { Cdp, pickTarget, sleep } from './cdp.mjs'

const TOL = (() => {
  const i = process.argv.indexOf('--tolerance')
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : 0.5
})()

/** 视口宽：1100 = dev 窗口默认；1920/2560 = 全屏与 2K；1280/1440 = 常见笔记本 */
const VIEWPORTS = [1100, 1280, 1440, 1920, 2560]
/** 侧栏宽：App.tsx 允许 160–560（拖分隔线的上下限），取端点与中间值 */
const SIDEBARS = [160, 260, 320, 547, 560]

const q = `(s) => document.querySelector(s)`

const MEASURE = `(() => {
  const cx = (el) => { const b = el.getBoundingClientRect(); return (b.left + b.right) / 2 }
  const main = document.querySelector('.zn-main')
  const empty = document.querySelector('.zn-empty')
  if (!main) return { error: '找不到 .zn-main' }
  if (!empty) return { error: '当前不是空态（已打开笔记？先关掉再跑）' }
  const h1 = document.querySelector('.zn-empty h1')
  const cheat = document.querySelector('.zn-md-cheatsheet')
  const keys = document.querySelector('.zn-empty-keys')
  return {
    vw: innerWidth,
    main: cx(main),
    h1: h1 ? cx(h1) : null,
    cheat: cheat ? cx(cheat) : null,
    keys: keys ? cx(keys) : null,
    sidebarW: document.querySelector('.zn-sidebar').getBoundingClientRect().width,
  }
})()`

async function main() {
  const target = await pickTarget()
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  // 记下用户当前的侧栏宽，结束后还原（拖过的宽度不替你改掉）
  const orig = await cdp.js(
    `(() => { const s = document.querySelector('.zn-sidebar'); return s ? s.style.width : '' })()`,
  )

  const rows = []
  let fail = 0

  for (const vw of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vw,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    for (const sw of SIDEBARS) {
      // 直接改 inline width 模拟拖拽结果 —— React 下一次重渲染前一直有效，
      // 本脚本只做静态测量，测完立即还原，不会污染状态
      await cdp.js(`document.querySelector('.zn-sidebar').style.width = '${sw}px'`)
      await sleep(30)
      const m = await cdp.js(MEASURE)
      if (m.error) {
        console.error(`✗ ${m.error}`)
        await cdp.send('Emulation.clearDeviceMetricsOverride')
        cdp.close()
        process.exit(1)
      }
      const diffs = [m.h1, m.cheat, m.keys]
        .filter((v) => v !== null)
        .map((v) => Math.abs(v - m.main))
      const max = Math.max(...diffs)
      const ok = max <= TOL
      if (!ok) fail++
      rows.push({ vw, sw, actual: Math.round(m.sidebarW), main: m.main, max, ok })
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')
  }

  // 还原侧栏宽
  if (orig !== '') {
    await cdp.js(`document.querySelector('.zn-sidebar').style.width = ${JSON.stringify(orig)}`)
  }
  cdp.close()

  // 输出：一行一格，FAIL 打红
  console.log('视口宽  侧栏宽  实测侧栏  编辑区中心  三元素最大偏差  结果')
  for (const r of rows) {
    console.log(
      `${String(r.vw).padEnd(6)}  ${String(r.sw).padEnd(6)}  ${String(r.actual).padEnd(8)}  ` +
        `${r.main.toFixed(1).padEnd(12)}  ${r.max.toFixed(2).padEnd(14)}  ${r.ok ? 'PASS' : 'FAIL'}`,
    )
  }
  const total = rows.length
  console.log(`\n${total - fail}/${total} 通过（容差 ${TOL}px）`)
  if (fail) {
    console.error(`✗ ${fail} 组不满足「三元素中心 = 编辑区中心」`)
    process.exit(1)
  }
  console.log('✓ 全部满足：中心差值与侧栏宽、视口尺寸无关')
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
