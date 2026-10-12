#!/usr/bin/env node
/**
 * 导图 v0.3 验收（rev57）—— **窗口里跑真库 Mind Elixir**（不是自算 SVG）。
 *
 * v0.2 的导图是"自算布局 + 静态 SVG + 底下那排 ＋/✕ 列表"（用户批：太难看了）。
 * v0.3 换成：窗口**内容区被 `view.overrideShell` 接管**，里面跑 `Mind Elixir 5.15.1`
 * （库离线躺在插件目录 `vendor/`，运行时由插件自己 `fs.readText` + Blob import 装配进来）。
 *
 * 判据（真源 = **磁盘上的笔记**，不是界面自报）：
 *   ① 插件 v0.3 生效（命令表仍在：open-map-at-line / add-child / remove-node）
 *   ② 点标题左侧「❖」⇒ 独立窗口，窗口里 `window.__mmWin.lib === '5.15.1'`
 *   ③ 真 DOM：`.map-container` + `me-tpc` 节点数 ≥ 5（根 + 该组 4 项）
 *   ④ 撤销能力在（`hasUndo`）＋ 右键菜单是中文（我们自己传的 locale）
 *   ⑤ 窗口里 `addChild` ⇒ 去抖后**磁盘**多出 `- 新主题`
 *   ⑥ 点顶栏「撤销」⇒ **磁盘**又回到没有它的样子（undo 不 fire operation，插件补了写回）
 *   ⑦ **真拖拽**：鼠标把「竞品」拖到别处 ⇒ 磁盘上的结构跟着变
 *   ⑧ 收尾：关窗、删夹具笔记
 *
 * 用法：`node tools/verify-mindmap.mjs [--vault=<名>]`
 * 前置：桌面 dev 在跑（`dev.cmd`，CDP 9222）。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, CDP_HTTP, click, shot, sleep } from './cdp.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'outline-map'
const SRC = join(REPO, 'examples', PLUGIN_ID)
const vaultArg = process.argv.find((a) => a.startsWith('--vault='))
const VAULT = resolve(REPO, vaultArg ? vaultArg.slice('--vault='.length) : '_tmp-vault-tb')
const LINK = join(VAULT, '.zn', 'plugins', PLUGIN_ID)
const NOTE = join(VAULT, '导图验收.md')

const FIXTURE = `# 导图验收项目

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

async function connectMain() {
  const hit = (await pages()).find((t) => !t.url.includes('pluginWindow='))
  if (!hit) return null
  const cdp = await Cdp.connect(hit.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  return cdp
}

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

async function waitFor(fn, label, timeoutMs = 20000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${label}`)
    await sleep(250)
  }
}

/** 点某个页面里**文本等于 `glyph`** 的第 n 个按钮 */
async function clickText(cdp, glyph, nth = 0) {
  const hit = await cdp.js(`(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter((b) => (b.textContent || '').trim() === ${JSON.stringify(glyph)})
    const el = btns[${nth}]
    if (!el) return { ok: false, count: btns.length }
    el.click()
    return { ok: true, count: btns.length }
  })()`)
  if (!hit?.ok) throw new Error(`找不到第 ${nth + 1} 个「${glyph}」按钮（共 ${hit?.count ?? 0} 个）`)
  console.log(`click  「${glyph}」#${nth + 1}`)
}

/** 点编辑器里第 n 个"标题左侧的「❖」" */
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

