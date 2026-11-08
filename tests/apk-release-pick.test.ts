/**
 * 发版产物挑选（rev173.439）。
 *
 * 背景：rev173.437 把 0.9.16 的旧包改名成 0.10.2 发了出去（按目录名 + 体积取文件）。
 * 那次加的校验只用 mtime 判断「本次新产出」，而 Gradle 判定「无需重打」时 mtime 不变
 * ⇒ rev173.438 就误报「没有产出新的 APK」。这里锁住两侧语义：
 *   · 有本次新产物 ⇒ 只认新的（旧的即使版本对也不许混进来）
 *   · 没有新产物 ⇒ 回退校验已有产物，但每份版本必须对得上
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error 脚本侧是 .mjs，没有类型声明；本测试只做运行时对比
import { pickReleaseApks } from '../scripts/apk-version.mjs'

type Apk = { variant: string; apk: string }
type PickFn = (
  apks: Apk[],
  opts: {
    isFresh: (a: Apk) => boolean
    expectVersion: string
    check?: (apk: string, expect: string) => unknown
  },
) => {
  mode: 'fresh' | 'existing'
  picks: Array<{ variant: string; apk: string; versionName: string; versionCode: number }>
  rejected: Array<{ variant: string; apk: string; error: string }>
}

const pick = pickReleaseApks as PickFn

/** 假 aapt2：路径里含 `old` 就算旧版本，含 `new` 就算正确版本 */
function fakeCheck(apk: string, expect: string) {
  if (apk.includes('old')) {
    return {
      ok: false,
      error: `APK 里的版本是 0.9.16，但 package.json 是 ${expect}`,
    }
  }
  return { ok: true, versionName: expect, versionCode: 10002 }
}

const ARM_OLD: Apk = { variant: 'arm64', apk: 'build/apk/arm64/release/app-arm64-old.apk' }
const UNI_NEW: Apk = { variant: 'universal', apk: 'build/apk/universal/release/app-universal-new.apk' }

describe('pickReleaseApks', () => {
  it('有本次新产物 ⇒ 只认新产物，不混入旧目录里版本相同的包', () => {
    const r = pick([ARM_OLD, UNI_NEW], {
      isFresh: (a) => a.apk === UNI_NEW.apk,
      expectVersion: '0.10.2',
      check: fakeCheck,
    })
    expect(r.mode).toBe('fresh')
    expect(r.picks.map((p) => p.variant)).toEqual(['universal'])
    expect(r.rejected).toEqual([])
  })

  it('有本次新产物但版本不对 ⇒ 失败，不回退去拿旧的正确产物', () => {
    const freshBad: Apk = { variant: 'universal', apk: 'build/apk/universal/release/app-bad-old.apk' }
    const r = pick([freshBad, { variant: 'arm64', apk: 'build/apk/arm64/release/app-arm64-new.apk' }], {
      isFresh: (a) => a.apk === freshBad.apk,
      expectVersion: '0.10.2',
      check: fakeCheck,
    })
    expect(r.mode).toBe('fresh')
    expect(r.picks).toEqual([])
    expect(r.rejected).toHaveLength(1)
  })

  it('Gradle 无需重打（没有新产物）⇒ 回退校验已有产物，版本对的照样可用', () => {
    const r = pick([ARM_OLD, UNI_NEW], {
      isFresh: () => false,
      expectVersion: '0.10.2',
      check: fakeCheck,
    })
    expect(r.mode).toBe('existing')
    expect(r.picks.map((p) => p.variant)).toEqual(['universal'])
    expect(r.rejected.map((x) => x.variant)).toEqual(['arm64'])
  })

  it('没有新产物、已有产物版本全不对 ⇒ 空结果（调用方据此 exit 1）', () => {
    const r = pick([ARM_OLD], {
      isFresh: () => false,
      expectVersion: '0.10.2',
      check: fakeCheck,
    })
    expect(r.mode).toBe('existing')
    expect(r.picks).toEqual([])
    expect(r.rejected).toHaveLength(1)
  })

  it('isFresh 抛错（文件被删 / 无权限）⇒ 不算新产物，走回退', () => {
    const r = pick([UNI_NEW], {
      isFresh: () => {
        throw new Error('ENOENT')
      },
      expectVersion: '0.10.2',
      check: fakeCheck,
    })
    expect(r.mode).toBe('existing')
    expect(r.picks).toHaveLength(1)
  })

  it('目录里一个 APK 都没有 ⇒ 空结果，不抛异常', () => {
    const r = pick([], { isFresh: () => true, expectVersion: '0.10.2', check: fakeCheck })
    expect(r.mode).toBe('existing')
    expect(r.picks).toEqual([])
    expect(r.rejected).toEqual([])
  })
})
