/**
 * 粘贴图片的纯逻辑（rev173.46 · 2026-10-20 用户要求「截图后 Ctrl+V 直接进正文」）。
 *
 * 判据（每条都对应一个真实失败模式）：
 *  · 剪贴板里**没有图片必须放行默认粘贴** —— 否则从网页 / Excel 复制的文字被吞；
 *  · MIME 优先、文件名兜底、都认不出按 png —— 截图的事实标准；
 *  · base64 必须**分块**转换 —— 大图一次性展开会爆栈（网页截图动辄 1–3 MB）。
 */
import { describe, expect, it } from 'vitest'
import { MAX_PASTE_IMAGE_BYTES, bytesToBase64, pasteImageExt, pickPastedImage } from '../src/lib/paste-image'

/** 造一个够用的 FileList 假件（只用到 length + 下标） */
function fakeFiles(items: Array<{ type: string; name?: string }>): FileList {
  const list = { ...items, length: items.length }
  return list as unknown as FileList
}

describe('pickPastedImage', () => {
  it('没有 files / 空表 ⇒ null（调用方必须放行默认粘贴）', () => {
    expect(pickPastedImage(null)).toBeNull()
    expect(pickPastedImage(undefined)).toBeNull()
    expect(pickPastedImage(fakeFiles([]))).toBeNull()
  })

  it('只有文字（从网页 / Excel 复制）⇒ null，绝不接管', () => {
    expect(
      pickPastedImage(fakeFiles([{ type: 'text/plain', name: '' }, { type: 'text/html' }])),
    ).toBeNull()
  })

  it('挑出第一张图片，跳过排在它前面的非图片', () => {
    const picked = pickPastedImage(
      fakeFiles([{ type: 'text/plain' }, { type: 'image/png', name: 'image.png' }]),
    )
    expect(picked?.type).toBe('image/png')
  })

  it('MIME 大写也能认（image/PNG）', () => {
    expect(pickPastedImage(fakeFiles([{ type: 'image/PNG' }]))?.type).toBe('image/PNG')
  })
})

describe('pasteImageExt', () => {
  it('MIME 优先', () => {
    expect(pasteImageExt({ type: 'image/png' })).toBe('png')
    expect(pasteImageExt({ type: 'image/jpeg' })).toBe('jpg')
    expect(pasteImageExt({ type: 'image/svg+xml' })).toBe('svg')
    expect(pasteImageExt({ type: 'image/webp' })).toBe('webp')
  })

  it('MIME 认不出时看文件名后缀（大小写不敏感）', () => {
    expect(pasteImageExt({ type: '', name: 'shot.PNG' })).toBe('png')
    expect(pasteImageExt({ type: 'application/octet-stream', name: 'a.bmp' })).toBe('bmp')
  })

  it('都认不出 ⇒ png（截图事实标准）；非图片后缀不被带到落盘命令', () => {
    expect(pasteImageExt({ type: '', name: 'noext' })).toBe('png')
    expect(pasteImageExt({ type: '', name: 'evil.exe' })).toBe('png')
    expect(pasteImageExt({ type: '', name: 'x.png\\..\\y' })).toBe('png')
  })
})

describe('bytesToBase64', () => {
  it('与标准 base64 一致', () => {
    expect(bytesToBase64(new Uint8Array([0x50, 0x4e, 0x47, 0x31]))).toBe('UE5HMQ==')
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
  })

  it('1 MB 级数据不抛错（分块，不爆栈），长度符合 base64 公式', () => {
    const n = MAX_PASTE_IMAGE_BYTES / 10
    const bytes = new Uint8Array(n).fill(0xab)
    const out = bytesToBase64(bytes)
    expect(out.length).toBe(Math.ceil(n / 3) * 4)
    expect(out.startsWith('q6ur')).toBe(true)
  })
})
