/**
 * 面板渲染的**第一层**容错：调插件 `render()` 时抛错 → 退回一段错误提示 UINode。
 *
 * 背景（2026-10-11 已实测复现）：`panel.render()` 在**渲染期**被调用，
 * 插件一抛错，React 19 在没有 boundary 时会卸载整棵树
 * ⇒ 整个客户区白屏，连内核的笔记读写编辑都一起失效（`_shots\boom-07-crash-tab.png`）。
 *
 * 三层防护分工：
 *   ① 本文件 `renderPanelSafe()` —— render() 自身抛错，就地退回错误节点
 *   ② `components/PanelBoundary.tsx` —— 提交阶段 / 子孙组件的错，只让那个面板变错误卡片
 *   ③ `components/UIRenderer.tsx` —— 单个坏节点只影响自己，兄弟节点照常渲染
 *
 * 放在 kernel 层是因为它是**纯函数、不依赖 React**：只管把「可能抛错的 render()」
 * 变成「一定能渲染的 UINode」。与权限无关，拦的是崩溃不是恶意。
 */
import type { UINode } from './contract'
import type { PanelRegistration } from './kernel'

/** 渲染失败时的兜底界面（仍是 UINode，所以走同一条声明式渲染管线） */
function errorNode(message: string): UINode {
  return {
    type: 'stack',
    children: [
      { type: 'text', value: '⚠ 这个面板渲染失败了', variant: 'title' },
      { type: 'text', value: message, variant: 'caption' },
      { type: 'divider' },
      {
        type: 'text',
        value: '其它功能不受影响。修好插件后点「重新扫描」即可。',
        variant: 'caption',
      },
    ],
  }
}

export function renderPanelSafe(
  panel: Pick<PanelRegistration, 'pluginId' | 'render'>,
  state: Record<string, unknown>,
): UINode {
  // rev173.81：`mount` 面板没有 render —— 走到这里说明宿主用错了渲染分支，
  // 给一句能定位的提示，而不是 `undefined is not a function`（那会整树崩）。
  if (typeof panel.render !== 'function') {
    return errorNode(`面板 ${panel.pluginId || '(未知)'} 用 DOM 直挂（mount）渲染，不该走 UIRenderer`)
  }
  try {
    return panel.render({ pluginId: panel.pluginId ?? '', state })
  } catch (e) {
    return errorNode(String(e))
  }
}
