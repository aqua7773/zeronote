// @vitest-environment happy-dom
/**
 * 应用更新面板的「卡住」修复（rev173.324 · 用户实测两个现象）：
 *  · **装完新版本还提示安装** —— 已是最新时，缓存里残留的 APK 仍让界面停在「已下载完成 · 安装」；
 *  · **断点续传卡在旧版** —— 0.9.9 更新 0.9.10 中断，远端已到 0.9.12，界面却一直显示
 *    「发现新版本 0.9.10 / 继续下载」，且没有重新检查的入口。
 *
 * 判据：`loadLastCheck()` 里存的是**检查那一刻**的 `currentVersion`；与应用实际版本不一致 ⇒ 旧结论作废。
 * 缓存也一样：只有 `latest > current` 才认「已下载 / 断点」。
 * 纯 UI 行为，invoke 全 mock —— 真检查 / 下载 / 安装在 Rust。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  Channel: class {},
  convertFileSrc: (p: string) => p,
}))

import { AppUpdatePanel } from '../src/components/AppUpdatePanel'
import { saveLastCheck, type UpdateCheck } from '../src/kernel/app-update'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0'

const latest0912 = {
  version: '0.9.12',
  url: 'https://example.com/ZeroNote_0.9.12_arm64.apk',
  size: 100,
  mirrors: [],
}

/** 检查时还是 0.9.11、发现 0.9.12 可装 —— 用户 0.9.9 时代的真实旧结果 */
const staleCheck: UpdateCheck = {
  currentVersion: '0.9.11',
  hasUpdate: true,
  remoteVersion: '0.9.12',
  latest: latest0912,
  mirror: 'raw',
  error: null,
  routes: [],
}

const noUpdate: UpdateCheck = {
  currentVersion: '0.9.12',
  hasUpdate: false,
  remoteVersion: '0.9.12',
  latest: null,
  mirror: 'raw',
  error: null,
  routes: [],
}

function mockInvoke(opts: { check?: UpdateCheck; apk?: { path: string; size: number; partial: number } }) {
  mocks.invoke.mockImplementation((cmd: string) => {
    if (cmd === 'check_app_update') return Promise.resolve(opts.check ?? noUpdate)
    if (cmd === 'find_apk_cache')
      return Promise.resolve(opts.apk ?? { path: '', size: 0, partial: 0 })
    if (cmd === 'plugin:apk-install|can_install_apk') return Promise.resolve(true)
    return Promise.resolve(null)
  })
}

beforeEach(() => {
  window.localStorage.clear()
  mocks.invoke.mockReset()
  Object.defineProperty(navigator, 'userAgent', { value: ANDROID_UA, configurable: true })
})

afterEach(() => cleanup())

describe('应用更新面板：旧状态不再卡住（rev173.324）', () => {
  it('应用升级后旧检查结果作废：自动重查，显示「已是最新」而不是旧的「发现新版本」', async () => {
    // 上次检查时是 0.9.11 —— 现在应用已经是 0.9.12
    saveLastCheck(staleCheck)
    mockInvoke({
      check: noUpdate,
      // 缓存里还留着 0.9.12 的包（用户刚装完）—— 不该再显示「安装」
      apk: { path: '/cache/updates/zeronote-0.9.12.apk', size: 100, partial: 0 },
    })

    render(<AppUpdatePanel appVersion="0.9.12" />)

    await waitFor(() => expect(screen.getByText(/已是最新/)).toBeTruthy())
    expect(screen.queryByText(/发现新版本/)).toBeNull()
    expect(screen.queryByText(/已下载完成/)).toBeNull()
  })

  it('已经是最新时，缓存里残留的安装包不再显示「已下载完成」', async () => {
    // 这份结果就是当前版本查的（不是过期结果），但旧缓存文件还在
    saveLastCheck(noUpdate)
    mockInvoke({ apk: { path: '/cache/updates/zeronote-0.9.12.apk', size: 100, partial: 0 } })

    render(<AppUpdatePanel appVersion="0.9.12" />)

    await waitFor(() => expect(screen.getByText(/已是最新/)).toBeTruthy())
    expect(screen.queryByText(/已下载完成/)).toBeNull()
  })

  it('有新版且包已下完 ⇒ 仍显示「已下载完成 · 安装」（正常路径没被改坏）', async () => {
    // 应用还是 0.9.11、检查结果也是 0.9.11 查的 ⇒ 不算过期
    saveLastCheck(staleCheck)
    mockInvoke({ apk: { path: '/cache/updates/zeronote-0.9.12.apk', size: 100, partial: 0 } })

    render(<AppUpdatePanel appVersion="0.9.11" />)

    await waitFor(() =>
      expect(screen.getByText('已下载完成 · 点「安装」交给系统安装器')).toBeTruthy(),
    )
    // 有结果可铺 ⇒ 打开面板不重复检查
    expect(mocks.invoke).not.toHaveBeenCalledWith('check_app_update', expect.anything())
  })

  it('「发现新版本」态有「重新检查」入口，点了会重新拉清单', async () => {
    saveLastCheck(staleCheck)
    mockInvoke({})

    render(<AppUpdatePanel appVersion="0.9.11" />)

    const recheck = await screen.findByLabelText('重新检查更新')
    fireEvent.click(recheck)
    await waitFor(() =>
      expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === 'check_app_update')).toBe(true),
    )
  })

  it('断点续传卡在旧版：旧结果 + 半成品 ⇒ 重新检查后不再显示旧版的「继续下载」', async () => {
    // 0.9.10 下载到一半（30/100），远端已经 0.9.12；现在应用是 0.9.12
    saveLastCheck({ ...staleCheck, latest: { ...latest0912, version: '0.9.10' } })
    mockInvoke({
      check: noUpdate,
      apk: { path: '', size: 0, partial: 30 },
    })

    render(<AppUpdatePanel appVersion="0.9.12" />)

    await waitFor(() => expect(screen.getByText(/已是最新/)).toBeTruthy())
    expect(screen.queryByText('继续下载')).toBeNull()
    expect(screen.queryByText(/发现新版本/)).toBeNull()
  })
})
