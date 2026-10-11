// 实测项：CSP 为 null 时，Blob 里的 ESM 能不能直接 import 公网 CDN 上的依赖？
// 注意这里**没有声明 net** —— 声明了反而会被 assertCapabilities 拒掉（默认拒），
// 但不声明也照样能联网，这恰好暴露了「capability 目前不是安全边界」。
export default {
  async apply(api) {
    let badge = 'CDN?'
    try {
      const mod = await import('https://esm.sh/dayjs@1.11.13')
      const d = mod.default ?? mod
      badge = 'CDN✓' + (typeof d === 'function' ? '' : '?')
    } catch (e) {
      badge = 'CDN✗'
      api.host.log('warn', 'CDN 导入失败：' + String(e))
    }
    api.view.registerPanel({
      id: 'cdn-import.badge',
      title: 'CDN',
      location: 'statusbar',
      render: () => ({ type: 'text', value: badge, variant: 'caption' }),
    })
  },
}