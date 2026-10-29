import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { Prec, Range, type Extension, type EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, Decoration, type DecorationSet } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import type { AtomicCodeMirrorEditorHandle } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'
import { editorMarkExtensions } from '../kernel/editor-marks'
import { editorSyntaxExtensions } from '../kernel/editor-syntax'
import { frontmatterHide } from '../kernel/editor-frontmatter'
import { indentLine } from '../kernel/editor-indent'
import { resolveImageAbsPath, stripAngleTarget } from '../lib/insert-image'
import { MEDIA_ELEMENT_CLASS, MEDIA_WRAP_CLASS, mediaKindOf } from '../lib/media-render'
import { ensureReplaceEntry } from '../lib/find-replace-entry'
import { isPlainBracketLink, isPlainBracketSource, wikiLinkTarget } from '../lib/atomic-link'
import {
  MAX_PASTE_IMAGE_BYTES,
  bytesToBase64,
  pasteImageExt,
  pickPastedImage,
} from '../lib/paste-image'
import { SourceModeView } from './SourceModeView'
import { TableToolbar, type TableInfo } from './TableToolbar'

/** 编辑器 state 缓存上限（篇）；超过按 LRU 淘汰，避免开过很多笔记后内存无限涨 */
const MAX_CACHED_STATES = 20

/**
 * 嵌套引用（2026-10-17 用户报「引用嵌套无效」）。
 *
 * atomic 的 `.cm-atomic-blockquote` 只表达"这一行在引用里"，**不分层级**
 * ⇒ `> 一级` 与 `> > 二级` 渲染出来一模一样。这里按行首 `>` 的个数给行加
 * `zn-quote-dN`（样式在 styles.css 里逐级缩进）。
 */
const QUOTE_LINE_RE = /^\s*(?:>\s*)+/

/** 库外绝对路径（`D:\x` / `D:/x` / UNC）—— 媒体错误时据此判断「该不该给同步入口」 */
const EXTERNAL_ABS_RE = /^(?:[a-zA-Z]:[\\/]|\\\\)/

function quoteDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const m = QUOTE_LINE_RE.exec(line.text)
      if (m) {
        const depth = (m[0].match(/>/g) ?? []).length
        decos.push(
          Decoration.line({ class: `zn-quote-d${Math.min(depth, 4)}` }).range(line.from),
        )
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(decos)
}

const quoteDepthPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = quoteDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = quoteDecorations(update.view)
      }
    }
  },
  { decorations: (v: { decorations: DecorationSet }) => v.decorations },
)

/**
 * Tab / Shift-Tab：只在**列表行**上做缩进（2026-10-17 用户报「空列表无法直接缩进成子项」）。
 *
 * 为什么不能用 atomic 自带的 `indentWithTab`：它底层是 CM6 的 `indentMore`，
 * 而 markdown 语言包的缩进规则基于**语法块** —— `- `（空的列表项）在语法树里
 * 没有可缩进的块，实测按 Tab 毫无反应（有内容的 `- 无序列表` 能缩进）。
 *
 * 这里自己接管：行首是 `-` / `*` / `+` / `1.` + 空白的行，Tab 加 2 个空格、
 * Shift-Tab 减 0–2 个。**非列表行返回 false**，交还给 atomic 原来的处理。
 *
 * 实现在 `kernel/editor-indent.ts` —— 手机键盘上方工具栏的「缩进 / 取消缩进」按钮
 * （`core.indent` / `core.outdent` 命令）走的是**同一份**逻辑，改规则只改一处。
 */

/**
 * 正文图片的 src 解析（2026-10-18 用户要求「markdown 插入图片」）。
 *
 * 为什么需要它：atomic-editor 的 image-blocks 把 `![](url)` 渲染成 `<img>`，
 * 而 `img.src` 用的就是**文档原文**。写进 `.md` 的必须是相对路径（换机器 / 换端
 * 都能用），但 WebView 会把相对路径解析成 `http://localhost:1420/…` ⇒ 404 裂图。
 * 这里在 widget 挂进 DOM 的**同一帧**把 src 换成 asset URL ——
 * MutationObserver 回调是微任务，早于绘制，所以不会闪破图。
 *
 * 覆盖两处创建 `<img>` 的地方：image-blocks（正文块）与 table-widget（表格单元格），
 * 以及 CM6 虚拟化重挂载（滚走再滚回来 widget 会重建）。
 */
function fixImageSrc(
  view: EditorView,
  vault: string | null | undefined,
  notePath: string | null,
  onExternalMediaSync?: (raw: string) => void,
) {
  for (const img of view.contentDOM.querySelectorAll('img')) {
    const raw = img.getAttribute('src')
    if (!raw) continue
    // 音视频不在这里处理 —— 交给 upgradeMediaWidgets（它会把整个 image 块换成播放器）
    if (mediaKindOf(raw)) continue
    // 已经是可直接加载的 URL（网络图 / data: / plugin 的 asset:）就别碰
    if (/^(?:https?|data|blob|asset):/i.test(raw)) continue
    // 原样记住（rev173.239）：点开预览时要靠它反推库内相对路径，再问台账「这张图有没有原图」
    img.dataset.znRaw = raw
    const abs = resolveImageAbsPath(vault, notePath, raw)
    if (!abs) continue
    let url: string
    try {
      url = convertFileSrc(abs)
    } catch {
      // 非 Tauri 环境（浏览器预览 / 单测）没有 asset 协议：保持原文，别让整页炸掉
      continue
    }
    // 同一 URL 不重复赋值 —— 每次赋值都会让浏览器重新发起一次加载
    if (img.src !== url) img.src = url
    attachImageErrorHint(img, raw)
  }
  upgradeMediaWidgets(view, vault, notePath, onExternalMediaSync)
}

/**
 * 图片加载失败 → 在 widget 里写一行明确说明（rev173.235 · 需求 §4「不静默破图」）。
 *
 * 典型场景就是「引用原文件」：原图在另一台机器上、或被移动 / 删除了 ——
 * 只留一个空白块，用户会以为笔记坏了。提示里带上**原文路径**，
 * 方便直接去文件管理器核对。
 *
 * `error` 可能在挂监听**之前**就发生（虚拟化重建 / 缓存命中），所以先看 `complete`。
 * 用 `dataset` 标记保证同一个 `<img>` 只挂一次（`fixImageSrc` 会被 MutationObserver 反复调用）。
 */
function attachImageErrorHint(img: HTMLImageElement, raw: string) {
  if (img.dataset.znErrorBound) return
  img.dataset.znErrorBound = '1'
  const show = () => {
    const wrap = img.closest('.cm-atomic-image')
    if (!wrap || wrap.querySelector('.zn-image-error')) return
    const hint = document.createElement('div')
    hint.className = 'zn-image-error'
    hint.textContent = `图片不在本机：${stripAngleTarget(raw)}`
    wrap.appendChild(hint)
  }
  img.addEventListener('error', show, { once: true })
  // 失败在挂监听之前就结束的情形：`complete` 已经为真且没有解出尺寸
  if (img.complete && img.naturalWidth === 0) show()
}

/**
 * 音视频内联播放（rev173.226 · 2026-10-28 用户要求「音视频内联播放」）。
 *
 * 为什么走这条路：atomic 的 image-blocks 把 `![](clip.mp4)` 一律渲染成
 * `<div class="cm-atomic-image"><img src="clip.mp4"></div>` —— 浏览器拿 mp4 当图片
 * 只会显示破图。这里在 widget 挂进 DOM 后把 `<img>` 换成 `<video controls>` /
 * `<audio controls>`；asset URL 的解析规则与图片**完全一致**（相对笔记目录 /
 * `/` 开头相对库根 / 网络 URL 原样）。
 *
 * 三个约束：
 *  - **幂等**：`data-zn-media` 标记 + 没有 `img` 就跳过。CM6 虚拟化滚走再滚回来会重建
 *    widget（标记自然丢），那时走同一段代码重新升级，不需要额外缓存。
 *  - **别抢光标**：atomic 在 wrap 上挂了 `mousedown`（点图把光标挪到源码行）。
 *    播放器要能点播放，所以在 capture 阶段把 mousedown 掐掉，不让它冒到那个监听器。
 *  - **失败要说话**：`error` 事件在播放器下方写一条明确提示（文件不在 / 容器不支持），
 *    而不是留一个黑框（「静默失效比报错危险」）。
 */
