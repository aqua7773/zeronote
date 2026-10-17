import { describe, expect, it } from 'vitest'
import {
  baseName,
  DOC_RE,
  MD_RE,
  relPathIn,
  SAF_READABLE_RE,
  samePath,
  splitPath,
  toLocalPath,
  vaultKey,
} from '../src/lib/app-paths'

describe('vaultKey', () => {
  it('统一分隔符 / 去尾斜杠 / 忽略大小写', () => {
    expect(vaultKey('C:\\A\\B\\')).toBe('c:/a/b')
    expect(vaultKey('c:/a/b')).toBe(vaultKey('C:\\a\\b\\'))
  })
})

describe('baseName', () => {
  it('取最后一段（两种分隔符、尾斜杠）', () => {
    expect(baseName('C:\\Users\\me\\Notes\\')).toBe('Notes')
    expect(baseName('/storage/emulated/0/ZeroNote')).toBe('ZeroNote')
  })

  it('没有分隔符时返回自身', () => {
    expect(baseName('Notes')).toBe('Notes')
  })

  it('空串返回空串', () => {
    expect(baseName('')).toBe('')
  })
})

describe('toLocalPath', () => {
  it('file:// 前缀 + 盘符前斜杠被去掉', () => {
    expect(toLocalPath('file:///C:/a/b.md')).toBe('C:/a/b.md')
  })

  it('百分号编码会被解开', () => {
    expect(toLocalPath('file:///home/a%20b.md')).toBe('/home/a b.md')
  })

  it('非 file scheme 原样返回（content://）', () => {
    expect(toLocalPath('content://com.android/x')).toBe('content://com.android/x')
  })

  it('两端空白被 trim', () => {
    expect(toLocalPath('  file:///C:/a.md  ')).toBe('C:/a.md')
  })
})

describe('splitPath', () => {
  it('Windows 路径拆成 dir + name', () => {
    expect(splitPath('C:\\a\\b.md')).toEqual({ dir: 'C:\\a', name: 'b.md' })
  })

  it('POSIX 路径同样拆', () => {
    expect(splitPath('/a/b/c.md')).toEqual({ dir: '/a/b', name: 'c.md' })
  })

  it('没有分隔符时 dir 为空', () => {
    expect(splitPath('c.md')).toEqual({ dir: '', name: 'c.md' })
  })
})

describe('samePath', () => {
  it('斜杠方向 / 尾斜杠 / 大小写都不敏感', () => {
    expect(samePath('C:\\A\\b', 'c:/a/b/')).toBe(true)
    expect(samePath('/a/b', '/a/c')).toBe(false)
  })
})

describe('relPathIn', () => {
  it('库内文件返回相对路径（/ 分隔）', () => {
    expect(relPathIn('C:\\v', 'C:\\v\\n.md')).toBe('n.md')
    expect(relPathIn('C:\\v', 'C:\\v\\sub\\n.md')).toBe('sub/n.md')
  })

  it('路径就是库本身 ⇒ null', () => {
    expect(relPathIn('C:\\v', 'C:\\v')).toBeNull()
  })

  it('不在库内 ⇒ null（含前缀相同但不是子路径）', () => {
    expect(relPathIn('C:\\v', 'C:\\vv\\n.md')).toBeNull()
    expect(relPathIn('C:\\v', '/other/n.md')).toBeNull()
  })

  it('大小写不敏感', () => {
    expect(relPathIn('C:\\V', 'c:/v/N.md')).toBe('N.md')
  })

  it('空库路径 ⇒ null', () => {
    expect(relPathIn('', 'C:\\v\\n.md')).toBeNull()
  })
})

describe('扩展名名单', () => {
  it('MD_RE 只认 md / markdown', () => {
    expect(MD_RE.test('a.md')).toBe(true)
    expect(MD_RE.test('a.MARKDOWN')).toBe(true)
    expect(MD_RE.test('a.pdf')).toBe(false)
    expect(MD_RE.test('a.txt')).toBe(false)
  })

  it('DOC_RE 认只读文档，但不含 md', () => {
    expect(DOC_RE.test('a.pdf')).toBe(true)
    expect(DOC_RE.test('a.epub')).toBe(true)
    expect(DOC_RE.test('a.md')).toBe(false)
  })

  it('SAF_READABLE_RE 比 DOC_RE 多 md / markdown', () => {
    expect(SAF_READABLE_RE.test('a.md')).toBe(true)
    expect(SAF_READABLE_RE.test('a.pdf')).toBe(true)
    expect(SAF_READABLE_RE.test('a.png')).toBe(false)
  })
})
