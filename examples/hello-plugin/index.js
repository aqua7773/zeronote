/**
 * Hello 示例插件 —— ZeroNote 插件 API 的最小参考实现
 *
 * 加载方式：整个目录放进 `<笔记库>/.zn/plugins/hello/`
 * 验收判据（M2）：
 *   ① 装上 → 命令面板出现「Hello：打个招呼」，侧栏出现「Hello 插件」面板
 *   ② 点按钮 / 跑命令 → 弹出通知
 *   ③ 卸下 → 命令与面板全部消失，且不报错
 *
 * 注意：v0.1 只支持**单文件插件**（宿主用 Blob URL 动态 import，解析不了相对导入）。
 */

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, view, host, subscriptions } = ctx

    // 1) 注册一个命令（id 必须带命名空间前缀）
    subscriptions.push(
      command.register({
        id: 'hello.say',
        title: 'Hello：打个招呼',
        run: () => {
          host.notify('你好，ZeroNote！这条通知来自一个插件。')
          host.log('info', 'hello.say 被执行')
        },
      }),
    )

    // 2) 挂一个侧栏面板 —— 返回的是「界面描述」，由宿主用统一组件渲染
    subscriptions.push(
      view.registerPanel({
        id: 'hello.panel',
        title: 'Hello 插件',
        location: 'sidebar',
        render: () => ({
          type: 'stack',
          children: [
            { type: 'text', value: '我是 hello 插件', variant: 'title' },
            { type: 'text', value: '这块界面由「声明式 UI」渲染 —— 插件没写任何 React 代码。', variant: 'caption' },
            { type: 'divider' },
            { type: 'button', label: '打个招呼', onClick: 'hello.say' },
          ],
        }),
      }),
    )

    host.log('info', 'hello 插件已就绪')
  },

  dispose() {
    // subscriptions 由宿主统一 dispose；这里只做插件自己的额外清理
  },
}
