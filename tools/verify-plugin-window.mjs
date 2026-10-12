#!/usr/bin/env node
/**
 * 插件独立窗口验收（U1 · 2026-10-13 rev50）—— 全自动，不碰用户鼠标。
 *
 * 判据（每条都读机器可读的出口，不靠人眼）：
 *   ① 插件装上后命令表出现 `window-demo.open`
 *   ② 点「在新窗口打开」⇒ CDP 里多出一个 `?pluginWindow=…` 的页面（真窗口，不是 iframe）
 *   ③ 那个窗口渲染出了面板内容（`.zn-plugin-window` 里有标题与关闭按钮）
 *   ④ 主窗口的窗口账 `__znKernelAudit().windows` 记着这个 label
 *   ⑤ 关掉窗口 ⇒ 页面消失 **且** 账回空（用户手动关窗也要销账）
 *   ⑥ 卸载插件（删 junction + 重新扫描）⇒ 命令表回基线、窗口账为空
 *
 * 用法：
 *   node tools/verify-plugin-window.mjs                 # 默认测试库 _tmp-vault-tb
 *   node tools/verify-plugin-window.mjs --vault=<名>
 *
 * 前置：桌面 dev 在跑（`dev.cmd`，带 CDP 9222）。
 * ⚠️ 改过 `src-tauri/capabilities/*.json` 之后**必须重新编译**（capability 是编译期嵌进二进制的）
 *    —— 否则新窗口不在任何 capability 里，`close` 等核心命令会被拒（表现为"点了没反应"）。
 */
import { existsSync, lstatSync, rmdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, CDP_HTTP, click, shot, sleep } from './cdp.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'window-demo'
const PANEL_ID = `${PLUGIN_ID}.panel`
const WINDOW_HINT = `pluginWindow=${PANEL_ID}`
const SRC = join(REPO, 'examples', PLUGIN_ID)
const vaultArg = process.argv.find((a) => a.startsWith('--vault='))
const VAULT = resolve(REPO, vaultArg ? vaultArg.slice('--vault='.length) : '_tmp-vault-tb')
const LINK = join(VAULT, '.zn', 'plugins', PLUGIN_ID)

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? `　— ${detail}` : ''}`)
}
const note = (t) => console.log(`· ${t}`)
const j = (v) => JSON.stringify(v)

/* ───────── CDP 多 target：主窗口 vs 插件窗口 ───────── */

async function pages() {
  const list = await (await fetch(`${CDP_HTTP}/json/list`)).json()
  return list.filter((t) => t.type === 'page')
}

async function connectMain() {
  const hit = (await pages()).find((t) => !t.url.includes('pluginWindow='))
  if (!hit) return null
  const cdp = await Cdp.connect(hit.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  return cdp
}

/**
 * 连**指定 label** 的插件窗口。
 * CDP 的 target 列表里看不到 Tauri 的窗口 label，只能连上去问它自己 ——
 * 所以多开时必须按 label 挑，不能"随便连一个"（否则会对着窗口 A 断言窗口 B 的状态）。
 */
async function connectPluginWindow(label) {
  for (const t of await pages()) {
    if (!t.url.includes(WINDOW_HINT)) continue
    const cdp = await Cdp.connect(t.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    const l = await cdp.js(`window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null`)
    if (!label || l === label) return { cdp, label: l }
    cdp.close()
  }
  return null
}

const pluginPageCount = async () => (await pages()).filter((t) => t.url.includes(WINDOW_HINT)).length

async function waitFor(fn, label, timeoutMs = 15000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${label}`)
    await sleep(250)
  }
}

/* ───────── junction（只动链接） ───────── */

function removeLink() {
  if (!existsSync(LINK)) return
  const st = lstatSync(LINK)
  if (!st.isSymbolicLink() && !st.isDirectory()) throw new Error(`意外：${LINK} 不是链接也不是目录`)
  rmdirSync(LINK) // 只删链接本身，绝不递归（那会删掉 examples 里的真文件）
  note(`已移除 junction：${LINK}`)
}

function ensureLink() {
  if (existsSync(LINK)) removeLink()
  symlinkSync(SRC, LINK, 'junction')
  note(`已建 junction：${LINK} → ${SRC}`)
}

/** 走 UI：☰ → 插件管理 → 重新扫描 */
async function rescan(cdp) {
  await click(cdp, 'text:☰')
  await sleep(250)
  await click(cdp, 'text:插件管理')
  await sleep(400)
  await click(cdp, 'text:重新扫描')
}

/** 打开插件自己的面板页（☰ 菜单里那一项） */
async function openPanelPage(cdp) {
  await click(cdp, 'text:☰')
  await sleep(250)
  await click(cdp, 'text:独立窗口示例')
  await sleep(500)
}

/* ───────── 主流程 ───────── */

