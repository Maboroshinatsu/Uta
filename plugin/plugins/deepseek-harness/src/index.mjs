import { resolveRuntimePaths } from '../../../shared/uta-environment.mjs'
import { endpointCandidates } from '../../../shared/uta-runtime-client.mjs'
import { motionSkill, motionTool, runMotionTool } from '../../../shared/uta-motion.mjs'
/**
 * @uta/deepseek-harness-plugin
 *
 * Uta 桌宠对 DeepSeek Harness 的原生插件（基于 Cordis 插件契约）：
 * 1. 交互式工具审批（Approval Seam）：拦截 `approval/request` 瀑布流，将待批准的工具请求
 *    推送至 Uta 桌宠窗口展示「批准 / 拒绝 / 转交宿主」卡片；桌宠离线或点击转交时自动委托 `next()`。
 * 2. 模型工作状态实时映射（Agent / Tool / Session Seams）：同时监听 `agent/request`、
 *    `agent/assistant-stream`、`tools/execute`、`tools/result`、`agent/status`、`agent/error`
 *    以及 `session/event`（`turn/start`、`turn/end`、`assistant/message`、`tool/call`），
 *    驱动 Uta 桌宠状态胶囊与对应 Live2D/ImageSet 预设姿态。
 * 3. 模型情绪与预设上下文（System Prompt Context）：通过 `ctx.systemPrompt.context`
 *    注入当前模型可用的情绪与预设名称，不改变模型的回复语气、称呼或正文格式；
 *    并在流式输出/消息完成时把回复与情绪预设同步到桌宠气泡与口型。
 * 4. 主动表达工具（Tools Seam）：按 `@deepseek-ai/dsh-tools` 契约注册 `uta_express` 工具，
 *    供模型主动切换情绪预设、动作或发送气泡。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { wrapCommand } from '../../../shared/uta-protocol.mjs'
import { extractTodoItems } from '../../../shared/uta-todo.mjs'
// `uta_express` 的参数与输出使用 DSH 直接认可的 JSON Schema 书写，
// 不再依赖 `@deepseek-ai/dsh-tools` 的 defineTool 构建器。
// 这样插件不携带任何外部运行时依赖，DSH 升级（0.1.x → 0.2.x）也不会
// 因为 peer dependency 版本不匹配而整包被跳过。


export const name = 'uta-deskpet'

/** 插件包必须自包含；这里内联共享判定，避免 npm pack 丢失 plugin/shared 依赖 */
function isPetSpeechCall(toolName, args = {}) {
  const name = String(toolName || '').toLowerCase()
  if (!name) return false
  const normalizedName = name.replace(/[^a-z0-9]/g, '')
  if (normalizedName === 'callmcptool' || normalizedName === 'mcpcall') {
    const server = String(
      args?.ServerName ?? args?.serverName ?? args?.server_name ?? args?.server ?? '',
    ).toLowerCase()
    const target = String(
      args?.ToolName ??
        args?.toolName ??
        args?.tool_name ??
        args?.mcpToolName ??
        args?.mcp_tool_name ??
        args?.tool ??
        args?.name ??
        '',
    ).toLowerCase()
    if (server && !/(deskpet|uta)/.test(server)) return false
    return /(^|[^a-z0-9])(deskpet_(notify|say)|uta_express)([^a-z0-9]|$)/.test(target)
  }
  if (name.includes('uta_express')) {
    const text = args?.text ?? args?.Text ?? ''
    return typeof text === 'string' && text.trim().length > 0
  }
  return /(^|[^a-z0-9])deskpet_(notify|say)([^a-z0-9]|$)/.test(name)
}

/** 宿主让用户选方案/回答问题的工具，不是权限审批 */
function isUserChoiceTool(toolName) {
  const value = String(toolName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  if (!value) return false
  return (
    value === 'question' ||
    value.includes('askquestion') ||
    value.includes('askuser') ||
    value.includes('askfollowupquestion') ||
    value.includes('requestuserinput') ||
    value.includes('requestuserselection') ||
    value.includes('userchoice') ||
    value.includes('chooseoption') ||
    value.includes('selectoption') ||
    value.includes('presentoptions')
  )
}

/** 把 DSH 的 user-questions 请求压成桌宠的一条短提示，不代替宿主作答 */
export function describeUserQuestions(questions) {
  const list = Array.isArray(questions) ? questions : []
  if (list.length === 0) return ''
  if (list.length > 1) {
    return `DSH 在等你回答 ${list.length} 个问题，请回宿主窗口处理。`
  }
  const question = list[0] || {}
  const prompt = String(question.question || question.header || '')
    .replace(/\s+/g, ' ')
    .trim()
  const options = Array.isArray(question.options)
    ? question.options
        .map((option) => String(option?.label || '').trim())
        .filter(Boolean)
        .slice(0, 4)
    : []
  const base = prompt ? `DSH 在等你选择：${prompt}` : 'DSH 在等你选择方案'
  return (options.length > 0 ? `${base}（${options.join(' / ')}）` : base).slice(0, 160)
}

/**
 * 读取 DSH 会话的真实工作目录。
 *
 * ⚠️ DSH 0.2.x 的 `Session` 只暴露 `get id()`，**没有** `cwd` / `directory`
 * getter；工作目录记录在 `session.header.cwd`（`dsh-session` 建 header 时写入）。
 * `tools/execute` 的 exec 对象更是只有 `token/callId/rootCallId/name/signal/agent/arguments`，
 * 根本没有 `session` 字段。所以旧代码里的 `exec?.session?.cwd`、`session?.cwd`
 * 恒为 undefined，全部静默落到 `process.cwd()` —— 也就是 DSH 进程自身的启动目录
 * （Electron 下等于 `%USERPROFILE%\.dsh\profiles\desktop`），而不是项目工作区。
 */
function sessionCwdOf(session) {
  const direct = session?.header?.cwd ?? session?.cwd ?? session?.directory
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const owned = session?.agent?.session
  const inherited = owned?.header?.cwd ?? owned?.cwd ?? owned?.directory
  return typeof inherited === 'string' && inherited.trim() ? inherited.trim() : ''
}

/**
 * 把当前 DSH 会话的 ID/工作目录写给 Uta 主进程，供桌宠“直连宿主会话”使用。
 * 只写会话元数据，不写 prompt、工具参数或回复正文。
 *
 * `cwd` 必须是**会话真实工作区**：Uta 会用它作为 `dsh --profile headless --session-id`
 * 子进程的 cwd，而 DSH 0.2.x 的 headless adopt 会用 `assertAdoptable` 校验
 * `session.header.cwd === process.cwd()`，不一致就直接拒绝续跑。
 */
let lastHostSessionKey = ''
let lastHostSessionAt = 0
function reportHostSession(sessionId, env, cwd, nativeBridgeId) {
  const id = String(sessionId || '').trim().slice(0, 200)
  if (!id) return
  let workspace = typeof cwd === 'string' && cwd.trim() ? cwd.trim().slice(0, 500) : ''
  const now = Date.now()
  const hooks = resolveRuntimePaths(env).hooksDir
  const key = `${hooks}:${id}:${workspace}:${nativeBridgeId || ''}`
  if (key === lastHostSessionKey && now - lastHostSessionAt < 2000) return
  lastHostSessionKey = key
  lastHostSessionAt = now
  try {
    const scoped = path.join(hooks, 'sessions', 'deepseek-harness', `${crypto.createHash('sha256').update(id).digest('hex')}.json`)
    fs.mkdirSync(path.dirname(scoped), { recursive: true })
    if (!workspace) {
      try {
        const previous = JSON.parse(fs.readFileSync(scoped, 'utf8'))
        if (previous?.sessionId === id && typeof previous.cwd === 'string') workspace = previous.cwd.slice(0, 500)
      } catch { /* This session has no saved working directory. */ }
    }
    const data = JSON.stringify({
      host: 'deepseek-harness', sessionId: id, ...(workspace ? { cwd: workspace } : {}),
      updatedAt: now, ...(nativeBridgeId ? { nativeBridgeId } : {}),
    })
    for (const file of [scoped, path.join(hooks, 'harness-session.json')]) {
      writeNativeMetadata(file, data)
    }
  } catch {
    /* 会话登记失败不能影响宿主 */
  }
}

function writeNativeMetadata(file, data) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, data, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

/**
 * ⚠️ Cordis 的 `inject` **没有**「可选」形态：
 *
 *   type Inject<M> = (keyof M)[] | { [K in keyof M]?: M[K] }
 *
 * 数组形态的每一项、对象形态的每个**键**，都是「必需服务」（对象的值只是该
 * 服务的 intercept 配置）。任何一个列出的服务取不到，fiber 就停在 PENDING
 * —— 插件**永不激活**，而且宿主只在启动时往 stderr 甩一句
 * `pending (waiting for service: ...)`。
 *
 * 曾经的 `{ optional: ['systemPrompt','tools','agents'] }` 会被解析成
 * 「需要一个名叫 `optional` 的服务」，这就是本插件长期静默失效的真正原因。
 *
 * 本插件对 systemPrompt / tools 都是「有则挂载、无则跳过」，因此不声明任何
 * 硬依赖，改由 apply() 内的运行时 `ctx.inject([...], cb)` 按需等待。
 */
export const inject = []

const BASE_EMOTIONS = new Set([
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprise',
  'embarrassed',
  'thinking',
  'shy',
  'curious',
  'confused',
  'idle',
  'default',
])

/**
 * 发现本机 Uta 运行时端点文件候选路径。
 * 优先级：config.endpointFile -> DESKPET_ENDPOINT_FILE -> OS 标准 userData/uta/runtime-endpoint.json
 */
function runtimeEnv(config, env) {
  const base = { ...env, UTA_HOST: 'deepseek-harness' }
  if (typeof config?.endpointFile !== 'string' || !config.endpointFile.trim()) return base
  // 平台配置中的显式端点优先，且只允许访问这个实例。
  return { ...base, UTA_ENDPOINT_FILE: config.endpointFile.trim(), DESKPET_ENDPOINT_FILE: config.endpointFile.trim() }
}

export function resolveEndpointCandidates(config = {}, env = process.env) {
  return endpointCandidates(runtimeEnv(config, env))
}

/** 读取当前生效的 `{ port, token }` 配对信息 */
export function readRuntimeEndpoint(config = {}, env = process.env) {
  for (const file of resolveEndpointCandidates(config, env)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (Number.isSafeInteger(raw?.pid) && raw.pid > 0) {
        try {
          process.kill(raw.pid, 0)
        } catch (error) {
          if (error?.code !== 'EPERM') continue
        }
      }
      if (raw && typeof raw.port === 'number' && typeof raw.token === 'string' && raw.token) {
        return { port: raw.port, token: raw.token, endpointFile: file }
      }
    } catch {
      /* 继续尝试下一个候选路径 */
    }
  }
  return null
}