function upgradeMediaWidgets(
  view: EditorView,
  vault: string | null | undefined,
  notePath: string | null,
  onExternalMediaSync?: (raw: string) => void,
) {
  for (const wrap of view.contentDOM.querySelectorAll<HTMLElement>('.cm-atomic-image')) {
    if (wrap.dataset.znMedia) continue
    const img = wrap.querySelector('img')
    if (!img) continue
    const raw = img.getAttribute('src')
    if (!raw) continue
    // 尖括号目标（`![](<a b.mp4>)`）：扩展名判定要看剥掉尖括号后的真路径
    const kind = mediaKindOf(stripAngleTarget(raw))
    if (!kind) continue
    const url = mediaSourceUrl(raw, vault, notePath)
    if (!url) continue

    const el = document.createElement(kind === 'video' ? 'video' : 'audio')
    el.className = `${MEDIA_ELEMENT_CLASS} ${MEDIA_ELEMENT_CLASS}-${kind}`
    el.src = url
    el.controls = true
    el.preload = 'metadata'
    if (kind === 'video') {
      // 属性写法而不是 `el.playsInline`：`el` 是 video | audio 的联合类型（audio 没有这属性）
      el.setAttribute('playsinline', '')
      el.setAttribute('webkit-playsinline', '')
    }
    const hint = document.createElement('div')
    hint.className = 'zn-media-error'
    hint.hidden = true
    el.addEventListener('error', () => {
      hint.hidden = false
      hint.replaceChildren(
        document.createTextNode(
          kind === 'video'
            ? '无法播放：文件可能不在库里，或容器/编码不被支持（MKV、AVI 请先转成 MP4）'
            : '无法播放：文件可能不在库里，或格式不被支持（请先转成 MP3）',
        ),
      )
      // 库外绝对路径 = 「原文件在另一台机器上」的典型形态（需求 §5 入口 1）。
      // 点击后由宿主查台账 → 确认 → 从云端临时区接收 → 改写引用（编辑器不认识搬运逻辑）。
      if (onExternalMediaSync && EXTERNAL_ABS_RE.test(stripAngleTarget(raw))) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'zn-media-sync'
        btn.textContent = '原文件不在本机 · 同步'
        btn.addEventListener('click', (e) => {
          // wrap 上有 capture 阶段的 mousedown 拦截（防抢光标），点击要自己吃掉
          e.preventDefault()
          e.stopPropagation()
          onExternalMediaSync(raw)
        })
        hint.append(btn)
      }
    })

    wrap.dataset.znMedia = kind
    wrap.classList.add(MEDIA_WRAP_CLASS)
    wrap.replaceChildren(el, hint)
    wrap.addEventListener('mousedown', (e) => e.stopPropagation(), true)
  }
}

/** 媒体 src → 可直接喂给 `<video>` / `<audio>` 的 URL（解析规则与图片一致） */
function mediaSourceUrl(
  raw: string,
  vault: string | null | undefined,
  notePath: string | null,
): string | null {
  if (/^(?:https?|data|blob|asset):/i.test(raw)) return raw
  const abs = resolveImageAbsPath(vault, notePath, raw)
  if (!abs) return null
  try {
    return convertFileSrc(abs)
  } catch {
    return null
  }
}

function imageAssetPlugin(
  vault: string | null | undefined,
  notePath: string | null,
  onExternalMediaSync?: (raw: string) => void,
) {
  return ViewPlugin.fromClass(
    class {
      private readonly observer: MutationObserver
      constructor(view: EditorView) {
        this.observer = new MutationObserver(() => fixImageSrc(view, vault, notePath, onExternalMediaSync))
        this.observer.observe(view.contentDOM, { childList: true, subtree: true })
        fixImageSrc(view, vault, notePath, onExternalMediaSync)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          fixImageSrc(update.view, vault, notePath, onExternalMediaSync)
        }
      }
      destroy() {
        this.observer.disconnect()
      }
    },
  )
}

type Props = {
  /** 当前笔记的库内相对路径；null = 未打开 */
  path: string | null
  /** 库根**绝对路径**（把笔记里的相对图片路径转成 asset URL 用） */
  vault?: string | null
  /** 打开时载入的初始内容 */
  value: string
  onChange: (next: string) => void
  onSave: () => void
  /** 把底层 EditorView 交给宿主，供 doc 原语使用（读选区 / 替换 / 插入）；销毁时回调 null */
  onReady?: (view: EditorView | null) => void
  /** 顶部替换栏是否展开（由宿主的 Ctrl+H 命令控制） */
  replaceOpen?: boolean
  onCloseReplace?: () => void
  /**
   * 查找面板里点了「替换」→ 请宿主打开替换栏（rev173.71）。
   *
   * 为什么不让编辑器自己开：替换栏的开关是**宿主的状态**（`replaceOpen`，App 里由
   * `core.replace` 命令控制）—— 编辑器只把「用户想替换、关键词是这个」交回去。
   */
  onRequestReplace?: () => void
  /**
   * 插件登记的编辑器标记被点击时，把命令 id 交回宿主执行。
   * 编辑器本身**不认识任何插件** —— 它只知道"这段文本要执行这个命令"。
   */
  onCommand?: (id: string, payload?: Record<string, unknown>) => void
  /**
   * `[[笔记名]]` 被点击时把目标交回宿主打开（P2-2 · 2026-10-18）。
   *
   * 背景：atomic 的 inline-preview 把 `[[x]]` 渲染成**普通链接**（黄底 + 图标），
   * 点击只走 `onLinkClick(url)` —— 而那条路只认 http/https，`[[x]]` 于是没有任何出口。
   * 编辑器负责把"点了哪个 wiki 链接"告诉宿主，**找哪篇笔记、找不到怎么办由宿主决定**。
   */
  onWikiLinkOpen?: (target: string) => void
  /**
   * `[[x]]` 的**悬浮预览**（rev173.228 · 需求 §4.5「引用显示标题和摘要」）。
   *
   * 传了就启用：桌面 hover 350 ms、手机长按 450 ms 弹浮层。
   * 返回 `null` = 没找到这篇笔记（浮层显示「未找到」）；不传则完全不监听。
   * 查找与读正文由宿主负责（编辑器不认识 `notes` / `fs`）。
   */
  onWikiPreview?: (target: string) => Promise<{ title: string; snippet: string } | null>
  /**
   * 点正文里的**库内相对链接**（附件，rev173.3）→ 交给宿主按类型分流：
   * 图片预览 / 文档阅读器 / 提示路径。`http(s):` 这类外部链接仍走 `open_external`。
   *
   * 为什么要这个口：atomic 的 `onLinkClick` 只认 http/https，本地附件链接
   * （`[报告](报告.pdf)`）以前点了完全没反应。
   */
  onLocalLinkOpen?: (relPath: string) => void
  /**
   * 正文里**音视频播放失败**时给出的同步出口（rev173.239 · 附件同步期 4 的正文入口 1）。
   *
   * 只在源是**库外绝对路径**时才挂按钮（那种路径只可能来自「引用原文件」）：
   * 播放失败 ⇒ 原文件多半在另一台机器上。查台账 / 确认 / 接收 / 改写引用全在宿主，
   * 编辑器只把「哪个源失败了」交回去（与 `onLocalLinkOpen` 同一套边界）。
   */
  onExternalMediaSync?: (raw: string) => void
  /**
   * 用户可见的提示出口（rev173.41）。之前"打开外部链接失败"只打 `console.warn`——
   * 手机上 `open_external` 本来就不支持（原生层直接拒绝），点链接等于**零反馈**。
   * 宿主传 `setToast` 进来；不传则仍退回 console（浏览器预览 / 单测）。
   */
  onNotify?: (msg: string) => void
  /**
   * 粘贴图片（rev173.46 · 用户要求「截图后 Ctrl+V 直接进正文」）。
   *
   * 剪贴板里的图片只有内存字节、没有磁盘路径，所以编辑器**不自己落盘**：
   * 它只负责读出字节、推断扩展名，交给宿主（App）调 `import_attachment_b64`
   * 写进笔记所在目录并插入 `![](...)`。
   *
   * 不传则**不接管粘贴**（放行浏览器默认行为），避免把事件吞掉。
   */
  onPasteImage?: (img: { base64: string; ext: string }) => void | Promise<void>
  /**
   * 内嵌 HTML 是否渲染（rev173.39 · 设置页开关；默认开）。
   * 关闭时 HTML 语法原样显示（源码），打开时按白名单渲染（属性剔除）。
   */
  renderHtml?: boolean
  /**
   * Android 返回键的「层出口」栈（App 的 `layerExitsRef`）。
   * 图片预览打开时压一层：返回键先关预览，而不是往下走把笔记关掉。
   */
  layers?: RefObject<Array<() => boolean>>
}

