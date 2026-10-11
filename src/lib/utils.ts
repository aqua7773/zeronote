import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind class —— 后面的同类属性覆盖前面的。
 *
 * 抄自 Lumina `src/lib/utils.ts`（Apache-2.0，行为照原样）：
 * `clsx` 负责条件拼接，`twMerge` 负责消解冲突（`p-2 p-4` → `p-4`），
 * 这样组件的默认样式可以被调用方用 `className` 覆盖。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