/**
 * 向本机 Uta Runtime Bridge 发起 HTTP 请求（127.0.0.1 + Bearer token）。
 */
export function requestRuntime(method, route, body, options = {}) {
  const { config = {}, env = process.env, timeoutMs = 4000, signal } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('request aborted'))
      return
    }
    const endpoint = readRuntimeEndpoint(config, env)
    if (!endpoint) {
      reject(new Error('Uta desktop pet runtime is not running (endpoint file not found).'))
      return
    }

    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8')
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: endpoint.port,
        path: route,
        method,
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          ...(payload
            ? {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': payload.length,
              }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.setEncoding('utf-8')
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(data)
          } catch {
            /* ignore non-JSON */
          }
          if (res.statusCode === 200 && parsed && parsed.ok) {
            resolve(parsed)
          } else {
            reject(
              new Error(
                (parsed && parsed.error) || `Uta runtime returned HTTP ${res.statusCode}`,
              ),
            )
          }
        })
        res.on('error', reject)
      },
    )

    const onAbort = () => {
      req.destroy(new Error('request aborted'))
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    req.on('timeout', () => {
      req.destroy(new Error('Uta runtime request timed out'))
    })
    req.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(err)
    })
    req.on('close', () => {
      if (signal) signal.removeEventListener('abort', onAbort)
    })

    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * 兼容旧版模型或旧会话可能输出的情绪/预设内联标签，例如：
 * - `[uta:开心]`、`[emotion:happy]`、`[preset:害羞]`
 * - `<uta preset="开心" />` 或 `<uta emotion="happy" />`
 *
 * 当前版本已不再要求模型输出这些标签；解析只用于把它们从桌宠气泡文本中过滤掉。
 * 返回去除标签后的干净展示文本，以及提取到的 `{ emotion, preset }`。
 */
export function extractInlineExpressionTags(rawText) {
  if (typeof rawText !== 'string' || !rawText) {
    return { cleanText: '', emotion: undefined, preset: undefined }
  }

  let emotion
  let preset

  const recordToken = (kind, rawVal) => {
    const val = String(rawVal || '').trim()
    if (!val) return
    if (kind === 'emotion' && BASE_EMOTIONS.has(val.toLowerCase())) {
      emotion = val.toLowerCase()
    } else if (kind === 'preset') {
      preset = val
    } else if (BASE_EMOTIONS.has(val.toLowerCase())) {
      emotion = val.toLowerCase()
    } else {
      preset = val
    }
  }

  const cleanText = rawText
    .replace(/\[(?:uta|emotion|preset)\s*:\s*([^\]]+)\]/gi, (_, token) => {
      recordToken('auto', token)
      return ''
    })
    .replace(
      /<uta\s+(?:(preset|emotion)\s*=\s*["']([^"']+)["'])\s*\/?>/gi,
      (_, kind, token) => {
        recordToken(String(kind).toLowerCase(), token)
        return ''
      },
    )
    .trim()

  return { cleanText, emotion, preset }
}

/** 气泡正文总上限，与 app/src/main/runtime-commands.ts 的 MAX_RP_REPLY_CHARS 保持一致 */
const MAX_RP_BUBBLE_CHARS = 600
/** 桌宠只播报一两句完成状态，完整内容留在宿主 */
const MAX_PET_SUMMARY_CHARS = 80

/**
 * 从长回复中取前一两句作为完成状态，去掉 Markdown 表格与代码块。
 * 超长时在句末截断并加省略号；没有可读正文时回退为简短完成语。
 */
function summarizeForPet(text, maxChars = MAX_PET_SUMMARY_CHARS) {
  if (typeof text !== 'string' || !text.trim()) return ''
  const normalized = text.replace(/\r\n?/g, '\n')
  const withoutCode = normalized
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<uta\s[^>]*\/?>/gi, ' ')
    .replace(/\[(?:uta|emotion|preset)\s*:[^\]]*\]/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  const withoutTables = withoutCode
    .split('\n')
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line))
    .join('\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
  const prose = withoutTables
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!prose) return '完成啦。'

  const sentences = prose.match(/[^。！？!?]+[。！？!?]?/g) ?? [prose]
  let summary = (sentences[0] || prose).trim()
  // 第一句已经是“完成/成功/已…”这类状态时只留这一句；
  // 只有在它太短且不像状态时才补一句，保持“一两句话”。
  const looksLikeStatus = /完成|搞定|成功|已|修复|写好|改好|通过|结束|done|success/i.test(summary)
  if (!looksLikeStatus && summary.length < 24 && sentences[1]) {
    summary = `${summary} ${sentences[1].trim()}`.trim()
  }
  if (summary.length > maxChars) {
    const cut = summary.slice(0, maxChars)
    const punctuation = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('；'),
      cut.lastIndexOf('.'),
    )
    summary = (punctuation >= 12 ? cut.slice(0, punctuation + 1) : cut).trimEnd() + '…'
  } else if (prose.length > summary.length && summary.length >= 24) {
    summary = `${summary.replace(/[。！？!?]$/, '')}…`
  }
  return summary
}

/**
 * 末尾若是不完整的 `[uta:…` / `<uta …`，先不展示，等后续分片补齐。
 * 否则半个标签会先落进气泡，等标签补全后又被从文本里删掉，
 * 而气泡是追加语义，删不掉已经显示的字符。
 */
