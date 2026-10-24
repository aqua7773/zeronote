/**
 * net 原语的前端实现 —— 请求交给内核 Rust 侧（`reqwest`），**不受 CORS 约束**。
 *
 * 为什么不让插件自己 `fetch`：WebDAV 的 `PROPFIND` / `PUT` 必然触发 CORS preflight，
 * 服务器不回 CORS 头时前端只能看到 `TypeError: Failed to fetch`，
 * 分不清「CORS 被拒 / 断网 / 401」。依据 `docs/同步插件-调研与方案-2026-10-24.md` §3。
 *
 * 二进制走 base64 过桥（与 `host.saveFile` / `fs.writeBytes` 同一条约定）：
 * 把 `Uint8Array` 直接当 IPC 参数会被序列化成 JSON 数字数组，1 MB 就上百万个元素。
 */
import { invoke } from '@tauri-apps/api/core'
import type { NetApi, NetHeaders, NetRequestSpec, NetResponse } from './contract'
import { base64ToBytes, bytesToBase64 } from './base64-codec'

/** Rust 侧的返回形状（字段名与本模块的 `NetResponse` 刻意不同：一个是线上格式，一个是 API） */
type RawNetResponse = {
  status: number
  headers: NetHeaders
  body_b64: string
}

export function createNetApi(): NetApi {
  return {
    async fetch(spec: NetRequestSpec): Promise<NetResponse> {
      let bodyB64: string | null = null
      if (typeof spec.body === 'string') {
        bodyB64 = bytesToBase64(new TextEncoder().encode(spec.body))
      } else if (spec.body instanceof Uint8Array) {
        bodyB64 = bytesToBase64(spec.body)
      }

      const raw = await invoke<RawNetResponse>('net_request', {
        req: {
          url: spec.url,
          method: spec.method ?? null,
          headers: spec.headers ?? null,
          bodyB64,
          timeoutMs: spec.timeoutMs ?? null,
        },
      })

      /**
       * 解码**懒执行**：一次请求可能只要 `status`（HEAD / PROPFIND 的 207 才看 body），
       * 没必要为一个 429 解析十几 KB 的 HTML 错误页。
       */
      let cached: Uint8Array | null = null
      const bytes = (): Uint8Array => (cached ??= base64ToBytes(raw.body_b64))
      return {
        status: raw.status,
        headers: raw.headers ?? {},
        text: () => new TextDecoder().decode(bytes()),
        bytes,
      }
    },
  }
}
