#!/usr/bin/env node
/**
 * 大纲折叠 + 「❖」入口 · 回归验收（rev81）。
 *
 * **为什么有这个脚本**：rev81 期间观测到「同一次会话里第二次打开同一篇笔记时 ❖ 不显示」，
 * 复查 4 条路径（首开 / 重开 / 聚焦后重开 / 跨笔记切换）**都没能复现** —— 于是把这条路径
 * 固化成可重复的断言，而不是留一句"下次注意"。它同时覆盖折叠（官方 codeFolding 那一套）。
 *
 * 前置：目标页面上**已打开一篇含嵌套列表的笔记**（折点非空）。
 *   · 桌面 dev： `ZN_CDP=http://127.0.0.1:9222 ZN_TARGET=localhost:1420 node tools/verify-outline-fold.mjs`
 *   · 手机 dev： `adb forward tcp:9333 localabstract:webview_devtools_remote_<app pid>`
 *                `ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost node tools/verify-outline-fold.mjs`
 *
 * 断言（每条都读机器可读出口，不靠目测）：
 *   ① 折点非空（`__omFolds().ends`）
 *   ② ❖ 按钮数 === `__omButtons().length`（**就是那条曾观测到"不显示"的路径**）
 *   ③ 折点行带 `zn-ol-foldable`；展开后没有残留的折叠行
 *   ④ 点圆点 ⇒ 折起来（`kernelFolded` 增加、可见行变少、**没有 `…`**）
 *   ⑤ 再点 ⇒ 恢复（可见行回到基线）
 *   ⑥ 写盘一致（仅当库文件在本机可读：桌面）
 *
 * ⚠️ 所有页面内表达式都写成**字符串数组 join**（不用模板字符串）——
 * 之前用反引号嵌这些表达式踩过 `SyntaxError: missing ) after argument list`，不值得再赌。
 * ⚠️ 点击走页面内 `el.click()`（插件在 document 上做事件委托）—— 不用坐标，跨平台一致。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, CDP_HTTP } from './cdp.mjs'

const HINT = process.env.ZN_TARGET ?? 'localhost:1420'

/* ───────── 页面内表达式（字符串数组，避免嵌套引号） ───────── */

const EXPR_FOLDED_COUNT = "document.querySelectorAll('.cm-line.zn-ol-folded').length"

const EXPR_SNAPSHOT = [
  'JSON.stringify({',
  "  folds: (typeof window.__omFolds === 'function') ? window.__omFolds() : null,",
  "  buttons: (typeof window.__omButtons === 'function') ? window.__omButtons() : null,",
  "  btnDom: document.querySelectorAll('[data-zn-line-action]').length,",
  "  foldable: document.querySelectorAll('.zn-ol-foldable').length,",
  "  foldedDom: document.querySelectorAll('.zn-ol-folded').length,",
  "  lines: document.querySelectorAll('.cm-line').length,",
  "  placeholder: document.querySelectorAll('.zn-fold-placeholder').length,",
  "  text: (document.querySelector('.cm-content') || {}).textContent || '',",
  "  vault: localStorage.getItem('zeronote.vault'),",
  '})',
].join('\n')

const EXPR_CLICK_FOLDABLE = [
  '(() => {',
  "  const b = document.querySelector('.cm-line.zn-ol-foldable .cm-atomic-bullet')",
  '  if (!b) return false',
  '  b.click()',
  '  return true',
  '})()',
].join('\n')

const EXPR_CLICK_FOLDED = [
  '(() => {',
  "  const b = document.querySelector('.cm-line.zn-ol-folded .cm-atomic-bullet')",
  '  if (!b) return false',
  '  b.click()',
  '  return true',
  '})()',
].join('\n')