/**
 * 组件级样式：把 atomic-editor 的 `--atomic-editor-*` 主题变量桥接到本项目的
 * `--zn-*` token 上。**只作用于编辑器子树，不动全局 styles.css。**
 *
 * 用 `!important` 的原因：atomic 自带一条 `[data-theme="light"] .atomic-cm-editor`
 * （特异性 0,2,0），与本选择器完全相同；同特异性下靠源顺序（Vite 注入的 CSS
 * 在 head，本 style 在 body）胜出虽可行，但一旦打包顺序变化就会静默失效 ——
 * 显式压过更可解释。
 *
 * 刻意**保留**的：`--atomic-editor-body-size`（阅读型正文 1.0625rem）与
 * `--atomic-editor-measure`（70ch 行宽上限）。
 * **唯一改动的排版**：正文由「居中窄栏」改为**左对齐**（见下）—— 否则侧栏一开一关、
 * 容器宽度变了，正文边界却看着不动（实测左 238 / 右 83，明显不对称）。
 */
const EDITOR_CSS = `
.zn-editor .atomic-cm-editor {
  --atomic-editor-font: var(--zn-font) !important;
  --atomic-editor-font-mono: var(--zn-font-mono) !important;
  --atomic-editor-fg: var(--zn-fg) !important;
  --atomic-editor-fg-muted: var(--zn-fg-muted) !important;
  --atomic-editor-fg-faint: var(--zn-fg-subtle) !important;
  --atomic-editor-border: var(--zn-border) !important;
  --atomic-editor-accent: var(--zn-accent) !important;
  --atomic-editor-link: var(--zn-accent) !important;
  /* 编辑器内搜索命中的高亮：atomic 默认是紫，跟着换成独立的高亮色 */
  --atomic-editor-search-bg: var(--zn-highlight) !important;
  --atomic-editor-search-bg-active: #f59e0b !important;
}
.zn-editor .cm-editor.cm-focused { outline: none !important; }
/* 正文占满可用宽度，四周留出边距 —— **不设固定列宽**。
   窗口大小、侧栏开合怎么变，正文跟着变，永远只留四周这点边距。
   （固定列宽/居中窄栏是 Obsidian·Typora 那类"阅读模式"的做法，
     用户明确要"动态变化、四周留边界"，所以这里不做限宽。） */
.zn-editor .atomic-cm-editor .cm-scroller {
  padding: var(--zn-editor-pad-y, 28px) var(--zn-editor-pad-x, 48px) 60px !important;
}
/* 原生滚动条在 rev173.34 已整体隐藏，改用 GlobalScrollbars 全局自绘（见 App.tsx 与 styles.css）。 */
.zn-editor .atomic-cm-editor .cm-content {
  max-width: none !important;
  margin-inline: 0 !important;
}
/* 正文图片的预览尺寸（rev173.1 用户反馈「显示得太大了」→「再小一点，长宽都减半」）。
   atomic 只给 max-width:100%，竖长截图会按原比例铺满整屏 ⇒ 限制**最大高度**，
   宽度按比例收缩；看原图点一下图片（下方的 .zn-img-preview 遮罩）。
   尺寸口径：桌面 280px / 手机 23vh（上一版 560px / 46vh 的一半）。 */
.zn-editor .cm-atomic-image img {
  max-height: min(29vh, 280px);
  width: auto;
  cursor: zoom-in;
}
@media (max-width: 640px) {
  .zn-editor .cm-atomic-image img {
    max-height: 23vh;
  }
}
/* 音视频内联播放（rev173.226）：正文 ![](clip.mp4) 的 image 块被换成播放器
   （见 upgradeMediaWidgets）。失败提示用 danger 色。

   **版式与正文图片统一（rev173.236 · 用户「把视频、音频块的宽度和圆角统一成图片的样式」）**：
   图片的规格 = atomic 的 max-width:100% / height:auto / border-radius:0.4em
   ＋ 上面那条 max-height: min(29vh, 280px)（手机 23vh）。
   播放器此前各写各的 —— 视频 60vh / 420px + var(--zn-radius) + 黑底、音频 420px 且**没有圆角**
   ⇒ 在正文里比图片明显大一圈、边角也不一样。现在同一套：同圆角（0.4em）、同最大高度；
   音频保留 420px 上限（它没有宽高比，不能靠限高压宽），补上圆角。 */
.zn-editor .cm-atomic-image.zn-media-wrap {
  cursor: default;
}
.zn-editor .cm-atomic-image video {
  display: block;
  max-width: 100%;
  max-height: min(29vh, 280px);
  border-radius: 0.4em;
  background: #000;
}
.zn-editor .cm-atomic-image audio {
  display: block;
  width: min(100%, 420px);
  border-radius: 0.4em;
}
.zn-editor .cm-atomic-image .zn-media-error {
  margin-top: 6px;
  font-size: var(--zn-text-sm);
  color: var(--zn-danger);
}
/* 播放失败时给「原文件不在本机 · 同步」按钮（rev173.239 · 期 4 正文入口 1）。
   只在源是库外绝对路径时才出现（见 upgradeMediaWidgets）—— 同一行里跟在提示文字后面。 */
.zn-editor .cm-atomic-image .zn-media-sync {
  display: block;
  margin-top: 6px;
  padding: 2px 8px;
  font-size: var(--zn-text-sm);
  border: 1px solid var(--zn-border-strong);
  border-radius: var(--zn-radius);
  background: transparent;
  color: var(--zn-fg);
  cursor: pointer;
}
.zn-editor .cm-atomic-image .zn-media-sync:hover {
  background: var(--zn-bg-hover);
}
@media (max-width: 640px) {
  .zn-editor .cm-atomic-image video {
    max-height: 23vh;
  }
}
/* [[x]] 悬浮预览（rev173.228）：固定定位的小卡片，贴在链接下方 */
.zn-wiki-tip {
  position: fixed;
  z-index: 120;
  width: min(340px, calc(100vw - 24px));
  padding: 10px 12px;
  border-radius: var(--zn-radius-lg);
  border: 1px solid var(--zn-border-strong);
  background: var(--zn-bg);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  animation: zn-wiki-in 120ms ease-out;
}
@keyframes zn-wiki-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: none; }
}
.zn-wiki-tip-title {
  margin-bottom: 4px;
  font-size: var(--zn-text-sm);
  font-weight: 600;
  color: var(--zn-fg);
}
.zn-wiki-tip-body {
  font-size: var(--zn-text-sm);
  line-height: 1.5;
  color: var(--zn-fg-muted);
}
/* 查找面板：从「编辑器顶部通栏」改成**悬挂窗**（rev173.43 · 用户要求「像命令输入框这样的悬挂窗口」）。
 *
 * CM6 把面板渲染在 .cm-panels.cm-panels-top（sticky、占文档流、横跨全宽），
 * atomic 又在里面塞了 input + 计数 + 上/下/关闭。这里只动 CSS：
 *   · 容器 → fixed 全屏遮罩层（与 .zn-palette-mask 同参数：rgba(0,0,0,.35) + 12vh）
 *   · 面板 → 居中卡片（与 .zn-palette 同参数：560px / --zn-radius-lg / 同阴影）
 *   · 输入框 → 去掉原子边框、占满左侧；按钮改无边框图标
 * 点遮罩关闭在组件里做（.zn-editor 的 onPointerDown，见下）。 */
.zn-editor .cm-panels.cm-panels-top {
  position: fixed !important;
  inset: 0 !important;
  z-index: 100 !important;
  display: flex !important;
  align-items: flex-start !important;
  justify-content: center !important;
  padding-top: 12vh !important;
  background: rgba(0, 0, 0, 0.35) !important;
  border: 0 !important;
}
.zn-editor .cm-panels.cm-panels-top .cm-panel.cm-search {
  width: min(560px, 92vw) !important;
  padding: 0 !important;
  background: var(--zn-bg) !important;
  border: 1px solid var(--zn-border-strong) !important;
  border-radius: var(--zn-radius-lg) !important;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25) !important;
  overflow: hidden !important;
}
.zn-editor .cm-search form { display: flex !important; align-items: center !important; gap: 2px !important; }
.zn-editor .cm-search .cm-atomic-search-input {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  border: 0 !important;
  background: transparent !important;
  padding: 12px 16px !important;
  font: inherit !important;
  font-size: 14px !important;
  color: var(--zn-fg) !important;
  outline: none !important;
}
.zn-editor .cm-search .cm-atomic-search-input::placeholder { color: var(--zn-fg-subtle) !important; }
/* atomic 的 input focus 用 box-shadow 描边（绿色），在卡片里像一道外框 —— 去掉，只保留光标 */
.zn-editor .cm-search .cm-atomic-search-input:focus { box-shadow: none !important; }
.zn-editor .cm-search .cm-atomic-search-count {
  font-size: var(--zn-text-sm) !important;
  color: var(--zn-fg-subtle) !important;
  white-space: nowrap !important;
}
.zn-editor .cm-search .cm-atomic-search-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  border: 0 !important;
  background: transparent !important;
  color: var(--zn-fg-muted) !important;
  border-radius: var(--zn-radius-sm) !important;
  padding: 6px !important;
  cursor: pointer !important;
}
.zn-editor .cm-search .cm-atomic-search-btn:hover {
  background: var(--zn-bg-subtle) !important;
  color: var(--zn-fg) !important;
}
.zn-editor .cm-search .cm-atomic-search-btn svg { width: 16px !important; height: 16px !important; }

/* 自带替换栏 —— atomic 的查找面板没有替换行（见下方 extensions 的说明）。
   它渲染在 .zn-editor 之外、.zn-editor-wrap（flex column）之内，
   所以跟编辑器是「栏 + 占满剩余高度」的正常关系。 */
.zn-replace-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 6px 8px;
  border-bottom: 1px solid var(--zn-border);
  background: var(--zn-bg-subtle);
}
.zn-replace-input {
  width: 12rem;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--zn-border-strong);
  border-radius: var(--zn-radius-sm);
  background: var(--zn-bg);
  color: var(--zn-fg);
  font-size: 12px;
}
.zn-replace-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--zn-border-strong);
  border-radius: var(--zn-radius-sm);
  background: var(--zn-bg);
  color: var(--zn-fg);
  font-size: 12px;
  cursor: pointer;
}
.zn-replace-btn:hover { background: var(--zn-bg-hover); }
.zn-replace-btn.is-icon { padding: 0 7px; color: var(--zn-fg-muted); }
.zn-replace-msg { margin-left: auto; font-size: 12px; color: var(--zn-fg-muted); }
`