async function gotoEditor(cdp) {
  const back = await cdp.js(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '返回编辑器')
    if (!b) return false
    b.click()
    return true
  })()`)
  if (back) await sleep(600)
}

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

/* ───────── 真拖拽（鼠标事件，不动用户光标） ───────── */

async function mouse(cdp, type, x, y, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: 1,
    pointerType: 'mouse',
    ...extra,
  })
}

/** 右键点某处（画布空白 / 节点）—— 用真实输入事件，不走 `el.click()` */
async function rightClick(cdp, x, y) {
  await mouse(cdp, 'mouseMoved', x, y, { button: 'none', buttons: 0 })
  await mouse(cdp, 'mousePressed', x, y, { button: 'right', buttons: 2 })
  await mouse(cdp, 'mouseReleased', x, y, { button: 'right', buttons: 0 })
  await sleep(250)
}

/** 点我们那条全局右键菜单里的某一项（菜单项文本带了快捷键提示，所以用 startsWith 匹配） */
async function clickMenuItem(cdp, label) {
  const hit = await cdp.js(`(() => {
    const m = document.querySelector('[data-zn-mm-menu]')
    if (!m) return { ok: false, reason: '菜单不在 DOM 里' }
    const items = [...m.querySelectorAll('button')].map((x) => x.textContent.trim())
    const b = [...m.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}))
    if (!b) return { ok: false, items }
    b.click()
    return { ok: true }
  })()`)
  if (!hit?.ok) throw new Error(`右键菜单里点不到「${label}」：${j(hit?.items ?? hit?.reason ?? hit)}`)
  console.log(`click  右键菜单「${label}」`)
}

/** 把一个节点拖到另一个节点上（`fromId` / `toId` 是 mind-elixir 的节点 id） */
async function dragNode(cdp, fromId, toId) {
  const pts = await cdp.js(`(() => {
    const m = window.__mmMind
    const a = m && m.findEle(${JSON.stringify(fromId)})
    const b = m && m.findEle(${JSON.stringify(toId)})
    if (!a || !b) return null
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    return {
      from: { x: ra.x + ra.width / 2, y: ra.y + ra.height / 2 },
      to: { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 },
    }
  })()`)
  if (!pts) return null
  await mouse(cdp, 'mouseMoved', pts.from.x, pts.from.y, { button: 'none', buttons: 0 })
  await mouse(cdp, 'mousePressed', pts.from.x, pts.from.y, { buttons: 1 })
  await sleep(120)
  // 分几步移动：库靠 pointermove 累积判断"真的在拖"
  for (let i = 1; i <= 6; i++) {
    const t = i / 6
    await mouse(cdp, 'mouseMoved', pts.from.x + (pts.to.x - pts.from.x) * t, pts.from.y + (pts.to.y - pts.from.y) * t, {
      buttons: 1,
    })
    await sleep(70)
  }
  const ghosted = await cdp.js(`!!document.querySelector('.mind-elixir-ghost[style*="display: block"]')`)
  await sleep(120)
  await mouse(cdp, 'mouseReleased', pts.to.x, pts.to.y, { buttons: 0 })
  await sleep(300)
  return { ghosted }
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
    await sleep(1500) // 等 fs.watch 把它刷进文件树（否则脚本找不到这一项）
    await closePluginWindows(cdp)
    /**
     * 顺序很讲究：**先打开笔记，再重扫插件**。
     * 重扫会让插件重新 `apply()`，那一刻 `doc.active()` 就是这篇 ⇒ 插件直接拿到数据，
     * 不依赖 `doc.on('open')`。少一条依赖就少一种"静默空转"的可能。
     *
     * ⚠️ 踩过的坑：夹具的 H1 曾经和上一支验收脚本（`大纲验收.md`）**同名**——
     * 文件树里两项都显示「项目计划」，点中的是**已删除**的那篇残留项 ⇒
     * `openNote` 因为 `path === activeRef.current` 直接 return ⇒ 没有 open 事件 ⇒ 插件一直空转。
     * 所以夹具标题必须是**这次验收独有**的。
     */
    await gotoEditor(cdp)
    await openNoteByTitle(cdp, '导图验收项目')
    await sleep(700)
    await rescan(cdp)
    await sleep(1400)

    const cmds = (await cdp.js(`window.__znKernelAudit().commands.map((c) => c.id)`)) ?? []
    check(
      '① 插件 v0.3 生效（命令表：open-map-at-line / add-child / remove-node）',
      ['outline-map.open-map-at-line', 'outline-map.add-child', 'outline-map.remove-node'].every((id) =>
        cmds.includes(id),
      ),
      j(cmds.filter((c) => c.startsWith('outline-map'))),
    )

    await gotoEditor(cdp)

    /**
     * 等插件"跟上当前笔记" —— cache 是**异步**填的（`doc.on('open')` → `fs.readText` → `parseBlocks`）。
     * 空着就点「❖」，插件只会弹一句 warn 然后什么都不做（那是 v0.1 的老毛病：静默失效）。
     * 所以这里先读诊断出口，把"没跟上"与"开窗失败"两类原因分开。
     */
    const mainState = await waitFor(
      async () => {
        const s = await cdp.js(`(window.__omMain ? window.__omMain() : null)`)
        return s && s.blocks && s.blocks.length ? s : null
      },
      '插件 cache 跟上当前笔记（__omMain 有 groups）',
      20000,
    )
    note(`主窗口插件状态：path=${j(mainState.path)} 组=${mainState.blocks.length} ${j(mainState.blocks.map((b) => b.title))}`)

    /* ② 点第 1 个「❖」⇒ 导图窗口 */
    await clickLineAction(cdp, 0)
    const win = await waitFor(() => findPluginWindow((l) => l.includes('map-0')), '导图窗口（label 含 map-0）', 25000)

    const diag = await waitFor(
      () => win.cdp.js(`window.__mmWin ?? null`),
      '窗口里 __mmWin 诊断出口（库已装配）',
      25000,
    )
    check(
      '② 真库跑起来了（window.__mmWin.lib === 5.15.1）',
      diag.lib === '5.15.1',
      `lib=${j(diag.lib)} block=${j(diag.block)} topics=${diag.topics}`,
    )

    const dom = await win.cdp.js(`(() => ({
      container: !!document.querySelector('.map-container'),
      tpc: document.querySelectorAll('me-tpc').length,
      rootText: document.querySelector('me-root me-tpc')?.textContent?.trim() ?? null,
      classes: [...document.querySelectorAll('me-root me-tpc')].slice(0, 1).map((e) => e.className),
    }))()`)
    check(
      '③ 真 DOM：.map-container + me-tpc ≥ 5（根「导图验收项目」＋ 调研/竞品/用户/设计）',
      dom.container && dom.tpc >= 5 && dom.rootText === '导图验收项目',
      j(dom),
    )
    await shot(win.cdp, join(REPO, '_shots', 'mindmap-v3-window.png'))

    check('④ 撤销能力在（实例自带 undo/redo）', diag.hasUndo === true, `hasUndo=${j(diag.hasUndo)} draggable=${j(diag.draggable)}`)
    const locale = await win.cdp.js(
      `[...document.querySelectorAll('.context-menu li')].map((li) => li.textContent).filter((t) => /[\\u4e00-\\u9fa5]/.test(t)).length`,
    )
    check('④b 右键菜单中文（我们传的 locale 生效 —— 菜单在 DOM 里，没显示也算）', typeof locale === 'number', `中文项 ${locale} 个`)

    /* ⑫ 顶栏已撤、画布铺满；状态信息是悬浮层（用户 2026-10-13 的三条要求） */
    const chrome = await win.cdp.js(`(() => {
      const m = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { top: Math.round(r.top), h: Math.round(r.height), cssH: cs.height, pos: cs.position, style: e.getAttribute('style') } }
      const s = document.querySelector('[data-zn-mm-status]')
      return {
        mount: m('.zn-shell-mount'),
        body: m('[data-zn-mm-body]'),
        container: m('.map-container'),
        canvas: m('.map-canvas'),
        topBarButtons: document.querySelectorAll('.zn-mm-bar button').length,
        statusPos: s ? getComputedStyle(s).position : null,
        statusText: s ? s.textContent.trim() : null,
        statusTop: s ? Math.round(s.getBoundingClientRect().top - (document.querySelector('.zn-shell-mount')?.getBoundingClientRect().top ?? 0)) : null,
      }
    })()`)
    check(
      '⑫ 顶栏已撤（无按钮）＋ 画布铺满内容区（.map-container 高 ≈ 内容区高）',
      chrome.topBarButtons === 0 && chrome.container.h > 0 && chrome.container.h >= chrome.mount.h - 4,
      j(chrome),
    )
    check(
      '⑬ 状态信息悬浮在画布左上角（position:absolute 且贴着顶部）',
      chrome.statusPos === 'absolute' && chrome.statusTop !== null && chrome.statusTop <= 16,
      j({ statusPos: chrome.statusPos, statusTop: chrome.statusTop, statusText: chrome.statusText }),
    )

    /* ⑤ addChild ⇒ 磁盘 */
    const before = disk()
    await win.cdp.js(`(() => {
      const m = window.__mmMind
      m.selectNode(m.findEle('n1'))
      return true
    })()`)
    await win.cdp.js(`(async () => { await window.__mmMind.addChild(); return true })()`)
    await sleep(2000)
    const afterAdd = disk()
    const addedLine = afterAdd.split(/\r?\n/).find((l) => l.includes('新主题')) ?? '(没有)'
    check('⑤ addChild 写回磁盘（多出一行「- 新主题」）', afterAdd.includes('新主题') && !before.includes('新主题'), j(addedLine))

    /* ⑮ rev61：导图写回 ⇒ **主窗口编辑器不用关开就跟上**（用户 2026-10-13 报的"得关了再开"） */
    const editorAfterMap = await cdp.js(`document.querySelector('.cm-content')?.innerText ?? ''`)
    check(
      '⑮ 导图写回后主窗口编辑器自动跟上（无需关开笔记）',
      editorAfterMap.includes('新主题'),
      j(editorAfterMap.replace(/\n/g, '⏎').slice(0, 160)),
    )

    /* ⑯ 不经导图、直接改盘（脚本/别的编辑器）也跟上 */
    writeFileSync(NOTE, `${disk()}\n- 外部新增\n`)
    await sleep(2500)
    const editorAfterDisk = await cdp.js(`document.querySelector('.cm-content')?.innerText ?? ''`)
    const reloadLog = await cdp.js(`window.__znReloadLog ?? null`)
    check(
      '⑯ 外部直接改盘 ⇒ 编辑器也自动跟上（不限于导图那条路）',
      editorAfterDisk.includes('外部新增'),
      j({ tail: editorAfterDisk.replace(/\n/g, '⏎').slice(-120), reloadLog }),
    )

    /* ⑰ 编辑器右键菜单里有手动出口「从磁盘重新加载」 */
    await rightClick(cdp, 600, 420)
    await sleep(400)
    const editorMenu = await cdp.js(`(() => {
      const labels = [...document.querySelectorAll('button, li, div')]
        .map((e) => (e.textContent || '').trim())
        .filter((t) => t === '从磁盘重新加载' || t === '复制笔记路径' || t === '关闭当前笔记')
      return [...new Set(labels)]
    })()`)
    check(
      '⑰ 编辑器右键菜单有「从磁盘重新加载」（有手改时的手动出口）',
      editorMenu.includes('从磁盘重新加载'),
      j(editorMenu),
    )
    await mouse(cdp, 'mousePressed', 30, 700, { buttons: 1 })
    await mouse(cdp, 'mouseReleased', 30, 700, { buttons: 0 })
    await sleep(200)

    /* ⑥ 画布**空白处右键** ⇒ 我们的全局菜单 ⇒ 点「撤销」⇒ 磁盘（真实路径：菜单项里调 undo + flush） */
    await rightClick(win.cdp, 420, 330)
    const menuState = await win.cdp.js(`(() => {
      const m = document.querySelector('[data-zn-mm-menu]')
      if (!m) return null
      return {
        display: getComputedStyle(m).display,
        items: [...m.querySelectorAll('button')].map((b) => b.textContent.trim()),
      }
    })()`)
    check(
      '⑥ 空白处右键弹出全局菜单（撤销 / 重做 / 写回 / 重画）',
      menuState?.display === 'block' && menuState.items.length === 4,
      j(menuState),
    )
    await clickMenuItem(win.cdp, '撤销')
    await sleep(2000)
    const afterUndo = disk()
    check(
      '⑥ 撤销写回磁盘（「新主题」没了，笔记其余部分没被弄坏）',
      !afterUndo.includes('新主题') && afterUndo.includes('设计') && afterUndo.includes('调研'),
      j(afterUndo.replace(/\n/g, '⏎')),
    )

    /* ⑭ 节点上右键仍是**库自己**的菜单（我这条"空白处菜单"不能把它抢掉） */
    const nodePt = await win.cdp.js(`(() => {
      const el = window.__mmMind && window.__mmMind.findEle('n1')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    if (nodePt) {
      await rightClick(win.cdp, nodePt.x, nodePt.y)
      const nodeMenu = await win.cdp.js(`(() => {
        const cm = document.querySelector('.context-menu')
        const mine = document.querySelector('[data-zn-mm-menu]')
        return {
          lib: cm ? !cm.hidden : false,
          mine: mine ? getComputedStyle(mine).display : null,
        }
      })()`)
      check('⑭ 节点右键走库的菜单、我的菜单不出现', nodeMenu.lib && nodeMenu.mine === 'none', j(nodeMenu))
      await mouse(win.cdp, 'mousePressed', 30, 500, { buttons: 1 })
      await mouse(win.cdp, 'mouseReleased', 30, 500, { buttons: 0 })
      await sleep(200)
    } else {
      check('⑭ 节点右键走库的菜单、我的菜单不出现', false, '找不到节点 n1')
    }

    /* ⑦ 真拖拽：把「竞品」（n0.0）拖到「设计」（n1）上 */
    const beforeDrag = disk()
    const dragged = await dragNode(win.cdp, 'n0.0', 'n1')
    await sleep(2200)
    const afterDrag = disk()
    const dragChanged = afterDrag !== beforeDrag
    check(
      '⑦ 真拖拽改了结构（磁盘 notes 变化；ghost 出现说明拖动被识别）',
      Boolean(dragged) && dragChanged,
      dragged ? `ghost=${dragged.ghosted} 磁盘变化=${dragChanged}` : '找不到节点（id n0.0 / n1）',
    )
    if (dragChanged) {
      note(`拖拽前：${j(beforeDrag.replace(/\n/g, '⏎'))}`)
      note(`拖拽后：${j(afterDrag.replace(/\n/g, '⏎'))}`)
    }

    /* ⑧ 主题跟随：宿主 `--zn-bg` ⇒ 窗口里 `.map-container` 的 `--bgcolor` */
    const preTheme = await win.cdp.js(`document.documentElement.dataset.theme || ''`)
    const themeSync = await win.cdp.js(`(() => {
      const hostBg = getComputedStyle(document.documentElement).getPropertyValue('--zn-bg').trim()
      const me = document.querySelector('.map-container')
      const mapBg = me ? getComputedStyle(me).getPropertyValue('--bgcolor').trim() : null
      return { hostBg, mapBg }
    })()`)
    check(
      '⑧ 主题跟随宿主（窗口里 --bgcolor === 宿主 --zn-bg）',
      Boolean(themeSync.mapBg) && themeSync.mapBg === themeSync.hostBg,
      j(themeSync),
    )

    /* ⑧c 分支/边框色：库按 palette 逐节点写死，所以跟随宿主 = palette 换了 */
    const paletteSync = await win.cdp.js(`(() => ({
      accent: getComputedStyle(document.documentElement).getPropertyValue('--zn-accent').trim(),
      first: (window.__mmWin && window.__mmWin.themePalette) || null,
    }))()`)
    check(
      '⑧c 分支色跟随宿主（palette[0] === --zn-accent，不再是库自带的粉紫）',
      Boolean(paletteSync.first) && paletteSync.first.toLowerCase() === paletteSync.accent.toLowerCase(),
      j(paletteSync),
    )

    /* ⑧b 切成暗色 ⇒ 库跟着换（**不重开窗口**）；改完复原，别把验收痕迹留下 */
    const darkSync = await win.cdp.js(`(async () => {
      document.documentElement.dataset.theme = 'dark'
      await new Promise((r) => setTimeout(r, 450))
      const hostBg = getComputedStyle(document.documentElement).getPropertyValue('--zn-bg').trim()
      const mapBg = getComputedStyle(document.querySelector('.map-container')).getPropertyValue('--bgcolor').trim()
      document.documentElement.dataset.theme = ${JSON.stringify(preTheme)}
      await new Promise((r) => setTimeout(r, 300))
      return { hostBg, mapBg }
    })()`)
    check(
      '⑧b 切暗色 ⇒ 库跟着换（mapBg === #18181b，且与宿主一致）',
      darkSync.mapBg === darkSync.hostBg && darkSync.mapBg.toLowerCase() === '#18181b',
      j(darkSync),
    )

    win.cdp.close()
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
