#!/usr/bin/env node
/**
 * 大纲 · 导图 v0.2 验收（rev52）—— 全自动，不碰用户鼠标。
 *
 * v0.2 的架构：**导图在独立窗口（U1）里，编辑直接写库文件（fs），不依赖编辑器挂载**。
 * （一开始想把大纲放侧栏"与编辑器同屏"，实测发现内核里 `sidebar` 面板其实渲染在主区 ⇒
 *   那条路要有编辑器就得动内核；而导图本来就在独立窗口里 ⇒ 干脆让插件直接读写文件。）
 *
 * 判据（真源 = **磁盘上的笔记**，不是界面自报）：
 *   ① 插件 v0.2 生效（命令表出现 open-map / add-child / remove-node / reload）
 *   ② 打开含列表的笔记后，主区面板列出大纲组（组名 +「❖ 导图」按钮）
 *   ③ 点「❖ 导图」⇒ CDP 里多出一个独立窗口，窗口内渲染出该组 SVG（含组内文字）
 *   ④ 再点另一组 ⇒ **多开**（两个窗口）
 *   ⑤ **在窗口里**点「＋」⇒ 磁盘笔记多出 `  - 新主题`
 *   ⑥ **在窗口里**点「✕」⇒ 该节点连同子树从磁盘消失
 *   ⑦ 收尾：关窗、删夹具笔记
 *
 * 用法：`node tools/verify-outline-map.mjs [--vault=<名>]`
 * 前置：桌面 dev 在跑（`dev.cmd`，CDP 9222）。
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, CDP_HTTP, click, shot, sleep } from './cdp.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'outline-map'
const SRC = join(REPO, 'examples', PLUGIN_ID)
const vaultArg = process.argv.find((a) => a.startsWith('--vault='))
const VAULT = resolve(REPO, vaultArg ? vaultArg.slice('--vault='.length) : '_tmp-vault-tb')
const LINK = join(VAULT, '.zn', 'plugins', PLUGIN_ID)
const NOTE = join(VAULT, '大纲验收.md')

const FIXTURE = `# 项目计划

- 调研
  - 竞品
  - 用户
- 设计

## 另一组

- 排期
  - 里程碑
`

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? `　— ${detail}` : ''}`)
}
const note = (t) => console.log(`· ${t}`)
const j = (v) => JSON.stringify(v)
const disk = () => readFileSync(NOTE, 'utf8')

/* ───────── CDP ───────── */

async function pages() {
  const list = await (await fetch(`${CDP_HTTP}/json/list`)).json()
  return list.filter((t) => t.type === 'page')
}
const pluginPages = async () => (await pages()).filter((t) => t.url.includes('pluginWindow='))
const pluginPageCount = async () => (await pluginPages()).length

