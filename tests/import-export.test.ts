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
  embedCommentOf,
  embedSummary,
  findAssetEntry,
  guessCategory,
  imageMimeOf,
  imageRefKind,
  importBasePath,
  importDateStamp,
  normalizeRefPath,
  normalizeRelPath,
  rewriteImageRefs,
  sanitizeDirName,
  scanImageRefs,
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
    // Android 标准目录是**单数** Download（不是 Downloads）—— 手机实测踩到过
    expect(guessCategory('/sdcard/Download/导入样本.md')).toBe('')
    expect(guessCategory('/sdcard/DCIM/a.jpg')).toBe('')
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

/**
 * 导出 Markdown 图片内嵌（rev173.278 · 真人使用测试 #20）。
 *
 * 判据（每条对应一个真实失败模式）：
 *  · 只认 `![]()` —— 内嵌 HTML 白名单不含 img，`<img>` 在 ZeroNote 里根本渲染不出来；
 *  · 尖括号 / title / 百分号转义都要按内核同一口径剥掉，否则读不到原图；
 *  · 已经是 URL（含上一轮导出留下的 `data:`）必须原样保留 —— 导出要幂等；
 *  · 台账比对要抹平斜杠与大小写（`C:\x` 与 `c:/x` 是同一个文件）；
 *  · `<!-- zn-orig: … -->` 里的 `-->` 必须切掉，否则注释提前结束、正文后半段被吞。
 */
describe('scanImageRefs', () => {
  it('认出普通图片引用与区间', () => {
    const md = '前\n![](attachments/a.png)\n后'
    const hits = scanImageRefs(md)
    expect(hits).toHaveLength(1)
    expect(hits[0].alt).toBe('')
    expect(hits[0].target).toBe('attachments/a.png')
    expect(md.slice(hits[0].start, hits[0].end)).toBe('![](attachments/a.png)')
  })

  it('尖括号目标（含空格路径）整段被认出，target 保留尖括号', () => {
    const hits = scanImageRefs('![](<C:/截图 2026/a b.png>)')
    expect(hits[0].target).toBe('<C:/截图 2026/a b.png>')
  })

  it('带 title 也认，target 不含 title', () => {
    const hits = scanImageRefs('![图](a.png "说明")')
    expect(hits[0].target).toBe('a.png')
    expect(hits[0].alt).toBe('图')
  })

  it('普通链接不算图片；多张图按顺序返回', () => {
    const hits = scanImageRefs('[链接](a.md)\n![](1.png)\n![](2.png)')
    expect(hits.map((h) => h.target)).toEqual(['1.png', '2.png'])
  })
})

describe('imageRefKind', () => {
  it('相对路径 / 盘符 / UNC', () => {
    expect(imageRefKind('attachments/a.png', 'windows')).toBe('rel')
    expect(imageRefKind('C:/x/a.png', 'windows')).toBe('abs')
    expect(imageRefKind('C:\\x\\a.png', 'windows')).toBe('abs')
    expect(imageRefKind('\\\\主机\\共享\\a.png', 'windows')).toBe('abs')
  })

  it('Android 的 /storage 是库外绝对路径，桌面上的 /x 是相对库根', () => {
    expect(imageRefKind('/storage/emulated/0/DCIM/a.jpg', 'android')).toBe('abs')
    expect(imageRefKind('/attachments/a.png', 'windows')).toBe('rootrel')
  })

  it('已经是 URL ⇒ remote（导出要幂等，不再套一层 base64）', () => {
    expect(imageRefKind('https://a.com/a.png', 'windows')).toBe('remote')
    expect(imageRefKind('data:image/png;base64,AAA', 'windows')).toBe('remote')
    expect(imageRefKind('blob:http://x/y', 'windows')).toBe('remote')
    expect(imageRefKind('', 'windows')).toBe('empty')
  })

  it('尖括号与百分号转义先剥掉再判', () => {
    expect(imageRefKind('<C:/a b.png>', 'windows')).toBe('abs')
    expect(imageRefKind('C:/a%20b.png', 'windows')).toBe('abs')
  })
})

