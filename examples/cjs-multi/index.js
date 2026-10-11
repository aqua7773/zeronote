// 形态 2：多文件。宿主会把 manifest.files 里声明的文件一起读出来，
// 装进一个极简的 CommonJS 运行时，所以 require 相对路径能用。
const { greet } = require('./lib/greet.js')
const { bump } = require('./lib/counter.js')

module.exports = {
  apply(api) {
    api.command.register({
      id: 'cjs-multi.count',
      title: '多文件示例：计数 +1',
      run: async () => {
        const n = await bump(api)
        api.host.notify(greet() + ' 第 ' + n + ' 次', 'info')
        return n
      },
    })
    // 状态栏标记：只有 require 真的解析成功、模块可用，这里才渲染得出来
    api.view.registerPanel({
      id: 'cjs-multi.badge',
      title: '多文件',
      location: 'statusbar',
      render: () => ({ type: 'text', value: 'Multi' + greet().length + '✓', variant: 'caption' }),
    })
  },
}