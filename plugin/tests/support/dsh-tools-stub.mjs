// 仅测试期使用的 @deepseek-ai/dsh-tools 替身。
// 真实包会把 parameters DSL 编译成 JSON Schema；测试只关心
// 定义能否被 register() 接收、execute() 能否被调用，故原样返回。
// 该替身仅由 resolve-dsh-tools.mjs 在 `node --import` 时接管，
// 生产运行时仍解析宿主提供的真实包，不会被遮蔽。
export function defineTool(definition) {
  return definition
}
