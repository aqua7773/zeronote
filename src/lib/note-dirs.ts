/**
 * 从笔记清单推导**所有层级目录前缀**（供下拉筛选）。
 *
 * `a/b/c.md` → `a`、`a/b`。只用于 UI 选项，不参与路径解析。
 * 搜索面板（rev173.47）与全局替换面板（rev173.49）共用，避免两份实现跑偏。
 */
export function dirPrefixesOf(notes: { path: string }[]): string[] {
  const set = new Set<string>()
  for (const n of notes) {
    const parts = n.path.replace(/\\/g, '/').split('/')
    parts.pop() // 去掉文件名
    let acc = ''
    for (const seg of parts) {
      acc = acc ? `${acc}/${seg}` : seg
      if (acc) set.add(acc)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
}
