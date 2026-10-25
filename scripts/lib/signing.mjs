#!/usr/bin/env node
/**
 * 插件签名的 **Node 侧共享实现**（2026-10-25 rev173.143）。
 *
 * 为什么单独抽出来：`sign.mjs`（签一个目录）和 `pack-plugin.mjs`（打包时顺手签）
 * 必须用**同一份**逻辑。格式约定本身与前端 `src/lib/plugin-signing.ts` 逐字一致，
 * 由 `tests/plugin-signing.test.ts` 守着。
 *
 * ⚠️ 改这里 = 所有已有签名失效。改动时同步改前端那份，并跑 vitest。
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const SIGNATURE_FILE = 'signature.json'
export const SIGNATURE_PREFIX = 'zn-plugin-v2'

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * 签名载荷（与前端 `signingPayload()` 逐字一致）。
 * `files` 按路径字典序排序 —— 同一份内容永远得到同一串，不受遍历顺序影响。
 */
export function signingPayload(id, version, entrySha256, files = []) {
  const tail = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}:${f.sha256}`)
    .join('|')
  return `${SIGNATURE_PREFIX}|${id}|${version}|${entrySha256}|${tail}`
}

/** 递归列出目录下的文件（POSIX 相对路径），跳过签名文件与 node_modules */
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === SIGNATURE_FILE) continue
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, base, out)
    else out.push(relative(base, abs).replace(/\\/g, '/'))
  }
  return out
}

/**
 * 收集一个插件目录里**需要进包**的文件（相对路径 → 文本内容）。
 *
 * 规则：目录下所有文件都收，除了 `manifest.json`（它单独作为 `.znp` 的 manifest 字段）
 * 和 `signature.json`（签名是打包时现算的，不从源码目录带）。
 * 二进制文件直接报错 —— 目前没有插件带二进制，`.znp` 是纯文本 JSON。
 */
export function collectPluginFiles(dir) {
  const files = {}
  for (const rel of walk(dir)) {
    if (rel === 'manifest.json') continue
    const abs = join(dir, rel)
    const raw = readFileSync(abs)
    // 粗判二进制：含 NUL 字节
    if (raw.includes(0)) throw new Error(`插件文件是二进制，.znp 不支持：${rel}`)
    files[rel] = raw.toString('utf8')
  }
  return files
}

/**
 * 算签名用的文件摘要：入口 + `manifest.files` 里除入口外的每个文件。
 * 与宿主加载时算的一致（宿主只签 manifest.files 声明的文件，不是整个目录）。
 */
export function digestForSigning(manifest, files) {
  const entrySha = sha256(Buffer.from(files[manifest.entry] ?? '', 'utf8'))
  const extra = []
  for (const rel of manifest.files ?? []) {
    if (rel === manifest.entry) continue
    if (files[rel] === undefined) throw new Error(`manifest.files 声明了 ${rel}，但目录里没有这个文件`)
    extra.push({ path: rel, sha256: sha256(Buffer.from(files[rel], 'utf8')) })
  }
  return { entrySha, files: extra, payload: signingPayload(manifest.id, manifest.version, entrySha, extra) }
}

/** 对「文件集合」签名，返回 signature.json 的内容对象 */
export function signFiles(manifest, files, { keyPath, keyId }) {
  const { payload } = digestForSigning(manifest, files)
  const privateKey = createPrivateKey(readFileSync(keyPath))
  const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey)
  return { signature: { alg: 'ed25519', keyId: keyId ?? manifest.sigKeyId ?? 'default', sig: sig.toString('base64') }, payload }
}

/** 读插件目录的 manifest；不存在直接抛 */
export function readManifest(dir) {
  const p = join(resolve(dir), 'manifest.json')
  if (!existsSync(p)) throw new Error(`找不到 ${p}`)
  return JSON.parse(readFileSync(p, 'utf8'))
}
