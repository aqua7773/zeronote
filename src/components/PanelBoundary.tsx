/**
 * 面板容错围栏（第二层）—— 只有这个面板变成错误卡片，内核继续跑。
 *
 * 分工见 `kernel/panel-safe.ts` 的注释。这里兜的是**第一层兜不住**的那些：
 * 提交阶段的异常、子孙组件（插件数据驱动的 React 组件）自己抛的错。
 *
 * 切换面板时靠**外部 `key`** 重置错误态（React 在 key 变化时卸载并重建本组件），
 * 所以不需要 `componentDidUpdate` + setState。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null }

export class PanelBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ZeroNote] 插件面板崩溃（已隔离，内核继续运行）', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="zn-ui-error" role="alert">
          <div className="zn-ui-error-title">⚠ 这个面板渲染失败了</div>
          <pre className="zn-ui-error-msg">
            {String(this.state.error.message || this.state.error)}
          </pre>
          <div className="zn-ui-error-hint">其它功能不受影响。修好插件后点「重新扫描」即可。</div>
        </div>
      )
    }
    return this.props.children
  }
}
