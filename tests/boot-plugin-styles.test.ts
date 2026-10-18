// @vitest-environment happy-dom
/**
 * 插件样式首屏预热（rev135）。纯函数 + DOM 操作，不碰 Tauri。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyBootPluginStyles,
  cachePluginStyle,
  dropBootPluginStyles,
  LS_PLUGIN_STYLES,
  uncachePluginStyle,
} from '../src/lib/boot-plugin-styles'

const boot = () => document.getElementById('zn-boot-plugin-styles') as HTMLStyleElement | null

beforeEach(() => {
  localStorage.clear()
  document.getElementById('zn-boot-plugin-styles')?.remove()
})

describe('boot-plugin-styles', () => {
  it('没有缓存 ⇒ 不注入', () => {
    applyBootPluginStyles()
    expect(boot()).toBeNull()
  })

  it('有缓存 ⇒ 拼成一条 style 追加到 head 末尾', () => {
    cachePluginStyle('theme-green', ':root { --zn-bg: #f4fbf6; }')
    cachePluginStyle('theme-sepia', ':root { --zn-bg: #fdf6e3; }')
    applyBootPluginStyles()
    const el = boot()
    expect(el).toBeTruthy()
    expect(el!.textContent).toContain('--zn-bg: #f4fbf6')
    expect(el!.textContent).toContain('--zn-bg: #fdf6e3')
    expect(document.head.lastElementChild).toBe(el)
  })

  it('cache / uncache 往返：卸载的插件不再预热', () => {
    cachePluginStyle('a', ':root{--zn-bg:red}')
    uncachePluginStyle('a')
    applyBootPluginStyles()
    expect(boot()).toBeNull()
  })

  it('drop 之后预热样式被移除（真实样式接管）', () => {
    cachePluginStyle('a', ':root{--zn-bg:red}')
    applyBootPluginStyles()
    expect(boot()).toBeTruthy()
    dropBootPluginStyles()
    expect(boot()).toBeNull()
  })

  it('缓存是坏 JSON ⇒ 不抛错、不注入', () => {
    localStorage.setItem(LS_PLUGIN_STYLES, '{not json')
    expect(() => applyBootPluginStyles()).not.toThrow()
    expect(boot()).toBeNull()
  })

  it('空字符串样式不进入预热', () => {
    cachePluginStyle('empty', '   ')
    applyBootPluginStyles()
    expect(boot()).toBeNull()
  })
})
