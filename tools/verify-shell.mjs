#!/usr/bin/env node
/**
 * 整窗接管验收（U2 · 2026-10-13 rev51）—— 全自动，不碰用户鼠标。
 *
 * 判据（每条都读机器可读的出口）：
 *   ① 插件装上后命令表出现 `shell-demo.takeover`
 *   ② 执行接管 ⇒ `.zn-shell-mount` 出现、里面是插件的 DOM、**内核 UI 让位**
 *      （侧栏 / 编辑器 / 状态栏都不在渲染树里），`__znKernelAudit().shell === 'shell-demo'`
 *   ③ 插件自己的「释放接管」按钮 ⇒ 容器消失、内核 UI 回来、`shell === null`
 *   ④ 再次接管后**卸载插件** ⇒ 内核 UI 自动复原（subscriptions 登记生效），命令表回基线
 *
 * 用法：`node tools/verify-shell.mjs [--vault=<名>]`
 * 前置：桌面 dev 在跑（`dev.cmd`，CDP 9222）。
 */
import { existsSync, lstatSync, rmdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, CDP_HTTP, click, key, shot, sleep, typeText } from './cdp.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'shell-demo'
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

async function connectMain() {
  const list = await (await fetch(`${CDP_HTTP}/json/list`)).json()
  const hit = list.filter((t) => t.type === 'page').find((t) => !t.url.includes('pluginWindow='))
  if (!hit) return null
  const cdp = await Cdp.connect(hit.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  return cdp
}

async function waitFor(fn, label, timeoutMs = 15000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${label}`)
    await sleep(250)
  }
}

function removeLink() {
  if (!existsSync(LINK)) return
  const st = lstatSync(LINK)
  if (!st.isSymbolicLink() && !st.isDirectory()) throw new Error(`意外：${LINK} 不是链接也不是目录`)
  rmdirSync(LINK) // 只删链接本身，绝不递归
  note(`已移除 junction：${LINK}`)
}

function ensureLink() {
  if (existsSync(LINK)) removeLink()
  symlinkSync(SRC, LINK, 'junction')
  note(`已建 junction：${LINK} → ${SRC}`)
}

async function rescan(cdp) {
  await click(cdp, 'text:☰')
  await sleep(250)
  await click(cdp, 'text:插件管理')
  await sleep(400)
  await click(cdp, 'text:重新扫描')
}

/** 通过命令面板执行一条命令（命令不进 ☰ 菜单，这是最接近用户操作的路径） */
async function runCommand(cdp, query) {
  await click(cdp, 'text:☰')
  await sleep(250)
  await click(cdp, 'text:命令面板')
  await sleep(350)
  await typeText(cdp, 'input', query)
  await sleep(250)
  await key(cdp, 'Enter')
}

/** 页面侧状态快照：接管容器 + 内核 UI 是否在场 */
const STATE_JS = `(() => ({
  mount: !!document.querySelector('.zn-shell-mount'),
  mountText: (document.querySelector('.zn-shell-mount')?.innerText ?? '').slice(0, 60),
  shellAudit: window.__znKernelAudit ? window.__znKernelAudit().shell : null,
  kernelUi: !!document.querySelector('.zn-sidebar') || !!document.querySelector('.zn-statusbar')
    || !!document.querySelector('.zn-main-panel') || !!document.querySelector('.zn-editor-wrap'),
  probe: window.__shellDemo ?? null,
}))()`

async function main() {
  if (!existsSync(join(VAULT, '.zn'))) throw new Error(`测试库不像 ZeroNote 库：${VAULT}`)
  const cdp = await connectMain()
  if (!cdp) throw new Error('连不上主窗口（dev 没起来？CDP 9222 没开？）')
  note('已连上主窗口')

  try {
    removeLink()
    await rescan(cdp)
    await sleep(700)
    const baseline = await cdp.js(`window.__znKernelAudit()`)
    note(`基线：命令 ${baseline.commands.length} 条 · shell=${j(baseline.shell)}`)

    /* ── ① 装上插件 ── */
    ensureLink()
    await rescan(cdp)
    await waitFor(
      async () => (await cdp.js(`window.__znKernelAudit()`)).commands.some((c) => c.id === `${PLUGIN_ID}.takeover`),
      '命令表出现 shell-demo.takeover',
    )
    check('① 插件装上（命令表出现 shell-demo.takeover）', true)

    /* ── ② 接管 ── */
    await runCommand(cdp, '整窗接管')
    await waitFor(async () => (await cdp.js(STATE_JS)).mount, '接管容器出现')
    await sleep(300)
    const taken = await cdp.js(STATE_JS)
    check('② 接管生效：.zn-shell-mount 出现且渲染出插件内容', taken.mountText.includes('整窗接管示例'), `文本：${j(taken.mountText)}`)
    check('②b 内核 UI 让位（侧栏/编辑器/状态栏都不在渲染树里）', !taken.kernelUi, `kernelUi=${taken.kernelUi}`)
    check('②c 审计读数 shell === shell-demo', taken.shellAudit === PLUGIN_ID, `shell=${j(taken.shellAudit)}`)
    check('②d 插件自己的诊断出口 active=true', taken.probe?.active === true, j(taken.probe))
    await shot(cdp, join(REPO, '_shots', 'shell-takeover.png'))

    /* ── ③ 插件自己的按钮释放接管 ──
       ⚠️ 文本必须给全：内核逃生口那颗按钮也叫「释放接管」，而定位是"包含匹配取最短"，
       只写 `text:释放接管` 会点到内核那颗 —— 那样就验错了对象。 */
    await click(cdp, 'text:释放接管（内核 UI 回来）')
    await waitFor(async () => !(await cdp.js(STATE_JS)).mount, '接管容器消失')
    await sleep(300)
    const released = await cdp.js(STATE_JS)
    check('③ 释放后容器消失、内核 UI 回来', !released.mount && released.kernelUi, `kernelUi=${released.kernelUi}`)
    check('③b 审计读数 shell === null', released.shellAudit === null, `shell=${j(released.shellAudit)}`)
    await shot(cdp, join(REPO, '_shots', 'shell-released.png'))

    /* ── ④ 内核逃生口：插件不给退出入口时，用户也必须能回到内核 ── */
    await runCommand(cdp, '整窗接管')
    await waitFor(async () => (await cdp.js(STATE_JS)).mount, '第二次接管容器出现')
    const hasEscape = await cdp.js(`!!document.querySelector('.zn-shell-escape')`)
    check('④ 接管期间内核逃生口在（可见按钮）', hasEscape)
    await click(cdp, 'text:释放接管') // exact = 内核逃生口那颗
    await waitFor(async () => !(await cdp.js(STATE_JS)).mount, '逃生口释放后容器消失', 8000)
    await sleep(300)
    const escaped = await cdp.js(STATE_JS)
    check('④b 逃生口释放生效（内核 UI 回来、账清空）', escaped.kernelUi && escaped.shellAudit === null,
      `kernelUi=${escaped.kernelUi} shell=${j(escaped.shellAudit)}`)
    check('④c 插件被通知到"已释放"（它的 dispose 收了尾）', escaped.probe?.releasedBy === 'dispose', j(escaped.probe))

    /* ── ⑤ 卸载插件 ⇒ 命令表回基线（注：接管**进行中**时内核 UI 不可达，
       所以"卸载"这条只能在释放后走；接管中被锁死的那条路由 ④ 的逃生口覆盖） ── */
    note('再接管一次，然后先逃生口释放、再卸载插件')
    await runCommand(cdp, '整窗接管')
    await waitFor(async () => (await cdp.js(STATE_JS)).mount, '第三次接管容器出现')
    await click(cdp, 'text:释放接管')
    await waitFor(async () => !(await cdp.js(STATE_JS)).mount, '释放第三次接管', 8000)
    removeLink()
    await rescan(cdp)
    await sleep(700)
    const after = await cdp.js(`window.__znKernelAudit()`)
    check('⑤ 卸载后命令表逐字回基线', j(after.commands) === j(baseline.commands),
      j(after.commands) === j(baseline.commands) ? '' : `\n  基线：${j(baseline.commands)}\n  卸载后：${j(after.commands)}`)
    check('⑤b 卸载后 shell 账为空、无残留容器',
      after.shell === baseline.shell && !(await cdp.js(`!!document.querySelector('.zn-shell-mount')`)),
      `shell=${j(after.shell)}`)
  } finally {
    removeLink()
    cdp.close()
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
