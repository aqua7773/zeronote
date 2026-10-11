// 形态 3：不导出任何东西，靠全局函数注册自己
window.registerPlugin({
  name: '全局注册示例',
  register(api) {
    api.command.register({
      id: 'yank-style.hello',
      title: '全局注册示例：你好',
      run: () => api.host.notify('registerPlugin 形态跑通了', 'info'),
    })
    api.view.registerPanel({
      id: 'yank-style.badge',
      title: 'Yank',
      location: 'statusbar',
      render: () => ({ type: 'text', value: 'Yank✓', variant: 'caption' }),
    })
  },
})