/* ───────── 连接 ───────── */

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? `　— ${detail}` : ''}`)
}
const note = (t) => console.log(`· ${t}`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const list = (await (await fetch(`${CDP_HTTP}/json/list`)).json()).filter((t) => t.type === 'page')
/**
 * 挑 target：含 `ZN_TARGET` 且不是插件窗口页；同条件时**优先 URL 最短的那个** ——
 * 手机上"关掉的插件窗口"会留下常驻 webview（URL 是 `?vault=…`，比主窗口裸地址长），
 * 不排一下就会连到那个没有编辑器的页面上去。
 */
const cands = list
  .filter((t) => t.url.includes(HINT) && !t.url.includes('pluginWindow='))
  .sort((a, b) => a.url.length - b.url.length)
const target = cands[0] ?? list[0]
if (!target) {
  console.error('CDP 里没有 page target —— dev 起了吗？端口 forward 了吗？')
  process.exit(2)
}
note(`目标：${target.url}`)

const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
const js = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result?.value
}

/* ───────── 先把折叠全部展开（盘上恢复出来的不算基线） ─────────
   展开循环放在**宿主侧**：每次 evaluate 都是同步的、立刻返回 ——
   页面内 async 循环 + `awaitPromise` 在这个通道上踩过 `Runtime.evaluate 超时`。 */
for (let i = 0; i < 8; i++) {
  if ((await js(EXPR_FOLDED_COUNT)) === 0) break
  await js(EXPR_CLICK_FOLDED)
  await wait(300)
}

const S = JSON.parse(await js(EXPR_SNAPSHOT))
if (!S.folds) {
  console.error('页面上没有插件出口 `__omFolds` —— 插件没加载？还是没打开笔记？')
  process.exit(2)
}

/* ───────── ①②③ 基线与"❖ 不显示"这条路径 ───────── */
check('① 折点非空（__omFolds().ends）', S.folds.ends.length > 0, `ends=[${S.folds.ends}]`)
check(
  '② ❖ 按钮数 === __omButtons().length',
  S.btnDom === (S.buttons?.length ?? -1),
  `dom=${S.btnDom} om=${S.buttons?.length}`,
)
check('③ 折点行带 zn-ol-foldable', S.foldable > 0, `foldable=${S.foldable}`)
check(
  '③b 展开后无残留折叠行',
  S.foldedDom === 0 && S.folds.kernelFolded.length === 0,
  `dom=${S.foldedDom} kernel=${JSON.stringify(S.folds.kernelFolded)}`,
)

/* ───────── ④ 点第一个可折叠行的圆点 ⇒ 折起来 ───────── */
const clicked = await js(EXPR_CLICK_FOLDABLE)
if (!clicked) {
  check('④ 点圆点 ⇒ 折起来', false, '页面上找不到 .zn-ol-foldable 的圆点')
} else {
  await wait(800)
  const A = JSON.parse(await js(EXPR_SNAPSHOT))
  check(
    '④ 点圆点 ⇒ 折起来',
    A.folds.kernelFolded.length > 0,
    `kernelFolded=${JSON.stringify(A.folds.kernelFolded)} folded=${JSON.stringify(A.folds.folded)}`,
  )
  check('④b 折叠期间没有省略号（官方 placeholder 是空 span）', !A.text.includes('…'),
    `placeholder=${A.placeholder}`)
  check('④c 可见行变少（或出现 placeholder）', A.lines < S.lines || A.placeholder > 0,
    `lines ${S.lines} → ${A.lines}`)
  check('④d 已折叠行 class 数 === 插件折叠签名数', A.foldedDom === A.folds.folded.length,
    `dom=${A.foldedDom} 签名=${A.folds.folded.length}（注：kernelFolded 是"折点落在折叠区里"的探针，
     被祖先折住的子行也会命中，所以不能拿它当折点数比）`)

  /* ───────── ⑤ 再点 ⇒ 恢复 ───────── */
  await js(EXPR_CLICK_FOLDED)
  await wait(800)
  const B = JSON.parse(await js(EXPR_SNAPSHOT))
  check('⑤ 再点 ⇒ 恢复', B.folds.kernelFolded.length === 0 && B.lines === S.lines,
    `kernelFolded=${JSON.stringify(B.folds.kernelFolded)} lines ${A.lines} → ${B.lines}（基线 ${S.lines}）`)
}

/* ───────── ⑥ 写盘一致（仅当库就在这台机器上：桌面） ───────── */
const finalFolds = JSON.parse(await js('JSON.stringify(window.__omFolds())'))
const localVault = typeof S.vault === 'string' && /^[A-Za-z]:[\\/]/.test(S.vault)
if (localVault) {
  try {
    const disk = JSON.parse(readFileSync(join(S.vault, '.zn', 'outline-folded.json'), 'utf8'))
    const diskSet = [...(disk[finalFolds.path] ?? [])].sort()
    const memSet = [...finalFolds.folded].sort()
    check('⑥ 写盘与插件内存一致', JSON.stringify(diskSet) === JSON.stringify(memSet),
      `disk=${JSON.stringify(diskSet)} mem=${JSON.stringify(memSet)}`)
  } catch (e) {
    check('⑥ 写盘一致', false, `读不到库文件：${String(e).slice(0, 90)}`)
  }
} else {
  note(`跳过 ⑥：库不在这台机器上（${S.vault ?? '未知'}）—— 写盘一致性只在桌面侧可查`)
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${failed.length ? '✗' : '✓'} ${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
