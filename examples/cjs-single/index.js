// 形态 1：CommonJS 单文件，导出的是**函数本身**（不是 { apply }）
// 这是 Lumina-Note 的入口形状：module.exports = function (api, plugin) {}
module.exports = function (api) {
  api.command.register({
    id: 'cjs-single.ping',
    title: 'CJS 示例：打个招呼',
    run: () => {
      api.host.notify('CJS 单文件插件跑通了', 'info')
      return 'pong'
    },
  })
  api.view.registerPanel({
    id: 'cjs-single.badge',
    title: 'CJS',
    location: 'statusbar',
    render: () => ({ type: 'text', value: 'CJS通用', variant: 'caption' }),
  })
}