/**
 * 行内即时渲染编辑器（Obsidian 风格 Live Preview）。
 *
 * 由 `@atomic-editor/editor` 承担渲染：光标所在行显示 markdown 源码，其余行
 * 渲染成标题 / 粗体 / 表格 / 列表 / 图片 / 代码块等。markdown 纯文本始终是
 * 唯一真相（装饰只作用于视图），所以读写仍然保真。
 *
 * 两个必须自己接的缝：
 * 1. **裸 EditorView**：atomic 的 React 组件不导出 view —— `editorHandleRef` 只
 *    给 focus / undo / getMarkdown / getContentDOM / setReadOnly 这类动作，没有
 *    读选区、dispatch 的通道。宿主 `docApi` 要的就是裸 view，所以这里用它的
 *    官方扩展点 `extensions` 注入一个 `ViewPlugin`：CM6 保证 ViewPlugin 的构造
 *    函数在 `new EditorView()` 时**同步**收到 view，拿它转交 onReady 即可。
 * 2. **外部 value 同步**：atomic 的 `markdownSource` 只在 mount 时读一次（后续以
 *    编辑器自身为真相），所以要自己 compare + dispatch 替换。
 *
 * 文档身份用 `documentId={path}`：切换笔记时 atomic 重建 view（丢弃上一篇的
 * undo 历史与选区），其余时候不重建 —— 若不给 documentId，它会把
 * `markdownSource` 当身份，等于每次输入都重建编辑器。
 */
/**
 * 点击在表格 widget 上时返回表格信息（工具条要用）；否则 null。
 *
 * 为什么用**点击目标**而不是选区：atomic 的表格是 widget（整表替换），
 * 点进单元格走的是 contenteditable，**CM6 的选区并不落在表格里** ——
 * 用 `selection.head` 判断永远为 false（实测工具条不出现）。
 */
function computeTableInfoFromEvent(view: EditorView, target: HTMLElement): TableInfo | null {
  const widget = target.closest('.cm-atomic-table') as HTMLElement | null
  if (!widget) return null
  const from = view.posAtDOM(widget)
  const tree = syntaxTree(view.state)
  let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(from, 1)
  while (node && node.name !== 'Table') node = node.parent
  if (!node) return null
  const host = view.dom.getBoundingClientRect()
  const rect = widget.getBoundingClientRect()
  const cell = target.closest('th, td') as HTMLElement | null
  const tr = cell?.parentElement as HTMLElement | null
  const head = tr?.parentElement?.tagName === 'THEAD'
  const rowIdx = tr ? [...(tr.parentElement as HTMLElement).children].indexOf(tr) : 0
  const col = cell && tr ? [...tr.children].indexOf(cell) : 0
  return {
    from: node.from,
    to: node.to,
    row: head ? 0 : rowIdx + 1,
    col,
    x: rect.left - host.left,
    y: rect.top - host.top - 30,
  }
}

