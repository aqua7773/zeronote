/**
 * 插入图片的纯逻辑（rev173 · 2026-10-18 用户要求「markdown 插入图片」）。
 *
 * 判据（每条都对应一个真实失败模式）：
 *  · 相对路径按**笔记所在目录**解析 —— 占位图裂掉的第一原因就是「按页面 URL 解析」；
 *  · `/x.png` 按库根解析（Obsidian 同款），`../` 越出库根 ⇒ null（不读库外文件）；
 *  · `http:` / `data:` / `blob:` 原样透传 —— 网络图片不能被当成库内文件；
 *  · 图片语法独占一行 —— 插在标题/正文行中间时补前后换行，否则 Markdown 解析不出来。
 */
import { describe, expect, it } from 'vitest'
import {
  attachmentStem,
  dirnamePosix,
  imageInsertion,
  normalizePosix,
  pathFromNote,
  resolveImageAbsPath,
} from '../src/lib/insert-image'

describe('normalizePosix', () => {
  it('消掉 . 与多余斜杠', () => {
    expect(normalizePosix('./a//b/./c.png')).toBe('a/b/c.png')
  })

  it('反斜杠按正斜杠处理（Windows 上粘贴的路径）', () => {
    expect(normalizePosix('a\\b\\c.png')).toBe('a/b/c.png')
  })

  it('.. 可以回退，但越出根返回 null', () => {
    expect(normalizePosix('a/../b/c.png')).toBe('b/c.png')
    expect(normalizePosix('../x.png')).toBeNull()
    expect(normalizePosix('a/../../x.png')).toBeNull()
  })
})

describe('dirnamePosix', () => {
  it('有目录 / 无目录 / 反斜杠', () => {
    expect(dirnamePosix('sub/a.md')).toBe('sub')
    expect(dirnamePosix('a.md')).toBe('')
    expect(dirnamePosix('sub\\a.md')).toBe('sub')
  })
})

describe('resolveImageAbsPath', () => {
  const vault = 'C:/vault'
  it('相对路径按笔记目录解析', () => {
    expect(resolveImageAbsPath(vault, 'sub/a.md', 'image-1.png')).toBe('C:/vault/sub/image-1.png')
  })

  it('笔记在库根时按库根解析', () => {
    expect(resolveImageAbsPath(vault, 'a.md', 'image-1.png')).toBe('C:/vault/image-1.png')
  })

  it('以 / 开头按库根解析', () => {
    expect(resolveImageAbsPath(vault, 'sub/a.md', '/assets/x.png')).toBe('C:/vault/assets/x.png')
  })

  it('.. 可以指向库内上级，越出库根返回 null', () => {
    expect(resolveImageAbsPath(vault, 'sub/a.md', '../x.png')).toBe('C:/vault/x.png')
    expect(resolveImageAbsPath(vault, 'a.md', '../x.png')).toBeNull()
  })

  it('网络 / data / blob URL 原样透传（返回 null = 不按库内路径解析）', () => {
    expect(resolveImageAbsPath(vault, 'a.md', 'https://x.com/a.png')).toBeNull()
    expect(resolveImageAbsPath(vault, 'a.md', 'data:image/png;base64,AAA')).toBeNull()
    expect(resolveImageAbsPath(vault, 'a.md', 'blob:http://localhost/abc')).toBeNull()
  })

  it('Windows 绝对路径原样返回（仍可转 asset URL）', () => {
    expect(resolveImageAbsPath(vault, 'a.md', 'D:\\pics\\a.png')).toBe('D:/pics/a.png')
    expect(resolveImageAbsPath(vault, 'a.md', '\\\\server\\share\\a.png')).toBe(
      '//server/share/a.png',
    )
  })

  it('库未就绪 / 空 src 返回 null', () => {
    expect(resolveImageAbsPath(null, 'a.md', 'x.png')).toBeNull()
    expect(resolveImageAbsPath('', 'a.md', 'x.png')).toBeNull()
    expect(resolveImageAbsPath(vault, 'a.md', '   ')).toBeNull()
  })

  it('库路径尾部斜杠不会拼出双斜杠', () => {
    expect(resolveImageAbsPath('C:\\vault\\', 'a.md', 'x.png')).toBe('C:/vault/x.png')
  })
})

describe('pathFromNote', () => {
  it('与笔记同目录 ⇒ 只写文件名', () => {
    expect(pathFromNote('sub/a.md', 'sub/image-1.png')).toBe('image-1.png')
    expect(pathFromNote('a.md', 'image-1.png')).toBe('image-1.png')
  })

  it('图片在子目录 ⇒ 保留相对路径', () => {
    expect(pathFromNote('a.md', 'assets/image-1.png')).toBe('assets/image-1.png')
    expect(pathFromNote('sub/a.md', 'assets/image-1.png')).toBe('assets/image-1.png')
  })
})

describe('attachmentStem', () => {
  it('固定格式 image-YYYYMMDD-HHMMSS（带前导零）', () => {
    expect(attachmentStem(new Date(2026, 9, 18, 20, 30, 5))).toBe('image-20261018-203005')
  })
})

describe('imageInsertion', () => {
  const rel = 'image-1.png'

  it('空文档 ⇒ 只插语法本身，光标落在语法末尾', () => {
    const insert = '![](image-1.png)'
    expect(imageInsertion('', 0, 0, rel)).toEqual({
      from: 0,
      to: 0,
      insert,
      anchor: insert.length,
    })
  })

  it('行首且后面有换行 ⇒ 不补换行', () => {
    const doc = 'abc\n'
    expect(imageInsertion(doc, 4, 4, rel)).toEqual({
      from: 4,
      to: 4,
      insert: '![](image-1.png)',
      anchor: 4 + '![](image-1.png)'.length,
    })
  })

  it('行中插入 ⇒ 前后各补一个换行（图片语法独占一行）', () => {
    const doc = 'hello world'
    const got = imageInsertion(doc, 5, 5, rel)
    expect(got.insert).toBe('\n![](image-1.png)\n')
  })

  it('有选区 ⇒ 替换选区，且只看选区两端邻居', () => {
    const doc = 'aaXYbb'
    const got = imageInsertion(doc, 2, 4, rel)
    expect(got.from).toBe(2)
    expect(got.to).toBe(4)
    expect(got.insert).toBe('\n![](image-1.png)\n')
  })

  it('alt 文本会写进语法', () => {
    expect(imageInsertion('', 0, 0, rel, '示意图').insert).toBe('![示意图](image-1.png)')
  })
})
