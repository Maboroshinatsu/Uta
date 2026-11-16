/**
 * 宿主侧状态解说意图推断（纯函数，无副作用）。
 *
 * 宿主插件只上报“当前在做什么”的粗粒度意图，具体台词、情绪与预设由 Uta
 * 渲染层决定。这样中文文案只维护一份，也不会把 prompt / 工具参数带出宿主。
 */

export const NARRATION_INTENTS = Object.freeze([
  'session_start',
  'thinking',
  'looking',
  'searching',
  'reading',
  'defining',
  'editing',
  'testing',
  'running',
  'researching',
  'waiting',
  'found',
  'progress',
  'success',
  'error',
  'retry',
])

function text(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * 宿主让用户选方案/回答问题的工具，不是权限审批。
 * 这类工具必须留在宿主窗口处理，桌宠只提示一句，不提供批准/拒绝。
 */
export function isUserChoiceTool(toolName) {
  const name = String(toolName || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!name) return false
  return (
    name === 'question' ||
    name.includes('askquestion') ||
    name.includes('askuser') ||
    name.includes('askfollowupquestion') ||
    name.includes('requestuserinput') ||
    name.includes('requestuserselection') ||
    name.includes('userchoice') ||
    name.includes('chooseoption') ||
    name.includes('selectoption') ||
    name.includes('presentoptions')
  )
}

/** 从工具名和参数里提取一个短命令字符串，仅用于分类，不写日志 */
function commandText(input) {
  if (!input || typeof input !== 'object') return ''
  const candidate = input.command ?? input.cmd ?? input.script ?? input.CommandLine
  if (typeof candidate === 'string') return candidate.toLowerCase()
  if (Array.isArray(candidate)) {
    return candidate.filter((item) => typeof item === 'string').join(' ').toLowerCase()
  }
  return ''
}

/** 工具分类：只返回意图，不做任何网络或文件操作 */
export function inferToolIntent(toolName, toolInput = {}) {
  const name = text(toolName)
  if (!name) return null
  const command = commandText(toolInput)

  // 网络检索先于普通搜索，避免 search_web 被归成“翻代码”
  if (
    name.includes('url') ||
    name.includes('browser') ||
    name.includes('web_search') ||
    name.includes('search_web') ||
    name.includes('fetch') ||
    name.includes('http')
  ) {
    return 'researching'
  }

  if (name.includes('grep') || name.includes('glob') || name.includes('search') || name.includes('find')) {
    return 'searching'
  }

  if (
    name.includes('write') ||
    name.includes('edit') ||
    name.includes('apply_patch') ||
    name.includes('replace') ||
    name.includes('create_file') ||
    name.includes('patch')
  ) {
    return /config|schema|param|setting|option/.test(name) ? 'defining' : 'editing'
  }

  if (name.includes('goal') || name.includes('plan') || name.includes('todo')) {
    return 'defining'
  }

  if (name.includes('test') || name.includes('pytest') || name.includes('lint')) {
    return 'testing'
  }

  if (
    name === 'bash' ||
    name === 'shell' ||
    name === 'exec' ||
    name === 'terminal' ||
    name.includes('run_command') ||
    name.includes('command')
  ) {
    if (/test|build|typecheck|lint|vitest|jest|pytest|npm run/.test(command)) return 'testing'
    return 'running'
  }

  if (
    name.includes('read') ||
    name.includes('cat') ||
    name.includes('view') ||
    name.includes('open_file') ||
    name.includes('list_dir')
  ) {
    return 'looking'
  }

  if (name.includes('mcp') || name.includes('tool')) return 'running'
  return 'running'
}

/**
 * 把宿主生命周期事件映射为解说意图。
 * 返回 null 表示这次事件不需要打扰用户。
 */
export function inferNarration(event, payload = {}) {
  const name = String(event || '').trim()
  const toolName =
    typeof payload?.toolCall?.name === 'string'
      ? payload.toolCall.name
      : typeof payload?.tool_name === 'string'
        ? payload.tool_name
        : typeof payload?.toolName === 'string'
          ? payload.toolName
          : typeof payload?.tool === 'string'
            ? payload.tool
            : ''
  const toolInput =
    payload?.toolCall?.args ||
    payload?.tool_input ||
    payload?.toolInput ||
    payload?.args ||
    {}

  switch (name) {
    case 'SessionStart':
    case 'session.created':
      return 'session_start'
    case 'UserPromptSubmit':
    case 'PreInvocation':
    case 'agent/request':
    case 'session.execution.started':
      return 'thinking'
    case 'PreToolUse':
    case 'tool.execute.before':
    case 'tools/execute':
      return inferToolIntent(toolName, toolInput)
    case 'PostToolUse':
    case 'tool.execute.after':
    case 'tools/result':
      return payload?.error || payload?.isError ? 'error' : null
    case 'PostToolUseFailure':
    case 'session.error':
    case 'session.execution.failed':
    case 'agent/error':
      return 'error'
    case 'PermissionRequest':
    case 'approval/request':
    case 'permission.ask':
      return 'waiting'
    case 'Interrupt':
    case 'session.execution.interrupted':
      return 'retry'
    case 'Stop':
    case 'session.idle':
    case 'session.execution.succeeded':
      return 'success'
    default:
      return null
  }
}
