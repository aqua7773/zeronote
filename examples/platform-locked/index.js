/**
 * 平台门示例 —— 与其它示例唯一的不同在 `manifest.json` 里那一行：
 *
 *   "platforms": ["android"]
 *
 * 于是**桌面端根本不会读到这个文件**：内核在 `loadPlugin` 里比对平台时就把插件拦下了。
 * 插件管理页会把它显示成「不适用 · 仅移动端」、开关禁用、而且**不报错**
 * —— 把移动端专属插件留在桌面库里是很正常的事，不该报红。
 *
 * 三档写法：
 *   ["desktop"]                仅桌面
 *   ["android"]                仅移动端
 *   ["desktop", "android"]     双端
 *   （字段整个不写 = 全平台，向后兼容）
 *
 * 反向验收：把 `platforms` 改成 `["desktop"]` 推到手机上，手机端同样跳过它。
 * 写错取值（比如 `"windwos"`）会被**拒载并报错**，不再静默失效。
 */

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, host, subscriptions } = ctx
    subscriptions.push(
      command.register({
        id: 'platform-locked.say',
        title: '平台门示例：打个招呼',
        run: () => host.notify('能跑到这一句，说明当前平台与声明是对得上的。'),
      }),
    )
    host.log('info', 'platform-locked 已加载 —— 当前平台与它的 platforms 声明相符')
  },
}
