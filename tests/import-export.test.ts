/**
 * 导入落点与元数据（rev173.227 · 需求 §12）。
 *
 * 判据（每条对应一个真实失败模式）：
 *  · 统一落 `日期导入/<YYYY-MM-DD>/…` —— 否则导入的东西散在库根、和手写笔记混在一起；
 *  · 同一天多次导入必须进**同一个日期目录**（用本地日期，不用 UTC —— 跨零点会分家）；
 *  · 分类只取**直接父目录**，桌面 / 下载 / 缓存这类通用目录不算（否则分类全叫 Desktop）；
 *  · 分类名要过 Windows 非法字符清洗（印象笔记导出目录里常见 `:` 与 `?`）；
 *  · frontmatter 已有同名键不覆盖（md 导入自带 `created:` 时不能被导入时刻顶掉）。
 */
import { describe, expect, it } from 'vitest'
import {
  IMPORT_ROOT,
  guessCategory,
  importBasePath,
  importDateStamp,
  sanitizeDirName,
  withImportFrontmatter,
} from '../examples/import-export/index.js'

describe('sanitizeDirName', () => {
  it('去掉 Windows 非法字符', () => {
    expect(sanitizeDirName('工作:周报?v2')).toBe('工作周报v2')
    expect(sanitizeDirName('a/b\\c|d*e"f<g>h')).toBe('abcdefgh')
  })

  it('压空白、去首尾点与空格、限 40 字', () => {
    expect(sanitizeDirName('  工  作  ')).toBe('工 作')
    expect(sanitizeDirName('...隐藏...')).toBe('隐藏')
    expect(sanitizeDirName('x'.repeat(60)).length).toBe(40)
  })

  it('空值 / 控制字符 → 空串', () => {
    expect(sanitizeDirName('')).toBe('')
    expect(sanitizeDirName(null)).toBe('')
    expect(sanitizeDirName('\u0000\u0007')).toBe('')
  })
})

describe('guessCategory', () => {
  it('取直接父目录名', () => {
    expect(guessCategory('C:/导出/印象笔记/工作/周报.md')).toBe('工作')
    expect(guessCategory('C:\\导出\\印象笔记\\生活\\日记.docx')).toBe('生活')
  })

  it('通用目录不猜（桌面 / 下载 / 缓存 / 盘符根）', () => {
    expect(guessCategory('C:/Users/AQUA/Desktop/周报.docx')).toBe('')
    expect(guessCategory('C:/Users/AQUA/Downloads/a.md')).toBe('')
    expect(guessCategory('/data/user/0/app/cache/截图.png')).toBe('')
    expect(guessCategory('C:/周报.md')).toBe('')
  })

  it('没有目录 / 空值 → 空串', () => {
    expect(guessCategory('周报.md')).toBe('')
    expect(guessCategory('')).toBe('')
    expect(guessCategory(null)).toBe('')
  })

  it('分类名同样过清洗', () => {
    expect(guessCategory('C:/x/项目:Alpha/a.md')).toBe('项目Alpha')
  })
})

describe('importDateStamp', () => {
  it('本地日期，月/日补零', () => {
    expect(importDateStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(importDateStamp(new Date(2026, 9, 28))).toBe('2026-10-28')
  })
})

describe('importBasePath', () => {
  const day = new Date(2026, 9, 28)

  it('无分类：日期导入/<日期>/<文件名>', () => {
    expect(importBasePath({ date: day, stem: '周报' })).toBe(`${IMPORT_ROOT}/2026-10-28/周报`)
  })

  it('有分类：多一层原分类', () => {
    expect(importBasePath({ date: day, stem: '周报', category: '工作' })).toBe(
      `${IMPORT_ROOT}/2026-10-28/工作/周报`,
    )
  })

  it('分类为空串 / 脏字符 → 不建那一层或清洗', () => {
    expect(importBasePath({ date: day, stem: 'a', category: '  ' })).toBe(`${IMPORT_ROOT}/2026-10-28/a`)
    expect(importBasePath({ date: day, stem: 'a', category: '工作:2026' })).toBe(
      `${IMPORT_ROOT}/2026-10-28/工作2026/a`,
    )
  })

  it('文件名空 → imported', () => {
    expect(importBasePath({ date: day, stem: '' })).toBe(`${IMPORT_ROOT}/2026-10-28/imported`)
  })
})

describe('withImportFrontmatter', () => {
  const at = new Date('2026-10-28T03:10:00.000Z')

  it('没有 frontmatter → 顶部新建一块', () => {
    expect(withImportFrontmatter('# 标题\n\n正文', { source: '周报.docx', created: at })).toBe(
      `---\ncreated: ${at.toISOString()}\nsource: 周报.docx\n---\n\n# 标题\n\n正文`,
    )
  })

  it('已有 frontmatter → 就地追加，不丢原键', () => {
    const md = '---\ntags: [工作]\n---\n\n正文'
    const out = withImportFrontmatter(md, { source: 'a.md', created: at })
    expect(out.startsWith('---\ntags: [工作]\n')).toBe(true)
    expect(out).toContain(`created: ${at.toISOString()}`)
    expect(out).toContain('source: a.md')
    expect(out.endsWith('正文')).toBe(true)
  })

  it('已有同名键不覆盖', () => {
    const md = '---\ncreated: 2020-01-01\nsource: 原文件\n---\n\n正文'
    expect(withImportFrontmatter(md, { source: '新.md', created: at })).toBe(md)
  })

  it('source 里的换行压成空格（frontmatter 不能多行）', () => {
    const out = withImportFrontmatter('x', { source: 'a\nb.md', created: at })
    expect(out).toContain('source: a b.md')
  })

  it('没给 source 就只写 created', () => {
    expect(withImportFrontmatter('x', { created: at })).toBe(
      `---\ncreated: ${at.toISOString()}\n---\n\nx`,
    )
  })
})
