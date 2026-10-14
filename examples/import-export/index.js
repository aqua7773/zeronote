/**
 * 导入导出插件 —— **批 1：导入 md / txt → 库内 md 笔记**
 *
 * ## 这一批为什么只做 md / txt
 *
 * 其余格式（pdf / epub / html / docx）都要**转换器**，而转换器怎么引、引哪个包
 * 正在做选型（pandoc-wasm 已排除：58.6 MB + GPL-2.0-or-later）。md / txt 是**零依赖**
 * 的，先把"选文件 → 读内容 → 落库"这条**通道**打通并验收，后面每个格式只是往里加一个
 * `convert()` 分支。
 *
 * ## 通道（全走契约，不碰内部 API）
 *
 * ```
 * host.pickFile()            → 桌面绝对路径 / Android content:// URI（用户取消返回 null）
 * host.readContentUri(raw)   → { path(绝对), name }（Android 由原生插件复制到缓存；桌面原样返回）
 * host.assetUrlAbs(path)     → asset URL（tauri.conf.json 的 scope 是 ** ⇒ 库外也能读）
 * fetch(url)                 → 内容
 * fs.createNote(rel, text)   → 写进库
 * ```
 *
 * ⚠️ 插件是 Blob 模块，**import 不到 `@tauri-apps/api`** —— 所以凡是要 invoke 的，
 * 都必须由宿主包一层（`host.pickFile` / `host.readContentUri` 就是为此而加）。
 *
 * ## 命令可以带参数（给自动化验收 / 将来的拖拽用）
 *
 * `io.importFile` 的 payload 传 `{ path }` 时**不弹选择器**，直接导入那个路径/URI ——
 * 否则原生文件对话框没法脚本化。payload 省略时才弹选择器。
 */

/** 批 1 认识的源文件（纯文本类，原样落库） */
const TEXT_SRC_RE = /\.(md|markdown|txt)$/i

export default {
  apply(ctx) {
    const { fs, command, view, host, subscriptions } = ctx

    /**
     * 找一个**还不存在**的库内相对路径：`foo.md` 撞名就 `foo-1.md`、`foo-2.md`…
     *
     * 判据用 `fs.readText` 能否读到 —— 内核没有"存在否"的查询原语，
     * 而读失败（文件不存在）与真读失败在这里同义：这个名字不能用。
     */
    async function freeRelPath(stem) {
      for (let i = 0; i < 200; i++) {
        const rel = i === 0 ? `${stem}.md` : `${stem}-${i}.md`
        try {
          await fs.readText(rel)
        } catch {
          return rel // 读不到 ⇒ 空着，可以用
        }
      }
      return `${stem}-${Date.now()}.md`
    }

    /**
     * 导入一个文件（`raw` 省略则弹系统选择器）。
     * 返回落库的相对路径；用户取消返回 `null`。
     */
    async function importOne(raw) {
      let picked = raw
      if (!picked) {
        picked = await host.pickFile()
        if (!picked) return null // 用户取消 —— 不是错误，安静收场
      }
      if (typeof picked !== 'string') return null
      console.log('[io] picked =', picked, '| typeof host.readContentUri =', typeof host.readContentUri)

      const { path: abs, name } = await host.readContentUri(picked)
      console.log('[io] 源 =', abs, '| 名 =', name)
      if (!TEXT_SRC_RE.test(name)) {
        // 批 2/3 会在这里分流 pdf / epub / html / docx；现在如实告诉用户还没做
        throw new Error(`批 1 只支持 md / txt，拿到的是「${name}」（其它格式在后续批次）`)
      }

      const res = await fetch(host.assetUrlAbs(abs))
      if (!res.ok) throw new Error(`读源文件失败（HTTP ${res.status}）`)
      const text = await res.text()

      const stem = name.replace(/\.[^.]+$/, '') || 'imported'
      const rel = await freeRelPath(stem)
      await fs.createNote(rel, text)
      host.log('info', `导入 ${name} → ${rel}（${text.length} 字符）`)
      host.notify(`已导入「${rel}」`)
      return rel
    }

    subscriptions.push(
      command.register({
        id: 'io.importFile',
        title: '导入外部文件…',
        run: async (payload) => {
          const p = payload && typeof payload === 'object' ? payload : {}
          try {
            return await importOne(typeof p.path === 'string' ? p.path : undefined)
          } catch (e) {
            console.error('[io] 导入失败', e)
            host.notify(`导入失败：${String(e)}`, 'error')
            host.log('error', `导入失败：${String(e)}`)
            return null
          }
        },
      }),
    )

    subscriptions.push(
      view.registerPanel({
        id: 'io.panel',
        title: '导入导出',
        location: 'sidebar',
        render: () => ({
          type: 'stack',
          children: [
            { type: 'text', value: '导入导出', variant: 'title' },
            { type: 'text', value: '把外部文件变成库内笔记。', variant: 'caption' },
            { type: 'button', label: '导入文件…', onClick: 'io.importFile' },
            { type: 'divider' },
            {
              type: 'text',
              value: '当前支持：md / txt（原样落库，撞名自动加 -1）。\npdf / epub / html / docx 与导出功能在后续批次。',
              variant: 'caption',
            },
          ],
        }),
      }),
    )

    host.log('info', '导入导出插件已就绪（批 1：md / txt 导入）')
  },
}
