#!/usr/bin/env node
/**
 * LocalSend 发送器 —— 把文件从这台电脑发给同一局域网里的设备（手机 / 平板）。
 *
 * 为什么走 HTTP API 而不是 GUI：零点击、可脚本化、可复现（GUI 里还得点"发送 → 选设备 → 选文件"）。
 *
 * ⚠️ **接收端一定会弹窗要求确认**，脚本**不能**也不该绕过 —— 这是 LocalSend 的安全设计。
 *    运行后请看着手机点「接受」。两个前提：**手机已解锁**、**LocalSend 在手机前台**
 *    （Android 会拦下后台 App 的这类请求，锁屏时弹窗不出现 ⇒ 请求会一直挂到超时）。
 *
 * 用法：
 *   node tools/localsend-send.mjs <目标IP> <文件…>
 *   node tools/localsend-send.mjs 192.168.1.19 _tmp-send/outline-map-plugin.zip
 */
import { createReadStream, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { Readable } from 'node:stream'

const PORT = 53317
const [target, ...files] = process.argv.slice(2)
if (!target || files.length === 0) {
  console.error('用法：node tools/localsend-send.mjs <目标IP> <文件…>')
  process.exit(1)
}

const bytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`)

/** 问本机 LocalSend 要自己的设备信息 —— 发送方信息要原样报给接收方 */
async function localInfo() {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/localsend/v2/info`, { signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error(`本机 LocalSend 没响应（HTTP ${r.status}）—— 它开着吗？`)
  return r.json()
}

const MIME = {
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.md': 'text/markdown',
}

const info = await localInfo()
console.log(`本机：${info.alias}（${String(info.fingerprint).slice(0, 8)}…）→ 目标 ${target}:${PORT}`)

const list = files.map((f, i) => {
  const p = resolve(f)
  const st = statSync(p)
  const ext = p.slice(p.lastIndexOf('.'))
  return {
    id: `f${i}`,
    path: p,
    fileName: basename(p),
    size: st.size,
    fileType: MIME[ext] ?? 'application/octet-stream',
  }
})
for (const f of list) console.log(`  · ${f.fileName}  ${bytes(f.size)}`)

/* ① 请求发送 —— 这一步会**在接收端弹窗**，所以超时给足（人得点一下） */
console.log('\n等待接收端确认（去手机上点「接受」）…')
const prep = await fetch(`http://${target}:${PORT}/api/localsend/v2/prepare-upload`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    info: {
      alias: info.alias,
      version: info.version,
      deviceModel: info.deviceModel,
      deviceType: info.deviceType,
      fingerprint: info.fingerprint,
      download: false,
    },
    files: Object.fromEntries(
      list.map((f) => [f.id, { id: f.id, fileName: f.fileName, size: f.size, fileType: f.fileType }]),
    ),
  }),
  signal: AbortSignal.timeout(180_000),
})
if (prep.status === 401 || prep.status === 403) {
  throw new Error('接收端拒绝/未确认这次传输（手机锁屏、App 不在前台、或点了拒绝）')
}
if (!prep.ok) throw new Error(`prepare-upload 失败：HTTP ${prep.status} ${await prep.text().catch(() => '')}`)
const session = await prep.json()
console.log(`已接受，sessionId=${session.sessionId}`)

/* ② 逐个上传（**流式**，几百 MB 的文件也不会把内存吃满） */
let failed = 0
for (const f of list) {
  const token = session.files?.[f.id]
  if (!token) {
    failed++
    console.log(`  ✗ ${f.fileName}：接收端没给 token（被跳过）`)
    continue
  }
  const url =
    `http://${target}:${PORT}/api/localsend/v2/upload` +
    `?sessionId=${encodeURIComponent(session.sessionId)}&fileId=${encodeURIComponent(f.id)}&token=${encodeURIComponent(token)}`
  const t0 = Date.now()
  const up = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(f.size) },
    body: Readable.toWeb(createReadStream(f.path)),
    duplex: 'half',
    signal: AbortSignal.timeout(600_000),
  })
  const sec = (Date.now() - t0) / 1000
  if (!up.ok) failed++
  console.log(
    `  ${up.ok ? '✓' : '✗'} ${f.fileName}  ${sec.toFixed(1)}s  ${sec > 0 ? bytes(f.size / sec) + '/s' : '—'}  (HTTP ${up.status})`,
  )
}

console.log(failed ? `\n完成，但 ${failed} 个文件失败。` : '\n全部发送完成。')
process.exitCode = failed ? 1 : 0
