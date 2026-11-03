/**
 * 跨端一致性锁（2026-11-03 审计 5.1）。
 *
 * 插件签名 payload 有两份实现：
 *   · 浏览器 / 宿主：`src/lib/plugin-signing.ts#signingPayload`
 *   · Node 脚本：`scripts/lib/signing.mjs#signingPayload`
 * 两份必须**逐字一致**，否则「脚本签过了、宿主验不过」会变成一个没有报错的哑谜。
 *
 * 原来 `tests/plugin-signing.test.ts` 只断言前端那份输出长这样（固定字符串），
 * 脚本那份改坏了测试不会红。这里直接 import 两份，用同一组输入比输出。
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error 脚本侧是 .mjs，没有类型声明；本测试只做运行时对比
import { signingPayload as nodePayload } from '../scripts/lib/signing.mjs'
import { signingPayload as webPayload } from '../src/lib/plugin-signing'

type FileDigest = { path: string; sha256: string }
type PayloadFn = (id: string, version: string, entrySha256: string, files?: FileDigest[]) => string

const web = webPayload as PayloadFn
const node = nodePayload as PayloadFn

const CASES: { name: string; args: [string, string, string, FileDigest[]?] }[] = [
  { name: '无额外文件（末尾空段）', args: ['demo', '1.0.0', 'abc123'] },
  {
    name: '多文件乱序（排序后必须一致）',
    args: [
      'demo',
      '1.2.3',
      'entry-sha',
      [
        { path: 'lib/z.js', sha256: 'zzz' },
        { path: 'lib/a.js', sha256: 'aaa' },
        { path: 'lib/m.js', sha256: 'mmm' },
      ],
    ],
  },
  { name: '中文 id / 版本', args: ['标签', '0.1.0-beta.1', 'sha'] },
  { name: '空数组', args: ['demo', '1.0.0', 'sha', []] },
]

describe('签名 payload 跨端一致（前端 ↔ 脚本）', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(web(...c.args)).toBe(node(...c.args))
    })
  }

  it('同一组文件换顺序时两端都得到同一串', () => {
    const a: FileDigest[] = [
      { path: 'b.js', sha256: '2' },
      { path: 'a.js', sha256: '1' },
    ]
    const b: FileDigest[] = [a[1], a[0]]
    expect(web('d', '1', 'e', a)).toBe(web('d', '1', 'e', b))
    expect(node('d', '1', 'e', a)).toBe(node('d', '1', 'e', b))
    expect(web('d', '1', 'e', a)).toBe(node('d', '1', 'e', b))
  })
})
