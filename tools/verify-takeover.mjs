#!/usr/bin/env node
/**
 * 接管协议验收（rev49）—— **自动判定**「卸载插件后内核回到基线」。
 *
 * 为什么要有它：在这之前，"卸载即净"只能靠人眼截图 + 读日志推断，于是
 * `core.newNote` 被插件接管、卸载后变成"没有实现"这种缺口，躲了很久
 * （命令表看起来没变，四个入口一起坏、报错还只在执行时才出现）。
 * 现在判据是**机器读得到的**：`window.__znKernelAudit()` 快照 + 关键 DOM 属性。
 *
 * ## 流程（全自动，不碰用户鼠标）
 *
 * ```
 * 基线快照 → junction 进插件 → UI「重新扫描」→ 插件在时快照
 *          → 删 junction → 「重新扫描」→ 卸载后快照 → 逐条比对
 * ```
 *
 * ## 用法
 *
 * ```powershell
 * node tools/verify-takeover.mjs                 # 默认测试库 _tmp-vault-tb
 * node tools/verify-takeover.mjs --vault=_tmp-vault-tb
 * ```
 *
 * 前置：桌面 dev 在跑（`dev.cmd`，带 CDP 端口 9222）—— 见 `tools/cdp.mjs` 文件头。
 */
import { existsSync, lstatSync, rmdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, click, pickTarget, shot, sleep } from './cdp.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'takeover-probe'
const SRC = join(REPO, 'examples', PLUGIN_ID)
const vaultArg = process.argv.find((a) => a.startsWith('--vault='))
const VAULT = resolve(REPO, vaultArg ? vaultArg.slice('--vault='.length) : '_tmp-vault-tb')
const LINK = join(VAULT, '.zn', 'plugins', PLUGIN_ID)

const results = []