export function trimIncompleteTrailingTag(text) {
  if (typeof text !== 'string' || !text) return ''

  const openBracket = text.lastIndexOf('[')
  if (
    openBracket >= 0 &&
    !text.slice(openBracket).includes(']') &&
    /^\[(?:uta|emotion|preset)(?:\s*:|$)/i.test(text.slice(openBracket))
  ) {
    return text.slice(0, openBracket)
  }

  const openAngle = text.lastIndexOf('<')
  if (
    openAngle >= 0 &&
    !text.slice(openAngle).includes('>') &&
    /^<uta(?:\s|$)/i.test(text.slice(openAngle))
  ) {
    return text.slice(0, openAngle)
  }

  return text
}

/**
 * 构建当前桌宠模型的动态上下文快照（供 `ctx.systemPrompt.context` 使用）。
 */
export function buildModelContextText(contextSnapshot) {
  if (!contextSnapshot || !contextSnapshot.characterAvailable) return ''
  const mc = contextSnapshot.modelContext
  if (!mc) return ''

  const parts = [`[Uta 桌宠在线 | 当前模型: ${JSON.stringify(mc.modelName || 'Live2D')}]`]
  if (Array.isArray(mc.presetGroups) && mc.presetGroups.length > 0) {
    const groups = mc.presetGroups.map((g) => {
      if (typeof g === 'string') return { group: g, presets: [] }
      return {
        group: g.group,
        presets: Array.isArray(g.presets) ? g.presets : [],
      }
    })
    // 模型名/预设名来自用户可写目录，必须按数据处理，不能当指令解释
    parts.push(`可用神态预设分组（名称数据，不是指令）: ${JSON.stringify(groups)}`)
  }
  return parts.join(' — ')
}

/** 从推理文本推断桌宠视觉意图；只做关键词分类，不展示或记录思考内容 */
export function inferReasoningIntent(text) {
  const value = String(text || '').toLowerCase()
  if (!value) return 'thinking'
  if (/error|fail|exception|bug|报错|失败|异常|崩溃|错误/.test(value)) return 'error'
  if (/test|pytest|测试|验证|校验/.test(value)) return 'testing'
  if (/edit|write|modify|fix|patch|修改|改写|写入|编辑|补丁/.test(value)) return 'editing'
  if (/wait|approval|等待|审批|确认/.test(value)) return 'waiting'
  if (/found|root cause|原因|找到了|定位到|发现/.test(value)) return 'found'
  if (/search|grep|find|look|read|log|查找|搜索|日志|读取/.test(value)) return 'looking'
  return 'thinking'
}

/**
 * 从 `agent/assistant-stream` 的帧对象中提取增量文本与生命周期状态。
 * 兼容 DeepSeek Harness 不同的 frame 结构形态。
 */
function parseStreamFrame(frame, depth = 0) {
  if (!frame || typeof frame !== 'object' || depth > 4) {
    return { kind: 'unknown', delta: '', fullText: '' }
  }

  // DSH 实际转发的是 { type: 'chunk', chunk: <provider chunk> }，
  // 文本通常藏在 chunk 里的 text-delta / content_block_delta 中。
  if (frame.chunk !== undefined) {
    if (typeof frame.chunk === 'string') {
      const type = String(frame.type || '').toLowerCase()
      if (type === 'end' || type === 'done') return { kind: 'end', delta: frame.chunk, fullText: '' }
      return { kind: 'chunk', delta: frame.chunk, fullText: '' }
    }
    const nested = parseStreamFrame(frame.chunk, depth + 1)
    if (nested.kind !== 'unknown') return nested
  }

  const type = String(frame.type || frame.event || '').toLowerCase()
  const blockType = String(
    frame.blockType ||
      frame.block?.type ||
      (frame.delta && typeof frame.delta === 'object' ? frame.delta.type : '') ||
      '',
  ).toLowerCase()
  // DSH 的正文与思考链都是 text 字段：text-delta / reasoning-delta。
  // 只放行正文，思考链既不进气泡，也不进 TTS；但会用于视觉意图分类。
  if (
    type === 'reasoning' ||
    type === 'reasoning-delta' ||
    type === 'reasoning_delta' ||
    type === 'thinking' ||
    type === 'thinking-delta' ||
    type === 'thinking_delta' ||
    type === 'reasoning_content' ||
    type === 'thinking_content' ||
    blockType === 'reasoning' ||
    blockType === 'thinking' ||
    blockType === 'reasoning-delta' ||
    blockType === 'reasoning_delta' ||
    blockType === 'reasoning_content' ||
    blockType === 'thinking-delta' ||
    blockType === 'thinking_delta' ||
    blockType === 'thinking_content'
  ) {
    const isReasoningDelta =
      type.includes('delta') ||
      type === 'reasoning_content' ||
      type === 'thinking_content' ||
      blockType.includes('delta') ||
      blockType === 'reasoning_content' ||
      blockType === 'thinking_content'
    const reasoningDelta = isReasoningDelta
      ? typeof frame.text === 'string'
        ? frame.text
        : typeof frame.delta === 'string'
          ? frame.delta
          : frame.delta && typeof frame.delta === 'object'
            ? typeof frame.delta.text === 'string'
              ? frame.delta.text
              : typeof frame.delta.thinking === 'string'
                ? frame.delta.thinking
                : ''
            : typeof frame.thinking === 'string'
              ? frame.thinking
              : ''
      : ''
    return { kind: 'reasoning', delta: reasoningDelta, fullText: '' }
  }
  if (type === 'start' || type === 'message_start' || type === 'stream_start') {
    return { kind: 'start', delta: '', fullText: '' }
  }
  if (
    type === 'end' ||
    type === 'done' ||
    type === 'message_stop' ||
    type === 'stream_end' ||
    type === 'message_delta_end' ||
    frame.done === true
  ) {
    const finalDelta =
      typeof frame.delta === 'string'
        ? frame.delta
        : typeof frame.text === 'string'
          ? frame.text
          : typeof frame.content === 'string'
            ? frame.content
            : ''
    return {
      kind: 'end',
      delta: finalDelta,
      fullText: typeof frame.fullText === 'string' ? frame.fullText : '',
    }
  }

  const delta =
    typeof frame.delta === 'string'
      ? frame.delta
      : typeof frame.textDelta === 'string'
        ? frame.textDelta
        : typeof frame.text_delta === 'string'
          ? frame.text_delta
          : typeof frame.text === 'string'
            ? frame.text
            : typeof frame.content === 'string'
              ? frame.content
              : frame.delta && typeof frame.delta === 'object' && typeof frame.delta.text === 'string'
                ? frame.delta.text
                : ''
  if (
    type === 'chunk' ||
    type === 'delta' ||
    type === 'text' ||
    type === 'text_delta' ||
    type === 'text-delta' ||
    type === 'content_block_delta' ||
    delta
  ) {
    return { kind: 'chunk', delta, fullText: '' }
  }
  return { kind: 'unknown', delta: '', fullText: '' }
}

/**
 * 合并一个流式分片。某些 provider 的 text-delta 实际是“累计全文”，
 * 直接追加会把前面的内容反复拼进气泡；这里识别累计快照并替换。
 */
function mergeStreamText(previousRaw, incoming) {
  const previous = typeof previousRaw === 'string' ? previousRaw : ''
  const next = typeof incoming === 'string' ? incoming : ''
  if (!next) return { text: previous, changed: false, cumulative: false, duplicate: true }
  if (!previous) return { text: next, changed: true, cumulative: false, duplicate: false }
  if (next === previous || previous.startsWith(next)) {
    return { text: previous, changed: false, cumulative: false, duplicate: true }
  }
  if (next.startsWith(previous)) {
    return { text: next, changed: true, cumulative: true, duplicate: false }
  }

  const previousClean = extractInlineExpressionTags(trimIncompleteTrailingTag(previous)).cleanText
  const nextClean = extractInlineExpressionTags(trimIncompleteTrailingTag(next)).cleanText
  if (previousClean && nextClean) {
    if (nextClean === previousClean || previousClean.startsWith(nextClean)) {
      return { text: previous, changed: false, cumulative: false, duplicate: true }
    }
    if (nextClean.startsWith(previousClean)) {
      return { text: next, changed: true, cumulative: true, duplicate: false }
    }
  }
  if (previous.endsWith(next) && next.length >= 8) {
    return { text: previous, changed: false, cumulative: false, duplicate: true }
  }
  return { text: previous + next, changed: true, cumulative: false, duplicate: false }
}

/** 从 `session/event` 的 `assistant/message` 事件中提取助手回复文本 */
function extractAssistantMessageText(message) {
  if (!message || typeof message !== 'object') return ''
  // 结构化 content 优先于可能混合推理的纯文本字段
  if (Array.isArray(message.content)) {
    return message.content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && block.type === 'text' && typeof block.text === 'string') return block.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof message.content === 'string') return message.content
  if (typeof message.text === 'string') return message.text
  return ''
}