describe('normalizeRelPath', () => {
  it('消掉 . 与多余斜杠', () => {
    expect(normalizeRelPath('a/./b//c.png')).toBe('a/b/c.png')
    expect(normalizeRelPath('./a.png')).toBe('a.png')
  })

  it('越出库根 ⇒ null（不能读到库外）', () => {
    expect(normalizeRelPath('../x.png')).toBeNull()
    expect(normalizeRelPath('a/../../x.png')).toBeNull()
  })
})

describe('normalizeRefPath', () => {
  it('抹平斜杠、./ 与大小写（Windows 路径不区分大小写）', () => {
    expect(normalizeRefPath('C:\\Users\\AQUA\\a.png')).toBe('c:/users/aqua/a.png')
    expect(normalizeRefPath('./attachments/a.png')).toBe('attachments/a.png')
    expect(normalizeRefPath('<C:/a b.png>')).toBe('c:/a b.png')
  })
})

describe('findAssetEntry', () => {
  const entries = [
    { id: 'sha256:1', original: 'D:/照片/大图.jpg', size: 5, preview: 'attachments/大图-preview.jpg' },
    { id: 'sha256:2', original: 'D:/照片/二.jpg', size: 6, storedInVault: 'attachments/二.webp' },
  ]

  it('按原文件绝对路径命中（斜杠 / 大小写不敏感）', () => {
    expect(findAssetEntry(entries, { abs: 'd:\\照片\\大图.jpg' })?.id).toBe('sha256:1')
  })

  it('按入库副本命中（模式 B 的压缩版 / 模式 A 的预览图）', () => {
    expect(findAssetEntry(entries, { rel: 'attachments/二.webp' })?.id).toBe('sha256:2')
  })

  it('没这条 ⇒ null（不猜）', () => {
    expect(findAssetEntry(entries, { abs: 'D:/别的.jpg' })).toBeNull()
    expect(findAssetEntry([], { rel: 'a.png' })).toBeNull()
  })
})

describe('embedCommentOf', () => {
  it('紧跟图片的一行注释，存原文那条引用', () => {
    expect(embedCommentOf('attachments/a.png')).toBe('<!-- zn-orig: attachments/a.png -->')
  })

  it('引用里出现 --> 要切断，否则注释提前结束', () => {
    expect(embedCommentOf('a-->b.png')).toBe('<!-- zn-orig: a-- >b.png -->')
  })
})

describe('rewriteImageRefs', () => {
  const md = 'A![](1.png)B![](2.png)C'
  const hits = scanImageRefs(md)

  it('null 保留原文（非图片 / 本机没有原文件）', () => {
    expect(rewriteImageRefs(md, hits, [null, null])).toBe(md)
  })

  it('替换只动命中区间', () => {
    expect(rewriteImageRefs(md, hits, ['![](data:x)', null])).toBe('A![](data:x)B![](2.png)C')
  })

  it('没有命中 ⇒ 原样返回', () => {
    expect(rewriteImageRefs('纯文本', [], [])).toBe('纯文本')
  })
})

describe('imageMimeOf', () => {
  it('常见图片扩展名（大小写不敏感）', () => {
    expect(imageMimeOf('a/b.PNG')).toBe('image/png')
    expect(imageMimeOf('a/b.JPG')).toBe('image/jpeg')
    expect(imageMimeOf('a/b.gif')).toBe('image/gif')
    expect(imageMimeOf('a/b.svg')).toBe('image/svg+xml')
  })

  it('非图片 / 没有扩展名 ⇒ 空串（不内嵌）', () => {
    expect(imageMimeOf('a/报告.pdf')).toBe('')
    expect(imageMimeOf('a/视频.mp4')).toBe('')
    expect(imageMimeOf('无扩展名')).toBe('')
  })
})

describe('embedSummary', () => {
  it('有内嵌有保留', () => {
    expect(embedSummary({ embedded: 3, keptCount: 1 })).toBe('3 张图片内嵌 · 1 个附件保留引用')
  })

  it('都没发生 ⇒ 空串', () => {
    expect(embedSummary({ embedded: 0, keptCount: 0 })).toBe('')
  })
})
