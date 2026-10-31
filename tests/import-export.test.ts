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
  EXPORT_BUTTONS,
  IMPORT_ROOT,
  NOTE_PICK_LIMIT,
  buildHomeView,
  buildPickFormatView,
  buildPickNoteView,
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
  shareFileName,
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

/**
 * 面板三态（rev173.310 · 真人测试4 #1/#2）。
 *
 * 判据（每条对应一次真实失败模式）：
 *  · 首页只有「导出笔记…」「分享笔记…」两个入口 —— 不能再有「导出当前笔记」这类
 *    依赖 `doc.active()` 的按钮：`main` 面板占满主区时编辑器已卸载，那按钮永远是空的；
 *  · 选笔记列表的 key 必须是**完整库内路径**（宿主的 `list.onClick` 回传 key）；
 *  · 列表上限 200 行 + 提示「只显示前 200 篇」，否则几百篇会把 DOM 撑爆；
 *  · 筛选对**标题与路径**都生效（手机上路径是唯一可靠线索）；
 *  · 选格式：分享第一项必须是 Markdown 文件（用户点名的格式），且每个按钮 payload 都带 path
 *    —— 这是「不再回落 doc.active()」的硬保证。
 */
describe('面板：首页', () => {
  const view = buildHomeView() as any
  /** 递归收集（按钮是 stack 直接子节点，但别把嵌套写死进测试） */
  const collect = (node: any, type: string): any[] => {
    const out: any[] = []
    if (!node || typeof node !== 'object') return out
    if (node.type === type) out.push(node)
    for (const c of Array.isArray(node.children) ? node.children : []) out.push(...collect(c, type))
    return out
  }
  const buttons = collect(view, 'button')
  const entries = buttons.filter((n: any) => n.payload && n.payload.mode)

  it('两个入口：导出 / 分享', () => {
    expect(entries.map((n: any) => n.payload.mode)).toEqual(['export', 'share'])
    expect(entries.map((n: any) => n.label)).toEqual(['导出笔记…', '分享笔记…'])
  })

  it('三个按钮竖排等宽：都是 stack 的直接子节点，没有任何 row 包着', () => {
    const direct = view.children.filter((n: any) => n.type === 'button')
    expect(direct.map((n: any) => n.label)).toEqual(['导出笔记…', '分享笔记…', '导入文件…'])
    expect(collect(view, 'row')).toHaveLength(0)
  })

  it('不再有「导出当前笔记」这种前提（面板运行时编辑器已卸载）', () => {
    const labels = buttons.map((n: any) => String(n.label ?? ''))
    expect(labels.some((l: string) => l.includes('当前笔记'))).toBe(false)
    expect(labels).toContain('导入文件…')
  })
})

