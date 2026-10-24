/**
 * 二进制 ↔ base64 的编解码（rev173.106）。
 *
 * 为什么单独一个文件：内核里**三处**都要它 —— `net`（请求 / 响应体）、
 * `fs.readBytes/writeBytes`（附件）、`host.saveFile`（导出）。
 * 各自抄一份的下场是分块大小不一致、某一份在大文件上爆栈。
 *
 * 为什么用 base64 过桥而不是 `Vec<u8>`：Tauri 会把 `Uint8Array` / `Vec<u8>`
 * 序列化成 JSON **数字数组**，1 MB 文件就变成上百万元素（消息体积 ×8）。
 */

/** `Uint8Array` → base64。**分块**：一次性 `String.fromCharCode(...bytes)` 在大文件上爆栈。 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** base64 → `Uint8Array` */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
