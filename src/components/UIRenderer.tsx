import type * as React from 'react'
import type { UIGap, UIListItem, UITableRow, UINode } from '../kernel/contract'

/**
 * 声明式 UI 渲染器（内核契约 §2.2 view 原语）
 *
 * 设计意图：插件只「声明」界面（UINode 是可序列化的纯数据），宿主用这一个组件统一渲染，
 * 于是所有插件视图天然共享同一套 --zn-* token 与 zn-* class ⇒ 风格 100% 统一。
 *
 * 铁律：
 * - 命令类字段（`button.onClick` / `input.onSubmit` / `list.onClick` …）都是**命令 id 字符串**
 *   （不是函数），触发时回调宿主执行（`onAction`），因此 UINode 可以跨进程 / 进沙箱传输。
 * - 所有 `type` 都必须在这里有分支 —— 末尾有穷尽性检查（`never`），漏了会编译报错。
 * - **不给颜色**：视觉只走 `variant` / `tone` / `gap` 这些语义档位，由这里映射到 token。
 */

/** button.onClick / input.onSubmit / select.onSubmit / list.onClick 的回调形状 */
export type UIActionHandler = (commandId: string, payload?: Record<string, unknown>) => void

/** input/select 变更回调形状 */
export type UIStateChangeHandler = (bind: string, value: unknown) => void

