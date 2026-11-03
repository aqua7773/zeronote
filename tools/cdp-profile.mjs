#!/usr/bin/env node
/**
 * 冷启动 CPU profile 采样 —— 把「启动后过了几秒莫名卡一下」定位到具体函数。
 *
 * ## 为什么用它（而不是继续埋 performance.mark）
 *
 * rev173.356 的实测：卡顿是**启动完成 3 秒后的一个独立长任务**（release 包上
 * `longtask@3538 +8554ms`），期间 DOM 不变、无 IPC、无资源、常见慢方法探针全空。
 * 这种情况下靠猜「可能是什么」只会浪费轮次 —— mark 只能告诉你「卡在这里」，
 * 给不出「谁在烧 CPU」。
 *
 * CDP 的 `Profiler` 是**采样器**：直接拿到这 8 秒里每个 JS 栈帧的样本数与自耗时，
 * 文件名 + 行号都有，一次就能看到真凶。
 *
 * ## 用法
 *
 *   $env:ZN_CDP='http://127.0.0.1:9333'      # 手机 dev 包（adb forward）
 *   node tools/cdp-profile.mjs                # reload → 采 16s → 打印 Top 表
 *   node tools/cdp-profile.mjs --no-reload    # 不 reload，直接采当前页面 16s
 *
 * 环境变量：
 *   ZN_PROFILE_MS        采样总时长（默认 16000）
 *   ZN_PROFILE_WIN       统计窗口 `起,止`（毫秒，相对采样起点；默认 `3000,13000`）
 *   ZN_PROFILE_INTERVAL  采样间隔 μs（默认 1000）
 *   ZN_PROFILE_OUT       原始 profile 落盘路径（默认 `_shots/boot-profile.json`）
 *
 * ⚠️ 采样期间**别动手机屏幕**：手点出来的任务会和启动任务混在一起。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Cdp, pickTarget, sleep } from './cdp.mjs'

const waitMs = Number(process.env.ZN_PROFILE_MS ?? 16000)
const interval = Number(process.env.ZN_PROFILE_INTERVAL ?? 1000)
const out = process.env.ZN_PROFILE_OUT ?? '_shots/boot-profile.json'
const [winStart, winEnd] = (process.env.ZN_PROFILE_WIN ?? '3000,13000')
  .split(',')
  .map(Number)
const noReload = process.argv.includes('--no-reload')

const target = await pickTarget()
console.log(`target: ${target.url}`)

const cdp = await Cdp.connect(target.webSocketDebuggerUrl)

await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval })
await cdp.send('Profiler.start')

if (!noReload) {
  await cdp.send('Page.enable')
  await cdp.send('Page.reload', { ignoreCache: false })
  console.log(`reload → 采样 ${waitMs} ms …（别碰手机）`)
} else {
  console.log(`直接采样 ${waitMs} ms …（别碰手机）`)
}

await sleep(waitMs)

const { profile } = await cdp.send('Profiler.stop')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(profile))
console.log(`原始 profile: ${out}（${profile.samples.length} 个样本）`)

/* ───────── 统计 ───────── */

const nodeById = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map() // nodeId → 落在窗口内的耗时 μs
let t = profile.startTime
let totalWin = 0

for (let i = 0; i < profile.samples.length; i++) {
  const dt = profile.timeDeltas[i] ?? 0
  t += dt
  const relMs = (t - profile.startTime) / 1000
  if (relMs < winStart || relMs > winEnd) continue
  const id = profile.samples[i]
  self.set(id, (self.get(id) ?? 0) + dt)
  totalWin += dt
}

const label = (n) => {
  const f = n.callFrame
  const url = f.url ? f.url.replace(/^https?:\/\/[^/]+/, '').split('/').slice(-2).join('/') : '(native)'
  const fn = f.functionName || '(anonymous)'
  // 东八区行号：CDP 是 0 基，人看的是 1 基
  return `${fn} — ${url}:${f.lineNumber + 1}`
}

const rows = [...self.entries()]
  .map(([id, us]) => ({ label: label(nodeById.get(id)), ms: us / 1000 }))
  .sort((a, b) => b.ms - a.ms)

const agg = new Map()
for (const r of rows) agg.set(r.label, (agg.get(r.label) ?? 0) + r.ms)
const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)

console.log(`\n窗口 ${winStart}–${winEnd} ms 内共 ${(totalWin / 1000).toFixed(0)} ms 采样（手机主线程）`)
console.log('Top 自耗时（ms）：')
for (const [name, ms] of top) {
  const pct = ((ms / (totalWin / 1000)) * 100).toFixed(1)
  console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${pct.padStart(5)}%  ${name}`)
}

/* ───────── 长任务边界（页面里已有打点的话顺手给出） ───────── */

try {
  const marks = await cdp.js(`(() => {
    const b = window.__znBootMarks && window.__znBootMarks();
    return b ? JSON.stringify(b) : 'none';
  })()`)
  if (marks && marks !== 'none') console.log(`\n__znBootMarks(): ${marks}`)
} catch {
  /* reload 后页面还没挂好就跳过 */
}
