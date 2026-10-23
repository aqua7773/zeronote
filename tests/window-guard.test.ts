/**
 * 白屏兜底的判据（rev173.104）。
 *
 * 场景：插件窗口 / 笔记窗口是 `decorations:false` + 自绘标题条 —— 页面整页挂掉时
 * 屏幕上没有任何关闭入口。判据是纯函数，坏了就会**误杀正常窗口**或**放任僵尸窗口**，
 * 两种都很难在手工测试里覆盖，所以在这里逐条钉死。
 */
import { describe, expect, it } from 'vitest'
import {
  applyBeat,
  BAD_STREAK,
  domLooksAlive,
  GRACE_MS,
  isGuardedWindow,
  pickStuckWindows,
  STALE_MS,
  type WindowBeat,
} from '../src/lib/window-guard'

const NOW = 1_700_000_000_000

function beat(recvAt: number, ok = true, badStreak = 0): WindowBeat {
  return { recvAt, ok, badStreak }
}

describe('isGuardedWindow', () => {
  it('只守护插件窗口与笔记窗口', () => {
    expect(isGuardedWindow('plugin-doc-reader.view')).toBe(true)
    expect(isGuardedWindow('note-1')).toBe(true)
  })

  it('主窗口与其它 label 不参与（主窗口被关掉 = 整个 App 退出）', () => {
    expect(isGuardedWindow('main')).toBe(false)
    expect(isGuardedWindow('')).toBe(false)
    expect(isGuardedWindow('tauri')).toBe(false)
  })
})

describe('applyBeat', () => {
  it('ok 会清零连续白屏计数', () => {
    const next = applyBeat({ 'p1': beat(NOW - 5000, false, 2) }, 'p1', true, NOW)
    expect(next.p1).toEqual({ recvAt: NOW, ok: true, badStreak: 0 })
  })

  it('连续 bad 会累加', () => {
    const a = applyBeat({}, 'p1', false, NOW)
    const b = applyBeat(a, 'p1', false, NOW + 1000)
    expect(b.p1.badStreak).toBe(2)
  })

  it('不修改入参（React 状态要能比对引用）', () => {
    const prev = { 'p1': beat(NOW - 1) }
    const next = applyBeat(prev, 'p1', false, NOW)
    expect(prev.p1.recvAt).toBe(NOW - 1)
    expect(next).not.toBe(prev)
  })
})

describe('pickStuckWindows', () => {
  it('宽限期内（刚出现的窗口）不关 —— WebView 冷启动要时间', () => {
    expect(pickStuckWindows(['plugin-a'], {}, { 'plugin-a': NOW - 1000 }, NOW)).toEqual([])
    expect(GRACE_MS).toBeGreaterThan(5000)
  })

  it('过了宽限、从没发过心跳 ⇒ 页面根本没起来', () => {
    expect(pickStuckWindows(['plugin-a'], {}, { 'plugin-a': NOW - GRACE_MS - 1000 }, NOW)).toEqual(['plugin-a'])
  })

  it('没有 firstSeen 记录时不动手（第一轮扫描只登记，不判）', () => {
    expect(pickStuckWindows(['plugin-a'], {}, {}, NOW)).toEqual([])
  })

  it('心跳断了（页面 JS 停了 / 被换成别的页面）⇒ 关', () => {
    const beats = { 'plugin-a': beat(NOW - STALE_MS - 1) }
    expect(pickStuckWindows(['plugin-a'], beats, { 'plugin-a': NOW - 60000 }, NOW)).toEqual(['plugin-a'])
  })

  it('心跳正常 ⇒ 不关', () => {
    const beats = { 'plugin-a': beat(NOW - 3000) }
    expect(pickStuckWindows(['plugin-a'], beats, { 'plugin-a': NOW - 60000 }, NOW)).toEqual([])
  })

  it('心跳还在但自报白屏，连续 BAD_STREAK 次 ⇒ 关', () => {
    const beats = { 'plugin-a': beat(NOW - 1000, false, BAD_STREAK) }
    expect(pickStuckWindows(['plugin-a'], beats, { 'plugin-a': NOW - 60000 }, NOW)).toEqual(['plugin-a'])
  })

  it('白屏但还没到阈值 ⇒ 先观察（瞬时 DOM 重建不算）', () => {
    const beats = { 'plugin-a': beat(NOW - 1000, false, BAD_STREAK - 1) }
    expect(pickStuckWindows(['plugin-a'], beats, { 'plugin-a': NOW - 60000 }, NOW)).toEqual([])
  })

  it('主窗口永远不在名单里', () => {
    const beats = { main: beat(NOW - 99999) }
    expect(pickStuckWindows(['main', 'note-1'], beats, { main: NOW - 99999, 'note-1': NOW - 60000 }, NOW)).toEqual([
      'note-1',
    ])
  })

  it('多个窗口一起判，各算各的', () => {
    const labels = ['main', 'plugin-a', 'plugin-b', 'note-1']
    const beats = {
      'plugin-a': beat(NOW - 2000), // 健康
      'plugin-b': beat(NOW - STALE_MS - 1), // 心跳断了
      'note-1': beat(NOW - 1000, false, BAD_STREAK), // 白屏
    }
    const firstSeen = {
      main: NOW - 99999,
      'plugin-a': NOW - 60000,
      'plugin-b': NOW - 60000,
      'note-1': NOW - 60000,
    }
    expect(pickStuckWindows(labels, beats, firstSeen, NOW)).toEqual(['plugin-b', 'note-1'])
  })
})

describe('domLooksAlive（窗口端自检）', () => {
  /** 造一个够用的假 document（jsdom 不做布局，rect 恒 0，没法直接测） */
  function fakeDoc(opts: { root: boolean; w?: number; h?: number; children?: number }) {
    const el = opts.root
      ? {
          getBoundingClientRect: () => ({ width: opts.w ?? 900, height: opts.h ?? 640 }),
          childElementCount: opts.children ?? 2,
        }
      : null
    return { querySelector: () => el } as unknown as Document
  }

  it('根节点在 + 可见 + 有子元素 ⇒ 活着', () => {
    expect(domLooksAlive(fakeDoc({ root: true }))).toBe(true)
  })

  it('根节点没了（整棵树被移除）⇒ 白屏', () => {
    expect(domLooksAlive(fakeDoc({ root: false }))).toBe(false)
  })

  it('根节点被隐藏 / 零尺寸（display:none、CSS 全挂）⇒ 白屏', () => {
    expect(domLooksAlive(fakeDoc({ root: true, w: 0, h: 0 }))).toBe(false)
    expect(domLooksAlive(fakeDoc({ root: true, w: 900, h: 0 }))).toBe(false)
  })

  it('根节点只剩空壳（React 树被清空）⇒ 白屏', () => {
    expect(domLooksAlive(fakeDoc({ root: true, children: 0 }))).toBe(false)
  })

  it('空输入不炸', () => {
    expect(domLooksAlive(null)).toBe(false)
    expect(domLooksAlive(undefined)).toBe(false)
  })
})
