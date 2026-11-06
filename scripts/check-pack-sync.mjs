#!/usr/bin/env node
/**
 * 市场包 ↔ examples 源码 一致性门（2026-11-06 · rev173.391 的教训）
 *
 * 为什么有这道门：`examples/<id>/index.js` 改了但忘了重打包时，
 * `market/index.json` 里的版本号可能还等于 `examples/<id>/manifest.json` 的版本号
 * ⇒ `gen-market` 的「索引 vs manifest」检查全绿，而市场里的 `.znp` 仍是旧代码。
 * 用户从市场更新到「最新版本」，拿到的却是旧逻辑（2026-11-06 私密文件夹 / 密码库真实事故）。
 *
 * 判据：对 market/index.json 的每个条目，解出 `market/packs/<id>-<version>.znp`（JSON 包），
 * 把包内 `files` 的每个文件与 `examples/<id>/<同名文件>` 逐字节比较。不一致 ⇒ 红。
 *
 * 用法：node scripts/check-pack-sync.mjs
 * 退出码：0 = 全部一致；1 = 有不一致（打印明细）。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const indexPath = path.join(root, 'market', 'index.json')

if (!fs.existsSync(indexPath)) {
  console.error('❌ 没有 market/index.json')
  process.exit(1)
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const entries = index.plugins || []
const problems = []
let compared = 0

for (const entry of entries) {
  const id = entry.id
  const version = entry.version
  const packPath = path.join(root, 'market', 'packs', `${id}-${version}.znp`)
  const srcDir = path.join(root, 'examples', id)

  if (!fs.existsSync(packPath)) {
    problems.push(`${id}@${version}：缺包 market/packs/${id}-${version}.znp`)
    continue
  }
  if (!fs.existsSync(srcDir)) {
    problems.push(`${id}@${version}：没有源码目录 examples/${id}`)
    continue
  }

  let pack
  try {
    pack = JSON.parse(fs.readFileSync(packPath, 'utf8'))
  } catch (e) {
    problems.push(`${id}@${version}：包不是合法 JSON（${e.message}）`)
    continue
  }

  const files = pack.files || {}
  for (const [rel, packed] of Object.entries(files)) {
    if (rel === 'signature.json') continue // 签名是打包时生成的，源码目录里没有
    const srcPath = path.join(srcDir, rel)
    if (!fs.existsSync(srcPath)) {
      problems.push(`${id}@${version}：包内有 ${rel}，但 examples/${id}/${rel} 不存在`)
      continue
    }
    const source = fs.readFileSync(srcPath, 'utf8')
    compared += 1
    if (source !== packed) {
      problems.push(
        `${id}@${version}：${rel} 与源码不一致（包内 ${packed.length} B / 源码 ${source.length} B）`,
      )
    }
  }

  // 包内没收录源码里的入口 = 打包时漏了文件（样式插件可能只有 styles.css，比上面已经覆盖）
  const entryFile = pack.manifest?.entry
  if (entryFile && !files[entryFile]) {
    problems.push(`${id}@${version}：manifest.entry = ${entryFile}，但包里没有这个文件`)
  }
}

if (problems.length) {
  console.error(`❌ 市场包与源码不一致：${problems.length} 处（比较了 ${compared} 个文件）`)
  for (const p of problems) console.error('   · ' + p)
  console.error('\n修法：`node scripts/pack-plugin.mjs examples/<id> --key <密钥> --key-id <id>` 后 `node scripts/gen-market.mjs --write`')
  process.exit(1)
}

console.log(`✅ 市场包与源码一致：${entries.length} 个插件 · 比较 ${compared} 个文件`)