describe('面板：选笔记', () => {
  const notes = [
    { path: '工作/周报.md', dir: '工作', title: '周报' },
    { path: '日记/2026-10-31.md', dir: '日记', title: '十月最后一天' },
    { path: '收件箱/untitled.md', dir: '', title: '没有目录的一篇' },
  ]

  it('列表 key = 完整路径，标题在前、目录在后', () => {
    const view = buildPickNoteView({ notes, mode: 'export' }) as any
    const list = view.children.find((n: any) => n.type === 'list')
    expect(list.items.map((it: any) => it.key)).toEqual(notes.map((n) => n.path))
    expect(list.items[0].node.children[0].value).toBe('周报')
    expect(list.items[0].node.children[1].value).toBe('工作')
    // 目录为空 ⇒ 不渲染那行（手机窄屏没必要留一行空）
    expect(list.items[2].node.children).toHaveLength(1)
  })

  it('空库 / 筛不到 ⇒ 有明确空态文案', () => {
    const empty = buildPickNoteView({ notes: [] }) as any
    expect(empty.children.find((n: any) => n.type === 'list').empty).toBe('库里还没有笔记')
    const miss = buildPickNoteView({ notes, filter: '不存在的词' }) as any
    expect(miss.children.find((n: any) => n.type === 'list').empty).toBe('没有匹配的笔记')
  })

  it('筛选对标题与路径都生效（大小写不敏感）', () => {
    const m1 = buildPickNoteView({ notes, filter: '周报' }) as any
    expect(m1.children.find((n: any) => n.type === 'list').items).toHaveLength(1)
    const m2 = buildPickNoteView({ notes, filter: 'DIARY' }) as any // 路径里是大写才有
    expect(m2.children.find((n: any) => n.type === 'list').items).toHaveLength(0)
    const m3 = buildPickNoteView({ notes, filter: '日记' }) as any // 只有路径含"日记"
    expect(m3.children.find((n: any) => n.type === 'list').items).toHaveLength(1)
  })

  it('超过上限：只渲染前 200 行，并提示可筛选', () => {
    const many = Array.from({ length: NOTE_PICK_LIMIT + 30 }, (_, i) => ({
      path: `批量/${i}.md`,
      dir: '批量',
      title: `第 ${i} 篇`,
    }))
    const view = buildPickNoteView({ notes: many }) as any
    const list = view.children.find((n: any) => n.type === 'list')
    expect(list.items).toHaveLength(NOTE_PICK_LIMIT)
    const count = view.children.find((n: any) => n.type === 'text' && String(n.value).includes('篇'))
    expect(String(count.value)).toContain(`只显示前 ${NOTE_PICK_LIMIT} 篇`)
  })

  it('标题文案区分导出 / 分享', () => {
    expect(JSON.stringify(buildPickNoteView({ notes, mode: 'export' }))).toContain('选择要导出的笔记')
    expect(JSON.stringify(buildPickNoteView({ notes, mode: 'share' }))).toContain('选择要分享的笔记')
  })
})

describe('面板：选格式', () => {
  it('分享：第一项是 Markdown 文件（用户点名的「带图片的 md」）', () => {
    const view = buildPickFormatView({ mode: 'share', notePath: 'a/b.md', noteTitle: 'B' }) as any
    const buttons = view.children.filter((n: any) => n.type === 'button' && n.onClick !== 'io.panel.back')
    expect(buttons[0].onClick).toBe('io.shareMd')
    expect(buttons[0].label).toContain('Markdown')
    expect(buttons.map((b: any) => b.onClick)).toEqual(['io.shareMd', 'io.sharePng', 'io.shareTxt'])
  })

  it('导出：六种格式都在，且每个按钮都带选中的 path（不回落到 doc.active()）', () => {
    const view = buildPickFormatView({ mode: 'export', notePath: 'a/b.md' }) as any
    const buttons = view.children.filter((n: any) => n.type === 'button' && n.onClick !== 'io.panel.back')
    expect(buttons.map((b: any) => b.onClick)).toEqual(EXPORT_BUTTONS.map(([id]: any) => id))
    for (const b of buttons) expect(b.payload.path).toBe('a/b.md')
  })

  it('显示选中那篇的标题；没标题就退回路径', () => {
    const withTitle = buildPickFormatView({ notePath: 'a/b.md', noteTitle: '周报' }) as any
    expect(withTitle.children[1].value).toBe('周报')
    const noTitle = buildPickFormatView({ mode: 'export', notePath: 'a/b.md' }) as any
    expect(noTitle.children[1].value).toBe('a/b.md')
  })
})

describe('shareFileName', () => {
  it('普通名字原样带扩展名', () => {
    expect(shareFileName('周报', 'md')).toBe('周报.md')
  })

  it('路径分隔符 / Windows 非法字符全部洗掉（FileProvider 找不到会直接抛）', () => {
    expect(shareFileName('a/b\\c:d?e*f', 'md')).toBe('abcdef.md')
  })

  it('空 / 全脏 ⇒ note 保底', () => {
    expect(shareFileName('', 'png')).toBe('note.png')
    expect(shareFileName('...', 'md')).toBe('note.md')
  })
})

