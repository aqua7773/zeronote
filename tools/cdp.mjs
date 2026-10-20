#!/usr/bin/env node
/**
 * ZeroNote CDP 工具 —— 用 Chrome DevTools Protocol 直接操作 ZeroNote 的 WebView。
 *
 * ## 为什么要有它（以及它取代了什么）
 *
 * 在此之前验收 GUI 靠的是"截图 → 人眼估坐标 → 合成鼠标点击"（`gentle_*` 那套），
 * 代价是：**抢用户的鼠标**、窗口一动坐标就失效、跨轮沿用坐标会点错东西
 * （2026-10-12 真的误触了「切换笔记库」，弹出文件夹对话框）。
 *
 * 这条路完全不同：`dev.cmd` 里给 WebView2 开了 `--remote-debugging-port=9222`，
 * 本工具连上去之后：
 *   · 按 **CSS 选择器 / 文本** 找元素，不靠坐标；
 *   · 点击用 `Input.dispatchMouseEvent`（页面内的**真实输入事件**，React 与任何组件库都认），
 *     但**不动系统光标** —— 用户可以同时用电脑；
 *   · 输入用 `Input.insertText` —— 中文不会被输入法吃掉；
 *   · 截图用 `Page.captureScreenshot`，没有 DWM 边框/多显示器那些坑。
 *
 * ## 用法（可连续多步，一条命令走完整个流程）
 *
 *   node tools/cdp.mjs text
 *   node tools/cdp.mjs click "text:新建笔记" shot _shots/a.png
 *   node tools/cdp.mjs clickat 439 74                 # 真实鼠标点页面坐标（带 clientX/Y）
 *   node tools/cdp.mjs eval "document.title"
 *   node tools/cdp.mjs type "input" "hello" key Enter shot b.png
 *
 * 命令：`shot <path>` · `text [sel]` · `html [sel]` · `eval <js>` ·
 *       `click <sel|text:…>` · `clickat <x> <y>` · `type <sel|text:…> <值>` · `key <Enter|Escape|…>` ·
 *       `wait <ms>` · `waitfor <sel|text:…>` · `list`
 *
 * 环境变量 `ZN_CDP`（默认 `http://127.0.0.1:9222`）、`ZN_TARGET`（多页面时挑哪个）。
 *
 * ⚠️ 调试端口只在 dev 启动脚本里开（`dev.cmd`），**生产包不含**（官方推荐的隔离方式）。
 */

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CDP_HTTP = process.env.ZN_CDP ?? 'http://127.0.0.1:9222'
const TARGET_HINT = process.env.ZN_TARGET ?? 'localhost:1420'

/* ───────── 连接 ───────── */

async function pickTarget() {
  const res = await fetch(`${CDP_HTTP}/json/list`)
  const list = await res.json()
  const pages = list.filter((t) => t.type === 'page')
  if (!pages.length) throw new Error('CDP 里没有 page target —— dev 起了吗？端口开了吗？')
  const matched = pages.filter((t) => t.url.includes(TARGET_HINT))
  /**
   * **默认优先主窗口**：插件独立窗口与主窗口的 URL 是同一个前缀（只多 `?pluginWindow=`），
   * 只按 `includes` 挑会随机挑到插件窗口 —— 于是"以为在主窗口里执行"其实跑在插件窗口里
   * （2026-10-13 排查"插件窗口关不掉"时真踩到）。要连插件窗口请显式设 `ZN_TARGET=pluginWindow=`。
   *
   * rev173.51 同理：笔记独立窗口的 URL 只多 `?note=`，也必须排除。
   */
  return (
    matched.find((t) => !t.url.includes('pluginWindow=') && !t.url.includes('note=')) ??
    matched[0] ??
    pages[0]
  )
}

class Cdp {
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error(`连不上 ${url}`)), { once: true })
    })
    const c = new Cdp(ws)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const p = c.pending.get(msg.id)
      if (!p) return
      c.pending.delete(msg.id)
      if (msg.error) p.rej(new Error(msg.error.message))
      else p.res(msg.result)
    })
    return c
  }

  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
      // 兜底超时：CDP 不响应时别把整条命令挂死
      setTimeout(() => {
        if (this.pending.delete(id)) rej(new Error(`${method} 超时`))
      }, 15000)
    })
  }

  /** 在页面里跑 JS 并取回值（DOM 对象取不回 —— 所以"找元素"与"用它"必须同一段代码） */
  async js(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text
      throw new Error(String(d).split('\n')[0])
    }
    return r.result?.value
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* 无所谓 */
    }
  }
}

