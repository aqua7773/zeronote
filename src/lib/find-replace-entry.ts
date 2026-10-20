/**
 * 查找面板里的「替换」入口（rev173.71）。
 *
 * 为什么需要：atomic-editor 的查找面板**没有替换行**（上游源码注释原话 "No replace"），
 * 所以「在当前这篇里替换」只能靠 ZeroNote 自己的 `.zn-replace-bar`（Ctrl+H）。
 * 结果是按 Ctrl+F 打开的面板里找不到替换，用户得记住另一个键、另一个面板。
 *
 * 做法：面板是 CM6 自己创建的 DOM（没有 React 回调可接），只能往 `.cm-search` 里补一个
 * 按钮；点了 = 关掉查找面板（复用它自带的关闭按钮，与 rev173.43 点遮罩同一出口）
 * + 把关键词交回编辑器，由宿主打开替换栏。
 */

/** 按钮标记：重复扫描时据此判重（MutationObserver 会反复触发） */
export const REPLACE_ENTRY_ATTR = 'data-zn-replace-entry'

/**
 * 往查找面板补按钮。已存在则返回 null（幂等）。
 *
 * @param panel `.cm-search.atomic-editor-search-panel` 元素
 * @param onOpen 点击后的回调，参数是当前的查找关键词（可能为空串）
 */
export function ensureReplaceEntry(
  panel: HTMLElement,
  onOpen: (keyword: string) => void,
): HTMLButtonElement | null {
  if (panel.querySelector(`[${REPLACE_ENTRY_ATTR}]`)) return null

  const btn = document.createElement('button')
  btn.type = 'button'
  // 与 atomic 自带按钮同一 class，样式（高亮 / 间距）直接复用
  btn.className = 'cm-atomic-search-btn zn-find-replace-entry'
  btn.setAttribute(REPLACE_ENTRY_ATTR, '1')
  btn.textContent = '替换'
  btn.title = '在本篇里替换（Ctrl+H）'
  btn.addEventListener('click', () => {
    const input = panel.querySelector<HTMLInputElement>('.cm-atomic-search-input')
    const keyword = input?.value ?? ''
    // 先拿走关键词，再关面板（关闭会移除整棵面板 DOM）
    panel.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click()
    onOpen(keyword)
  })
  panel.appendChild(btn)
  return btn
}
