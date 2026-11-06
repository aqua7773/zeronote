/**
 * 密码输入框（圆点 + 框内 👁 切换明文）—— **只有这一份实现**（rev173.405）。
 *
 * 来源：rev173.378 在 `UIRenderer` 里给插件的 `input.secret` 做了眼睛按钮；
 * rev173.405 内核又加了 `host.prompt({ secret: true })`（宿主弹的输入对话框），
 * 同一种控件出现在两处 ⇒ 抽到这里，`UIRenderer` 与 `App` 的 prompt 浮层共用。
 *
 * 为什么显示 / 隐藏状态由组件自己持有：这是**纯 UI 关注点**，不该进插件 state；
 * 切换是「点击保持」（用户要求），按钮按下时阻止默认以免抢走输入框焦点。
 */
import { useState } from 'react'

export type SecretFieldProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** 打开即聚焦（宿主 prompt 用；插件表单里的多字段不聚焦） */
  autoFocus?: boolean
  /** 按 Enter 的回调（不传则不响应 Enter） */
  onSubmit?: () => void
}

export function SecretField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
}: SecretFieldProps): React.JSX.Element {
  const [shown, setShown] = useState(false)
  return (
    <div className="zn-ui-secret">
      <input
        type={shown ? 'text' : 'password'}
        className="zn-ui-input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) onSubmit()
        }}
      />
      <button
        type="button"
        className={`zn-ui-secret-toggle${shown ? ' is-shown' : ''}`}
        aria-label={shown ? '隐藏密码' : '显示密码'}
        aria-pressed={shown}
        title={shown ? '隐藏密码' : '显示密码'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? '🙈' : '👁'}
      </button>
    </div>
  )
}
