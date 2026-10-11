import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind class —— 后面的同类属性覆盖前面的。
 *
 * 抄自 Lumina `src/lib/utils.ts`（Apache-2.0）：`clsx` 负责条件拼接，
 * `twMerge` 负责消解冲突（`p-2 p-4` → `p-4`），这样组件默认样式可被调用方
 * 用 `className` 覆盖。
 *
 * ⚠️ 必须把本项目的**自定义色名**登记给 tailwind-merge（见 extend.theme.colors）：
 * 它内置规则只认 Tailwind 自带色名，遇到 `text-primary-foreground` 会**误判成「字号」组**，
 * 与同组的 `text-sm` 冲突后把颜色**丢掉** —— 症状是「紫底按钮上的白字看不见」。
 * 实测对照：换成内置的 `text-white` 立刻恢复正常。
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'background',
        'foreground',
        'surface',
        'surface-hover',
        'surface-active',
        'border',
        'border-strong',
        'muted-foreground',
        'subtle-foreground',
        'primary',
        'primary-foreground',
        'destructive',
        'popover',
        'popover-foreground',
        'accent',
        'accent-foreground',
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
