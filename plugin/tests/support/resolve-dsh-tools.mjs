// 测试期模块解析钩子：把宿主的 @deepseek-ai/dsh-tools 指到本地替身，
// 使插件单测无需安装 DeepSeek Harness 即可运行。
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const STUB_URL = pathToFileURL(path.join(import.meta.dirname, 'dsh-tools-stub.mjs')).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return { url: STUB_URL, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
