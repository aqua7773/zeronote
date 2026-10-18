/**
 * 插件样式**首屏预热**（rev135 · 修复「翠绿主题经常闪一下深色界面」）。
 *
 * ## 问题
 * 纯样式插件（主题类，如 `theme-green`）的 CSS 由插件宿主在**插件加载完之后**注入：
 * `usePluginHost` 的 effect → 读 manifest → 读 CSS → `injectStyles`（append `<style>`）。
 * 这条链要等 React 挂载、再跑若干次 await —— 首屏早已用内核默认主题（深色）渲染完毕，
 * 主题一变就是「闪一下深色」。每刷新 / 冷启动 / 切库都会来一次。
 *
 * ## 做法
 * 1. 真实注入插件样式时，顺便把 CSS 缓存进 localStorage（`cachePluginStyle`）；
 * 2. `main.tsx` 在 React 挂载**之前**调用 `applyBootPluginStyles()`，把缓存拼成一条
 *    `<style>` 追加到 `<head>` 末尾 —— 此时内核 `styles.css` 已由 Vite 注入，
 *    文档顺序在前 ⇒ 同特异性下插件主题变量胜出，首屏直接就是主题色；
 * 3. 插件真实加载完成后删掉这条预热样式（`dropBootPluginStyles`），正常样式接管；
 *    插件卸载 / 被禁用时缓存同步删除，下次启动不再预热它。
 *
 * 代价：缓存可能比真实插件旧一帧（插件更新后第一次启动仍是旧主题色，加载完成即纠正）——
 * 比「每次都闪深色」好，且主题 CSS 极少变。
 */
export const LS_PLUGIN_STYLES = 'zeronote.plugin.styles'

const BOOT_STYLE_ID = 'zn-boot-plugin-styles'

/** 记录某个插件的样式（真实注入时调用） */
export function cachePluginStyle(pluginId: string, css: string): void {
  try {
    const raw = localStorage.getItem(LS_PLUGIN_STYLES)
    const map: Record<string, string> = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    map[pluginId] = css
    localStorage.setItem(LS_PLUGIN_STYLES, JSON.stringify(map))
  } catch {
    /* 写不进去只影响首屏预热，不影响正常运行 */
  }
}

/** 插件卸载时删掉它的缓存（否则下次启动会预热一个已经不存在的主题） */
export function uncachePluginStyle(pluginId: string): void {
  try {
    const raw = localStorage.getItem(LS_PLUGIN_STYLES)
    if (!raw) return
    const map = JSON.parse(raw) as Record<string, string>
    if (!(pluginId in map)) return
    delete map[pluginId]
    localStorage.setItem(LS_PLUGIN_STYLES, JSON.stringify(map))
  } catch {
    /* 缓存坏了：整个清掉，别让它一直毒害首屏 */
    try {
      localStorage.removeItem(LS_PLUGIN_STYLES)
    } catch {
      /* ignore */
    }
  }
}

/** React 挂载前调用：把上次注入过的插件样式先摆上，避免主题闪一下 */
export function applyBootPluginStyles(): void {
  try {
    const raw = localStorage.getItem(LS_PLUGIN_STYLES)
    if (!raw) return
    const map = JSON.parse(raw) as Record<string, string>
    const css = Object.values(map)
      .filter((s) => typeof s === 'string' && s.trim())
      .join('\n')
    if (!css) return
    document.getElementById(BOOT_STYLE_ID)?.remove()
    const el = document.createElement('style')
    el.id = BOOT_STYLE_ID
    el.textContent = css
    document.head.appendChild(el)
  } catch {
    /* 缓存坏了就当没有：首屏退回内核主题，由插件加载后纠正 */
  }
}

/** 真实插件样式注入（或插件加载完成）后清掉预热样式 */
export function dropBootPluginStyles(): void {
  document.getElementById(BOOT_STYLE_ID)?.remove()
}
