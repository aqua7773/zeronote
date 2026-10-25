#!/usr/bin/env node
/**
 * ZeroNote 质量门汇总（2026-10-20）
 * 依次跑：facts --check（文档新鲜度/事实块）· check-arch（依赖方向）· check-links（本地死链）
 *
 * 用法：node scripts/check-gates.mjs
 * 任一子门失败退出码 1。
 */
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const gates = [
  ['facts', 'scripts/facts.mjs', '--check'],
  ['arch', 'scripts/check-arch.mjs'],
  ['links', 'scripts/check-links.mjs'],
  ['catalog', 'scripts/gen-catalog.mjs', '--check'],
  ['keys', 'scripts/gen-keys.mjs', '--check'],
  // rev173.143：市场索引与 examples 的 manifest 不能漂移（改了插件版本忘重新打包 = 红）
  ['market', 'scripts/gen-market.mjs'],
  // rev173.158：外部条目的格式门（**离线**，不联网）—— 脏 PR 一进来就红。
  // 联网那半（拉 entry / 下包核 sha256）只在人工审 PR 时跑，不进 CI：别让 CI 红在别人的服务器上。
  ['review', 'scripts/review-plugin.mjs'],
]

let failed = 0
for (const [name, script, ...args] of gates) {
  console.log(`\n--- ${name} ---`)
  const r = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) failed++
}
if (failed) {
  console.error(`\n❌ 质量门：${failed}/${gates.length} 项失败`)
  process.exit(1)
}
console.log(`\n✅ 质量门：${gates.length}/${gates.length} 通过`)
