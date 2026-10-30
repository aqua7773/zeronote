#!/usr/bin/env node
/**
 * 本地 WebDAV 桩（测试用，**不入库**）—— 支持 `sync` 插件用到的全部方法。
 *
 * 用途：桌面与手机双端同步测试，不需要真实坚果云。
 * 手机通过 `adb reverse tcp:8899 tcp:8899` 访问 `http://127.0.0.1:8899/dav/`。
 *
 * 支持：PROPFIND(Depth 1) · GET(含 If-None-Match → 304) · PUT(含 If-Match → 412) ·
 *       MKCOL · DELETE · HEAD。Basic 认证接受任意账号密码（桩，不校验）。
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname, posix, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'

const PORT = Number(process.env.ZN_DAV_PORT || 8899)
const ROOT = resolve(process.env.ZN_DAV_ROOT || '_tmp-dav-root/dav')
mkdirSync(ROOT, { recursive: true })

const etagOf = (buf) => `"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`

/** URL 路径 → 磁盘路径（防穿越）；返回 null 表示非法 */
function resolveDisk(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0])
  rel = rel.replace(/^\/dav\/?/, '')
  rel = rel.replace(/^\/+/, '')
  const full = resolve(ROOT, rel)
  // 穿越判定要用 relative（Windows 上 join 出的是反斜杠，直接 startsWith 会误判成非法）
  const r = relative(ROOT, full)
  if (r.startsWith('..') || isAbsolute(r)) return null
  return { full, rel }
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function propfindBody(rel, isDir, size, etag) {
  const href = `/dav/${rel.split('/').map(encodeURIComponent).join('/')}${isDir ? '/' : ''}`
  return (
    `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>` +
    (isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>') +
    (etag ? `<d:getetag>${xmlEscape(etag)}</d:getetag>` : '') +
    `<d:getcontentlength>${size}</d:getcontentlength>` +
    `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  )
}

const server = createServer((req, res) => {
  const method = (req.method || 'GET').toUpperCase()
  const target = resolveDisk(req.url || '/')
  if (!target) {
    res.writeHead(400).end('bad path')
    return
  }
  const { full, rel } = target
  console.log(`${new Date().toISOString().slice(11, 19)} ${method} ${req.url}`)

  if (method === 'PROPFIND') {
    if (!existsSync(full)) {
      res.writeHead(404).end('not found')
      return
    }
    const st = statSync(full)
    const parts = [propfindBody(rel, st.isDirectory(), st.isDirectory() ? 0 : st.size, st.isDirectory() ? null : etagOf(readFileSync(full)))]
    if (st.isDirectory()) {
      for (const name of readdirSync(full)) {
        const childRel = posix.join(rel, name)
        const childFull = join(full, name)
        const cst = statSync(childFull)
        parts.push(
          propfindBody(
            childRel,
            cst.isDirectory(),
            cst.isDirectory() ? 0 : cst.size,
            cst.isDirectory() ? null : etagOf(readFileSync(childFull)),
          ),
        )
      }
    }
    const body = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${parts.join('')}</d:multistatus>`
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
    res.end(body)
    return
  }

  if (method === 'GET' || method === 'HEAD') {
    if (!existsSync(full) || statSync(full).isDirectory()) {
      res.writeHead(404).end()
      return
    }
    const buf = readFileSync(full)
    const etag = etagOf(buf)
    if (method === 'HEAD') {
      res.writeHead(200, { etag, 'Content-Length': String(buf.length) }).end()
      return
    }
    const inm = req.headers['if-none-match']
    if (inm && inm === etag) {
      res.writeHead(304, { etag }).end()
      return
    }
    res.writeHead(200, { etag, 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Length': String(buf.length) })
    res.end(buf)
    return
  }

  if (method === 'PUT') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const buf = Buffer.concat(chunks)
      const ifMatch = req.headers['if-match']
      if (ifMatch) {
        if (!existsSync(full)) {
          res.writeHead(412).end('precondition')
          return
        }
        const cur = etagOf(readFileSync(full))
        if (ifMatch !== cur) {
          res.writeHead(412).end('precondition')
          return
        }
      }
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, buf)
      res.writeHead(existsSync(full) ? 204 : 201, { etag: etagOf(buf) }).end()
    })
    return
  }

  if (method === 'MKCOL') {
    if (existsSync(full)) {
      res.writeHead(405).end('exists')
      return
    }
    mkdirSync(full, { recursive: true })
    res.writeHead(201).end()
    return
  }

  if (method === 'DELETE') {
    if (!existsSync(full)) {
      res.writeHead(404).end()
      return
    }
    rmSync(full, { recursive: true, force: true })
    res.writeHead(204).end()
    return
  }

  res.writeHead(405).end('unsupported')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DAV stub on http://127.0.0.1:${PORT}/dav/  (root=${ROOT})`)
})
