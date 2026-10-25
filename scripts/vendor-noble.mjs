/**
 * 生成 `public/vendor/noble/` —— 安全插件用的密码学库（本地副本）
 *
 * 为什么不走 CDN / 不 import 裸包名：
 *   · 插件是 **Blob 模块**，`import` 不到裸包名（契约 §2.2 / import-export 的先例）
 *   · 密码学库从网络拉 = 谁的证书、谁的回滚、谁的可用性都变成攻击面
 *   · 本地副本可以逐字节核对（版本写进 README，重新生成就是重新核对）
 *
 * 做法：从 `node_modules/@noble/*` 按**相对 import 图**精确复制（只带真正用到的模块），
 * 保持 `ciphers/` `hashes/` 目录结构 —— 浏览器里的动态 `import()` 才能解析相对依赖。
 *
 * 用法：`node scripts/vendor-noble.mjs`
 * 幂等：重复跑结果一致（覆盖写）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'public/vendor/noble')
const NM = join(ROOT, 'node_modules/@noble')

/** 入口：安全插件真正会 import 的那些符号所在的模块 */
const ENTRIES = [
  ['ciphers', 'chacha.js'], // xchacha20poly1305 / chacha20poly1305
  ['ciphers', 'utils.js'], // randomBytes
  ['hashes', 'argon2.js'], // argon2id
  ['hashes', 'sha2.js'], // sha256（KDF 之外的摘要/指纹）
  ['hashes', 'hmac.js'], // HMAC-SHA256（sign/verify）
  ['hashes', 'hkdf.js'], // HKDF（DEK → 子密钥）
  ['hashes', 'utils.js'], // bytesToHex / utf8ToBytes
]

/** outRel（如 `hashes/argon2.js`）→ 源文件的绝对路径 */
const srcOf = (outRel) => {
  const [pkg, ...rest] = outRel.split('/')
  return join(NM, pkg, ...rest)
}

/** 归一化 outRel 里的 `..` / `.` 段（Windows 下 join 会给反斜杠，先统一成 `/`） */
function normalizeRel(rel) {
  const parts = []
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

const seen = new Set()
const files = []
let total = 0

function copyOne(outRel) {
  if (seen.has(outRel) || !outRel.endsWith('.js')) return
  seen.add(outRel)

  const srcAbs = srcOf(outRel)
  let text
  try {
    text = readFileSync(srcAbs, 'utf8')
  } catch {
    throw new Error(`缺少依赖文件：${outRel}（期望在 ${srcAbs}）—— 先跑 pnpm install`)
  }

  const destAbs = join(OUT, outRel)
  mkdirSync(dirname(destAbs), { recursive: true })
  writeFileSync(destAbs, text)

  const bytes = Buffer.byteLength(text)
  total += bytes
  files.push({ path: outRel, bytes })

  // 只追相对 import（裸包名 = 内置，如 node:crypto，不复制）
  for (const m of text.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    const depRel = normalizeRel(join(dirname(outRel), spec))
    copyOne(depRel)
  }
}

for (const [pkg, file] of ENTRIES) copyOne(`${pkg}/${file}`)

/* LICENSE 与来源说明（两个包分别留一份，作者不同渠道但同为 MIT） */
for (const pkg of ['ciphers', 'hashes']) {
  const lic = readFileSync(join(NM, pkg, 'LICENSE'), 'utf8')
  writeFileSync(join(OUT, `LICENSE-${pkg}`), lic)
}
const ver = (pkg) => JSON.parse(readFileSync(join(NM, pkg, 'package.json'), 'utf8')).version

files.sort((a, b) => (a.path < b.path ? -1 : 1))
const rows = files.map((f) => `| \`${f.path}\` | ${f.bytes.toLocaleString('en-US')} B |`).join('\n')

writeFileSync(
  join(OUT, 'README.md'),
  `# noble 密码学库（本地副本，勿手改）

> 生成：\`node scripts/vendor-noble.mjs\`（按相对 import 图精确复制，只带用到的模块）
> 来源：[@noble/ciphers](https://github.com/paulmillr/noble-ciphers) v${ver('ciphers')} ·
> [@noble/hashes](https://github.com/paulmillr/noble-hashes) v${ver('hashes')} · 均为 MIT
> 审计状态：noble-ciphers v1.0.0 经 Cure53 审计（范围 "everything"）；
> **noble-hashes 的 argon2 模块不在审计范围内**（见 \`docs/安全插件-方案-2026-10-25.md\` §3）。

## 文件清单（合计 ${total.toLocaleString('en-US')} B）

| 文件 | 大小 |
|---|---|
${rows}

## 重新生成

\`\`\`bash
pnpm install            # 保证 node_modules/@noble/* 存在
node scripts/vendor-noble.mjs
\`\`\`

升级 noble 版本后必须重跑，并在 \`HANDOFF.md\` 记一笔（密码学库换版本 = 值得留痕）。
`,
)

console.log(`✅ public/vendor/noble/：${files.length} 个文件，合计 ${total.toLocaleString('en-US')} B`)
for (const f of files) console.log(`   ${f.path.padEnd(24)} ${String(f.bytes).padStart(7)} B`)
