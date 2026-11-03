/**
 * Pure, send-time context trimming for the DSH model request.
 *
 * Every function here takes the frozen `RequestMessage[]` seen by the
 * `llm/stream` waterfall and returns a new array, or the very same reference
 * when it has nothing to do. The caller keeps the local Session log untouched:
 * nothing in this module mutates or inspects durable state.
 *
 * Shapes emitted here are constrained by the DeepSeek Messages adapter:
 * - `tool-call` blocks are never dropped, only their `arguments` are emptied,
 *   because the adapter rejects a `tool_result` without a matching `tool_use`
 *   and rejects an unanswered `tool_use`.
 * - `reasoning` blocks are never dropped, only their `text` is emptied, so the
 *   block count still matches the stored native replay metadata and the
 *   provider keeps receiving an ordinary `thinking` block.
 * - `tool` messages are never dropped, only their content is emptied, so the
 *   pairing above still holds.
 */

/** Tools whose result is a plain read of a file or a page, eligible for dedupe. */
const READ_TOOLS = new Set(['read', 'read_image', 'web_fetch', 'web_search', 'glob', 'grep'])

/** Tools that run a terminal command; only their output is worth keeping. */
const TERMINAL_TOOLS = new Set([
  'bash',
  'pwsh',
  'sh',
  'zsh',
  'cmd',
  'powershell',
  'terminal_open',
  'terminal_read',
  'terminal_send',
  'terminal_signal',
])

/** Upper bound for the two turn counters, so a typo cannot disable the session. */
const MAX_TURNS = 1000

/** Marker left in place of a repeated read. Stable, so the cached prefix stays stable. */
function duplicateMarker(ordinal) {
  return `[重复内容已省略：与第 ${ordinal} 条工具结果完全一致 / duplicate content omitted]`
}

function isBlock(value) {
  return value !== null && typeof value === 'object'
}

/**
 * Concatenate a message's text blocks, or `undefined` when any block is not a
 * text block. Only fully textual content can be compared for equality.
 *
 * @param {readonly unknown[]} content
 * @returns {string | undefined}
 */
function textOf(content) {
  if (!Array.isArray(content)) return undefined
  let text = ''
  for (const block of content) {
    if (!isBlock(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined
    text += block.text
  }
  return text
}

/**
 * Map every tool call id in the history to the tool name that emitted it. A
 * tool result message carries only its call id, so the name has to come from
 * the assistant message that requested it.
 *
 * @param {readonly unknown[]} messages
 * @returns {Map<string, string>}
 */
function toolNamesOf(messages) {
  const names = new Map()
  for (const message of messages) {
    if (!isBlock(message) || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (isBlock(block) && block.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string') {
        names.set(block.id, block.name)
      }
    }
  }
  return names
}

/**
 * Keep each `reasoning` block and its position, but empty its text. Local
 * history and the chat UI keep the full thinking; the model receives the same
 * block skeleton with nothing inside.
 *
 * @param {readonly any[]} messages
 * @returns {readonly any[]}
 */
export function stripReasoningText(messages) {
  let changed = false
  const next = messages.map((message) => {
    if (!isBlock(message) || !Array.isArray(message.content)) return message
    let touched = false
    const content = message.content.map((block) => {
      if (!isBlock(block) || block.type !== 'reasoning' || block.text === '') return block
      touched = true
      return { ...block, text: '' }
    })
    if (!touched) return message
    changed = true
    return { ...message, content }
  })
  return changed ? next : messages
}

/**
 * Collapse byte-identical file and page reads. The first occurrence keeps its
 * full content; every later occurrence keeps its role, call id, and position
 * but carries only a marker naming the retained one.
 *
 * @param {readonly any[]} messages
 * @returns {readonly any[]}
 */
export function dedupeRepeatedReads(messages) {
  const names = toolNamesOf(messages)
  /** @type {Map<string, number>} content -> 1-based ordinal of the retained read */
  const retained = new Map()
  let changed = false
  let ordinal = 0
  const next = messages.map((message) => {
    if (!isBlock(message) || message.role !== 'tool') return message
    ordinal += 1
    const name = names.get(message.toolCallId)
    if (name === undefined || !READ_TOOLS.has(name)) return message
    const text = textOf(message.content)
    if (text === undefined || text.length === 0) return message
    const first = retained.get(text)
    if (first === undefined) {
      retained.set(text, ordinal)
      return message
    }
    changed = true
    return { ...message, content: [{ type: 'text', text: duplicateMarker(first) }] }
  })
  return changed ? next : messages
}

/**
 * Empty the model-supplied arguments of terminal commands, keeping the call id,
 * the tool name, and therefore the matching terminal output.
 *
 * @param {readonly any[]} messages
 * @returns {readonly any[]}
 */
export function stripTerminalInputs(messages) {
  let changed = false
  const next = messages.map((message) => {
    if (!isBlock(message) || !Array.isArray(message.content)) return message
    let touched = false
    const content = message.content.map((block) => {
      if (!isBlock(block) || block.type !== 'tool-call') return block
      if (!TERMINAL_TOOLS.has(block.name) || block.arguments === '{}') return block
      touched = true
      return { ...block, arguments: '{}' }
    })
    if (!touched) return message
    changed = true
    return { ...message, content }
  })
  return changed ? next : messages
}

/**
 * Empty one message while keeping the structure the wire protocol needs: tool
 * calls survive with empty arguments, everything textual, binary, or decorative
 * is removed.
 *
 * @param {any} message
 * @returns {any}
 */
function emptyMessage(message) {
  const content = []
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!isBlock(block) || block.type !== 'tool-call') continue
      content.push({ ...block, arguments: '{}' })
    }
  }
  return { ...message, content }
}

