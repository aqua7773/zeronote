/**
 * 跨端路径候选对拍（方案 P1 · 2026-11-03）。
 *
 * 同一套「附件引用 → 候选路径」跑在两个运行环境里，各有一份实现：
 *  · 主程序 `src/lib/insert-image.ts#linkCandidates` —— 返回库内相对候选（string[]）；
 *  · 插件   `examples/import-export/index.js#refLocations` —— 返回 { kind, rel, abs }[]。
 *
 * 两份**顺序必须一致**：顺序漂了就会出现「正文能显示、导出/分享丢图」
 * （真人测试8 的 761 字节事故：渲染侧有库根兜底、导出侧没有）。
 *
 * 口径：
 *  · 核心组 = 两端都负责的输入（库内相对 / 前导 `/` / `./` / `..` / 反斜杠 / 双斜杠）。
 *  · 清洗层（尖括号、%xx）、平台分流、库外绝对路径、URL 由调用方前置处理 ——
 *    放在「已知差异」里断言**当前真实行为**，任一端改了行为测试就红，逼你同步。
 */
import { describe, expect, it } from 'vitest'
import { linkCandidates, resolveImageAbsPaths } from '../src/lib/insert-image'
import { refLocations } from '../examples/import-export/index.js'

const ROOT = 'C:/vault'

/** 同一次输入，取两端各自的「库内相对候选」列表 */
function both(rel: string, note: string | null, platform = 'desktop') {
  return {
    main: linkCandidates(rel, note),
    plugin: (refLocations(rel, note, platform, ROOT) as { rel: string | null }[])
      .map((x) => x.rel)
      .filter((x): x is string => typeof x === 'string'),
  }
}

const CORE: [string, string | null, string[]][] = [
  ['笔记在子目录：笔记目录 → 库根', 'image-1.png', 'sub/a.md', ['sub/image-1.png', 'image-1.png']],
  ['笔记在库根：只有一条', 'image-1.png', 'a.md', ['image-1.png']],
  ['前导 / = 只按库根', '/assets/x.png', 'sub/a.md', ['assets/x.png']],
  ['前导 / + 子目录笔记', '/assets/x.png', 'sub/deep/a.md', ['assets/x.png']],
  ['./ 前缀：与裸相对同序', './image-1.png', 'sub/a.md', ['sub/image-1.png', 'image-1.png']],
  ['多层子目录', 'image-1.png', 'sub/deep/a.md', ['sub/deep/image-1.png', 'image-1.png']],
  ['../ 未越界：回退后仍在库内', '../x.png', 'sub/deep/a.md', ['sub/x.png']],
  ['../ 越界：两端都空', '../../x.png', 'sub/a.md', []],
  ['反斜杠按正斜杠', 'a\\b.png', 'sub/a.md', ['sub/a/b.png', 'a/b.png']],
  ['双斜杠折叠', 'a//b.png', 'sub/a.md', ['sub/a/b.png', 'a/b.png']],
  ['notePath 为 null：只按库根', 'x.png', null, ['x.png']],
  ['notePath 为空串：只按库根', 'x.png', '', ['x.png']],
]

describe('路径候选跨端对拍（核心组：顺序必须一致）', () => {
  it.each(CORE)('%s', (_name, rel, note, expected) => {
    const { main, plugin } = both(rel, note)
    expect(main).toEqual(expected)
    expect(plugin).toEqual(expected)
    expect(main).toEqual(plugin)
  })
})

/**
 * 已知差异：这些输入**不由两端共同负责**，差异是当前设计的一部分。
 * 每条都写清「哪一端负责哪一步」，避免以后有人看到差异就改错地方。
 */
describe('已知差异（记录当前真实行为，行为变了就红）', () => {
  it('尖括号：插件自己剥，主程序靠调用方先 stripAngleTarget', () => {
    const { main, plugin } = both('<my pic.png>', 'sub/a.md')
    expect(main).toEqual(['sub/<my pic.png>', '<my pic.png>'])
    expect(plugin).toEqual(['sub/my pic.png', 'my pic.png'])
  })

  it('百分号转义：插件自己解码，主程序靠调用方先 decodeLocalPath', () => {
    const { main, plugin } = both('my%20pic.png', 'sub/a.md')
    expect(main).toEqual(['sub/my%20pic.png', 'my%20pic.png'])
    expect(plugin).toEqual(['sub/my pic.png', 'my pic.png'])
  })

  it('URL：插件返回空，主程序不判 scheme（调用方 resolveImageAbsPaths 先挡）', () => {
    expect(both('https://x.com/a.png', 'a.md').plugin).toEqual([])
    expect(both('https://x.com/a.png', 'a.md').main).toEqual(['https:/x.com/a.png'])
  })

  it('Windows 绝对路径：插件判 abs，主程序靠调用方先挡', () => {
    expect(both('D:\\pics\\a.png', 'a.md').plugin).toEqual([])
    expect(both('D:\\pics\\a.png', 'a.md').main).toEqual(['D:/pics/a.png'])
  })

  it('Android /storage 绝对路径：插件判 abs、主程序的解析入口原样返回（2026-11-03 P1 收口）', () => {
    const { main, plugin } = both('/storage/emulated/0/a.png', 'sub/a.md', 'android')
    expect(plugin).toEqual([]) // abs 分支：rel 为 null
    // linkCandidates 本身不认平台（仍按库根切），但解析入口已经先拦下绝对路径：
    expect(main).toEqual(['storage/emulated/0/a.png'])
    expect(resolveImageAbsPaths('C:/vault', 'sub/a.md', '/storage/emulated/0/a.png')).toEqual([
      '/storage/emulated/0/a.png',
    ])
  })

  it('空串：插件判 empty 返回空，主程序会返回笔记目录本身', () => {
    expect(both('', 'sub/a.md').plugin).toEqual([])
    expect(both('', 'sub/a.md').main).toEqual(['sub'])
  })
})
