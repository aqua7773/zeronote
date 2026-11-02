// @vitest-environment happy-dom
/**
 * 崩溃日志（rev173.327 · 用户「每次崩溃直接导出崩溃日志，我转发就可以了」）。
 *
 * 测的是**判定与文本**这两块纯逻辑 —— 真正读 tombstone 的那半在原生插件里，
 * 单测碰不到（要 Android 真机）。这里的判据：
 *  · 同一个崩溃只算「新」一次（时间戳去重），否则每次启动都弹窗；
 *  · 预览要封顶、且明确告诉用户完整内容在导出的文件里；
 *  · 报告文本缺水时写「未知」而不是 `undefined`，有堆栈时整段带上。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  CRASH_HANDLED_KEY,
  type CrashInfo,
  formatCrashReport,
  isNewCrash,
  loadHandledTs,
  saveHandledTs,
  tracePreview,
} from '../src/lib/crash-log'

function make(over: Partial<CrashInfo> = {}): CrashInfo {
  return {
    found: true,
    timestamp: 1_762_000_000_000,
    reason: 5,
    reasonLabel: '原生崩溃（SIGABRT / SIGSEGV）',
    description: 'crash',
    trace: '#00 pc 000000000007120c  libc.so (abort+160)',
    appVersion: '0.9.14',
    androidVersion: '16',
    device: 'nubia NX741J',
    webviewVersion: '140.0.7339.207',
    exportPath: '/storage/emulated/0/Download/ZeroNote-crash/zeronote-crash-20261102-131102.txt',
    ...over,
  }
}

afterEach(() => {
  localStorage.clear()
})

describe('isNewCrash', () => {
  it('null / found=false / 时间戳为 0 都不算新崩溃', () => {
    expect(isNewCrash(null, 0)).toBe(false)
    expect(isNewCrash(make({ found: false }), 0)).toBe(false)
    expect(isNewCrash(make({ timestamp: 0 }), 0)).toBe(false)
  })

  it('比已处理时间戳新才算 —— 等于也不算（避免同一崩溃弹两次）', () => {
    const c = make({ timestamp: 1000 })
    expect(isNewCrash(c, 999)).toBe(true)
    expect(isNewCrash(c, 1000)).toBe(false)
    expect(isNewCrash(c, 1001)).toBe(false)
  })
})

describe('loadHandledTs / saveHandledTs', () => {
  it('存进去能读出来；坏值按 0 处理', () => {
    expect(loadHandledTs()).toBe(0)
    saveHandledTs(1234)
    expect(localStorage.getItem(CRASH_HANDLED_KEY)).toBe('1234')
    expect(loadHandledTs()).toBe(1234)
    localStorage.setItem(CRASH_HANDLED_KEY, 'not-a-number')
    expect(loadHandledTs()).toBe(0)
  })

  it('拒绝写入非正数（0 会让"已处理"退回到"从没处理过"）', () => {
    saveHandledTs(0)
    expect(localStorage.getItem(CRASH_HANDLED_KEY)).toBeNull()
  })
})

describe('tracePreview', () => {
  it('短的原样返回', () => {
    expect(tracePreview('abc', 10)).toBe('abc')
  })

  it('超长截断并注明原长', () => {
    const out = tracePreview('x'.repeat(50), 10)
    expect(out.startsWith('x'.repeat(10))).toBe(true)
    expect(out).toContain('50')
    expect(out).toContain('已复制')
  })

  it('空 trace 返回空串（由界面决定显示什么）', () => {
    expect(tracePreview('')).toBe('')
  })
})

describe('formatCrashReport', () => {
  it('带堆栈：时间 / 环境 / 原因 / tombstone 四段齐', () => {
    const text = formatCrashReport(make())
    expect(text).toContain('【ZeroNote 崩溃报告】')
    expect(text).toContain('ZeroNote 0.9.14')
    expect(text).toContain('Android 16')
    expect(text).toContain('nubia NX741J')
    expect(text).toContain('WebView 140.0.7339.207')
    expect(text).toContain('原生崩溃')
    expect(text).toContain('tombstone')
    expect(text).toContain('libc.so (abort+160)')
  })

  it('没有堆栈时明说系统没留，而不是留空白', () => {
    const text = formatCrashReport(make({ trace: '' }))
    expect(text).toContain('系统没有保留堆栈')
  })

  it('字段缺失写「未知」，不出现 undefined / NaN', () => {
    const text = formatCrashReport(
      make({ appVersion: '', androidVersion: '', device: '', webviewVersion: '', timestamp: 0 }),
    )
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
    expect(text).toContain('未知')
  })
})
