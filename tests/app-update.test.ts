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
  APP_UPDATE_MIRROR_KEY,
  APP_UPDATE_TTL_MS,
  UPDATE_MIRRORS,
  fmtSpeed,
  isAndroidApp,
  isAppAutoCheckEnabled,
  lastCheckedAt,
  loadLastCheck,
  loadUpdateMirror,
  markChecked,
  saveLastCheck,
  saveUpdateMirror,
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

describe('更新渠道（rev173.300 / rev173.440 同源）', () => {
  it('缺省 = 第一条（raw），只保留完整源（jsDelivr 拿不到 Release 附件，已移除）', () => {
    expect(loadUpdateMirror().id).toBe('raw')
    expect(UPDATE_MIRRORS.map((m) => m.id)).toEqual(['raw', 'gitee', 'gitlab', 'ghproxy'])
  })

  it('存过且认识 ⇒ 用它；存了个不认识的 ⇒ 回默认（不报错）', () => {
    saveUpdateMirror('ghproxy')
    expect(loadUpdateMirror().id).toBe('ghproxy')
    saveUpdateMirror('nope')
    expect(loadUpdateMirror().id).toBe('raw')
  })

  it('与插件市场的渠道各存各的（互不覆盖）', () => {
    saveUpdateMirror('ghproxy')
    expect(window.localStorage.getItem(APP_UPDATE_MIRROR_KEY)).toBe('ghproxy')
    expect(window.localStorage.getItem('zn-market-mirror')).toBeNull()
  })
})

describe('检查结果持久化（rev173.311）', () => {
  const sample = {
    currentVersion: '0.9.8',
    hasUpdate: true,
    remoteVersion: '0.9.9',
    latest: {
      version: '0.9.9',
      url: 'https://github.com/aqua7773/zeronote/releases/download/v0.9.9/a.apk',
      mirrors: [],
    },
    mirror: 'raw',
    routes: [
      {
        id: 'direct',
        label: 'GitHub 直连',
        url: 'https://github.com/aqua7773/zeronote/releases/download/v0.9.9/a.apk',
        ok: true,
        ms: 900,
        bps: 1_100_000,
        detail: '1.1 MB/s · 900ms',
      },
    ],
  }

  it('存了能读回来（关掉设置面板再打开不必重拉清单）', () => {
    saveLastCheck(sample)
    expect(loadLastCheck()?.latest?.version).toBe('0.9.9')
    expect(loadLastCheck()?.routes?.[0].id).toBe('direct')
  })

  it('没存过 ⇒ null', () => {
    expect(loadLastCheck()).toBeNull()
  })

  it('坏 JSON ⇒ null（不抛）', () => {
    window.localStorage.setItem('zn-app-update-last-result', '{oops')
    expect(loadLastCheck()).toBeNull()
  })

  it('缺 currentVersion 的结果当作无效（旧格式 / 手改过）', () => {
    window.localStorage.setItem(
      'zn-app-update-last-result',
      JSON.stringify({ at: 1, check: {} }),
    )
    expect(loadLastCheck()).toBeNull()
  })
})

describe('路径测速展示（rev173.311）', () => {
  it('0 / 空 ⇒ 短横（= 这条路没测通）', () => {
    expect(fmtSpeed(0)).toBe('—')
    expect(fmtSpeed(null)).toBe('—')
    expect(fmtSpeed(undefined)).toBe('—')
  })

  it('KB / MB 分档（1 MB 以上才换单位）', () => {
    expect(fmtSpeed(1024)).toBe('1 KB/s')
    expect(fmtSpeed(300 * 1024)).toBe('300 KB/s')
    expect(fmtSpeed(1.2 * 1024 * 1024)).toBe('1.2 MB/s')
  })
})
