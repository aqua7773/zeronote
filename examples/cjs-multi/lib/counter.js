// 模块自己也能要求它自己的依赖 —— 解析基准是**当前文件所在目录**
const { greet } = require('./greet.js')

exports.bump = async function (api) {
  const n = ((await api.store.get('n', 0)) || 0) + 1
  await api.store.set('n', n)
  return n
}
exports.selfCheck = () => greet().length > 0