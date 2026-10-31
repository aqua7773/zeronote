// @vitest-environment happy-dom
/**
 * 应用本体更新（rev173.292）的**前端纯逻辑**：节流判定、开关持久化、平台判据。
 *
 * 真正干活的三条（check / install / download）都是 invoke，不在这里测 ——
 * Rust 侧 `updates.rs` 的版本比较有单测（`is_newer`），下载与签名校验要真网络/真安装包。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  APP_UPDATE_AUTO_KEY,
  APP_UPDATE_LAST_CHECK_KEY,
  APP_UPDATE_TTL_MS,
  isAndroidApp,
  isAppAutoCheckEnabled,
  lastCheckedAt,
  markChecked,
  setAppAutoCheckEnabled,
  shouldAutoCheck,
} from '../src/kernel/app-update'

beforeEach(() => {
  window.localStorage.clear()
})

describe('启动节流', () => {
  it('没查过 ⇒ 该查', () => {
    expect(shouldAutoCheck(1_000_000)).toBe(true)
  })

  it('24 小时内查过 ⇒ 不重复查（边界：刚好 24 小时算到期）', () => {
    markChecked(1_000_000)
    expect(shouldAutoCheck(1_000_000 + APP_UPDATE_TTL_MS - 1)).toBe(false)
    expect(shouldAutoCheck(1_000_000 + APP_UPDATE_TTL_MS)).toBe(true)
  })

  it('开关关掉后即使过期也不查', () => {
    setAppAutoCheckEnabled(false)
    expect(shouldAutoCheck(9_999_999_999)).toBe(false)
    expect(isAppAutoCheckEnabled()).toBe(false)
    setAppAutoCheckEnabled(true)
    expect(shouldAutoCheck(9_999_999_999)).toBe(true)
  })

  it('时间戳坏了（非数字）当没查过', () => {
    window.localStorage.setItem(APP_UPDATE_LAST_CHECK_KEY, 'not-a-number')
    expect(lastCheckedAt()).toBe(0)
    expect(shouldAutoCheck(1_000_000)).toBe(true)
  })
})

describe('开关持久化', () => {
  it('缺省 = 开', () => {
    expect(isAppAutoCheckEnabled()).toBe(true)
  })

  it('写成 0 表示关，写成 1 表示开', () => {
    setAppAutoCheckEnabled(false)
    expect(window.localStorage.getItem(APP_UPDATE_AUTO_KEY)).toBe('0')
    setAppAutoCheckEnabled(true)
    expect(window.localStorage.getItem(APP_UPDATE_AUTO_KEY)).toBe('1')
  })
})

describe('平台判据', () => {
  it('UA 里有 Android 才算安卓（与 App.tsx 的 platform 同一判据）', () => {
    const spy = (ua: string) =>
      Object.defineProperty(window.navigator, 'userAgent', {
        value: ua,
        configurable: true,
      })
    spy('Mozilla/5.0 (Linux; Android 15; 24069RA21C) AppleWebKit/537.36')
    expect(isAndroidApp()).toBe(true)
    spy('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    expect(isAndroidApp()).toBe(false)
  })
})
