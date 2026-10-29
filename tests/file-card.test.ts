/**
 * **附件文件卡片**的数据口径（rev173.245 · 附件需求最后一小块）。
 *
 * 这些用例守的是四件最容易静默错的事：
 *
 * 1. **判定范围**：只认库外绝对路径 + 文档白名单。放宽一格就会把正文里的普通
 *    外链、笔记间链接、图片（`![]()` 的领域）统统变成卡片 —— 那是回归，不是功能。
 * 2. **整行链接的解析边界**：行首行尾有别的字、列表前缀、目标含空格 / 括号。
 * 3. **台账对不上时不能猜**：台账里没这条 ⇒ 大小留空、不报「不在本机」；
 *    报了就是误报，而误报一次这条提示就没人信了（与 `claimAudit` 同一条取舍）。
 * 4. **路径写法归一**：`\` 与 `/`、尖括号、`%xx` 都是同一个文件。
 */
import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import {
  extOfPath,
  fileCardKindOf,
  fileCardModelOf,
  fileCardSubtitle,
  isExternalAbsPath,
  normalizeCardPath,
  parseSingleLinkLine,
  setFileCardLedger,
  type FileCardLedgerEntry,
} from '../src/kernel/file-card'
import { findFileCardLines } from '../src/kernel/editor-syntax'

const ledger = (rows: FileCardLedgerEntry[]) => new Map(rows.map((r) => [r.original, r]))

describe('路径判定', () => {
  it('剥尖括号 / 解 %xx / 反斜杠归一', () => {
    expect(normalizeCardPath('<D:/资料/报告 v2.pdf>')).toBe('D:/资料/报告 v2.pdf')
    expect(normalizeCardPath('D:\\资料\\a%20b.pdf')).toBe('D:/资料/a b.pdf')
    expect(normalizeCardPath('./D:/x.pdf')).toBe('D:/x.pdf')
  })

  it('认盘符 / UNC / Unix 绝对（rev173.250 手机走查补）', () => {
    expect(isExternalAbsPath('D:/a.pdf')).toBe(true)
    expect(isExternalAbsPath('d:\\a.pdf')).toBe(true)
    expect(isExternalAbsPath('\\\\nas\\共享\\a.pdf')).toBe(true)
    // Android 的库外文件是 Unix 绝对路径 —— 此前只认 Windows 形态，手机上卡片静默不出现
    expect(isExternalAbsPath('/storage/emulated/0/Download/a.pdf')).toBe(true)
    expect(isExternalAbsPath('//nas/共享/a.pdf')).toBe(true)
    // 库内相对路径、绝对 URL、笔记链接都不是
    expect(isExternalAbsPath('附件/a.pdf')).toBe(false)
    expect(isExternalAbsPath('./附件/a.pdf')).toBe(false)
    expect(isExternalAbsPath('https://a.com/a.pdf')).toBe(false)
    expect(isExternalAbsPath('/')).toBe(false)
  })

  it('扩展名小写、无扩展名为空串', () => {
    expect(extOfPath('D:/a/B.PDF')).toBe('pdf')
    expect(extOfPath('<D:/a/b c.zip>')).toBe('zip')
    expect(extOfPath('D:/a/README')).toBe('')
    expect(extOfPath('D:/a/.hidden')).toBe('')
  })
})

describe('卡片判定', () => {
  it('库外文档类 → 卡片分组', () => {
    expect(fileCardKindOf('D:/a/报告.pdf')).toBe('doc')
    expect(fileCardKindOf('D:/a/账.xlsx')).toBe('sheet')
    expect(fileCardKindOf('D:/a/讲稿.pptx')).toBe('slide')
    expect(fileCardKindOf('D:/a/备份.7z')).toBe('archive')
    expect(fileCardKindOf('D:/a/书.epub')).toBe('ebook')
    expect(fileCardKindOf('D:/a/记录.txt')).toBe('file')
  })

  it('图片 / 音视频 / 未知扩展名 / 库内路径都不卡片化', () => {
    expect(fileCardKindOf('D:/a/photo.jpg')).toBe(null)
    expect(fileCardKindOf('D:/a/clip.mp4')).toBe(null)
    expect(fileCardKindOf('D:/a/song.mp3')).toBe(null)
    expect(fileCardKindOf('D:/a/data.xyz')).toBe(null)
    expect(fileCardKindOf('附件/报告.pdf')).toBe(null)
  })
})