async function connectMain() {
  const hit = (await pages()).find((t) => !t.url.includes('pluginWindow='))
  if (!hit) return null
  const cdp = await Cdp.connect(hit.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  return cdp
}

/**
 * 按 **label** 找一个插件窗口 —— 不能按 `/json/list` 的索引挑：
 * 那个顺序不保证是创建顺序（上一次就是按索引挑，结果把要用的窗口关掉了，
 * 后面所有断言都在对着一个已经不存在的 webview 说话 → evaluate 超时）。
 */
async function findPluginWindow(match) {
  for (const t of await pluginPages()) {
    const cdp = await Cdp.connect(t.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    const label = await cdp.js(`window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null`)
    if (label && match(String(label))) return { cdp, label }
    cdp.close()
  }
  return null
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

/** 点某个页面里文本为 `glyph` 的第 n 个按钮（`＋` / `✕` / `❖ 导图` 都用它） */
async function clickGlyph(cdp, glyph, nth = 0) {
  const hit = await cdp.js(`(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter((b) => (b.textContent || '').trim() === ${JSON.stringify(glyph)})
    const el = btns[${nth}]
    if (!el) return { ok: false, count: btns.length }
    el.click()
    return { ok: true, count: btns.length }
  })()`)
  if (!hit?.ok) throw new Error(`找不到第 ${nth + 1} 个「${glyph}」按钮（共 ${hit?.count ?? 0} 个）`)
  console.log(`click  「${glyph}」#${nth + 1}（共 ${hit.count} 个）`)
}

/** 点编辑器里第 n 个"标题左侧的「❖」"（内核 `editor.addLineAction` 插的 widget 按钮） */
async function clickLineAction(cdp, nth = 0) {
  const hit = await cdp.js(`(() => {
    const btns = [...document.querySelectorAll('.zn-line-action')]
    const el = btns[${nth}]
    if (!el) return { ok: false, count: btns.length }
    el.click()
    return { ok: true, count: btns.length }
  })()`)
  if (!hit?.ok) throw new Error(`标题左侧找不到第 ${nth + 1} 个「❖」（共 ${hit?.count ?? 0} 个）`)
  console.log(`click  标题左侧「❖」#${nth + 1}（共 ${hit.count} 个）`)
}

async function rescan(cdp) {
  await click(cdp, 'text:☰')
  await sleep(250)
  await click(cdp, 'text:插件管理')
  await sleep(400)
  await click(cdp, 'text:重新扫描')
}

/** 回到编辑器视图 */
async function gotoEditor(cdp) {
  const back = await cdp.js(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent || '').trim() === '返回编辑器')
    if (!b) return false
    b.click()
    return true
  })()`)
  if (back) await sleep(600)
}

/** 点文件树里的某一项（文件树显示的是**笔记标题**，不是文件名） */
async function openNoteByTitle(cdp, title) {
  await waitFor(
    () =>
      cdp.js(`(() => {
        const el = [...document.querySelectorAll('.zn-filetree *')]
          .find((n) => (n.textContent || '').trim() === ${JSON.stringify(title)})
        if (!el) return false
        el.click()
        return true
      })()`),
    `文件树里出现「${title}」`,
    12000,
  )
  console.log(`click  文件树项「${title}」`)
}

async function closePluginWindows(mainCdp) {
  for (const t of await pluginPages()) {
    const c = await Cdp.connect(t.webSocketDebuggerUrl)
    await c.send('Runtime.enable')
    const label = await c.js(`window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null`)
    c.close()
    if (label) {
      await mainCdp.js(
        `(async () => { await window.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: ${JSON.stringify(label)} }); return true })()`,
      )
    }
    await sleep(300)
  }
}

function ensureLink() {
  if (existsSync(LINK)) {
    const st = lstatSync(LINK)
    if (st.isSymbolicLink() || st.isDirectory()) return
    throw new Error(`意外：${LINK} 不是链接也不是目录`)
  }
  symlinkSync(SRC, LINK, 'junction')
  note(`已建 junction：${LINK} → ${SRC}`)
}

/* ───────── 主流程 ───────── */

async function main() {
  if (!existsSync(join(VAULT, '.zn'))) throw new Error(`测试库不像 ZeroNote 库：${VAULT}`)
  const cdp = await connectMain()
  if (!cdp) throw new Error('连不上主窗口（dev 没起来？CDP 9222 没开？）')
  note('已连上主窗口')

  try {
    ensureLink()
    mkdirSync(VAULT, { recursive: true })
    writeFileSync(NOTE, FIXTURE)
    note(`已写夹具笔记：${NOTE}`)
    await closePluginWindows(cdp)
    await rescan(cdp)
    await sleep(800)

    const cmds = (await cdp.js(`window.__znKernelAudit().commands.map((c) => c.id)`)) ?? []
    check(
      '① 插件 v0.2 生效（命令表有 open-map / add-child / remove-node / reload）',
      ['outline-map.open-map', 'outline-map.add-child', 'outline-map.remove-node', 'outline-map.reload'].every(
        (id) => cmds.includes(id),
      ),
      j(cmds.filter((c) => c.startsWith('outline-map'))),
    )

    /* 打开笔记：插件靠 doc.on('open') 跟上，顶部条随即出现每组一个按钮 */
    await gotoEditor(cdp)
    await sleep(1200) // 等 fs.watch 把新写的夹具笔记刷进文件树
    await openNoteByTitle(cdp, '项目计划')
    await sleep(1500)

    const btnInfo = await cdp.js(`(() => {
      const btns = [...document.querySelectorAll('.zn-line-action')]
      return { count: btns.length, labels: btns.map((b) => (b.textContent || '').trim()).slice(0, 5) }
    })()`)
    check(
      '② 每个大纲组的**标题左侧**有「❖」按钮（编辑器内；笔记本身仍是大纲）',
      btnInfo.count >= 2 && btnInfo.labels.every((l) => l === '❖'),
      j(btnInfo),
    )
    await shot(cdp, join(REPO, '_shots', 'outline-map-v2-titlebtn.png'))

    /* ③ 点第 1 个按钮（第 1 组的标题左侧）⇒ 开该组导图窗口 */
    await clickLineAction(cdp, 0)
    const win1 = await waitFor(
      () => findPluginWindow((l) => l.includes('map-0')),
      '第一个导图窗口（label 含 map-0）',
      20000,
    )
    await waitFor(
      async () => ((await win1.cdp.js(`document.body.innerText`)) || '').includes('调研'),
      '导图窗口渲染出该组内容',
      20000,
    )
    const winText = await win1.cdp.js(`document.body.innerText`)
    const winSvg = await win1.cdp.js(`!!document.querySelector('svg.om-svg')`)
    check(
      '③ 独立窗口渲染出该组导图（含「调研」+ 真 SVG）',
      winText.includes('调研') && winSvg,
      `label=${win1.label} svg=${winSvg}`,
    )
    await shot(win1.cdp, join(REPO, '_shots', 'outline-map-v2-window.png'))

    /* ④ 多开：点第 2 个按钮（另一组的标题左侧） */
    await clickLineAction(cdp, 1)
    const win2 = await waitFor(
      () => findPluginWindow((l) => l.includes('map-1')),
      '第二个导图窗口（label 含 map-1）',
      20000,
    )
    check('④ 多开（两个导图窗口同时在，label 不同）', (await pluginPageCount()) === 2, `${win1.label} / ${win2.label}`)
    // 关掉第二个（**按 label 精确关**），第一个留着做编辑验收
    await cdp.js(
      `(async () => { await window.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: ${JSON.stringify(win2.label)} }); return true })()`,
    )
    win2.cdp.close()
    await sleep(800)

    /* ⑤ **在窗口里**插入子主题 ⇒ 看磁盘 */
    const before = disk()
    await clickGlyph(win1.cdp, '＋', 0)
    await sleep(2000)
    const afterAdd = disk()
    check(
      '⑤ 窗口里「＋」写回磁盘（多出缩进两格的 `- 新主题`）',
      afterAdd.includes('\n  - 新主题') && !before.includes('新主题'),
      `新增行：${j(afterAdd.split(/\r?\n/).find((l) => l.includes('新主题')) ?? '(没有)')}`,
    )

    /* ⑥ **在窗口里**删除该节点连同子树 ⇒ 看磁盘 */
    await clickGlyph(win1.cdp, '✕', 0)
    await sleep(2000)
    const afterDel = disk()
    check(
      '⑥ 窗口里「✕」删掉节点连同子树（调研 / 竞品 / 用户 / 新主题 全没了，「设计」还在）',
      ['调研', '竞品', '用户', '新主题'].every((t) => !afterDel.includes(t)) && afterDel.includes('设计'),
      `删除后：${j(afterDel.replace(/\n/g, '⏎'))}`,
    )
    win1.cdp.close()
  } finally {
    await closePluginWindows(cdp).catch(() => {})
    try {
      if (existsSync(NOTE)) unlinkSync(NOTE)
      note('已删除夹具笔记')
    } catch {
      /* 无所谓 */
    }
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
  process.exitCode = 1
})
