// @vitest-environment happy-dom
/**
 * 本地媒体 URL（rev173.240 · Android 大视频 Range）。
 *
 * 为什么值得单测：这个字符串直接决定 `<video>` 能不能加载 ——
 *  · 服务没起时必须返回 `null`（调用方回落 asset 协议，桌面行为不能变）；
 *  · 起了就必须**完全**是服务能解析的形态：`/m/<token>/<percent-encoded 绝对路径>`；
 *  · 反斜杠不统一 ⇒ Rust 侧当文件名的一部分 ⇒ 404。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mediaHttpUrl, mediaServerInfo, mediaServerUrl, setMediaServer } from '../src/kernel/media-url'

const INFO = { port: 34567, token: 'abc123' }

beforeEach(() => {
  setMediaServer(null)
})

describe('medialUrl 的开关', () => {
  it('没设服务 ⇒ null（桌面 / 启动早期）', () => {
    expect(mediaServerUrl('C:/v/a.mp4')).toBeNull()
    expect(mediaHttpUrl('C:/v/a.mp4')).toBeNull()
    expect(mediaServerInfo()).toBeNull()
  })

  it('setMediaServer(null / 非法值) ⇒ 停用', () => {
    setMediaServer(INFO)
    expect(mediaServerUrl('C:/v/a.mp4')).not.toBeNull()
    setMediaServer({ port: 0, token: 'x' })
    expect(mediaServerUrl('C:/v/a.mp4')).toBeNull()
    setMediaServer({ port: 1234, token: '' })
    expect(mediaServerUrl('C:/v/a.mp4')).toBeNull()
    setMediaServer(null)
    expect(mediaServerUrl('C:/v/a.mp4')).toBeNull()
  })
})

describe('URL 形态', () => {
  it('标准形态：127.0.0.1 + /m/<token>/<编码后的绝对路径>', () => {
    setMediaServer(INFO)
    const url = mediaServerUrl('C:/vault/clip.mp4')
    expect(url).toBe(`http://127.0.0.1:34567/m/abc123/${encodeURIComponent('C:/vault/clip.mp4')}`)
    // 端口与 token 都得在，且路径要编码过（斜杠变成 %2F）
    expect(url).toContain('127.0.0.1:34567')
    expect(url).toContain('%2F')
  })

  it('反斜杠路径先统一成 /（否则 Rust 侧当文件名的一部分）', () => {
    setMediaServer(INFO)
    const a = mediaServerUrl('C:\\vault\\clip.mp4')
    const b = mediaServerUrl('C:/vault/clip.mp4')
    expect(a).toBe(b)
    expect(a).not.toContain('\\')
  })

  it('中文 / 空格路径整体编码（Rust 侧 percent_decode 还原）', () => {
    setMediaServer(INFO)
    const url = mediaServerUrl('C:/我的 库/音乐 1.mp3')
    expect(url).toContain(encodeURIComponent('我的'))
    expect(url).toContain('%20')
    expect(url).not.toContain(' ')
  })

  it('空路径 / 空串 ⇒ null', () => {
    setMediaServer(INFO)
    expect(mediaServerUrl('')).toBeNull()
    expect(mediaServerUrl('   '.trim())).toBeNull()
  })

  it('mediaServerInfo 返回副本，改它不影响内部状态', () => {
    setMediaServer(INFO)
    const got = mediaServerInfo()
    expect(got).toEqual(INFO)
    got!.port = 1
    expect(mediaServerInfo()!.port).toBe(34567)
  })
})
