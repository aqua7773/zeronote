/**
 * 同步限流退避（rev173.279 · 真人使用测试 #12「坚果云同步很容易触发限流」）。
 *
 * 用户截图：底部「同步失败：Error: 下载失败（503）」，面板又写着「自动 · 前台每 5 秒」
 * —— 5 秒一轮 = 360 次 / 30 分钟，撞上坚果云 600 次的上限很快。
 *
 * 旧行为：撞上 503 就 `stopAuto()` + 把 `settings.auto` 置 false ⇒ **永久停**，
 * 用户必须手动重开；重开后又 5 秒一轮，很快再撞。
 *
 * 新行为：**指数退避**（15 s → 60 s → 300 s），任意一轮成功立刻复位。
 * 认证类错误仍然立刻停 —— 那种重试只会让封禁更久。
 *
 * 静态检查而不是跑插件：插件是独立 Blob 模块（依赖宿主 API），单测跑不起来；
 * 这里防的是「退避被手改回去 / 只改了一个后端」。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * rev173.288：三个网络后端并进 `sync` 一个插件 —— 退避常量在 `lib/core.cjs`、
 * 流程在 `index.cjs`，两份源码拼起来当作被测对象（断言的仍是同一批字符串）。
 */
const read = (_id: string) =>
  readFileSync(join(root, 'examples/sync/lib/core.cjs'), 'utf8') +
  readFileSync(join(root, 'examples/sync/index.cjs'), 'utf8')

/** 本地文件夹后端没有网络请求，也就不存在限流 */
const NETWORK_BACKENDS = ['sync'] as const

describe.each(NETWORK_BACKENDS)('%s 的限流退避', (id) => {
  const src = read(id)

  it('退避三档存在', () => {
    expect(src).toContain('const BACKOFF_MS = [15000, 60000, 300000]')
  })

  it('退避期内跳过请求（节拍照走，才能自动恢复）', () => {
    expect(src).toContain('if (Date.now() < backoffUntil) return')
  })

  it('成功一轮复位退避', () => {
    expect(src).toContain('backoffUntil = 0')
  })

  it('面板会说「限流退避中」（不再谎报「前台每 5 秒」）', () => {
    expect(src).toContain('限流退避中')
  })

  it('限流分支【不】停自动同步（旧行为已移除）', () => {
    // 「已退避」这行在限流分支内 —— 往前 500 字符覆盖整个分支
    const at = src.indexOf('已退避')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(Math.max(0, at - 500), at)).not.toContain('stopAuto(')
  })

  it('认证失败仍然立刻停（重试只会更糟）', () => {
    // 认证正则（三个后端的写法略有不同，但都以 `401|` 开头）后面紧跟 stopAuto()
    const at = src.search(/\/401\|/)
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 500)).toContain('stopAuto(')
  })
})