function check(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? `　— ${detail}` : ''}`)
}

function note(text) {
  console.log(`· ${text}`)
}

const j = (v) => JSON.stringify(v)

/* ───────── 页面侧读取 ───────── */

/** 一次读全：审计快照 + 关键 DOM 状态 + 夹具自己的诊断出口 */
const SAMPLE_JS = `(() => {
  const bar = document.querySelector('.zn-statusbar');
  return {
    audit: window.__znKernelAudit ? window.__znKernelAudit() : null,
    statusbar: bar ? bar.style.backgroundImage : null,
    bodyFlag: document.body.dataset.znProbeUnregistered ?? null,
    probe: window.__takeoverProbe ?? null,
  };
})()`

const sample = (cdp) => cdp.js(SAMPLE_JS)

/** 等到插件的诊断出口变成期望状态（`loaded` 真/假），超时抛错 */
async function waitProbe(cdp, wantLoaded, timeoutMs = 25000) {
  const t0 = Date.now()
  for (;;) {
    const probe = await cdp.js(`window.__takeoverProbe ?? null`)
    if (probe && probe.loaded === wantLoaded) return probe
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`等不到 __takeoverProbe.loaded === ${wantLoaded}（当前 ${j(probe)}）`)
    }
    await sleep(250)
  }
}

/** 走 UI：☰ → 插件管理 → 重新扫描（与用户手动操作同一条路，不改内部状态） */
async function rescan(cdp) {
  await click(cdp, 'text:☰')
  await sleep(250)
  await click(cdp, 'text:插件管理')
  await sleep(400)
  await click(cdp, 'text:重新扫描')
}

/* ───────── junction 管理（只动链接，绝不动真目录） ───────── */

function removeLink() {
  if (!existsSync(LINK)) return
  const st = lstatSync(LINK)
  if (!st.isSymbolicLink() && !st.isDirectory()) throw new Error(`意外：${LINK} 不是链接也不是目录`)
  // 用 rmdir 删链接本身（等价 `Directory.Delete(path, false)`）——
  // 绝不用递归删除：那会跟着链接删掉 examples/takeover-probe 里的真文件
  rmdirSync(LINK)
  note(`已移除 junction：${LINK}`)
}

function ensureLink() {
  if (existsSync(LINK)) removeLink()
  symlinkSync(SRC, LINK, 'junction')
  note(`已建 junction：${LINK} → ${SRC}`)
}

/* ───────── 主流程 ───────── */

async function main() {
  if (!existsSync(join(VAULT, '.zn'))) {
    throw new Error(`测试库不像 ZeroNote 库（没有 .zn）：${VAULT}`)
  }

  const target = await pickTarget()
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  note(`已连上 WebView：${target.url}`)

  try {
    // 起点干净：确保插件不在库里
    removeLink()
    await rescan(cdp)
    await sleep(600)

    const baseline = await sample(cdp)
    if (!baseline.audit) throw new Error('页面里没有 window.__znKernelAudit —— 内核是这一版吗？')
    note(`基线：命令 ${baseline.audit.commands.length} 条 · 订阅 topic ${Object.keys(baseline.audit.eventTopics).length} 个 · 面板 ${baseline.audit.panels.length} 个`)

    /* ── ① 装上插件 ── */
    ensureLink()
    await rescan(cdp)
    const loadedProbe = await waitProbe(cdp, true)
    await sleep(400)
    const loaded = await sample(cdp)
    note(`插件在时：命令 ${loaded.audit.commands.length} 条 · 夹具日志 ${loadedProbe.log.length} 条`)

    const loadedPing = loaded.audit.commands.find((c) => c.id === `${PLUGIN_ID}.ping`)
    check('插件确实加载了（命令表里出现 takeover-probe.ping）', Boolean(loadedPing), j(loadedPing ?? null))

    const loadedNewNote = loaded.audit.commands.find((c) => c.id === 'core.newNote')
    check(
      '接管生效（core.newNote 的实现归属 = 插件）',
      loadedNewNote?.impl === `plugin:${PLUGIN_ID}`,
      j(loadedNewNote ?? null),
    )

    check(
      '宿主自动登记了未接返回值的订阅（note:saved 订阅者 +1）',
      (loaded.audit.eventTopics['note:saved'] ?? 0) > (baseline.audit.eventTopics['note:saved'] ?? 0),
      `基线 ${baseline.audit.eventTopics['note:saved'] ?? 0} → 插件在时 ${loaded.audit.eventTopics['note:saved'] ?? 0}`,
    )

    // 失败时也把"插件在时"的状态暴露出来，便于定位
    note(`插件在时 statusbar.backgroundImage = ${JSON.stringify(loaded.statusbar)}`)
    await shot(cdp, join(REPO, '_shots', 'takeover-loaded.png'))

    /* ── ② 卸掉插件 ── */
    removeLink()
    await rescan(cdp)
    await waitProbe(cdp, false)
    await sleep(600)
    const after = await sample(cdp)

    /* ── 判定 ── */
    check(
      '命令表逐字回到基线（含插件自己的命令已消失）',
      j(after.audit.commands) === j(baseline.audit.commands),
      j(after.audit.commands) === j(baseline.audit.commands) ? '' : `\n  基线：${j(baseline.audit.commands)}\n  卸载后：${j(after.audit.commands)}`,
    )

    const afterNewNote = after.audit.commands.find((c) => c.id === 'core.newNote')
    check(
      '**接管被还原到内核实现**（core.newNote 归属 = core，而不是 null）',
      afterNewNote?.impl === 'core',
      j(afterNewNote ?? null),
    )

    check(
      '事件订阅表回到基线',
      j(after.audit.eventTopics) === j(baseline.audit.eventTopics),
      `\n  基线：${j(baseline.audit.eventTopics)}\n  卸载后：${j(after.audit.eventTopics)}`,
    )

    for (const [label, key] of [
      ['面板', 'panels'],
      ['服务', 'services'],
      ['编辑器标记规则', 'editorMarks'],
      ['插件注入样式数', 'pluginStyles'],
    ]) {
      check(
        `${label}回到基线`,
        j(after.audit[key]) === j(baseline.audit[key]),
        j(after.audit[key]) === j(baseline.audit[key]) ? '' : `${j(baseline.audit[key])} → ${j(after.audit[key])}`,
      )
    }

    check(
      '登记过的 DOM 改动被内核还原（状态栏条纹已复原）',
      after.statusbar === baseline.statusbar,
      `基线 ${j(baseline.statusbar)} → 卸载后 ${j(after.statusbar)}`,
    )
    await shot(cdp, join(REPO, '_shots', 'takeover-unloaded.png'))

    /* 这一条**故意不判失败**：它是"没登记的自己负责"的边界确认 */
    const residual = after.bodyFlag === '1'
    console.log(
      residual
        ? 'ℹ 边界确认：未登记的 DOM 改动**如预期残留**（内核不管没登记的东西 —— 这正是原则 4 的诚实边界）'
        : 'ℹ 边界确认：未登记的 DOM 改动也没了（说明别处清理过，不影响本次判定）',
    )

    /* ── 收尾：把夹具留下的痕迹清掉，环境回干净 ── */
    await cdp.js(`delete document.body.dataset.znProbeUnregistered; delete window.__takeoverProbe; true`)
    note('已清理夹具残留（body 属性 / 全局出口）')
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
  // 兜底：别把 junction 留在库里
  try {
    removeLink()
  } catch {
    /* 无所谓 */
  }
  process.exitCode = 1
})