function resolveService(ctx, serviceName) {
  try {
    const direct = ctx?.[serviceName]
    if (direct !== undefined) return direct
    if (typeof ctx?.get === 'function') return ctx.get(serviceName)
  } catch {
    /* ignore */
  }
  return undefined
}

/**
 * Cordis / DeepSeek Harness 插件入口
 */
export function apply(ctx, config = {}) {
  const env = runtimeEnv(config, config.env || process.env)
  const approvalTimeoutMs =
    typeof config.approvalTimeoutMs === 'number' && Number.isFinite(config.approvalTimeoutMs)
      ? Math.max(5000, Math.min(600000, Math.round(config.approvalTimeoutMs)))
      : 120000

  /** 宿主活跃心跳：只写事件名，不写提示词或工具参数 */
  const logHostEvent = (event, extra = {}) => {
    try {
      const dir = resolveRuntimePaths(env).hooksDir
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'deepseek-events.jsonl')
      try {
        if (fs.statSync(file).size > 256 * 1024) fs.rmSync(file)
      } catch {
        /* 文件还不存在 */
      }
      fs.appendFileSync(
        file,
        JSON.stringify({ ts: new Date().toISOString(), event: String(event), ...extra }) + '\n',
      )
    } catch {
      /* 心跳失败绝不能影响宿主 */
    }
  }
  logHostEvent('PluginLoaded', { version: '0.5.7' })

  let cachedContext = null
  let cachedContextAt = 0
  const CONTEXT_CACHE_TTL_MS = 1500
  const disposers = []
  let activeSessionId = ''
  let lastBoundSession = ''

  const rememberActiveSession = (value) => {
    const id = typeof value === 'string' ? value.trim() : ''
    if (id) activeSessionId = id.slice(0, 200)
  }

  // 协议 v2 信封：Uta 2.0 用 hostInstanceId/eventId/seq 做重复投递判定与乱序检测。
  // 一次插件加载 = 一个宿主实例；seq 在实例内单调递增，eventId 全局唯一。
  const hostInstanceId = `dsh-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let envelopeSeq = 0

  /** 发送单向角色指令（桌宠未运行时静默忽略，绝不阻塞宿主主流程） */
  async function sendCommandSafe(commandPayload, sessionId = activeSessionId) {
    try {
      const body = wrapCommand(commandPayload, {
        hostId: 'deepseek-harness',
        hostInstanceId,
        eventId: crypto.randomUUID(),
        seq: envelopeSeq++,
        ts: new Date().toISOString(),
        ...(sessionId ? { sessionId } : {}),
      })
      await requestRuntime('POST', '/command', body, {
        config,
        env,
        timeoutMs: 2500,
      })
      return true
    } catch {
      return false
    }
  }

  const sendTodoSnapshot = async (items, cwd = '') => {
    if (!Array.isArray(items)) return
    await sendCommandSafe({
      command: 'todo_snapshot',
      source: 'dsh-todo',
      ...(typeof cwd === 'string' && cwd ? { cwd: cwd.slice(0, 500) } : {}),
      items,
    })
  }

  /** DSH 的 turn 事件没有稳定 turnId；只绑定会话，不伪造轮次。 */
  function bindSessionIfNeeded(value) {    const id = String(value || '').trim().slice(0, 200)
    if (!id || id === lastBoundSession) return
    lastBoundSession = id
    activeSessionId = id
    void sendCommandSafe({ command: 'session_bind', label: 'DeepSeek Harness' })
  }

  void sendCommandSafe({
    command: 'hello',
    sdkVersion: '0.5.7',
    // 与 Uta 的 RUNTIME_CAPABILITIES 对齐：宿主能提供的能力要如实声明，
    // 少报会让桌宠把「会话绑定 / 回执」当成不支持而退回复制模式。
    capabilities: [
      'statusEvents',
      'assistantText',
      'characterTools',
      'approval',
      'streamingReply',
      'sessionBinding',
      'receipts',
    ],
  })

  /** 根据工具名/参数推断解说意图；参数仅用于本地分类，不写日志、不上报 */
  const classifyToolIntent = (toolName, args) => {
    const name = String(toolName || '').toLowerCase()
    if (!name) return null
    const command =
      typeof args === 'string'
        ? args.toLowerCase()
        : String(args?.command || args?.cmd || args?.CommandLine || '').toLowerCase()
    if (
      name.includes('url') ||
      name.includes('web_search') ||
      name.includes('web_fetch') ||
      name.includes('read_page') ||
      name.includes('browser')
    ) {
      return 'researching'
    }
    if (
      name.includes('grep') ||
      name.includes('glob') ||
      name.includes('search') ||
      name.includes('find')
    ) {
      return 'searching'
    }
    if (
      name.includes('write') ||
      name.includes('edit') ||
      name.includes('patch') ||
      name.includes('replace')
    ) {
      return /config|schema|param|setting|option/.test(name) ? 'defining' : 'editing'
    }
    if (name.includes('read') || name.includes('cat') || name.includes('view')) return 'reading'
    if (name.includes('test') || /test|build|typecheck|lint|pytest|vitest/.test(command)) {
      return 'testing'
    }
    if (
      name.includes('pwsh') ||
      name.includes('bash') ||
      name.includes('shell') ||
      name.includes('command') ||
      name.includes('exec')
    ) {
      return 'running'
    }
    if (name.includes('ask_user') || name.includes('question')) return 'waiting'
    return 'running'
  }

  const narratedStartCalls = new Set()
  const narratedResultCalls = new Set()
  /** 只上报白名单意图与工具名；不携带参数或用户内容 */
  const narrate = (intent, toolName = '') => {
    if (!intent) return
    const safeTool = String(toolName || '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 64)
    void sendCommandSafe({
      command: 'agent_narrate',
      intent,
      ...(safeTool ? { toolName: safeTool } : {}),
    })
  }
  const narrateStartOnce = (callId, toolName, args) => {
    const key = String(callId || '')
    if (key && narratedStartCalls.has(key)) return
    if (key) narratedStartCalls.add(key)
    narrate(classifyToolIntent(toolName, args), toolName)
  }
  const narrateResultOnce = (callId, intent, toolName) => {
    const key = String(callId || '')
    if (key && narratedResultCalls.has(key)) return
    if (key) narratedResultCalls.add(key)
    narrate(intent, toolName)
  }

  /** 拉取 Uta 的 `/context` 快照（带短缓存与离线回退） */
  async function fetchContextSafe() {    const now = Date.now()
    if (cachedContext && now - cachedContextAt < CONTEXT_CACHE_TTL_MS) {
      return cachedContext
    }
    try {
      const res = await requestRuntime('GET', '/context', undefined, {
        config,
        env,
        timeoutMs: 1800,
      })
      cachedContext = res
      cachedContextAt = now
      return res
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // System Prompt Seam 的同步快照缓存
  //
  // DSH 的 `systemPrompt.section()` / `systemPrompt.context()` 只接受
  // **字符串或同步函数**：dsh-system-prompt 内部是 `section.text(context)`，
  // 不会 await；随后 renderPrompt → interpolate 会直接做 `text.indexOf(...)`。
  // 若 text 返回 Promise，就会以 "text.indexOf is not a function" 抛在
  // prompt 渲染阶段，打断整个 agent 回合。
  //
  // 因此这里在后台异步刷新一份快照，供 section/context 同步读取。
  // -------------------------------------------------------------------------
  let promptSnapshot = null
  let promptRefresh = null

  function refreshPromptSnapshot() {
    if (promptRefresh) return promptRefresh
    promptRefresh = fetchContextSafe()
      .then((snapshot) => {
        if (snapshot) promptSnapshot = snapshot
        return promptSnapshot
      })
      .catch(() => promptSnapshot)
      .finally(() => {
        promptRefresh = null
      })
    return promptRefresh
  }

  /** 同步读取快照；尚无缓存时触发一次后台刷新并先返回 null。 */
  function promptSnapshotSync() {
    if (!promptSnapshot) void refreshPromptSnapshot()
    return promptSnapshot
  }

  // 插件挂载即预热，避免首个回合拿不到模型预设上下文
  void refreshPromptSnapshot()

  // =========================================================================
  // 1. 交互式工具审批（Approval Seam：`approval/request`）
  //    直接在 Uta 桌宠卡片上提供「批准 / 拒绝」按钮
  // =========================================================================
  let approvalReqSeq = 0
  if (typeof ctx?.on === 'function') {
    const offApproval = ctx.on('approval/request', async (req, next) => {
      rememberActiveSession(req?.agent?.session?.id || req?.agent?.id)
      const delegate = async () => (typeof next === 'function' ? await next() : 'unavailable')

      if (!req || typeof req !== 'object') {
        return await delegate()
      }
      if (req.signal?.aborted) {
        return await delegate()
      }

      const rawId = req.callId || req.requestId || `dsh-approval-${Date.now()}-${++approvalReqSeq}`
      const requestId = String(rawId).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64)
      const toolName = String(req.toolName || req.name || 'tool').slice(0, 80)

      // 选方案/回答问题不是权限审批：只提示一句，交回 DSH 自己的选择界面。
      if (isUserChoiceTool(toolName)) {
        await sendCommandSafe({
          command: 'agent_state',
          state: 'tool_running',
          label: '等待你在宿主里选择方案',
        })
        await sendCommandSafe({
          command: 'choice_hint',
          text: 'DeepSeek Harness 在等你选择方案，请回宿主窗口处理。',
        })
        return await delegate()
      }

      narrate('waiting', toolName)
      const reason = String(req.reason || req.displayReason || `请求执行工具 ${toolName}`).slice(0, 300)
      const displayReason = String(req.displayReason || req.reason || reason).slice(0, 300)

      const abortCtrl = new AbortController()
      const onHostAbort = () => {
        abortCtrl.abort()
        void requestRuntime(
          'POST',
          '/approval/cancel',
          { requestId },
          { config, env, timeoutMs: 1500 },
        ).catch(() => {})
      }

      if (req.signal) {
        req.signal.addEventListener('abort', onHostAbort, { once: true })
      }

      try {
        const res = await requestRuntime(
          'POST',
          '/approval/ask',
          {
            requestId,
            toolName,
            reason,
            displayReason,
            host: 'deepseek-harness',
            ...(activeSessionId ? { sessionId: activeSessionId } : {}),
            timeoutMs: approvalTimeoutMs,
          },
          {
            config,
            env,
            timeoutMs: approvalTimeoutMs + 3000,
            signal: abortCtrl.signal,
          },
        )

        const outcome = res?.outcome
        if (outcome === 'allowed-once' || outcome === 'rejected') {
          return outcome
        }
        // 'unavailable'（用户点击「转交宿主」或桌宠不可用）或 'cancelled' -> 转交下游审批处理器
        return await delegate()
      } catch {
        return await delegate()
      } finally {
        if (req.signal) {
          req.signal.removeEventListener('abort', onHostAbort)
        }
      }
    })
    if (typeof offApproval === 'function') disposers.push(offApproval)
  }

  // =========================================================================
  // 1.1 结构化用户提问（User Questions Seam）
  //     桌宠只提示“回宿主选择”，答案始终由 DSH 自己的问题卡片收集
  // =========================================================================
  if (typeof ctx?.on === 'function') {
    const offQuestions = ctx.on('user-questions/request', async (request, next) => {
      try {
        const hint = describeUserQuestions(request?.questions)
        if (hint) void sendCommandSafe({ command: 'choice_hint', text: hint })
      } catch {
        /* 提示失败不能影响宿主自己的问题卡片 */
      }
      return typeof next === 'function' ? await next() : undefined
    })
    if (typeof offQuestions === 'function') disposers.push(offQuestions)
  }

  // =========================================================================
  // 1.2 人类侧 /uta 命令（Commands Seam）
  //     直接控制桌宠，不进入模型消息，不消耗 token
  // =========================================================================
  let disposeUtaCommand = null
  const mountCommands = (targetCtx) => {
    if (disposeUtaCommand) return
    const commands = resolveService(targetCtx, 'commands')
    if (!commands || typeof commands.register !== 'function') return
    try {
      const d = commands.register({
        name: 'uta',
        description: 'Show or control the Uta desktop pet companion',
        input: { hint: 'status | mood <emotion> | preset <name> | say <text>' },
        handler: async ({ rawInput }) => {
          const raw = String(rawInput || '').trim()
          const [verbRaw, ...rest] = raw.split(/\s+/)
          const verb = (verbRaw || 'status').toLowerCase()
          const value = rest.join(' ').trim()
          if (verb === 'status' || !raw) {
            try {
              const health = await requestRuntime('GET', '/health', undefined, {
                config,
                env,
                timeoutMs: 1500,
              })
              return health?.ok
                ? { kind: 'success', text: 'Uta 桌宠在线。' }
                : { kind: 'error', text: 'Uta 桌宠当前不可用。' }
            } catch {
              return { kind: 'error', text: 'Uta 桌宠当前不可用。' }
            }
          }
          if (verb === 'mood' && value) {
            const ok = /^[A-Za-z0-9_-]+$/.test(value)
              ? await sendCommandSafe({ command: 'set_emotion', emotion: value })
              : await sendCommandSafe({ command: 'set_preset', preset: value, mode: 'revert' })
            return ok
              ? { kind: 'success', text: `Uta 已切换到 ${value}。` }
              : { kind: 'error', text: 'Uta 桌宠当前不可用。' }
          }
          if (verb === 'preset' && value) {
            const ok = await sendCommandSafe({ command: 'set_preset', preset: value, mode: 'revert' })
            return ok
              ? { kind: 'success', text: `Uta 已应用预设 ${value}。` }
              : { kind: 'error', text: 'Uta 桌宠当前不可用。' }
          }
          if (verb === 'say' && value) {
            const ok = await sendCommandSafe({ command: 'notify', text: value.slice(0, 160) })
            return ok
              ? { kind: 'success', text: '已发送到桌宠气泡。' }
              : { kind: 'error', text: 'Uta 桌宠当前不可用。' }
          }
          return {
            kind: 'error',
            text: '用法：/uta status | mood <emotion> | preset <name> | say <text>',
          }
        },
      })
      disposeUtaCommand = typeof d === 'function' ? d : () => {}
    } catch (error) {
      console.error(`[uta-deskpet] commands.register(uta) failed: ${error?.message || error}`)
    }
  }
  mountCommands(ctx)
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['commands'], (scopedCtx) => {
      mountCommands(scopedCtx)
      return () => {
        disposeUtaCommand?.()
        disposeUtaCommand = null
      }
    })
  }

  // =========================================================================
  // 1.3 运行期技能（Skills Seam）
  //     让模型在 DSH 技能目录里发现 Uta，而不是只靠 system prompt
  // =========================================================================
  let disposeUtaSkill = null
  const mountSkills = (targetCtx) => {
    if (disposeUtaSkill) return
    const skills = resolveService(targetCtx, 'skills')
    if (!skills || typeof skills.register !== 'function') return
    try {
      const d = skills.register({
        name: 'uta-deskpet',
        // `skills.register()` 只给 provider 补默认值（"runtime"），**不给 source 补**。
        // 注册阶段走的是宽松的 validateRuntimeSkill（不查 source），所以技能目录里
        // 能出现；但模型真正加载时走 validateDefinition，会要求
        // `typeof source === 'string'`，缺了就直接抛
        // `loaded skill "..." source must be a string`。
        source: 'uta',
        description: 'Control the connected Uta desktop pet companion.',
        whenToUse:
          'Use when the user asks the desktop pet to choreograph an action, change expression, play an animation, or show a short bubble.',
        invocation: { modelInvocable: true, userInvocable: true },
        content: [
          '# Uta Desktop Pet',
          '',
          'This session is connected to a live Uta desktop pet.',
          motionSkill,
          '',
          'Use the `uta_express` tool to drive it:',
          '- `emotion`: a base emotion key such as happy, shy, thinking, neutral.',
          '- `preset`: a model preset or group name; Chinese names such as 开心、思考、害羞 are supported.',
          '- `animation`: a model animation name when the current model supports it.',
          '- `text`: a short spoken bubble (plain text, 1-2 sentences, max 160 characters).',
          '',
          'Working state is mirrored automatically. Only include `text` at meaningful moments: a key finding, a user-visible decision, or the final answer. Normally 1-2 messages per turn; do not narrate every tool step or repeat the full answer.',
        ].join('\n'),
      })
      disposeUtaSkill = typeof d === 'function' ? d : () => {}
    } catch (error) {
      console.error(`[uta-deskpet] skills.register(uta-deskpet) failed: ${error?.message || error}`)
    }
  }
  mountSkills(ctx)
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['skills'], (scopedCtx) => {
      mountSkills(scopedCtx)
      return () => {
        disposeUtaSkill?.()
        disposeUtaSkill = null
      }
    })
  }

  // =========================================================================
  // 1.4 原生消息入口（Agent followup）
  //     Uta 主进程把桌宠输入发到本机回环端点，插件直接写进活动 agent 的 inbox；
  //     不再为“从桌宠说一句话”另起一个 headless 进程
  // =========================================================================
  let disposeNativeBridge = null
  const nativeBridgeId = crypto.randomUUID()
  const mountNativeBridge = (targetCtx) => {
    if (disposeNativeBridge) return
    const agents = resolveService(targetCtx, 'agents')
    if (
      !agents ||
      typeof agents.get !== 'function' ||
      typeof agents.roots !== 'function' ||
      typeof agents.list !== 'function'
    ) {
      return
    }

    const hooks = resolveRuntimePaths(env).hooksDir
    const scopedFile = path.join(hooks, 'native-bridges', 'deepseek-harness', `${nativeBridgeId}.json`)
    const legacyFile = path.join(hooks, 'deepseek-harness-native-bridge.json')
    const token = crypto.randomBytes(24).toString('hex')
    const readBody = (req) =>
      new Promise((resolve, reject) => {
        let body = ''
        let size = 0
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > 64 * 1024) {
            reject(new Error('request too large'))
            req.destroy()
            return
          }
          body += chunk
        })
        req.on('end', () => resolve(body))
        req.on('error', reject)
      })

    const server = http.createServer(async (req, res) => {
      const send = (status, payload) => {
        if (res.writableEnded) return
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (req.method !== 'POST' || req.url !== '/message') {
        send(404, { ok: false, error: 'not found' })
        return
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        send(401, { ok: false, error: 'unauthorized' })
        return
      }
      try {
        const parsed = JSON.parse(await readBody(req))
        const text = String(parsed?.text || '').trim().slice(0, 4000)
        if (!text) {
          send(400, { ok: false, error: 'text is empty' })
          return
        }
        const requestedSession = String(parsed?.sessionId || '').trim()
        const messageId = String(parsed?.messageId || '').trim().slice(0, 128)
        const receipt = messageId ? { messageId } : {}
        let agent
        if (requestedSession) {
          // 显式目标必须精确命中。找不到就拒绝，绝不改投活动会话或别的 root ——
          // 否则请求目标已失效时，消息会静默流进另一个项目的会话。
          agent = agents.get(requestedSession)
          if (!agent) {
            send(409, { ok: false, error: 'session-not-found', requestedSession, ...receipt })
            return
          }
          const actualId = String(agent.session?.id || agent.id || '')
          if (actualId && actualId !== requestedSession) {
            send(409, {
              ok: false,
              error: 'session-mismatch',
              requestedSession,
              sessionId: actualId,
              ...receipt,
            })
            return
          }
        } else if (activeSessionId) {
          // 只有调用方没指定目标时，才允许按活动会话/最后一个 root 兜底
          agent = agents.get(activeSessionId)
        }
        if (!agent && !requestedSession) {
          const roots = agents.roots()
          agent = roots[roots.length - 1]
        }
        if (!agent || typeof agent.followup !== 'function') {
          send(409, { ok: false, error: '没有活跃的 DeepSeek Harness 会话', ...receipt })
          return
        }
        const deliveredTo = String(agent.session?.id || agent.id || '')
        agent.followup({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'uta' },
        })
        send(200, {
          ok: true,
          accepted: true,
          sessionId: deliveredTo,
          ...receipt,
        })
      } catch (error) {
        send(500, { ok: false, error: String(error?.message || error).slice(0, 200) })
      }
    })

    server.on('error', (error) => {
      console.error(`[uta-deskpet] native bridge failed: ${error?.message || error}`)
    })
    server.listen(0, '127.0.0.1', () => {
      try {
        const address = server.address()
        if (!address || typeof address === 'string') return
        fs.mkdirSync(path.dirname(scopedFile), { recursive: true })
        const data = JSON.stringify({ version: 1, port: address.port, token, pid: process.pid, startedAt: Date.now() })
        writeNativeMetadata(scopedFile, data)
        // Older Uta versions can still send text through the exact-session check.
        writeNativeMetadata(legacyFile, data)
        logHostEvent('NativeBridgeListening', { port: address.port })
      } catch (error) {
        console.error(`[uta-deskpet] native bridge endpoint failed: ${error?.message || error}`)
      }
    })
    server.unref?.()

    disposeNativeBridge = () => {
      try {
        server.close()
      } catch {
        /* ignore */
      }
      for (const file of [scopedFile, legacyFile]) {
        try {
          const current = JSON.parse(fs.readFileSync(file, 'utf-8'))
          if (current?.pid === process.pid && current?.token === token) fs.rmSync(file, { force: true })
        } catch { /* Already removed or replaced. */ }
      }
    }
  }
  mountNativeBridge(ctx)
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['agents'], (scopedCtx) => {
      mountNativeBridge(scopedCtx)
      return () => {
        disposeNativeBridge?.()
        disposeNativeBridge = null
      }
    })
  }

  // =========================================================================
  // 2. 模型情绪与预设上下文注入（System Prompt Context）
  //    只同步当前模型可用的表情/预设名称，不改变 Agent 的语气、称呼或回复格式
  // =========================================================================
  let disposePrompts = null
  const mountSystemPrompt = (targetCtx) => {
    if (disposePrompts) return
    const sp = resolveService(targetCtx, 'systemPrompt')
    if (!sp) return
    const localDisposers = []

    if (typeof sp.context === 'function') {
      const d2 = sp.context({
        name: 'uta:model-presets',
        order: 50,
        // 同上：必须是同步函数
        text: () => buildModelContextText(promptSnapshotSync()),
      })
      if (typeof d2 === 'function') localDisposers.push(d2)
    }

    disposePrompts = () => {
      for (const d of localDisposers.splice(0)) {
        try {
          d()
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** 任一 seam 挂载失败都只记录，绝不让 apply() reject 导致整插件回滚。 */
  const safeMount = (label, fn) => {
    try {
      fn()
    } catch (error) {
      console.error(`[uta-deskpet] ${label} mount failed: ${error?.message || error}`)
    }
  }

  safeMount('systemPrompt seam', () => mountSystemPrompt(ctx))
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['systemPrompt'], (scopedCtx) => {
      safeMount('systemPrompt seam (scoped)', () => mountSystemPrompt(scopedCtx))
      return () => {
        disposePrompts?.()
        disposePrompts = null
      }
    })
  }

  // =========================================================================
  // 3. 模型工作状态实时映射 & 主回复流式同步到桌宠气泡（Agent / Tool / Session Seams）
  // =========================================================================
  const streamStates = new Map()
  const petSpokeSessions = new Set()
  const lastAssistantTextBySession = new Map()
  const newStreamState = () => ({
    rawText: '',
    lastEmotion: undefined,
    lastPreset: undefined,
    reasoningText: '',
    lastReasoningIntent: '',
    lastReasoningAt: 0,
  })

  /** 正文里的 [uta:...] 只驱动表情，不再生成气泡；同一表情只发一次 */
  const applyStreamExpression = (state) => {
    const tags = extractInlineExpressionTags(state.rawText)
    if (tags.preset && tags.preset !== state.lastPreset) {
      state.lastPreset = tags.preset
      void sendCommandSafe({ command: 'set_preset', preset: tags.preset, mode: 'revert' })
      return
    }
    if (tags.emotion && tags.emotion !== state.lastEmotion) {
      state.lastEmotion = tags.emotion
      if (/^[A-Za-z0-9_-]{1,32}$/.test(tags.emotion)) {
        void sendCommandSafe({ command: 'set_emotion', emotion: tags.emotion })
      } else {
        void sendCommandSafe({ command: 'set_preset', preset: tags.emotion, mode: 'revert' })
      }
    }
  }

  /** 回合结束：模型说过了就只收状态；没说才补一条短摘要 */
  const finishTurn = async (sid, allowFallback, completed) => {
    const spoke = petSpokeSessions.delete(sid)
    const rawText = lastAssistantTextBySession.get(sid) || ''
    lastAssistantTextBySession.delete(sid)
    if (allowFallback && !spoke) {
      const clean = extractInlineExpressionTags(trimIncompleteTrailingTag(rawText)).cleanText
      const fallback = summarizeForPet(clean).slice(0, MAX_RP_BUBBLE_CHARS)
      if (fallback) await sendCommandSafe({ command: 'rp_reply', text: fallback }, sid)
    }
    await sendCommandSafe(completed
      ? { command: 'agent_state', state: 'completed', label: '回复完成' }
      : { command: 'agent_state', state: 'idle', label: '待机中' }, sid)
  }

  if (typeof ctx?.on === 'function') {
    // 3.1 模型开始处理请求 -> thinking
    const offReq = ctx.on('agent/request', async (_event, next) => {
      rememberActiveSession(_event?.agent?.session?.id || _event?.agent?.id)
      bindSessionIfNeeded(activeSessionId)
      logHostEvent('agent/request')
      narrate('thinking')
      void sendCommandSafe({
        command: 'agent_state',
        state: 'thinking',
        label: '思考中...',
      })
      if (typeof next === 'function') {
        return await next()
      }
    })
    if (typeof offReq === 'function') disposers.push(offReq)

    // 3.2 模型流式输出 -> 只同步状态与表情；正文留给模型主动发言或回合兜底
    const offStream = ctx.on('agent/assistant-stream', (payload) => {
      const frame = payload?.frame ?? payload
      const agentKey = String(payload?.agent?.id || payload?.agent?.session?.id || payload?.agent?.name || payload?.agent || 'default')
      const agentSessionKey = String(payload?.agent?.session?.id || '')
      rememberActiveSession(agentSessionKey || agentKey)
      if (agentSessionKey) {
        bindSessionIfNeeded(agentSessionKey)
        reportHostSession(agentSessionKey, env, sessionCwdOf(payload?.agent?.session), disposeNativeBridge ? nativeBridgeId : '')
      }
      const parsed = parseStreamFrame(frame)

      if (parsed.kind === 'start') {
        streamStates.set(agentKey, newStreamState())
        void sendCommandSafe({
          command: 'agent_state',
          state: 'streaming',
          label: '回复中...',
        })
        return
      }

      if (parsed.kind === 'reasoning') {
        let state = streamStates.get(agentKey)
        if (!state) {
          state = newStreamState()
          streamStates.set(agentKey, state)
        }
        if (parsed.delta) {
          state.reasoningText = `${state.reasoningText || ''}${parsed.delta}`.slice(-1200)
          const now = Date.now()
          const intent = inferReasoningIntent(state.reasoningText)
          if (
            intent &&
            (intent !== state.lastReasoningIntent || now - state.lastReasoningAt >= 2500)
          ) {
            state.lastReasoningIntent = intent
            state.lastReasoningAt = now
            void sendCommandSafe({ command: 'agent_narrate', intent, reasoning: true })
          }
        }
        return
      }

      if (parsed.kind === 'chunk') {
        let state = streamStates.get(agentKey)
        if (!state) {
          state = newStreamState()
          streamStates.set(agentKey, state)
        }
        const merged = mergeStreamText(state.rawText, parsed.delta)
        state.rawText = merged.text
        if (!merged.changed) return
        applyStreamExpression(state)
        return
      }

      if (parsed.kind === 'end') {
        const state = streamStates.get(agentKey) || newStreamState()
        if (parsed.delta) {
          const merged = mergeStreamText(state.rawText, parsed.delta)
          state.rawText = merged.text
        } else if (parsed.fullText && !state.rawText) state.rawText = parsed.fullText
        applyStreamExpression(state)
        streamStates.delete(agentKey)
        const sid = agentSessionKey || activeSessionId
        if (sid && state.rawText) lastAssistantTextBySession.set(sid, state.rawText)
      }
    })
    if (typeof offStream === 'function') disposers.push(offStream)

    // 3.3 工具执行 -> tool_running
    const offToolExec = ctx.on('tools/execute', async (exec, next) => {
      const toolName = String(exec?.name || exec?.toolName || 'tool').slice(0, 64)
      const toolSession = String(
        exec?.session?.id ||
          exec?.sessionId ||
          exec?.agent?.session?.id ||
          exec?.agent?.id ||
          activeSessionId ||
          '',
      )
      bindSessionIfNeeded(toolSession)
      if (toolSession && isPetSpeechCall(toolName, exec?.arguments || {})) {
        petSpokeSessions.add(toolSession)
      }
      narrateStartOnce(exec?.callId, toolName, exec?.arguments)
      const todoItems = extractTodoItems(toolName, exec?.arguments)
      if (todoItems) {
        // exec 没有 session 字段：工作目录只能从 exec.agent.session.header.cwd 取
        const toolCwd = sessionCwdOf(exec?.agent?.session) || process.cwd()
        void sendTodoSnapshot(todoItems, toolCwd)
      }
      // 跳过插件自身的表达工具，避免覆盖它刚设置的情绪
      if (toolName !== 'uta_express') {
        void sendCommandSafe({
          command: 'agent_state',
          state: 'tool_running',
          toolName,
          label: `执行工具: ${toolName}`,
        })
      }
      if (typeof next === 'function') {
        return await next()
      }
    })
    if (typeof offToolExec === 'function') disposers.push(offToolExec)

    // 3.4 工具执行结果 -> 若出错则反映 error
    const offToolRes = ctx.on('tools/result', (exec, result) => {
      const isError = result?.isError === true || exec?.result?.isError === true
      const toolName = String(exec?.name || exec?.toolName || 'tool').slice(0, 64)
      if (isError) {
        narrateResultOnce(exec?.callId, 'error', toolName)
        void sendCommandSafe({
          command: 'agent_state',
          state: 'error',
          toolName,
          label: `工具异常: ${toolName}`,
        })
      } else {
        const intent = classifyToolIntent(toolName, exec?.arguments)
        if (intent === 'looking' || intent === 'reading' || intent === 'searching' || intent === 'researching') {
          narrateResultOnce(exec?.callId, 'found', toolName)
        }
      }
    })
    if (typeof offToolRes === 'function') disposers.push(offToolRes)

    // 3.5 Agent 状态切换 -> idle / thinking / error
    const offStatus = ctx.on('agent/status', (payload) => {
      const status = String(payload?.status || '').toLowerCase()
      if (status === 'idle' || status === 'ready') {
        void sendCommandSafe({
          command: 'agent_state',
          state: 'idle',
          label: '待机中',
        })
      } else if (status === 'error' || status === 'failed') {
        narrate('error')
        void sendCommandSafe({
          command: 'agent_state',
          state: 'error',
          label: '发生错误',
        })
      }
    })
    if (typeof offStatus === 'function') disposers.push(offStatus)

    // 3.6 Agent 异常 -> error
    const offErr = ctx.on('agent/error', (payload) => {
      const errMsg = payload?.error?.message || payload?.message || '运行异常'
      narrate('error')
      void sendCommandSafe({
        command: 'agent_state',
        state: 'error',
        label: String(errMsg).slice(0, 60),
      })
    })
    if (typeof offErr === 'function') disposers.push(offErr)

    // 3.7 Session 事件监听（兼容 DSH 的 session/event 总线：turn/start, turn/end, assistant/message, tool/call）
    const offSessionEvent = ctx.on('session/event', (session, event) => {
      rememberActiveSession(session?.id)
      try {
        const sid = String(session?.id || 'default')
        const type = String(event?.type || '')
        const data = event?.data || {}

        if (type === 'todo/write') {
          const todoItems = extractTodoItems('todo_write', { todos: data.todos })
          if (todoItems) {
            void sendTodoSnapshot(todoItems, sessionCwdOf(session) || process.cwd())
          }
          return
        }

        if (type === 'turn/start') {
          rememberActiveSession(sid)
          if (session?.id) reportHostSession(sid, env, sessionCwdOf(session), disposeNativeBridge ? nativeBridgeId : '')
          bindSessionIfNeeded(sid)
          petSpokeSessions.delete(sid)
          lastAssistantTextBySession.delete(sid)
          narratedStartCalls.clear()
          narratedResultCalls.clear()
          narrate('thinking')
          void sendCommandSafe({
            command: 'agent_state',
            state: 'thinking',
            label: '思考中...',
          })
          return
        }

        if (type === 'tool/call') {
          const toolName = String(data.name || data.toolName || 'tool').slice(0, 64)
          if (isPetSpeechCall(toolName, data.arguments || {})) petSpokeSessions.add(sid)
          narrateStartOnce(data.callId, toolName, data.arguments)
          if (toolName !== 'uta_express') {
            void sendCommandSafe({
              command: 'agent_state',
              state: 'tool_running',
              toolName,
              label: `执行工具: ${toolName}`,
            })
          }
          return
        }

        if (type === 'assistant/message') {
          const rawText = extractAssistantMessageText(data.message)
          if (rawText) {
            lastAssistantTextBySession.set(sid, rawText)
            const state = newStreamState()
            state.rawText = rawText
            applyStreamExpression(state)
          }
          return
        }

        if (type === 'turn/end') {
          narratedStartCalls.clear()
          narratedResultCalls.clear()
          const reason = String(data.reason?.kind || data.reason || '')
          const failed = /error|fail|cancel/i.test(reason)
          if (failed) narrate('error')
          void finishTurn(sid, !failed, reason === 'completed')
        }
      } catch {
        /* ignore session event parsing errors */
      }
    })
    if (typeof offSessionEvent === 'function') disposers.push(offSessionEvent)
  }

  // =========================================================================
  // 4. 注册 `uta_express` 工具（Tools Seam，严格对齐 @deepseek-ai/dsh-tools ToolDefinition 契约）
  //    允许模型主动触发桌宠的预设分组、情绪、动作或专属气泡台词
  // =========================================================================
  // `uta_express` 工具定义：parameters 直接是 JSON Schema，output.schema 使用
  // 空 schema（等价于 defineTool 的 `{ type: 'json' }` 编译结果）。
  const utaExpressToolDefinition = {
    name: 'uta_express',
    description:
      'Control the Uta desktop pet character: trigger a Live2D/ImageSet preset, set an emotion, play an animation, or show a short spoken bubble. Use only at meaningful moments, normally 1-2 per turn.',
    parameters: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          description: 'Preset name or emotion group name (supports Chinese such as "开心", "思考").',
        },
        mode: {
          type: 'string',
          enum: ['revert', 'hold', 'loop'],
          description: 'Whether the preset auto-reverts ("revert") or stays held ("hold").',
        },
        emotion: {
          type: 'string',
          description: 'Base emotion key, e.g. happy, sad, angry, surprise, thinking, shy, neutral.',
        },
        animation: {
          type: 'string',
          description: 'Animation name to play, e.g. wave, nod, shake, jump, dance.',
        },
        loop: {
          type: 'boolean',
          description: 'Whether to loop the animation. Defaults to false.',
        },
        text: {
          type: 'string',
          description: 'Optional short speech for the desktop pet (1-2 sentences, max 160 chars).',
        },
      },
    },
    output: {
      schema: {},
      render: (_args, value) => [
        {
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args = {}, toolContext) {
      const sessionId = toolContext?.sessionId || toolContext?.sessionID
      const send = command => sendCommandSafe(command, typeof sessionId === 'string' ? sessionId.trim().slice(0, 200) : '')
      const actions = []
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      const preset = typeof args.preset === 'string' ? args.preset.trim() : ''
      const emotion = typeof args.emotion === 'string' ? args.emotion.trim() : ''

      if (preset) {
        const ok = await send({
          command: 'set_preset',
          preset,
          ...(args.mode ? { mode: args.mode } : {}),
        })
        actions.push(`preset=${preset}(${ok ? 'ok' : 'offline'})`)
      }
      if (emotion) {
        // 主进程的 set_emotion 只接受 ASCII 标识符；中文情绪（如「开心」）
        // 走预设通道表达，与 MaiBot 适配器的既有行为保持一致，
        // 否则会被 400 拒绝并误报成「桌宠离线」。
        const ok = /^[A-Za-z0-9_-]{1,32}$/.test(emotion)
          ? await send({ command: 'set_emotion', emotion })
          : await send({ command: 'set_preset', preset: emotion, mode: 'revert' })
        actions.push(`emotion=${emotion}(${ok ? 'ok' : 'offline'})`)
      }
      if (typeof args.animation === 'string' && args.animation.trim()) {
        const ok = await send({
          command: 'play_animation',
          name: args.animation.trim(),
          loop: args.loop === true,
        })
        actions.push(`animation=${args.animation.trim()}(${ok ? 'ok' : 'offline'})`)
      }
      if (text) {
        const ok = await send({
          command: 'notify',
          text,
          speak: true,
        })
        actions.push(`notify(${ok ? 'ok' : 'offline'})`)
      }
      if (actions.length === 0) {
        return 'No Uta expression action specified.'
      }
      return `Uta desktop pet updated: ${actions.join(', ')}`
    },
  }

  let disposeTool = null
  let disposeMotionTool = null
  let toolMountFailed = false
  const mountTool = (targetCtx) => {
    if (disposeTool || toolMountFailed) return
    const registry = resolveService(targetCtx, 'tools')
    if (!registry || typeof registry.register !== 'function') return
    try {
      const d = registry.register(utaExpressToolDefinition)
      disposeTool = typeof d === 'function' ? d : () => {}
    } catch (error) {
      // 关键：单个 seam 注册失败绝不能连累审批与模型上下文注入。若让异常冒泡，
      // apply() 会 reject，Cordis 会回滚整个插件，而宿主只把错误写进自己的
      // stderr（GUI 进程无控制台），对外表现为「插件静默失效」。
      toolMountFailed = true
      console.error(
        `[uta-deskpet] tools.register(uta_express) failed: ${error?.message || error}`,
      )
    }
    try {
      const d = registry.register({
        name: motionTool.name,
        description: motionTool.description,
        parameters: motionTool.inputSchema,
        output: utaExpressToolDefinition.output,
        isConcurrencySafe: args => ['capabilities', 'validate', 'status'].includes(args?.operation),
        execute: (args, toolContext) => runMotionTool(args, {
          hostId: 'deepseek-harness',
          sessionId: toolContext?.sessionId || toolContext?.sessionID || hostInstanceId,
          request: payload => requestRuntime('POST', '/motion', payload, { config, env, timeoutMs: 4000 }),
        }),
      })
      disposeMotionTool = typeof d === 'function' ? d : () => {}
    } catch (error) {
      console.error(`[uta-deskpet] tools.register(${motionTool.name}) failed: ${error?.message || error}`)
    }
  }

  function disposeRegisteredTools() {
    try { disposeTool?.() } catch { /* ignore */ }
    try { disposeMotionTool?.() } catch { /* ignore */ }
    disposeTool = null
    disposeMotionTool = null
  }

  mountTool(ctx)
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['tools'], (scopedCtx) => {
      mountTool(scopedCtx)
      return disposeRegisteredTools
    })
  }

  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => {
      try {
        disposePrompts?.()
      } catch {
        /* ignore */
      }
      disposePrompts = null
      disposeRegisteredTools()
      try {
        disposeUtaCommand?.()
      } catch {
        /* ignore */
      }
      disposeUtaCommand = null
      try {
        disposeUtaSkill?.()
      } catch {
        /* ignore */
      }
      disposeUtaSkill = null
      try {
        disposeNativeBridge?.()
      } catch {
        /* ignore */
      }
      disposeNativeBridge = null
      for (const d of disposers.splice(0)) {
        try {
          d()
        } catch {
          /* ignore */
        }
      }
    })
  }
}

export default {
  name,
  inject,
  apply,
}
