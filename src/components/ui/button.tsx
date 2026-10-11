import { cn } from '@/lib/utils'

/**
 * 按钮原语。
 *
 * 行为/变体/尺寸分类照抄 Lumina `src/components/ui/button.tsx`（Apache-2.0），
 * 只把尺寸调小以匹配 ZeroNote 的紧凑排版（--zn-text-sm: 12px，现有 .zn-btn 约 26px 高）。
 *
 * class 名用的是 shadcn 惯例（bg-primary / border-border / text-muted-foreground），
 * 由 `src/styles.css` 的 `@theme inline` 映射到 --zn-* token，所以自动跟随暗色。
 */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary:
    'bg-background text-foreground border border-border-strong hover:bg-accent hover:border-border-strong',
  ghost: 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent',
  danger: 'bg-transparent text-destructive border border-border-strong hover:bg-accent',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-xs',
  md: 'h-7 px-2.5 text-xs',
  lg: 'h-8 px-3 text-sm',
}

export function Button({
  className,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-ui-md font-medium',
        'transition-[background-color,border-color,color] duration-150 ease-out',
        'disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  )
}