async function main() {
  if (!existsSync(join(VAULT, '.zn'))) throw new Error(`测试库不像 ZeroNote 库：${VAULT}`)
  const main0 = await connectMain()
  if (!main0) throw new Error('连不上主窗口（dev 没起来？CDP 9222 没开？）')
  note(`已连上主窗口`)

  let mainCdp = main0
  try {
    // 起点干净之一：关掉上次残留的插件窗口（否则窗口账不是从 0 起步，断言会跟着错）
    for (const t of await pages()) {
      if (!t.url.includes('pluginWindow=')) continue
      const c = await Cdp.connect(t.webSocketDebuggerUrl)
      await c.send('Runtime.enable')
      const l = await c.js(`window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null`)
      if (l) {
        await mainCdp.js(
          `(async () => { await window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: ${JSON.stringify(l)} }); return true })()`,
        )
        note(`已关掉残留窗口：${l}`)
      }
      c.close()
      await sleep(300)
    }

    // 起点干净之二：插件不在库里
    removeLink()
    await rescan(mainCdp)
    await sleep(700)
    const baseline = await mainCdp.js(`window.__znKernelAudit()`)
    note(`基线：命令 ${baseline.commands.length} 条 · 窗口账 ${j(baseline.windows)}`)

    /* ── ① 装上插件 ── */
    ensureLink()
    await rescan(mainCdp)
    await waitFor(
      async () => (await mainCdp.js(`window.__znKernelAudit()`)).commands.some((c) => c.id === `${PLUGIN_ID}.open`),
      '命令表出现 window-demo.open',
    )
    check('① 插件装上（命令表出现 window-demo.open）', true)

    /* ── ② 开两个窗口（顺带验多开） ── */
    await openPanelPage(mainCdp)
    await click(mainCdp, 'text:在新窗口打开')
    await waitFor(async () => (await pluginPageCount()) >= 1, '第一个插件窗口出现')
    const afterFirst = await mainCdp.js(`window.__znKernelAudit().windows`)
    check('② 独立窗口真的开出来了（CDP 里出现 ?pluginWindow= 的页面）', true, `账：${j(afterFirst)}`)

    await sleep(600)
    await click(mainCdp, 'text:再开一个')
    await waitFor(async () => (await pluginPageCount()) >= 2, '第二个插件窗口出现')
    const two = await mainCdp.js(`window.__znKernelAudit().windows`)
    check('②b 能多开（两个窗口、账里两条 label）', two.length === 2, `账：${j(two)}`)
    await shot(mainCdp, join(REPO, '_shots', 'plugin-window-main.png'))

    /* ── ③ 窗口里渲染出了面板（新窗口要先加载插件再渲染 —— 得等，别读空串当失败） ── */
    const targetLabel = two[0]
    const win = await waitFor(() => connectPluginWindow(targetLabel), `连上窗口 ${targetLabel}`)
    await waitFor(
      async () =>
        ((await win.cdp.js(`document.querySelector('.zn-plugin-window')?.innerText ?? ''`)) || '').includes(
          '独立窗口示例',
        ),
      '插件窗口渲染出面板',
      20000,
    )
    const winText = await win.cdp.js(`document.querySelector('.zn-plugin-window')?.innerText ?? ''`)
    const hasClose = await win.cdp.js(`!!document.querySelector('.zn-plugin-window-bar button')`)
    check(
      '③ 窗口里渲染出面板（标题 + 关闭按钮）',
      winText.includes('独立窗口示例') && hasClose,
      `label=${j(win.label)} 文本前 40 字：${j(winText.slice(0, 40))}`,
    )
    check('④ label 以 plugin- 开头（capability glob 的约定）', String(win.label).startsWith('plugin-'), j(win.label))
    await shot(win.cdp, join(REPO, '_shots', 'plugin-window-child.png'))

    /* ── ⑤ 关窗：页面消失 + 账销掉 ── */
    await click(win.cdp, 'text:关闭')
    win.cdp.close()
    await waitFor(async () => (await pluginPageCount()) <= 1, '第一个窗口关闭', 8000)
    const oneLeft = await mainCdp.js(`window.__znKernelAudit().windows`)
    check('⑤ 关掉的窗口从账上销掉（用户手动关也算）', oneLeft.length === 1, `账：${j(oneLeft)}`)

    // 第二个窗口也走它自己的「关闭」按钮（destroy 路径）
    const win2 = await waitFor(() => connectPluginWindow(oneLeft[0]), `连上窗口 ${oneLeft[0]}`)
    await waitFor(
      () => win2.cdp.js(`!!document.querySelector('.zn-plugin-window-bar button')`),
      '第二个窗口的关闭按钮',
      10000,
    )
    await click(win2.cdp, 'text:关闭')
    win2.cdp.close()
    await waitFor(async () => (await pluginPageCount()) === 0, '第二个窗口关闭', 10000)
    const zero = await mainCdp.js(`window.__znKernelAudit().windows`)
    check('⑤b 窗口全关后账为空（两个窗口都销账）', zero.length === 0, `账：${j(zero)}`)

    /* ── ⑥ 卸载插件 ⇒ 内核**自动**关掉还开着的窗口（这才叫"卸载即净"） ── */
    await sleep(400)
    await click(mainCdp, 'text:在新窗口打开')
    await waitFor(async () => (await pluginPageCount()) >= 1, '为卸载测试开的窗口')
    note('这个窗口**不手动关**，直接卸载插件 —— 期望内核替它关掉')
    removeLink()
    await rescan(mainCdp)
    await waitFor(async () => (await pluginPageCount()) === 0, '卸载后窗口被自动关掉', 12000)
    check('⑥ 卸载插件 ⇒ 开着的独立窗口被内核自动关掉（subscriptions 登记生效）', true)

    await sleep(600)
    const after = await mainCdp.js(`window.__znKernelAudit()`)
    check(
      '⑥b 卸载后命令表逐字回基线',
      j(after.commands) === j(baseline.commands),
      j(after.commands) === j(baseline.commands) ? '' : `\n  基线：${j(baseline.commands)}\n  卸载后：${j(after.commands)}`,
    )
    check('⑥c 卸载后窗口账为空', j(after.windows) === j(baseline.windows), `账：${j(after.windows)}`)
  } finally {
    removeLink()
    // 主窗口可能因 HMR 重连过：重新取一个连接再关
    try {
      const c = await connectMain()
      c?.close()
    } catch {
      /* 无所谓 */
    }
    mainCdp.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${failed.length ? '✗ 失败' : '✓ 全部通过'}：${results.length - failed.length}/${results.length}`)
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.name}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  try {
    removeLink()
  } catch {
    /* 无所谓 */
  }
  process.exitCode = 1
})