export type UIRendererProps = {
  node: UINode
  /** 命令类字段一律是「命令 id 字符串」，触发时回调给宿主执行 */
  onAction: UIActionHandler
  /** input/select/checkbox/tabs 的值来源 */
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

/** gap 档位 → class 后缀（实际尺寸在 styles.css，插件不写 px） */
function gapClass(gap?: UIGap): string {
  return gap ? ` zn-ui-gap-${gap}` : ''
}

/** 列表项：要么是裸 UINode（旧写法，退化为下标 key），要么是 `{key, node}` */
function isWrappedItem(it: UIListItem): it is { key: string; node: UINode } {
  return typeof it === 'object' && it !== null && 'node' in it
}

/**
 * 单节点容错：一个坏节点只显示自己的错误，**兄弟节点照常渲染**。
 *
 * 为什么必须有这一层：插件的 render() 返回的是**数据**，字段可以缺失或类型不对
 * （`{type:'stack'}` 没有 children、未知 type、value 不是字符串…）。
 * 这类错误发生在递归渲染途中，只有就地 try 才不会冒到整棵树。
 */
function renderNode(node: UINode, key: React.Key, ctx: RenderCtx): React.JSX.Element {
  try {
    return renderNodeUnsafe(node, key, ctx)
  } catch (e) {
    return (
      <div key={key} className="zn-ui-error-inline" role="alert">
        ⚠ 这个组件渲染失败：{String(e)}
      </div>
    )
  }
}

/** 渲染一组子节点（布局容器用） */
function renderChildren(nodes: UINode[] | undefined, ctx: RenderCtx): React.JSX.Element[] {
  if (!Array.isArray(nodes)) return []
  return nodes.map((child, i) => renderNode(child, i, ctx))
}

/** 表格单元格：字符串/数字按文本渲染，UINode 递归渲染 */
function renderCell(cell: UITableRow[string], key: React.Key, ctx: RenderCtx): React.JSX.Element {
  if (typeof cell === 'object' && cell !== null) {
    return (
      <td key={key} className="zn-ui-td">
        {renderNode(cell as UINode, key, ctx)}
      </td>
    )
  }
  return (
    <td key={key} className="zn-ui-td">
      {cell == null ? '' : String(cell)}
    </td>
  )
}

/** 真正的渲染 —— 只由 `renderNode` 包着调用 */
function renderNodeUnsafe(node: UINode, key: React.Key, ctx: RenderCtx): React.JSX.Element {
  switch (node.type) {
    /* ───────── 布局 ───────── */

    case 'stack':
      return (
        <div key={key} className={`zn-ui-stack${gapClass(node.gap)}`}>
          {renderChildren(node.children, ctx)}
        </div>
      )

    case 'row':
      return (
        <div
          key={key}
          className={
            `zn-ui-row zn-ui-row-${node.align ?? 'start'}` +
            gapClass(node.gap) +
            (node.wrap ? ' zn-ui-row-wrap' : '')
          }
        >
          {renderChildren(node.children, ctx)}
        </div>
      )

    case 'divider':
      return <div key={key} className="zn-ui-divider" role="separator" />

    case 'spacer':
      return <div key={key} className={`zn-ui-spacer${gapClass(node.size)}`} aria-hidden="true" />

    /* ───────── 文本 ───────── */

    case 'text': {
      const variant = node.variant ?? 'body'
      const tone = node.tone ?? 'default'
      return (
        <div key={key} className={`zn-ui-text zn-ui-text-${variant} zn-ui-tone-${tone}`}>
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

    /** 代码块：等宽 + 可横向滚动 + 可复制（不做语法高亮，插件想高亮请自己生成 html） */
    case 'code':
      return (
        <pre key={key} className="zn-ui-code" data-lang={node.lang ?? undefined}>
          <code>{node.value}</code>
        </pre>
      )

    /**
     * 富内容直投。**这是契约里唯一用 dangerouslySetInnerHTML 的分支** ——
     * 插件（或它拉的 CDN 库，如 katex / mermaid）返回什么就渲染什么。
     * 无沙箱前提下插件本就是本机可信代码，可以接受；装第三方插件前请读源码。
     */
    case 'html':
      return <div key={key} className="zn-ui-html" dangerouslySetInnerHTML={{ __html: node.value }} />

    /** 命令驱动的"链接"：不做真实导航（WebView 里跳转会顶掉应用），点它执行命令 */
    case 'link':
      return (
        <button
          key={key}
          type="button"
          className="zn-ui-link"
          onClick={() => ctx.onAction(node.onClick, node.payload)}
        >
          {node.label ?? node.onClick}
        </button>
      )

    /* ───────── 媒体 ───────── */

    case 'image':
      return (
        <img
          key={key}
          className="zn-ui-image"
          src={node.src}
          alt={node.alt ?? ''}
          loading="lazy"
          style={{
            maxHeight: node.height ? `${node.height}px` : undefined,
            objectFit: node.fit ?? 'contain',
          }}
        />
      )

    /* ───────── 交互 ───────── */

    case 'button': {
      const variant = node.variant ?? 'default'
      const send = node.send
      return (
        <button
          key={key}
          type="button"
          disabled={node.disabled}
          className={`zn-btn zn-ui-btn-${variant}`}
          onClick={() =>
            ctx.onAction(node.onClick, {
              ...node.payload,
              // send 最后合并：它读的是当前输入值，应当覆盖静态 payload 里的同名键
              ...(send ? { value: ctx.state[send] } : {}),
            })
          }
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
          type={node.secret ? 'password' : 'text'}
          className="zn-ui-input"
          value={asText(ctx.state[node.bind])}
          placeholder={node.placeholder}
          autoComplete={node.secret ? 'off' : undefined}
          onChange={(e) => ctx.onStateChange(node.bind, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && submitId) {
              ctx.onAction(submitId, { value: e.currentTarget.value })
            }
          }}
        />
      )
    }

    case 'textarea': {
      const submitId = node.onSubmit
      return (
        <textarea
          key={key}
          className="zn-ui-textarea"
          rows={node.rows ?? 3}
          value={asText(ctx.state[node.bind])}
          placeholder={node.placeholder}
          onChange={(e) => ctx.onStateChange(node.bind, e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter 提交（多行框里裸 Enter 应该是换行）
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submitId) {
              ctx.onAction(submitId, { value: e.currentTarget.value })
            }
          }}
        />
      )
    }

    case 'select': {
      // onSubmit 是契约里的可选字段；有的插件只在 onChange 时回调命令
      const submitId = (node as { onSubmit?: string }).onSubmit
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

    case 'checkbox': {
      const submitId = node.onSubmit
      return (
        <label key={key} className="zn-ui-checkbox">
          <input
            type="checkbox"
            checked={ctx.state[node.bind] === true}
            onChange={(e) => {
              const next = e.target.checked
              ctx.onStateChange(node.bind, next)
              if (submitId) ctx.onAction(submitId, { value: next })
            }}
          />
          {node.label ? <span>{node.label}</span> : null}
        </label>
      )
    }

    /* ───────── 数据展示 ───────── */

    case 'list': {
      const items = Array.isArray(node.items) ? node.items : []
      if (items.length === 0) {
        return node.empty ? (
          <div key={key} className="zn-ui-list-empty">
            {node.empty}
          </div>
        ) : (
          <div key={key} className="zn-ui-list" />
        )
      }
      return (
        <div key={key} className={`zn-ui-list${node.onClick ? ' is-clickable' : ''}`}>
          {items.map((it, i) => {
            const wrapped = isWrappedItem(it)
            const itemKey = wrapped ? it.key : i
            const body = renderNode(wrapped ? it.node : it, 'body', ctx)
            if (!node.onClick) return <div key={itemKey}>{body}</div>
            return (
              <div
                key={itemKey}
                className="zn-ui-list-item"
                role="button"
                tabIndex={0}
                onClick={() => ctx.onAction(node.onClick as string, { index: i, key: itemKey })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    ctx.onAction(node.onClick as string, { index: i, key: itemKey })
                  }
                }}
              >
                {body}
              </div>
            )
          })}
        </div>
      )
    }

    case 'table': {
      const rows = Array.isArray(node.rows) ? node.rows : []
      if (rows.length === 0) {
        return node.empty ? (
          <div key={key} className="zn-ui-list-empty">
            {node.empty}
          </div>
        ) : (
          <table key={key} className="zn-ui-table" />
        )
      }
      return (
        <div key={key} className="zn-ui-table-wrap">
          <table className="zn-ui-table">
            <thead>
              <tr>
                {node.columns.map((col) => (
                  <th
                    key={col.key}
                    className={col.align === 'right' ? 'is-right' : undefined}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {node.columns.map((col) => renderCell(row[col.key], col.key, ctx))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    case 'progress': {
      const max = node.max && node.max > 0 ? node.max : 100
      const pct = Math.max(0, Math.min(100, (Number(node.value) / max) * 100))
      return (
        <div key={key} className="zn-ui-progress">
          <div
            className="zn-ui-progress-bar"
            role="progressbar"
            aria-valuenow={Number(node.value)}
            aria-valuemin={0}
            aria-valuemax={max}
          >
            <div className="zn-ui-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          {node.label ? <div className="zn-ui-progress-label">{node.label}</div> : null}
        </div>
      )
    }

    case 'badge':
      return (
        <span key={key} className={`zn-ui-badge zn-ui-tone-${node.tone ?? 'default'}`}>
          {node.text}
        </span>
      )

    /* ───────── 表单 ───────── */

    case 'field':
      return (
        <div key={key} className="zn-ui-field">
          <div className="zn-ui-field-label">{node.label}</div>
          {node.hint ? <div className="zn-ui-field-hint">{node.hint}</div> : null}
          <div className="zn-ui-field-body">{renderNode(node.children, 'body', ctx)}</div>
        </div>
      )

    case 'tabs': {
      const tabs = Array.isArray(node.tabs) ? node.tabs : []
      if (tabs.length === 0) return <div key={key} className="zn-ui-tabs" />
      // 没选过时默认第一个 —— 插件不必在 apply() 里预置 state
      const current = asText(ctx.state[node.bind]) || tabs[0].key
      const active = tabs.find((t) => t.key === current) ?? tabs[0]
      return (
        <div key={key} className="zn-ui-tabs">
          <div className="zn-ui-tabs-bar" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === active.key}
                className={`zn-ui-tab${t.key === active.key ? ' is-active' : ''}`}
                onClick={() => ctx.onStateChange(node.bind, t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="zn-ui-tabs-body">{renderNode(active.node, 'body', ctx)}</div>
        </div>
      )
    }

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
    <div className="zn-ui-root">
      {renderNode(node, 'root', { onAction, state, onStateChange })}
    </div>
  )
}
