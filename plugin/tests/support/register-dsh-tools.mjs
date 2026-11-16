// 注册测试期解析钩子。用法：
//   node --import ./packages/.../register-dsh-tools.mjs --test ...
import { register } from 'node:module'

register('./resolve-dsh-tools.mjs', import.meta.url)
