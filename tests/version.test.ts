// @vitest-environment happy-dom
/**
 * 版本号比较（`rev173.259` 从 `builtin-plugins.ts` 迁到 `src/kernel/version.ts`）。
 *
 * 应用的「安装 / 可更新 / 已安装」判断全靠它 —— 用字符串比较会得出相反的结论
 * （`1.10.0 < 1.9.0`），所以这段必须锁死。
 */
import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/kernel/version'

describe('compareVersions（数字段按数值比，不是字符串序）', () => {
  it('1.10.0 > 1.9.0（字符串比较会得出相反的答案）', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
  })

  it('相等 / 前缀 v / 段数不同', () => {
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
  })

  it('非数字段当 0（预发布后缀不影响主序）', () => {
    expect(compareVersions('0.2.0-beta', '0.2.0')).toBe(0)
    expect(compareVersions('^1.2.0', '1.1.9')).toBe(1)
  })
})