export function MarkdownEditor({
  path,
  vault,
  value,
  onChange,
  onSave,
  onReady,
  replaceOpen = false,
  onCloseReplace,
  onRequestReplace,
  onCommand,
  onWikiLinkOpen,
  onWikiPreview,
  onLocalLinkOpen,
  onExternalMediaSync,
  onNotify,
  onPasteImage,
  layers,
  renderHtml = true,
}: Props) {
  const viewRef = useRef<EditorView | null>(null)
  /** 编辑器 DOM 根：观察 CM6 查找面板出现，往里补「替换」入口（rev173.71） */
  const editorRootRef = useRef<HTMLDivElement>(null)
  /**
   * 源码模式开关（2026-10-17 用户：「增加切换源码模式」）。
   * 持久化在 localStorage —— 关掉应用再开，仍停在用户上次选的模式。
   */
  const [sourceMode, setSourceMode] = useState(() => {
    try {
      return localStorage.getItem('zeronote.sourceMode') === '1'
    } catch {
      return false
    }
  })
  /** 表格工具条：当前编辑器 view + 光标所在表格的信息 */
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null)
  /** 正文图片的全屏预览地址（null = 没开）。rev173.1：正文里只显示缩略尺寸，点开看原图 */
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  /**
   * `[[笔记名]]` 悬浮预览的浮层状态（rev173.228 · 需求 §4.5）。
   *
   * `x/y` 是**视口坐标**（浮层 `position: fixed`）：贴在链接下方 6 px。
   * `loading` 期间先出壳（「读取中…」）—— 读正文是异步的，不先出壳会感觉"hover 没反应"。
   */
  const [wikiTip, setWikiTip] = useState<{
    x: number
    y: number
    target: string
    title: string
    snippet: string
    missing: boolean
  } | null>(null)
  /**
   * 长按弹了预览之后，**吞掉紧随其后的那一次 click**（rev173.228）。
   * 否则手机上「长按看预览」松手会直接跳走 —— 预览变成了跳转。
   */
  const suppressWikiClickRef = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem('zeronote.sourceMode', sourceMode ? '1' : '0')
    } catch {
      /* 隐私模式等拿不到 storage —— 忽略 */
    }
  }, [sourceMode])
  const handleRef = useRef<AtomicCodeMirrorEditorHandle | null>(null)
  /** 当前笔记路径的镜像 —— ViewPlugin 的 destroy 回调里读不到 props */
  const pathRef = useRef<string | null>(path)
  /**
   * 每篇笔记的 EditorState 缓存。
   *
   * CM6 里**撤销历史与选区都属于 EditorState**，而 `documentId={path}` 会让
   * atomic 在切换笔记时重建 view —— 不缓存就等于「切走再回来，Ctrl+Z 全没了」。
   * 上限 20 篇（LRU），避免开过很多笔记后内存无限上涨。
   */
  const stateCacheRef = useRef(new Map<string, EditorState>())
  /**
   * 每篇笔记的**滚动位置**。
   *
   * CM6 的 EditorState 含选区与历史，但**不含滚动**（滚动属于 DOM/view）。
   * 用户切走再切回时，光标位置恢复了、视野却跳回顶部，观感同样很糟。
   */
  const scrollCacheRef = useRef(new Map<string, number>())
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onReadyRef = useRef(onReady)

  // 最新回调同步进 ref（编辑器实例不能每次渲染重建）
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onReadyRef.current = onReady
  }, [onChange, onSave, onReady])

  /**
   * `[[笔记名]]` 点击跳转（P2-2 · 2026-10-18）。
   *
   * 为什么不用 CM6 的 `domEventHandlers`：atomic 的 inline-preview 在链接元素上
   * 自己处理点击（`onLinkClick` 只认 http/https）并把事件拦下，CM6 挂在 contentDOM
   * 上的冒泡监听收不到 —— 实测点了完全没反应。改用 document **捕获阶段**：
   * 事件先到这里，确认是编辑器里的 `[[…]]` 再决定拦不拦。
   *
   * 目标名直接取链接的可见文本（atomic 渲染出的就是 `[[…]]` 里的目标；
   * `[[目标|显示名]]` 时拿到的是显示名，属已知取舍，由宿主的匹配兜底）。
   */
  /**
   * 从点到的 `.cm-atomic-link` 反查 `[[…]]` 的目标名（点击 / hover / 长按**共用一份**）。
   *
   * 判据见 `wikiLinkTarget`：看**源码行**而不是可见文本 —— 可见文本的形态随光标位置变
   * （活跃行里方括号是 widget，`textContent` 只剩目标名；普通行里方括号是隐藏 span），
   * rev173.97 用可见文本判定时一半点击被丢弃。
   */
  const resolveWikiTarget = useCallback((el: HTMLElement): string | null => {
    const view = viewRef.current ?? EditorView.findFromDOM(el)
    if (!view) return null
    try {
      const from = view.posAtDOM(el, 0)
      return wikiLinkTarget(view.state.doc.lineAt(from).text, el.textContent ?? '')
    } catch {
      // 位置拿不到（widget / 未渲染）：不是 wikilink，交给别的分支
      return null
    }
  }, [])

  useEffect(() => {
    if (!onWikiLinkOpen) return
    const onClick = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest?.<HTMLElement>('.cm-atomic-link')
      if (!el) return
      const content = handleRef.current?.getContentDOM()
      if (!content || !content.contains(el)) return
      const target = resolveWikiTarget(el)
      if (!target) return
      ev.preventDefault()
      ev.stopPropagation()
      /**
       * 刚刚用长按看过这篇的预览 ⇒ 这次松手是「关预览」，不是「打开笔记」（rev173.228）。
       * 标记在 click 里消费掉；`onUp` 另有一个 500 ms 兜底复位（有的浏览器不派发那次 click）。
       */
      if (suppressWikiClickRef.current) {
        suppressWikiClickRef.current = false
        return
      }
      onWikiLinkOpen(target)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [onWikiLinkOpen, resolveWikiTarget])

  /**
   * `[[笔记名]]` **悬浮预览**（rev173.228 · 需求 §4.5「引用显示标题和摘要」）。
   *
   * · 桌面：`mouseover` 停 350 ms 弹；离开链接或浮层 160 ms 后收（留时间让鼠标移到浮层上）
   * · 手机：长按 450 ms 弹（移动 >10 px 取消 —— 那是滚动/拖选，不是长按）
   * · 只认**编辑器正文里**的链接（侧栏 / 面板里的 `.cm-atomic-link` 不受影响）
   *
   * 关闭：鼠标离开 / 滚动 / Esc / 点别处。查找与读正文在宿主（`onWikiPreview`），
   * 编辑器只负责「什么时候、在哪儿显示」。
   */
  useEffect(() => {
    if (!onWikiPreview) return
    const content = () => handleRef.current?.getContentDOM() ?? null
    const linkAt = (t: EventTarget | null): HTMLElement | null => {
      const el = (t as HTMLElement | null)?.closest?.<HTMLElement>('.cm-atomic-link') ?? null
      if (!el) return null
      const c = content()
      return c && c.contains(el) ? el : null
    }

    let openTimer: number | null = null
    let closeTimer: number | null = null
    let pressTimer: number | null = null
    let press: { x: number; y: number; el: HTMLElement } | null = null

    const clearOpen = () => {
      if (openTimer !== null) window.clearTimeout(openTimer)
      openTimer = null
    }
    const clearClose = () => {
      if (closeTimer !== null) window.clearTimeout(closeTimer)
      closeTimer = null
    }
    const clearPress = () => {
      if (pressTimer !== null) window.clearTimeout(pressTimer)
      pressTimer = null
      press = null
    }
    const close = () => setWikiTip(null)
    const scheduleClose = () => {
      clearClose()
      closeTimer = window.setTimeout(close, 160)
    }

    /** 弹浮层：先出壳（标题=目标名、正文空），读到摘要再补 —— 否则异步读盘期间像"没反应" */
    const show = (el: HTMLElement) => {
      const target = resolveWikiTarget(el)
      if (!target) return
      const rect = el.getBoundingClientRect()
      // 视口坐标：贴链接下方 6 px；右侧放不下就左移（简单 clamp）
      const x = Math.min(rect.left, Math.max(8, window.innerWidth - 348))
      const y = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 140))
      setWikiTip({ x, y, target, title: target, snippet: '', missing: false })
      void onWikiPreview(target)
        .then((info) => {
          setWikiTip((cur) =>
            cur && cur.target === target
              ? {
                  ...cur,
                  title: info?.title || target,
                  snippet: info?.snippet ?? '',
                  missing: !info,
                }
              : cur,
          )
        })
        .catch(() => {
          setWikiTip((cur) => (cur && cur.target === target ? { ...cur, missing: true } : cur))
        })
    }

    const onOver = (ev: MouseEvent) => {
      const el = linkAt(ev.target)
      if (!el) return
      clearClose()
      if (openTimer !== null) return
      openTimer = window.setTimeout(() => {
        openTimer = null
        show(el)
      }, 350)
    }

    const onOut = (ev: MouseEvent) => {
      const el = linkAt(ev.target)
      if (!el) return
      const to = ev.relatedTarget as HTMLElement | null
      if (to?.closest?.('.zn-wiki-tip')) return // 移到浮层上：先别收
      clearOpen()
      scheduleClose()
    }

    const onDown = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse') {
        // 鼠标点别处：关掉（点在链接上不算 —— 那是要跳转）
        if (!linkAt(ev.target)) close()
        return
      }
      const el = linkAt(ev.target)
      if (!el) {
        close()
        return
      }
      clearPress()
      press = { x: ev.clientX, y: ev.clientY, el }
      pressTimer = window.setTimeout(() => {
        pressTimer = null
        if (!press) return
        suppressWikiClickRef.current = true
        show(press.el)
        press = null
      }, 450)
    }

    const onMove = (ev: PointerEvent) => {
      if (!press) return
      if (Math.abs(ev.clientX - press.x) > 10 || Math.abs(ev.clientY - press.y) > 10) clearPress()
    }
    /**
     * 松手：清掉长按计时器；**已经弹过预览**的话，抑制标记等这一次 click 消费。
     *
     * ⚠️ 复位必须挂在 pointerup 之后（300 ms 窗口）而不是长按触发时 —— 从触发时算，
     * 用户按住超过 950 ms 再松手，标记已过期 ⇒ 松手直接跳走（rev173.228 真机实测踩到）。
     */
    const onUp = () => {
      clearPress()
      if (suppressWikiClickRef.current) {
        window.setTimeout(() => {
          suppressWikiClickRef.current = false
        }, 300)
      }
    }
    const onScroll = () => {
      clearOpen()
      clearPress()
      close()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close()
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKey)
    return () => {
      clearOpen()
      clearClose()
      clearPress()
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onWikiPreview, resolveWikiTarget])

  /**
   * 非 wikilink 的 `.cm-atomic-link` 去掉链接外观（rev173.97 · 用户「取消这个标签形式，
   * wikilink 就是 wikilink」）。
   *
   * frontmatter 的 `tags: [工作, 周报]` 被 markdown 解析成 Link 节点 ⇒ atomic 给
   * `.cm-atomic-link`（绿色 + 外链图标），但它既不是 `[[…]]` 也不是 `[文字](url)`。
   * 判据抽在 `lib/atomic-link.ts`（纯函数，可单测）；这里只加/去 `zn-plain-link`，
   * 样式覆盖在 `styles.css`。
   *
   * 为什么用 MutationObserver：编辑器每次重绘（输入 / 换行 / 滚动）都会重建这些 span，
   * 一次性标记会被冲掉 —— 与图片 asset 修复（`imageAssetPlugin`）同一个套路。
   */
  useEffect(() => {
    let disposed = false
    let mo: MutationObserver | null = null
    let raf = 0
    let tries = 0

    const mark = (root: HTMLElement) => {
      // 首选**整行源码**判据（活跃行会藏方括号，可见文本不可靠）
      const view = viewRef.current ?? EditorView.findFromDOM(root)
      for (const el of root.querySelectorAll<HTMLElement>('.cm-atomic-link')) {
        const text = el.textContent ?? ''
        let plain = false
        let decided = false
        if (view) {
          try {
            const from = view.posAtDOM(el, 0)
            /**
             * ⚠️ `posAtDOM` 只覆盖**文本**：方括号在 atomic 里可能是独立 widget
             * （实测 rev173.97：frontmatter 的 `[工作, 周报]` 取到的源码只是 `工作, 周报`）。
             * 所以拿整行反查形态：行里有 `[[文本]]` ⇒ wikilink；否则有 `[文本]` ⇒ 普通方括号。
             * 顺序不能反 —— `[[X]]` 里也含 `[X]`。
             */
            const line = view.state.doc.lineAt(from).text
            const src = line.includes(`[[${text}]]`)
              ? `[[${text}]]`
              : line.includes(`[${text}]`)
                ? `[${text}]`
                : ''
            if (src) {
              plain = isPlainBracketSource(src)
              decided = true
            }
          } catch {
            /* 位置拿不到（widget / 未渲染）：退回可见文本判据 */
          }
        }
        if (!decided) plain = isPlainBracketLink(text)
        el.classList.toggle('zn-plain-link', plain)
      }
    }

    const attach = () => {
      if (disposed) return
      const content = handleRef.current?.getContentDOM()
      if (!content) {
        // atomic 的 handle 要等它 ready（通常一两帧）；30 帧还拿不到就算了（不阻塞编辑）
        if (tries++ < 30) raf = window.requestAnimationFrame(attach)
        return
      }
      mark(content)
      mo = new MutationObserver(() => mark(content))
      mo.observe(content, { childList: true, subtree: true, characterData: true })
    }

    attach()
    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      mo?.disconnect()
    }
  }, [path])

  /**
   * 点正文图片 → 全屏预览（rev173.1 · 用户反馈「显示得太大了」）。
   *
   * atomic 的图片 widget 在 `mousedown` 里 preventDefault 并把光标挪到源码行
   * （`image-blocks.js` 的 onPointer），冒泡阶段拿不到干净的 click ⇒ 走 document
   * 捕获阶段（与上面 `[[…]]` 同一套路）。
   *
   * 预览用的是 `img.src` —— `fixImageSrc` 已把它换成 asset URL（原图分辨率），
   * CSS 只是把正文里的显示尺寸压小。
   */
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const img = (ev.target as HTMLElement | null)?.closest?.(
        '.cm-atomic-image img',
      ) as HTMLImageElement | null
      if (!img) return
      const content = handleRef.current?.getContentDOM()
      if (!content || !content.contains(img)) return
      ev.preventDefault()
      ev.stopPropagation()
      /**
       * 库内相对路径的图 ⇒ 交给宿主的预览（rev173.239）：
       * 宿主那边会查引用台账，模式 B 的图能就地给「同步原图」——编辑器自己不认识台账。
       * 宿主没传口 / 库外绝对路径 ⇒ 仍用本组件自己的预览（行为与 rev173.1 一致）。
       */
      const raw = img.dataset.znRaw
      if (onLocalLinkOpen && raw) {
        const abs = resolveImageAbsPath(vault, path, raw)
        const root = (vault ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
        if (abs && root && abs.startsWith(`${root}/`)) {
          onLocalLinkOpen(abs.slice(root.length + 1))
          return
        }
      }
      setPreviewSrc(img.src)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [onLocalLinkOpen, vault, path])

  // Esc 关闭图片预览
  useEffect(() => {
    if (!previewSrc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewSrc(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewSrc])

  /**
   * 预览压进 Android 返回键层栈（rev173.2 · 用户报「预览时返回先退预览，现在直接关了笔记」）。
   *
   * 返回键链在 App 的 `backRef`：先弹 `layerExitsRef` 栈顶；没有这一层就会被当成
   * "没有浮层"继续往下走，最后 `closeNote()` —— 预览明明还开着，笔记先没了。
   * 弹出一个返回 true 的关闭函数即可拦在笔记之前。
   */
  useEffect(() => {
    if (!previewSrc || !layers) return
    const stack = layers.current
    const close = () => {
      setPreviewSrc(null)
      return true
    }
    stack.push(close)
    return () => {
      const i = stack.indexOf(close)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [previewSrc, layers])

  // 下面三个都是稳定引用（useCallback([])），所以扩展数组可以在首帧安全地
  // 捕获它们。全部放在 useCallback 里，也顺带满足 oxlint 的 react(refs)：
  // render 期一律不出现 `*.current`，ref 只在事件/生命周期回调里读写。
  const adoptView = useCallback((view: EditorView) => {
    viewRef.current = view
    // 表格工具条要拿 view 做操作（对齐/插行）—— 用 state 存一份，避免 render 期读 ref
    setEditorView(view)
    // 滚动位置必须**实时**记，不能在销毁时读 —— ViewPlugin 的 destroy 回调里
    // view.scrollDOM 往往已被重置为 0，那样存下来的永远是"顶部"
    // （实测：切走再切回，视野跳回第一行）。
    // 用 addEventListener 而不是 onsroll 属性：CM6 内部也会碰这个容器，
    // 属性赋值可能被它覆盖掉。view 销毁时 DOM 一并消失，无需手动清理。
    view.scrollDOM.addEventListener(
      'scroll',
      () => {
        const p = pathRef.current
        if (p) scrollCacheRef.current.set(p, view.scrollDOM.scrollTop)
      },
      { passive: true },
    )
    onReadyRef.current?.(view)
  }, [])

  const releaseView = useCallback((view: EditorView) => {
    // destroy 时 state 仍可读：先把这篇笔记的历史留在缓存里，再放掉 view
    const p = pathRef.current
    if (p) {
      const cache = stateCacheRef.current
      cache.delete(p) // 先删再插，维持 LRU 顺序
      cache.set(p, view.state)
      while (cache.size > MAX_CACHED_STATES) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
        scrollCacheRef.current.delete(oldest) // 滚动位置与 state 同寿命
      }
    }
    if (viewRef.current === view) viewRef.current = null
    setEditorView(null)
    setTableInfo(null)
    onReadyRef.current?.(null)
  }, [])

  const handleSaveKey = useCallback(() => {
    onSaveRef.current()
    return true
  }, [])

  // Ctrl/Cmd+S → onSave。
  // 不用 CM6 的 keymap：一是不必把持 ref 的回调塞进 render 期构造的扩展里，
  // 二是挂在 window 上比 CM6 keymap 覆盖面更广 —— 焦点在搜索面板 / 侧边栏时
  // 也能保存（App 的全局快捷键只管 Ctrl+P 与 Escape，不会与之重叠）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key.toLowerCase() !== 's') return
      e.preventDefault()
      handleSaveKey()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSaveKey])

  const handleMarkdownChange = useCallback((next: string) => {
    onChangeRef.current(next)
  }, [])

  // extensions 在**每次 render 现场构造**即可：atomic 只在 mount（以及
  // documentId 变化）时捕获这个数组，之后换引用不会作用到已挂载的 view
  // （它的 mount effect 只依赖 documentId）。因此不需要 useRef/useState 缓存 ——
  // 也顺带避免了在 render 期读 `*.current`（oxlint 的 react(refs) 会报）。
  const extensions: Extension[] = [
    // 粘贴图片（rev173.46 · 用户「截图后 Ctrl+V 直接进正文」）。
    //
    // 两条硬规矩：
    //  1. **只有剪贴板确实带图片时才接管**（`pickPastedImage` 返回 null 就 `return false`）。
    //     否则会把从网页 / Excel 复制的文字也吞掉 —— 那是最常见的粘贴场景。
    //  2. 先 `preventDefault` 再异步读字节：WebView 里 `File` 只在事件回调期间有效，
    //     晚一步读就是空。
    // `Prec.high`：万一 atomic 将来自己加 paste 处理器，这一层也要先跑。
    //
    // 回调**直接闭包捕获 prop**（与上面的 `onCommand` 同款）：atomic 在 mount /
    // 切笔记时重建 view 并重新捕获 extensions，那时拿到的就是当次渲染的回调；
    // 走 ref 反而会在 render 期读 `*.current`（oxlint 的 react(refs) 会报）。
    Prec.high(
      EditorView.domEventHandlers({
        paste: (e) => {
          const file = pickPastedImage(e.clipboardData?.files)
          if (!file || !onPasteImage) return false
          e.preventDefault()
          if (file.size > MAX_PASTE_IMAGE_BYTES) {
            const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
            onNotify?.(`图片太大（${mb(file.size)} MB），上限 ${mb(MAX_PASTE_IMAGE_BYTES)} MB`)
            return true
          }
          const ext = pasteImageExt(file)
          void file
            .arrayBuffer()
            .then((buf) => onPasteImage({ base64: bytesToBase64(new Uint8Array(buf)), ext }))
            .catch((err) => onNotify?.(`读取剪贴板图片失败：${String(err)}`))
          return true
        },
      }),
    ),
    // Tab / Shift-Tab：列表行手动缩进（见 `kernel/editor-indent.ts`）。
    // `Prec.high` 保证排在 atomic 自带的 `indentWithTab` 之前。
    Prec.high(
      keymap.of([
        { key: 'Tab', run: (view) => indentLine(view, 1) },
        { key: 'Shift-Tab', run: (view) => indentLine(view, -1) },
      ]),
    ),
    // 嵌套引用：按行首 `>` 的个数加 `zn-quote-dN`（atomic 自己不分层级）。
    quoteDepthPlugin,
    // ⚠️ 查找面板**不是** CM6 原生的 `defaultSearchPanel`（踩坑记录，别再试一遍）：
    // atomic 的源码写的是 `search({ top: true, createPanel: … defaultSearchPanel(…) })`，
    // 但实测面板只有一个查找框 + 上/下/关闭（placeholder 是 "Search" 而非 CM6 的 "Find"），
    // 且 `EditorState.phrases` 覆盖对它**完全无效** —— 说明它实际渲染的是自己那套面板。
    // 由此得出：**Ctrl+F 查找可用；替换不可用**（替换行只在 CM6 原生面板里，且
    // handle 也没暴露 replace API，Ctrl+H 无绑定）。补替换只能自带 UI 或替换 search 扩展。
    ViewPlugin.fromClass(
      class {
        readonly view: EditorView
        constructor(view: EditorView) {
          this.view = view
          adoptView(view)
        }
        destroy() {
          releaseView(this.view)
        }
      },
    ),
    // 插件登记的「编辑器标记规则」（`[[引用]]` / `#标签` / `==高亮==`）在这里翻成
    // CM6 装饰器。**没有任何插件登记时它返回空数组** ⇒ 编辑器与以前完全一样（按需激活）。
    // 直接闭包捕获 onCommand：数组每次 render 现场构造，而 atomic 只在 mount / 切换
    // 笔记时读它，那时捕获到的就是当次渲染的回调，不需要 ref 中转。
    ...editorMarkExtensions((id, payload) => onCommand?.(id, payload)),
    // Markdown 语法增强（rev173.36）：上标 ^x^ / 下标 ~x~ / Emoji :name:
    editorSyntaxExtensions(renderHtml),
    // frontmatter 隐藏（rev173.98 · 用户「frontmatter 隐藏」）—— 见 kernel/editor-frontmatter.ts
    frontmatterHide(),
    // 正文图片：`![](相对路径)` → asset URL（见 imageAssetPlugin 的说明）
    imageAssetPlugin(vault, path, onExternalMediaSync),
  ]

  // 兜底（正常走不到）：万一将来 atomic 的内部实现不再触发我们注入的
  // ViewPlugin，就借它公开的 handle 拿到 contentDOM，再向 CM6 反查 view，
  // 避免 onReady 静默失效后宿主 docApi 全部失灵。
  useEffect(() => {
    if (viewRef.current) return
    const contentDOM = handleRef.current?.getContentDOM()
    const view = contentDOM ? EditorView.findFromDOM(contentDOM) : null
    if (!view) return
    adoptView(view)
  }, [path, adoptView])

  // 切换笔记：atomic 已经重建了 view（新 state、空历史），这里把这篇笔记上次的
  // state 装回去 —— 撤销栈、选区都在里面。
  // 必须排在下面那个「外部内容同步」之前：装回来的可能是旧内容，由后者按 value
  // 纠正（value 才是真相），但**历史得以保留**。
  useEffect(() => {
    pathRef.current = path
    const view = viewRef.current
    if (!view || !path) return
    const cached = stateCacheRef.current.get(path)
    // 无条件装回 —— 即便内容碰巧相同，**历史**也是这份 state 独有的资产。
    // （曾用 `cached.doc !== view.state.doc` 当守卫，结果「清空后切走再切回，
    //   Ctrl+Z 恢复不了」：两边 doc 都是空串，历史被一起丢掉了。）
    if (cached) view.setState(cached)
    // 滚动位置：setState 之后 CM6 还会异步重排，直接赋值容易被随后的测量覆盖，
    // 因此放到下一帧再设。次数不多（仅切回时一次），开销可忽略。
    const top = scrollCacheRef.current.get(path)
    if (top !== undefined && top > 0) {
      window.requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = top
      })
    }
  }, [path])

  // 切换笔记 / 外部内容变化：整篇替换（doc 身份变了则由 atomic 自己重建）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
    })
  }, [path, value])

  /**
   * 替换栏（自带）。
   *
   * 为什么必须自带：atomic 的查找面板**没有替换行** —— 它渲染的是自己那套面板
   * （不是 CM6 原生的 `defaultSearchPanel`），handle 也没暴露 replace API。
   * 这里用最朴素的办法补齐：纯字符串 `indexOf` / `split`，
   * **不引新依赖、不碰 atomic 内部**。
   * 语义与主流一致：「替换」只动光标之后的第一个匹配（到尾部回绕），「全部替换」动全篇。
   */
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [replaceMsg, setReplaceMsg] = useState('')

  /**
   * 查找面板里的「替换」入口（rev173.71）。
   *
   * 面板是 CM6 现插的 DOM（没有 React 回调），所以只能订阅子树变化、出现就补按钮；
   * 点它 = 关掉查找面板 + 把关键词带进替换栏（宿主打开）。
   */
  useEffect(() => {
    const root = editorRootRef.current
    if (!root || !onRequestReplace) return
    const scan = () => {
      const panel = root.querySelector<HTMLElement>('.cm-search.atomic-editor-search-panel')
      if (!panel) return
      ensureReplaceEntry(panel, (keyword) => {
        if (keyword) setFindText(keyword)
        setReplaceMsg('')
        onRequestReplace()
      })
    }
    const mo = new MutationObserver(scan)
    mo.observe(root, { childList: true, subtree: true })
    scan()
    return () => mo.disconnect()
  }, [onRequestReplace])

  const replaceNext = useCallback(() => {
    const view = viewRef.current
    if (!view || !findText) return
    const doc = view.state.doc.toString()
    let at = doc.indexOf(findText, view.state.selection.main.from)
    if (at < 0) at = doc.indexOf(findText) // 到尾部后回绕
    if (at < 0) {
      setReplaceMsg('没有匹配')
      return
    }
    view.dispatch({
      changes: { from: at, to: at + findText.length, insert: replaceText },
      selection: { anchor: at + replaceText.length },
    })
    setReplaceMsg('已替换 1 处')
  }, [findText, replaceText])

  const replaceAll = useCallback(() => {
    const view = viewRef.current
    if (!view || !findText) return
    const doc = view.state.doc.toString()
    const parts = doc.split(findText)
    const count = parts.length - 1
    if (count === 0) {
      setReplaceMsg('没有匹配')
      return
    }
    view.dispatch({ changes: { from: 0, to: doc.length, insert: parts.join(replaceText) } })
    setReplaceMsg(`已替换 ${count} 处`)
  }, [findText, replaceText])

  return (
    <>
      <style>{EDITOR_CSS}</style>

      {replaceOpen && (
        <div className="zn-replace-bar">
          <input
            className="zn-replace-input"
            value={findText}
            placeholder="查找"
            autoFocus
            onChange={(e) => {
              setFindText(e.target.value)
              setReplaceMsg('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCloseReplace?.()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                replaceNext()
              }
            }}
          />
          <input
            className="zn-replace-input"
            value={replaceText}
            placeholder="替换为"
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCloseReplace?.()
              }
            }}
          />
          <button type="button" className="zn-replace-btn" onClick={replaceNext}>
            替换
          </button>
          <button type="button" className="zn-replace-btn" onClick={replaceAll}>
            全部替换
          </button>
          {replaceMsg && <span className="zn-replace-msg">{replaceMsg}</span>}
          <button
            type="button"
            className="zn-replace-btn is-icon"
            onClick={() => onCloseReplace?.()}
            title="关闭替换栏（Esc）"
            aria-label="关闭替换栏"
          >
            ✕
          </button>
        </div>
      )}

      <div
        className="zn-editor"
        ref={editorRootRef}
        onPointerDown={(e) => {
          /**
           * 查找面板的遮罩（rev173.43）：点卡片外 = 关闭，与命令面板（`.zn-palette-mask`）一致。
           * 面板是 CM6 自己创建的 DOM，没有 React 回调可接 —— 只能在这里做事件委托，
           * 再点它自带的「关闭」按钮（`aria-label="Close"`，atomic 的 makeIconButton 固定带）。
           */
          const target = e.target as HTMLElement
          const panels = target.closest?.('.cm-panels-top') as HTMLElement | null
          if (panels && !target.closest('.cm-search')) {
            panels.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click()
            return
          }
          // 点击表格 widget → 算出表格信息（工具条浮在表格左上角）；
          // 点别处 → null（隐藏）。注意用 viewRef 而不是 state：事件里读 ref 才拿得到最新 view。
          const view = viewRef.current
          if (!view) return
          setTableInfo(computeTableInfoFromEvent(view, e.target as HTMLElement))
        }}
      >
        <div className="zn-editor-modebar">
          <button
            type="button"
            className="zn-mode-toggle"
            onClick={() => setSourceMode((v) => !v)}
            title={sourceMode ? '切回预览（Live Preview）' : '切换到源码模式（显示原始 markdown）'}
          >
            {sourceMode ? '预览' : '源码'}
          </button>
        </div>
        {sourceMode ? (
          <SourceModeView path={path} value={value} onChange={handleMarkdownChange} />
        ) : (
          <AtomicCodeMirrorEditor
            documentId={path ?? ''}
            markdownSource={value}
            onMarkdownChange={handleMarkdownChange}
            editorHandleRef={handleRef}
            extensions={extensions}
            /**
             * 链接点击（2026-10-17 用户报「链接无法跳转打开浏览器」）：
             * atomic 默认走 `window.open`，而 Tauri 的 WebView **不接管**它 ⇒ 静默无反应。
             * 这里转给内核命令 `open_external`（只放行 http/https，用系统默认程序打开）。
             */
            onLinkClick={(url) => {
              // 库内相对链接（附件，没有 scheme）→ 交给宿主分流；外部链接走系统打开
              if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
                onLocalLinkOpen?.(url)
                return
              }
              void invoke('open_external', { url }).catch((e: unknown) => {
                const msg = `打开链接失败：${url}（${
                  /Android/i.test(navigator.userAgent)
                    ? '移动端暂不支持打开外部链接，请复制到浏览器'
                    : String(e)
                }）`
                if (onNotify) onNotify(msg)
                else console.warn('[zn] 打开链接失败', url, e)
              })
            }}
          />
        )}
        {/* 表格工具条：光标在表格里时浮在表格左上角 */}
        <TableToolbar view={editorView} info={tableInfo} />
      </div>
      {/* `[[x]]` 悬浮预览（rev173.228 · 需求 §4.5）：标题 + 摘要；找不到时给「未找到」 */}
      {wikiTip && (
        <div
          className="zn-wiki-tip"
          style={{ left: wikiTip.x, top: wikiTip.y }}
          role="tooltip"
          onMouseLeave={() => setWikiTip(null)}
          onClick={() => setWikiTip(null)}
        >
          <div className="zn-wiki-tip-title">
            {wikiTip.missing ? `「${wikiTip.target}」` : wikiTip.title}
          </div>
          <div className="zn-wiki-tip-body">
            {wikiTip.missing ? '没有找到这篇笔记' : wikiTip.snippet || '（空笔记）'}
          </div>
        </div>
      )}
      {/* 正文图片全屏预览（rev173.1）：点遮罩 / Esc 关闭 */}
      {previewSrc && (
        <div
          className="zn-img-preview"
          role="presentation"
          onClick={() => setPreviewSrc(null)}
        >
          <img src={previewSrc} alt="" />
        </div>
      )}
    </>
  )
}