/* ───────── 页面侧的小助手（拼进 evaluate 的表达式里） ───────── */

/**
 * 找元素并操作它 —— **找与用必须写在同一段 JS 里**（DOM 节点不能通过 returnByValue 传回来）。
 * 这段会被 evaluate 执行，返回值必须是可序列化的普通对象。
 */
const ACT_JS = (target, action) => `
(() => {
  const t = ${JSON.stringify(target)};
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  let el = null;
  if (t.startsWith('text:')) {
    const want = t.slice(5);
    const sel = 'button,[role="tab"],[role="menuitem"],a,li,label,td,th,h1,h2,h3,span,div';
    const cands = [...document.querySelectorAll(sel)].filter(visible);
    // 「文本完全相等」的候选可能有好几个（菜单项外层 div 与内层 button 文本一样，
    // 但 onClick 只挂在内层）—— 优先挑**真正可点**的那些，否则 el.click() 打空
    // （2026-10-13 踩到：'text:插件管理' 命中了外层 div，菜单项纹丝不动）
    const clickable = (n) =>
      n.tagName === 'BUTTON' || n.tagName === 'A'
      || n.getAttribute('role') === 'menuitem' || n.getAttribute('role') === 'tab';
    const exact = cands.filter((n) => (n.textContent || '').trim() === want);
    el = exact.find(clickable)
      ?? exact[0]
      // 包含匹配时取**文本最短**的那个（= 最具体）。否则 'text:导图' 会命中
      // 整个页面的根容器 —— 它的 innerText 里什么都含（踩过）
      ?? cands
        .filter((n) => (n.textContent || '').includes(want))
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
  } else {
    el = document.querySelector(t);
  }
  if (!el) throw new Error('找不到元素：' + t);
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  ${action}
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    text: (el.textContent || '').trim().slice(0, 80),
    tag: el.tagName.toLowerCase(),
  };
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 点击。**走 DOM 的 `el.click()`**，不派发坐标鼠标事件 —— 原因：
 * 像标题栏那种"悬停才实心"的按钮，坐标点击要先 hover 再按，时序很脆；
 * 而 `el.click()` 直接触发元素上的 click（React 17+ 委托到 root，照样认），
 * 与 hover 状态、窗口位置、遮挡都无关。
 * 需要真实鼠标序列（拖拽、悬停菜单）时用 `rclick` / `hover`。
 */
async function click(cdp, target) {
  const hit = await cdp.js(ACT_JS(target, 'el.click();'))
  console.log(`click  <${hit.tag}> ${hit.text}  @${hit.x},${hit.y}`)
}

/** 真实鼠标序列（先移动再按，能触发 hover 类交互） */
async function rclick(cdp, target) {
  const hit = await cdp.js(ACT_JS(target, ''))
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y })
  await sleep(150)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1, buttons: 1,
  })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1, buttons: 0,
  })
  console.log(`rclick <${hit.tag}> ${hit.text}  @${hit.x},${hit.y}`)
}

/**
 * 在**页面坐标**点一下（真实鼠标事件，带 clientX / clientY）。
 *
 * 为什么需要它：`click` 走 `el.click()`，合成事件的坐标是 0,0 ——
 * atomic 的链接「尾部图标热区」用 `event.clientX` 与元素 rect 比较，
 * 合成点击永远落在热区外（实测点了没反应）。这里发真实鼠标序列。
 */
async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(80)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1,
  })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0,
  })
  console.log(`clickat @${x},${y}`)
}

/** 把鼠标移到元素上（触发 hover 态，不点） */
async function hover(cdp, target) {
  const hit = await cdp.js(ACT_JS(target, ''))
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y })
  console.log(`hover  <${hit.tag}> ${hit.text}  @${hit.x},${hit.y}`)
}

async function typeText(cdp, target, value) {
  const hit = await cdp.js(ACT_JS(target, 'el.focus(); if (el.select) el.select();'))
  // insertText 走浏览器输入管线 ⇒ 中文不会被输入法吃掉（合成按键就没这待遇）
  await cdp.send('Input.insertText', { text: value })
  console.log(`type   "${value}"  → <${hit.tag}> ${hit.text}`)
}

async function key(cdp, name) {
  const MAP = {
    Enter: { windowsVirtualKeyCode: 13, key: 'Enter', text: '\r' },
    Escape: { windowsVirtualKeyCode: 27, key: 'Escape' },
    Tab: { windowsVirtualKeyCode: 9, key: 'Tab' },
    ArrowDown: { windowsVirtualKeyCode: 40, key: 'ArrowDown' },
  }
  const k = MAP[name] ?? { key: name }
  for (const t of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type: t, ...k, ...(t === 'keyUp' ? { text: undefined } : {}) })
  }
  console.log(`key    ${name}`)
}

async function shot(cdp, path) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  console.log(`shot   ${path}`)
}

async function waitFor(cdp, target, timeoutMs = 6000) {
  const t0 = Date.now()
  for (;;) {
    try {
      const hit = await cdp.js(ACT_JS(target, ''))
      console.log(`ready  ${hit.text || hit.tag}`)
      return hit
    } catch (e) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`等不到 ${target}：${e.message}`)
      await sleep(120)
    }
  }
}

/* ───────── 主流程 ───────── */

async function main() {
  const argv = process.argv.slice(2)
  if (!argv.length) {
    console.log('用法见文件头注释；例：node tools/cdp.mjs click "text:新建笔记" shot a.png')
    return
  }

  if (argv[0] === 'list') {
    const list = await (await fetch(`${CDP_HTTP}/json/list`)).json()
    for (const t of list) console.log(`${t.type}\t${t.title}\t${t.url}`)
    return
  }

  const target = await pickTarget()
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  let i = 0
  while (i < argv.length) {
    const cmd = argv[i++]
    switch (cmd) {
      case 'shot':
        await shot(cdp, argv[i++])
        break
      case 'text': {
        const sel = argv[i]?.startsWith('text:') || argv[i]?.startsWith('.') || argv[i]?.startsWith('#') ? argv[i++] : 'body'
        const out = await cdp.js(
          `(() => { const el = document.querySelector(${JSON.stringify(sel)});
            return el ? el.innerText.slice(0, 4000) : '(没有 ' + ${JSON.stringify(sel)} + ')' })()`,
        )
        console.log(out)
        break
      }
      case 'html': {
        const sel = argv[i]?.startsWith('.') || argv[i]?.startsWith('#') ? argv[i++] : 'body'
        const out = await cdp.js(
          `(() => { const el = document.querySelector(${JSON.stringify(sel)});
            return el ? el.innerHTML.slice(0, 4000) : '' })()`,
        )
        console.log(out)
        break
      }
      case 'eval':
        console.log(JSON.stringify(await cdp.js(argv[i++]), null, 2))
        break
      case 'click':
        await click(cdp, argv[i++])
        break
      case 'clickat':
        await clickAt(cdp, Number(argv[i++]), Number(argv[i++]))
        break
      case 'rclick':
        await rclick(cdp, argv[i++])
        break
      case 'hover':
        await hover(cdp, argv[i++])
        break
      case 'type':
        await typeText(cdp, argv[i++], argv[i++])
        break
      case 'key':
        await key(cdp, argv[i++])
        break
      case 'wait':
        await sleep(Number(argv[i++]) || 300)
        break
      case 'waitfor':
        await waitFor(cdp, argv[i++])
        break
      default:
        throw new Error(`未知命令：${cmd}`)
    }
  }
  cdp.close()
}

/* ───────── 可复用导出（2026-10-13 加） ─────────
 *
 * 验收脚本（`tools/verify-takeover.mjs`）要复用这套 CDP 封装 —— 于是把这些
 * 本来"只有 CLI 用"的东西导出。**同时给 `main()` 加主模块判断**：否则被 import 时
 * 它会拿调用方的 `argv` 当 cdp 命令去跑（等于把验收脚本自己搞挂）。
 */
export {
  Cdp,
  pickTarget,
  click,
  rclick,
  hover,
  typeText,
  key,
  shot,
  waitFor,
  sleep,
  CDP_HTTP,
  TARGET_HINT,
}

/** 只有 `node tools/cdp.mjs …` 直接跑时才进 CLI 流程 */
const isMainEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainEntry) {
  main().catch((e) => {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  })
}
