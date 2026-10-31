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
 *   node tools/cdp.mjs dblclickat 439 74              # 真实双击（canvas / 导图改名）
 *   node tools/cdp.mjs eval "document.title"
 *   node tools/cdp.mjs type "input" "hello" key Enter shot b.png
 *
 * 命令：`shot <path>` · `text [sel]` · `html [sel]` · `eval <js>` ·
 *       `click <sel|text:…>` · `clickat <x> <y>` · `dblclickat <x> <y>` · `type <sel|text:…> <值>` · `key <Enter|Escape|…>` ·
 *       `wait <ms>` · `waitfor <sel|text:…>` · `crash` · `list`
 *
 * `crash`（rev173.246）：对当前 target 发 CDP 的 `Page.crash`，**直接杀渲染进程** ——
 * 页面不再响应、窗口壳还在。白屏兜底（`src/lib/window-guard.ts`）的验收就用它；
 * 要崩别的窗口：`$env:ZN_TARGET="note="; node tools/cdp.mjs crash`。
 * ⚠️ 崩掉的是真窗口，测完记得关（渲染进程已死时窗口关不掉，从主窗口
 * `invoke('plugin:window|close', { label })` 可以关，详见 `docs/卡死兜底方案-2026-10-13.md` §11）。
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

/**
 * 真实双击（rev173.89）：mind-elixir 的节点改名靠 `dblclick`，
 * 而 `.dispatchEvent('dblclick')` 只派一个孤立事件、库不认；必须让浏览器自己合成。
 * 做法与 `clickAt` 同一条流水线，第二组按下/松开带 `clickCount: 2`。
 */
async function dblclickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(80)
  for (const clickCount of [1, 2]) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount, buttons: 1,
    })
    await sleep(40)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount, buttons: 0,
    })
    await sleep(40)
  }
  console.log(`dblclickat @${x},${y}`)
}

/** 把鼠标移到元素上（触发 hover 态，不点） */async function hover(cdp, target) {
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
      case 'dblclickat':
        await dblclickAt(cdp, Number(argv[i++]), Number(argv[i++]))
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
      /**
       * 模拟窄屏视口（rev173.303）：只影响页面渲染（媒体查询按它算），**不动窗口**。
       *
       *   node tools/cdp.mjs viewport 390 844
       *   node tools/cdp.mjs viewport off          # 恢复真实视口
       *
       * 用途：验「手机上才生效」的 CSS（替换栏两行、底部四项…），桌面窗口不必缩到 390。
       * ⚠️ 它与真机仍有差异：UA 不变（`platform` 判据仍按桌面走）、触摸事件也要另造。
       */
      case 'viewport': {
        const arg = argv[i++]
        if (arg === 'off') {
          await cdp.send('Emulation.clearDeviceMetricsOverride', {})
          console.log('viewport 恢复')
          break
        }
        const w = Number(arg)
        const h = Number(argv[i++] ?? 844)
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: h || 844,
          deviceScaleFactor: 2,
          mobile: true,
        })
        console.log(`viewport ${w}x${h || 844}`)
        break
      }
      case 'wait':
        await sleep(Number(argv[i++]) || 300)
        break
      case 'waitfor':
        await waitFor(cdp, argv[i++])
        break
      case 'crash': {
        /**
         * 杀渲染进程（rev173.246）：白屏兜底的验收手段（见 `docs/卡死兜底方案-2026-10-13.md` §11）。
         *
         * ⚠️ **不能 await `cdp.send('Page.crash')`**：渲染进程一死，这条命令的回执就永远不会来
         * （实测 socket 挂着、Promise 不 resolve）⇒ 发出去就往下走，别等。
         */
        console.log(`crash  → ${target.url}`)
        void cdp.send('Page.crash').catch(() => {})
        await sleep(600)
        console.log('crash  已发出（页面不再响应；窗口壳仍在，等主窗口的 reaper 处理）')
        break
      }
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