describe('整行链接解析', () => {
  it('纯链接行（两侧空白允许）', () => {
    expect(parseSingleLinkLine('[报告](D:/a.pdf)')).toEqual({
      label: '报告',
      target: 'D:/a.pdf',
    })
    expect(parseSingleLinkLine('  [报告](<D:/a b.pdf>)  ')).toEqual({
      label: '报告',
      target: '<D:/a b.pdf>',
    })
  })

  it('同一行有别的字 / 列表前缀 / 多个链接 ⇒ 不接管（块级替换会吞掉它们）', () => {
    expect(parseSingleLinkLine('见 [报告](D:/a.pdf)')).toBe(null)
    expect(parseSingleLinkLine('[报告](D:/a.pdf) 谢谢')).toBe(null)
    expect(parseSingleLinkLine('- [报告](D:/a.pdf)')).toBe(null)
    expect(parseSingleLinkLine('> [报告](D:/a.pdf)')).toBe(null)
    expect(parseSingleLinkLine('[a](D:/a.pdf) [b](D:/b.pdf)')).toBe(null)
    expect(parseSingleLinkLine('普通一行字')).toBe(null)
  })

  it('空标签也行（显示名退回文件名）', () => {
    expect(parseSingleLinkLine('[](D:/a/报告.pdf)')).toEqual({
      label: '',
      target: 'D:/a/报告.pdf',
    })
  })
})

describe('卡片模型', () => {
  it('台账有这条 → 大小与「不在本机」都按事实给', () => {
    const map = ledger([
      { original: 'D:/a/报告.pdf', size: 2411724, exists: false },
    ])
    const m = fileCardModelOf('报告', 'D:/a/报告.pdf', map)
    expect(m).not.toBe(null)
    expect(m).toMatchObject({
      name: '报告',
      target: 'D:/a/报告.pdf',
      ext: 'pdf',
      kind: 'doc',
      size: 2411724,
      missing: true,
    })
    expect(fileCardSubtitle(m!)).toBe('PDF · 2.3 MB')
  })

  it('台账没有这条 → 大小留空、不误报「不在本机」', () => {
    const m = fileCardModelOf('报告', 'D:/a/报告.pdf', ledger([]))
    expect(m).toMatchObject({ size: null, missing: false })
    expect(fileCardSubtitle(m!)).toBe('PDF')
  })

  it('反斜杠 / 尖括号 / %20 写都能匹配到台账同一条', () => {
    const map = ledger([{ original: 'D:/资料/报告 2.pdf', size: 1024, exists: true }])
    for (const target of [
      'D:\\资料\\报告 2.pdf',
      '<D:/资料/报告 2.pdf>',
      'D:/资料/报告%202.pdf',
    ]) {
      const m = fileCardModelOf('报告', target, map)
      expect(m, target).not.toBe(null)
      expect(m!.size, target).toBe(1024)
      expect(m!.missing, target).toBe(false)
    }
  })

  it('标签是 URL / 空 → 显示名退回路径里的文件名', () => {
    expect(fileCardModelOf('https://a.com/x', 'D:/a/报告.pdf', ledger([]))!.name).toBe(
      '报告.pdf',
    )
    expect(fileCardModelOf('   ', 'D:/a/报告.pdf', ledger([]))!.name).toBe('报告.pdf')
  })

  it('不该卡片的行 → null（模型层最后一道闸）', () => {
    expect(fileCardModelOf('图', 'D:/a/photo.jpg', ledger([]))).toBe(null)
    expect(fileCardModelOf('笔记', '附件/a.pdf', ledger([]))).toBe(null)
  })
})

/**
 * 哪些行会被接管（`editor-syntax.ts` 的块装饰器入口）。
 *
 * 装饰器的**渲染**不在单测范围（需要真实编辑器，按 ROADMAP §4 第 5 条走 CDP 实测）；
 * 这里只锁「收哪几行」—— 收错了要么吞掉正文，要么漏掉卡片。
 */
describe('整篇扫描（findFileCardLines）', () => {
  const doc = (s: string) => Text.of(s.split('\n'))

  it('多行文档只收纯链接行，且带出台账给的大小', () => {
    setFileCardLedger([{ original: 'D:/a/报告.pdf', size: 5242880, exists: true }])
    try {
      const lines = findFileCardLines(
        doc(
          [
            '# 标题',
            '',
            '[报告](D:/a/报告.pdf)',
            '',
            '见 [报告](D:/a/报告.pdf) 谢谢',
            '[图](D:/a/photo.jpg)',
            '[库内](附件/报告.pdf)',
            '- [列表](D:/a/报告.pdf)',
          ].join('\n'),
        ),
      )
      expect(lines).toHaveLength(1)
      expect(lines[0].from).toBe(6) // `# 标题\n\n` 之后（4 + 换行 + 空行换行）
      expect(lines[0].model.size).toBe(5242880)
      expect(lines[0].model.missing).toBe(false)
    } finally {
      // 模块级台账是共享状态：用例结束必须清空，否则后面的用例读到上一条
      setFileCardLedger([])
    }
  })

  it('一个都没有时返回空数组（不会误解构）', () => {
    expect(findFileCardLines(doc('只有正文\n没有链接'))).toEqual([])
  })
})
