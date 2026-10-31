/**
 * 环形快捷入口的 **5 格配置**（rev173.281 · 真人使用测试 J#9）。
 *
 * 用户 2026-10-30 拍板：环形菜单**共 6 个位置** ——
 * 中心「＋」= 新建笔记（**固定**），周围 5 格是功能入口，且**可配**。
 * （原话更正：「本来那个加号就是新建笔记，我的意思是其他五个放功能入口」。）
 *
 * 存 `localStorage`（应用级偏好，不跟库走）：换库不该把快捷入口一起换掉。
 * 值是「槽位 → key」的数组，长度恒为 `QUICK_SLOT_COUNT`，`null` = 空槽（环上画虚线占位）。
 *
 * key 两种：
 *  · `panel:<面板 id>` —— 插件面板（记账 / 导入导出 …），未启用时环上显示「未安装」；
 *  · `builtin:<动作>` —— 内核内置入口（搜索 / 回收站 / 设置 …）。
 */
export const QUICK_SLOT_COUNT = 5
export const QUICK_SLOTS_KEY = 'zeronote.quickSlots'

export type QuickSlotOption = {
  key: string
  label: string
}

/**
 * 内置动作候选。
 *
 * **刻意不放「新建笔记」**：中心那个 ＋ 就是它，重复放一格只浪费位置。
 *
 * **也刻意不放「时间流」（rev173.303 · 第三次真人测试 #1）**：时间流是桌面专属功能，
 * 桌面自己有图标栏 / `Ctrl+3` / 菜单三处入口，不需要绕一圈手机的 ＋ 环形菜单；
 * 而手机上它只能是个「仅桌面」的灰位 —— 用户原话「设置这个没有意义」。
 */
export const BUILTIN_QUICK_OPTIONS: QuickSlotOption[] = [
  { key: 'builtin:search', label: '搜索' },
  { key: 'builtin:plugins', label: '插件中心' },
  { key: 'builtin:trash', label: '回收站' },
  { key: 'builtin:settings', label: '设置' },
  { key: 'builtin:vaults', label: '切换笔记库' },
]

/**
 * 默认 5 格。
 *
 * 第一格保留改造前的「记账」：装了就是入口，没装就是「未安装」灰位
 * （与改造前行为一致，用户熟悉）。注意**面板 id** 是 `accounting.ledger`
 * （插件 id 是 `accounting`，但面板挂在 `.ledger` 上 —— 2026-10-30 手机实测发现）。
 * 其余四格都是手机上真能用的内置入口 —— 不放 `builtin:timeline`（rev173.303 起候选里也没有它）。
 */
export const DEFAULT_QUICK_SLOTS: (string | null)[] = [
  'panel:accounting.ledger',
  'builtin:search',
  'builtin:trash',
  'builtin:plugins',
  'builtin:settings',
]

/** 把任意输入规整成「长度 5、每项 string | null」—— 读坏了不炸，只是回落成空槽 */
export function normalizeQuickSlots(raw: unknown): (string | null)[] {
  const arr = Array.isArray(raw) ? raw : []
  return Array.from({ length: QUICK_SLOT_COUNT }, (_, i) => {
    const v = arr[i]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  })
}

export function readQuickSlots(): (string | null)[] {
  try {
    const raw = localStorage.getItem(QUICK_SLOTS_KEY)
    if (!raw) return [...DEFAULT_QUICK_SLOTS]
    return normalizeQuickSlots(JSON.parse(raw))
  } catch {
    return [...DEFAULT_QUICK_SLOTS]
  }
}

export function writeQuickSlots(slots: (string | null)[]): void {
  try {
    localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(normalizeQuickSlots(slots)))
  } catch {
    /* 存不了就只活在内存里（隐私模式 / 配额满），不影响用 */
  }
}

/** 插件面板 → 候选（进来的应是已经过滤掉 `hidden` 的清单） */
export function quickSlotOptions(panels: { id: string; title: string }[]): QuickSlotOption[] {
  return [
    ...panels.map((p) => ({ key: `panel:${p.id}`, label: p.title })),
    ...BUILTIN_QUICK_OPTIONS,
  ]
}

/**
 * key → 人类可读标签；解析不出来（插件已卸载 / key 写坏）返回 `null`
 * ⇒ 调用方把这一格当空槽，不画一个点不动的怪东西。
 */
export function quickSlotLabel(
  key: string | null,
  panels: { id: string; title: string }[],
): string | null {
  if (!key) return null
  if (key.startsWith('panel:')) {
    return panels.find((p) => p.id === key.slice('panel:'.length))?.title ?? null
  }
  if (key.startsWith('builtin:')) {
    return BUILTIN_QUICK_OPTIONS.find((o) => o.key === key)?.label ?? null
  }
  return null
}
