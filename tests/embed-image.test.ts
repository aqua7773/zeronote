/**
 * 内嵌图的原引用解析（rev173.278 · 真人使用测试 #20）。
 *
 * 判据（每条对应一个真实失败模式）：
 *  · 注释必须从**图片 widget 之后那一小段**里读 —— 整篇扫会拿到第一张的（多图导出稿必踩）；
 *  · `<!--` 注释里出现 `-->` 会提前结束，写的那一端做了替换，读的这端不能把它当结束；
 *  · `/x.png` 在桌面上是**相对库根**、在 Android 上是 `/storage/...` 的绝对路径 —— 只能靠平台分；
 *  · 导出稿被导入到库里别处时，「相对当前笔记目录」就错了 ⇒ 要按候选顺序试，别一步咬死。
 */
import { describe, expect, it } from 'vitest'
import {
  isEmbeddedOrigAbs,
  parseZnOrig,
  znOrigCandidates,
} from '../src/lib/embed-image'
import { collectEmbeddedOrigins } from '../src/lib/embed-image'

describe('parseZnOrig', () => {
  it('读出注释里的原引用', () => {
    expect(parseZnOrig('![](data:image/png;base64,AAA)<!-- zn-orig: 附件/a.png -->')).toBe(
      '附件/a.png',
    )
  })

  it('没有注释 / 空注释 ⇒ null', () => {
    expect(parseZnOrig('![](data:image/png;base64,AAA)')).toBeNull()
    expect(parseZnOrig('<!-- zn-orig:   -->')).toBeNull()
    expect(parseZnOrig('')).toBeNull()
  })

  it('取的是**这一段**的第一条（多图时不串到下一张）', () => {
    const text = 'a<!-- zn-orig: 1.png --> 中间 <!-- zn-orig: 2.png -->'
    expect(parseZnOrig(text)).toBe('1.png')
  })

  it('原引用里带空格 / 反斜杠原样保留', () => {
    expect(parseZnOrig('<!-- zn-orig: D:\\照片\\a b.jpg -->')).toBe('D:\\照片\\a b.jpg')
  })

  it('不是 zn-orig 的注释不认', () => {
    expect(parseZnOrig('<!-- 普通注释 -->')).toBeNull()
  })
})

describe('isEmbeddedOrigAbs', () => {
  it('盘符 / UNC 在两个平台都是绝对', () => {
    expect(isEmbeddedOrigAbs('C:/x/a.png', 'windows')).toBe(true)
    expect(isEmbeddedOrigAbs('C:\\x\\a.png', 'android')).toBe(true)
    expect(isEmbeddedOrigAbs('\\\\host\\share\\a.png', 'windows')).toBe(true)
  })

  it('/storage/... 只在 Android 是绝对；桌面上它是相对库根', () => {
    expect(isEmbeddedOrigAbs('/storage/emulated/0/DCIM/a.jpg', 'android')).toBe(true)
    expect(isEmbeddedOrigAbs('/storage/emulated/0/DCIM/a.jpg', 'windows')).toBe(false)
  })

  it('相对路径与空值不是绝对', () => {
    expect(isEmbeddedOrigAbs('附件/a.png', 'windows')).toBe(false)
    expect(isEmbeddedOrigAbs('', 'windows')).toBe(false)
  })
})

describe('znOrigCandidates', () => {
  it('相对路径：先按笔记目录，再按库根', () => {
    expect(znOrigCandidates('a.png', '工作/周报.md', 'windows')).toEqual([
      '工作/a.png',
      'a.png',
    ])
  })

  it('笔记在库根 ⇒ 只有一个候选', () => {
    expect(znOrigCandidates('a.png', '周报.md', 'windows')).toEqual(['a.png'])
  })

  it('桌面上 /x.png = 相对库根，不拼笔记目录', () => {
    expect(znOrigCandidates('/附件/a.png', '工作/周报.md', 'windows')).toEqual(['附件/a.png'])
  })

  it('库外绝对路径 ⇒ 不在这里处理', () => {
    expect(znOrigCandidates('C:/x/a.png', '工作/周报.md', 'windows')).toEqual([])
    expect(znOrigCandidates('/storage/emulated/0/a.jpg', '工作/周报.md', 'android')).toEqual([])
  })

  it('空值 ⇒ 空数组', () => {
    expect(znOrigCandidates('  ', '工作/周报.md', 'windows')).toEqual([])
  })
})

/**
 * 内嵌图与注释的配对（rev173.278 实测修正）。
 *
 * 第一版按 `posAtDOM` 位置找注释 —— 实测**整体错位一张图**（1096×709 的图配上了
 * 512×512 的 icon 路径）。改成按 **data URL 精确配对**：文档里图片语法中的 URL
 * 与 DOM 的 `<img src>` 是同一串 base64。
 */
describe('collectEmbeddedOrigins', () => {
  it('按 data URL 配对，两张图各归各的', () => {
    const md = [
      '# 标题',
      '![](data:image/png;base64,AAA)<!-- zn-orig: 附件/a.png -->',
      '中间文字',
      '![](data:image/jpeg;base64,BBB)<!-- zn-orig: C:/照片/b.jpg -->',
    ].join('\n')
    const map = collectEmbeddedOrigins(md)
    expect(map.get('data:image/png;base64,AAA')).toBe('附件/a.png')
    expect(map.get('data:image/jpeg;base64,BBB')).toBe('C:/照片/b.jpg')
    expect(map.size).toBe(2)
  })

  it('没有注释的 data 图不进表（用户自己贴的不该被绑）', () => {
    const map = collectEmbeddedOrigins('![](data:image/png;base64,CCC)')
    expect(map.size).toBe(0)
  })

  it('注释与图片之间有空格 / 换行也认', () => {
    const map = collectEmbeddedOrigins('![](data:image/png;base64,DDD)  <!-- zn-orig: x.png -->')
    expect(map.get('data:image/png;base64,DDD')).toBe('x.png')
  })

  it('空注释不配（否则会绑到空路径上）', () => {
    const map = collectEmbeddedOrigins('![](data:image/png;base64,EEE)<!-- zn-orig:   -->')
    expect(map.size).toBe(0)
  })

  it('文档里没有 zn-orig ⇒ 空表（快速短路）', () => {
    expect(collectEmbeddedOrigins('![](a.png)\n普通正文').size).toBe(0)
  })
})
