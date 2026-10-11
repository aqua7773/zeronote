import type * as React from 'react'
import type { UINode } from '../kernel/contract'

/**
 * 声明式 UI 渲染器（内核契约 §2.2 view 原语）
 *
 * 设计意图：插件只「声明」界面（UINode 是可序列化的纯数据），宿主用这一个组件统一渲染，
 * 于是所有插件视图天然共享同一套 --zn-* token 与 zn-* class ⇒ 风格 100% 统一。
 *
 * 铁律：
 * - `button.onClick` / `input.onSubmit` / `select.onSubmit` 都是**命令 id 字符串**（不是函数），
 *   点击/提交时回调宿主执行（`onAction`），因此 UINode 可跨进程/沙箱传输。
 * - 递归渲染全部 type：stack / row / text / markdown / button / input / select / list / divider。
 * - 不引入任何依赖；markdown 在 M1 只做可读可复制的 <pre>。
 */

/** button.onClick / input.onSubmit / select.onSubmit 的回调形状 */
export type UIActionHandler = (commandId: string, payload?: Record<string, unknown>) => void

/** input/select 变更回调形状 */
export type UIStateChangeHandler = (bind: string, value: unknown) => void

export type UIRendererProps = {
  node: UINode
  /** button 的 onClick 是「命令 id 字符串」，点击时回调给宿主执行 */
  onAction: UIActionHandler
  /** input/select 的值来源 */
  state: Record<string, unknown>
  onStateChange: UIStateChangeHandler
}

type RenderCtx = {
  onAction: UIActionHandler
  state: Record<string, unknown>
  onStateChange: UIStateChangeHandler
}

/** 契约里 state 是 unknown；受控组件只接受字符串，统一收敛到这里 */
function asText(value: unknown): string {
  return value == null ? '' : String(value)
}

/**
 * select 的 `onSubmit` 是 v0.1 契约里预留但未声明的可选字段（见 docs §2.2 与 contract.ts）。
 * 不改契约文件，运行时按可选字段探测：有就按 input 的方式在变更后回调命令。
 */
function submitIdOf(node: UINode): string | undefined {
  return (node as { onSubmit?: string }).onSubmit
}

function renderNode(node: UINode, key: React.Key, ctx: RenderCtx): React.JSX.Element {
  const renderChildren = (nodes: UINode[]) =>
    nodes.map((child, i) => renderNode(child, i, ctx))

  switch (node.type) {
    case 'stack':
      return (
        <div key={key} className="zn-ui-stack">
          {renderChildren(node.children)}
        </div>
      )

    case 'row':
      return (
        <div key={key} className="zn-ui-row">
          {renderChildren(node.children)}
        </div>
      )

    case 'text': {
      const variant = node.variant ?? 'body'
      return (
        <div key={key} className={`zn-ui-text zn-ui-text-${variant}`}>
          {node.value}
        </div>
      )
    }

    /**
     * M1 阶段：只把源码放进 <pre>，保证内容可读、可复制、不引入依赖。
     * v0.2 换成真正的渲染器（届时按 token 映射标题/列表/代码块样式，仍然不裸用第三方主题）。
     */
    case 'markdown':
      return (
        <pre key={key} className="zn-ui-markdown">
          {node.value}
        </pre>
      )

    case 'button': {
      const variant = node.variant ?? 'default'
      const send = node.send
      return (
        <button
          key={key}
          type="button"
          className={`zn-btn zn-ui-btn-${variant}`}
          onClick={() => ctx.onAction(node.onClick, send ? { value: ctx.state[send] } : undefined)}
        >
          {node.label}
        </button>
      )
    }

    case 'input': {
      const submitId = node.onSubmit
      return (
        <input
          key={key}
          type="text"
          className="zn-ui-input"
          value={asText(ctx.state[node.bind])}
          placeholder={node.placeholder}
          onChange={(e) => ctx.onStateChange(node.bind, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && submitId) {
              ctx.onAction(submitId, { value: e.currentTarget.value })
            }
          }}
        />
      )
    }

    case 'select': {
      const submitId = submitIdOf(node)
      return (
        <select
          key={key}
          className="zn-ui-select"
          value={asText(ctx.state[node.bind])}
          onChange={(e) => {
            const next = e.target.value
            ctx.onStateChange(node.bind, next)
            if (submitId) ctx.onAction(submitId, { value: next })
          }}
        >
          {node.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )
    }

    case 'list':
      return (
        <div key={key} className="zn-ui-list">
          {node.items.length > 0
            ? renderChildren(node.items)
            : node.empty
              ? <div className="zn-ui-list-empty">{node.empty}</div>
              : null}
        </div>
      )

    case 'divider':
      return <div key={key} className="zn-ui-divider" role="separator" />

    default: {
      // 穷尽性检查：契约将来新增 type 时，这里会编译报错，提醒渲染器补齐
      const unknownNode: never = node
      return (
        <div key={key} className="zn-ui-text zn-ui-text-caption">
          {JSON.stringify(unknownNode)}
        </div>
      )
    }
  }
}

export function UIRenderer({ node, onAction, state, onStateChange }: UIRendererProps): React.JSX.Element {
  return (
    <div className="zn-ui-root">{renderNode(node, 'root', { onAction, state, onStateChange })}</div>
  )
}
