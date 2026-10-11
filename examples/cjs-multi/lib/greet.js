// 二级目录里的模块：路径解析要能处理 './lib/greet.js' 这种带目录的相对引用
exports.greet = function () {
  return '多文件 require 通了，'
}