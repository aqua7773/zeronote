/**
 * UI 组件演示插件 —— 把 UINode 的**每一种节点**都渲染一遍。
 *
 * 两个用途：
 *   ① 插件作者的活文档：想看某个节点长什么样、怎么写，翻这个文件；
 *   ② 渲染器的回归清单：改了 UIRenderer / styles.css 之后装上它，
 *      只要有一种节点没出来、或颜色没跟主题走，一眼就能看出来。
 *
 * 全部节点都只传**语义档位**（gap / tone / variant / align），一个颜色值都没写 ——
 * 这正是"宿主统一渲染、风格 100% 统一"的意思：换主题、切暗色，这个面板自动跟着变。
 */
export default {
  apply(api) {
    const { view, command } = api

    /**
     * 所有可点元素都回调到这一个命令，把 payload 记进面板状态。
     * 这样能直观验证三件事：命令有没有被调到、payload 里带了什么、宿主有没有重渲染。
     */
    command.register({
      id: 'ui-kit.hit',
      title: 'UI 组件演示：记录一次点击',
      run: (payload) => {
        view.setState('lastHit', JSON.stringify(payload ?? null))
        view.refresh()
      },
    })

    // 一张自包含的小图（data: URL，不联网）—— 用来验证 image 节点
    const dot =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72">' +
          '<rect width="96" height="72" rx="10" fill="#3f3f46"/>' +
          '<text x="48" y="44" font-size="24" fill="#ffffff" text-anchor="middle">图</text>' +
          '</svg>',
      )

    view.registerPanel({
      id: 'ui-kit.panel',
      title: 'UI 组件演示',
      location: 'sidebar',
      render: (ctx) => {
        /** 点击结果（命令写进 state，这里读出来展示） */
        const lastHit = ctx.state.lastHit ?? '（还没有点击）'
        const tab = ctx.state.tab ?? 'a'
        const checked = ctx.state.agree === true

        return {
          type: 'stack',
          gap: 'lg',
          children: [
            /* ── 文本 ── */
            {
              type: 'stack',
              gap: 'sm',
              children: [
                { type: 'text', value: 'UI 组件演示', variant: 'title' },
                { type: 'text', value: 'text：caption 档 + muted', variant: 'caption', tone: 'muted' },
                { type: 'text', value: 'tone：success', tone: 'success' },
                { type: 'text', value: 'tone：warn', tone: 'warn' },
                { type: 'text', value: 'tone：danger', tone: 'danger' },
              ],
            },

            { type: 'divider' },

            /* ── 徽标（5 档 tone）── */
            {
              type: 'row',
              gap: 'sm',
              align: 'center',
              wrap: true,
              children: [
                { type: 'badge', text: '默认' },
                { type: 'badge', text: '已同步', tone: 'success' },
                { type: 'badge', text: '待处理', tone: 'warn' },
                { type: 'badge', text: '失败', tone: 'danger' },
                { type: 'badge', text: '已忽略', tone: 'muted' },
              ],
            },

            /* ── 进度 ── */
            { type: 'progress', value: 42, max: 100, label: 'progress：42 / 100' },

            /* ── 图片 ── */
            { type: 'image', src: dot, alt: '示例图', height: 72 },

            /* ── 代码 / 富内容 ── */
            { type: 'code', value: "const p = { type: 'image', src }", lang: 'js' },
            {
              type: 'html',
              value:
                '<b>html 节点</b>：katex / mermaid / marked 的产物都从这里进来，' +
                '<code style="font-family:monospace">行内样式由插件生成的 HTML 自带</code>。',
            },

            { type: 'divider' },

            /* ── 表单行 ── */
            {
              type: 'field',
              label: 'input',
              hint: 'field = 标签 + 提示 + 控件；回车触发 onSubmit',
              children: {
                type: 'input',
                bind: 'name',
                placeholder: '随便输点什么，按回车',
                onSubmit: 'ui-kit.hit',
              },
            },
            {
              type: 'field',
              label: 'textarea',
              hint: '多行框里裸回车是换行，Ctrl/Cmd + 回车才提交',
              children: {
                type: 'textarea',
                bind: 'note',
                rows: 2,
                placeholder: '多行文本…',
                onSubmit: 'ui-kit.hit',
              },
            },
            {
              type: 'field',
              label: 'select',
              hint: '选中即触发 onSubmit',
              children: {
                type: 'select',
                bind: 'pick',
                options: [
                  { value: 'one', label: '选项一' },
                  { value: 'two', label: '选项二' },
                  { value: 'three', label: '选项三' },
                ],
                onSubmit: 'ui-kit.hit',
              },
            },
            { type: 'checkbox', bind: 'agree', label: 'checkbox：勾选会写进 state', onSubmit: 'ui-kit.hit' },

            { type: 'divider' },

            /* ── 按钮三档 + 带参数 ── */
            {
              type: 'row',
              gap: 'sm',
              wrap: true,
              children: [
                { type: 'button', label: '默认按钮', onClick: 'ui-kit.hit', payload: { variant: 'default' } },
                { type: 'button', label: 'ghost', variant: 'ghost', onClick: 'ui-kit.hit', payload: { variant: 'ghost' } },
                { type: 'button', label: 'danger', variant: 'danger', onClick: 'ui-kit.hit', payload: { variant: 'danger' } },
                { type: 'button', label: '禁用', disabled: true, onClick: 'ui-kit.hit' },
              ],
            },
            // 把输入框的值随命令一起发出去（send 读 state[bind]）
            { type: 'button', label: '把上面 input 的值发出去', onClick: 'ui-kit.hit', send: 'name' },
            { type: 'link', label: 'link 节点也走命令（不做真实导航）', onClick: 'ui-kit.hit', payload: { from: 'link' } },

            /* ── 可点列表（稳定 key + 整行可点）── */
            {
              type: 'list',
              onClick: 'ui-kit.hit',
              items: [
                { key: 'row-1', node: { type: 'text', value: '可点列表 · 第 1 行（key=row-1）' } },
                { key: 'row-2', node: { type: 'text', value: '可点列表 · 第 2 行（key=row-2）' } },
                {
                  key: 'row-3',
                  node: {
                    type: 'row',
                    gap: 'sm',
                    align: 'center',
                    children: [
                      { type: 'text', value: '第 3 行带徽标', variant: 'caption' },
                      { type: 'badge', text: 'success', tone: 'success' },
                    ],
                  },
                },
              ],
            },

            /* ── 表格（单元格可以是任意 UINode）── */
            {
              type: 'table',
              columns: [
                { key: 'name', label: '节点' },
                { key: 'state', label: '状态', align: 'right', width: '88px' },
              ],
              rows: [
                { name: 'image / html', state: { type: 'badge', text: '新', tone: 'success' } },
                { name: 'table / progress', state: { type: 'badge', text: '新', tone: 'success' } },
                { name: 'stack / row', state: '原有' },
              ],
            },

            /* ── 分组切换 ── */
            {
              type: 'tabs',
              bind: 'tab',
              tabs: [
                {
                  key: 'a',
                  label: '第一组',
                  node: { type: 'text', value: 'tabs：当前在「第一组」（当前 tab = ' + tab + '）', variant: 'caption' },
                },
                {
                  key: 'b',
                  label: '第二组',
                  node: {
                    type: 'stack',
                    gap: 'sm',
                    children: [
                      { type: 'text', value: 'tabs：当前在「第二组」', variant: 'caption' },
                      { type: 'badge', text: 'tab 内容也能是任意节点', tone: 'muted' },
                    ],
                  },
                },
              ],
            },

            { type: 'spacer', size: 'md' },
            { type: 'divider' },

            /* ── 交互反馈 ── */
            {
              type: 'stack',
              gap: 'sm',
              children: [
                { type: 'text', value: '最后一次点击的 payload（住 state，由命令写回）', variant: 'caption', tone: 'muted' },
                { type: 'code', value: String(lastHit) },
                { type: 'text', value: 'checkbox 当前值：' + String(checked), variant: 'caption', tone: 'muted' },
              ],
            },
          ],
        }
      },
    })
  },
}
