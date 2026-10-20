/**
 * 笔记独立窗口的 URL / label（rev173.51）。
 *
 * 锁两条：① 不继承主窗口原有 query（否则新窗口会以插件窗口 / 别的模式启动）；
 * ② 不带 vault 时 URL 里不能出现空的 `vault=`（那会被 App 当成"指定了一个空库"）。
 */
import { describe, expect, it } from 'vitest'
import { NOTE_WINDOW_PREFIX, noteWindowLabel, noteWindowUrl } from '../src/lib/note-window'

describe('noteWindowUrl', () => {
  it('带上 note 与 vault，路径按 URL 编码', () => {
    const url = noteWindowUrl('http://localhost:1420/', '文件夹/我的笔记.md', 'C:/vault')
    const u = new URL(url)
    expect(u.searchParams.get('note')).toBe('文件夹/我的笔记.md')
    expect(u.searchParams.get('vault')).toBe('C:/vault')
  })

  it('不继承主窗口原有的 query（插件窗口 / 旧参数都不带过去）', () => {
    const url = noteWindowUrl('http://localhost:1420/?pluginWindow=map-1&x=1', 'a.md', 'C:/v')
    expect(url).not.toContain('pluginWindow')
    expect(url).not.toContain('x=1')
    expect(new URL(url).searchParams.get('note')).toBe('a.md')
  })

  it('vault 为空时不写这一项（写入空值会变成「指定空库」）', () => {
    const url = noteWindowUrl('http://localhost:1420/', 'a.md', null)
    expect(new URL(url).searchParams.has('vault')).toBe(false)
  })

  it('保留 origin 与 pathname（生产环境的 tauri://localhost 走同一套）', () => {
    // 非特殊协议的 origin 是 "null"，所以实现必须靠 URL 对象改 search，不能手工拼 origin
    expect(noteWindowUrl('tauri://localhost/index.html', 'a.md', 'C:/v')).toMatch(
      /^tauri:\/\/localhost\/index\.html\?/,
    )
  })
})

describe('noteWindowLabel', () => {
  it('前缀是 capabilities 里 glob 覆盖的那个', () => {
    expect(NOTE_WINDOW_PREFIX).toBe('note-')
    expect(noteWindowLabel(3)).toBe('note-3')
  })
})