/**
 * Empty every turn outside the leading and trailing retention windows.
 *
 * One turn is one user message plus the model output that follows it, so turns
 * are delimited by `user` messages. System and developer messages are protocol
 * structure rather than turn content and are never emptied. A conversation that
 * fits inside both windows is left completely alone.
 *
 * @param {readonly any[]} messages
 * @param {number} keepHead leading turns to keep
 * @param {number} keepTail trailing turns to keep
 * @returns {readonly any[]}
 */
export function stripMiddleTurns(messages, keepHead, keepTail) {
  const starts = []
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'user') starts.push(index)
  }
  const count = starts.length
  const head = Math.min(MAX_TURNS, Math.max(1, Math.trunc(Number(keepHead)) || 0))
  const tail = Math.min(MAX_TURNS, Math.max(0, Math.trunc(Number(keepTail)) || 0))
  if (count <= head + tail) return messages
  const from = starts[head]
  const to = tail === 0 ? messages.length : starts[count - tail]
  if (!(from < to)) return messages
  const next = messages.slice()
  for (let index = from; index < to; index += 1) {
    const message = messages[index]
    if (message?.role === 'developer' || message?.role === 'system') continue
    next[index] = emptyMessage(message)
  }
  return next
}

/**
 * Apply every enabled rule in a fixed order. Middle-turn stripping runs last so
 * it decides the final shape of a removed turn.
 *
 * @param {readonly any[]} messages the request messages seen at `llm/stream`
 * @param {import('./settings.js').ContextSaverSettings} settings
 * @returns {readonly any[]} the same reference when nothing was trimmed
 */
export function trimMessages(messages, settings) {
  if (!Array.isArray(messages) || messages.length === 0) return messages
  if (settings?.enabled !== true) return messages
  let next = messages
  if (settings.stripThink) next = stripReasoningText(next)
  if (settings.dedupeReads) next = dedupeRepeatedReads(next)
  if (settings.stripTerminal) next = stripTerminalInputs(next)
  if (settings.stripMiddle) next = stripMiddleTurns(next, settings.keepHeadTurns, settings.keepTailTurns)
  return next
}
