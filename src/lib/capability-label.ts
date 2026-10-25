/**
 * **能力自述 → 人话**（rev173.156 · 第二批 UX）。
 *
 * 插件 manifest 里的 `capabilities` 是给内核看的取值（`fs:read` / `view:main`…），
 * 直接摊给用户等于没说。这里只做**展示翻译**，不改变任何行为：
 *
 * · 未知取值**原样返回** —— 宁可露出 `xxx` 也不猜（契约 §4 明确 capability 只是自述，
 *   内核不校验取值，所以「不认识的字符串」是合法存在的）；
 * · `host` / `event` 是早期插件里的老写法（contract.ts 的 Capability 已不含它们），
 *   照样翻译，因为它们出现在已发布的 13 个插件里（tag-panel / backlinks）。
 */

/** 已知能力的说法（措辞要具体到「能做什么」，不要写成「权限 A」） */
const CAPABILITY_LABEL: Record<string, string> = {
  'fs:read': '读你的文件',
  'fs:write': '写文件',
  'doc:read': '读当前笔记',
  'doc:write': '改当前笔记',
  'index:query': '查全文索引',
  'index:write': '改索引',
  command: '注册命令',
  'view:main': '主区面板',
  'view:sidebar': '侧栏',
  'view:modal': '浮层',
  'view:statusbar': '状态栏',
  'view:editor-toolbar': '编辑器底栏',
  'view:editor-topbar': '编辑器顶栏',
  'editor:mark': '正文标记',
  'editor:line-action': '行首按钮',
  'editor:line-class': '行样式',
  'editor:fold': '折叠',
  store: '自己的存储',
  net: '联网',
  proc: '起子进程',
  event: '监听事件',
  host: '宿主能力',
  service: '后台服务',
  /**
   * 旧写法（早期插件只写一个粗粒度 `fs`，不分读写）—— 13 个官方插件里真用到，
   * 出现在 accounting / import-export 的 manifest 里。翻译成合并说法，别让用户看到裸 `fs`。
   */
  fs: '读写文件',
}

/** 一条能力的中文说法；不认识的返回原字符串（不猜、不隐藏） */
export function capabilityLabel(capability: string): string {
  const key = String(capability ?? '').trim()
  if (!key) return ''
  return CAPABILITY_LABEL[key] ?? key
}

/** 整串能力的中文说法（过滤空项；去重后保持原顺序） */
export function capabilityLabels(capabilities: readonly string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of capabilities ?? []) {
    const label = capabilityLabel(raw)
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}
