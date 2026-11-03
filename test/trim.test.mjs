import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dedupeRepeatedReads,
  stripMiddleTurns,
  stripReasoningText,
  stripTerminalInputs,
  trimMessages,
} from '../src/trim.js'

const ALL_ON = {
  enabled: true,
  stripThink: true,
  dedupeReads: true,
  stripTerminal: true,
  stripMiddle: false,
  keepHeadTurns: 5,
  keepTailTurns: 5,
}

const text = (value) => ({ type: 'text', text: value })
const user = (value) => ({ role: 'user', source: { kind: 'user' }, content: [text(value)] })
const assistant = (content) => ({ role: 'assistant', source: { kind: 'model' }, content })
const call = (id, name, args) => ({ type: 'tool-call', id, name, arguments: args })
const result = (callId, value) => ({
  role: 'tool',
  source: { kind: 'tool', callId },
  toolCallId: callId,
  content: [text(value)],
})

/** One turn = one user message plus the assistant output that follows it. */
function conversation(turns) {
  const messages = []
  for (let index = 0; index < turns; index += 1) {
    messages.push(user(`question ${index + 1}`))
    messages.push(assistant([text(`answer ${index + 1}`)]))
  }
  return messages
}

test('middle stripping empties exactly the turns outside both windows', () => {
  // 17 turns, keep the first 7 and the last 8: 15 turns stay, so turns 8 and 9 go.
  const messages = conversation(17)
  const trimmed = stripMiddleTurns(messages, 7, 8)

  const emptied = []
  for (let index = 0; index < 17; index += 1) {
    const assistantMessage = trimmed[index * 2 + 1]
    const kept = assistantMessage.content.length > 0 && assistantMessage.content[0].text !== ''
    if (!kept) emptied.push(index + 1)
  }

  assert.deepEqual(emptied, [8, 9])
  assert.equal(trimmed.length, messages.length)
})

test('a conversation that fits inside both windows is returned untouched', () => {
  const messages = conversation(10)
  assert.equal(stripMiddleTurns(messages, 5, 5), messages)
  assert.equal(stripMiddleTurns(messages, 7, 8), messages)
})

test('middle stripping keeps tool calls and results paired', () => {
  const messages = [
    ...conversation(6),
    user('run the command'),
    assistant([call('call_1', 'pwsh', '{"command":"Get-Date"}')]),
    result('call_1', 'Monday'),
    assistant([text('done')]),
    ...conversation(6),
  ]

  const trimmed = stripMiddleTurns(messages, 5, 6)
  const callBlock = trimmed[13].content[0]
  const resultMessage = trimmed[14]

  assert.equal(callBlock.type, 'tool-call')
  assert.equal(callBlock.id, 'call_1')
  assert.equal(callBlock.arguments, '{}')
  assert.equal(resultMessage.role, 'tool')
  assert.equal(resultMessage.toolCallId, 'call_1')
  assert.deepEqual(resultMessage.content, [])
})

test('system and developer messages are never emptied', () => {
  const messages = conversation(12)
  messages.splice(5, 0, {
    role: 'developer',
    source: { kind: 'system-prompt' },
    content: [text('tool update')],
  })

  const trimmed = stripMiddleTurns(messages, 2, 2)
  assert.deepEqual(trimmed[5].content, [text('tool update')])
})

test('reasoning blocks keep their position and signature but lose their text', () => {
  const messages = [user('hi'), assistant([
    { type: 'reasoning', text: 'a long chain of thought', signature: 'sig' },
    text('answer'),
  ])]

  const trimmed = stripReasoningText(messages)
  const blocks = trimmed[1].content

  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0], { type: 'reasoning', text: '', signature: 'sig' })
  assert.deepEqual(blocks[1], text('answer'))
  assert.equal(messages[1].content[0].text, 'a long chain of thought', 'input must not be mutated')
})

test('identical reads collapse to the first occurrence, which stays complete', () => {
  const body = 'file body '.repeat(40)
  const messages = [
    user('read it'),
    assistant([call('call_1', 'read', '{"path":"a.txt"}')]),
    result('call_1', body),
    user('read it again'),
    assistant([call('call_2', 'read', '{"path":"a.txt"}')]),
    result('call_2', body),
  ]

  const trimmed = dedupeRepeatedReads(messages)
  assert.equal(trimmed[2].content[0].text, body)
  assert.equal(trimmed[5].toolCallId, 'call_2')
  assert.match(trimmed[5].content[0].text, /^\[重复内容已省略/)
  assert.match(trimmed[5].content[0].text, /第 1 条/)
})

test('different reads and non-read tools are left alone', () => {
  const messages = [
    user('read'),
    assistant([call('call_1', 'read', '{"path":"a.txt"}')]),
    result('call_1', 'same'),
    user('run'),
    assistant([call('call_2', 'pwsh', '{"command":"echo same"}')]),
    result('call_2', 'same'),
    user('read other'),
    assistant([call('call_3', 'read', '{"path":"b.txt"}')]),
    result('call_3', 'other'),
  ]

  assert.equal(dedupeRepeatedReads(messages), messages)
})

test('terminal tool calls lose their arguments but keep their identity', () => {
  const messages = [
    user('run'),
    assistant([call('call_1', 'pwsh', '{"command":"Get-ChildItem"}')]),
    result('call_1', 'listing'),
    assistant([call('call_2', 'read', '{"path":"a.txt"}')]),
    result('call_2', 'body'),
  ]

  const trimmed = stripTerminalInputs(messages)
  assert.deepEqual(trimmed[1].content[0], {
    type: 'tool-call',
    id: 'call_1',
    name: 'pwsh',
    arguments: '{}',
  })
  assert.equal(trimmed[3].content[0].arguments, '{"path":"a.txt"}')
})

test('the master switch returns the original array', () => {
  const messages = conversation(4)
  assert.equal(trimMessages(messages, { ...ALL_ON, enabled: false }), messages)
})

test('trimming is deterministic so the request prefix stays cacheable', () => {
  const body = 'file body '.repeat(40)
  const messages = [
    ...conversation(3),
    user('read it'),
    assistant([
      { type: 'reasoning', text: 'thinking', signature: 'sig' },
      call('call_1', 'read', '{"path":"a.txt"}'),
    ]),
    result('call_1', body),
    ...conversation(20),
    user('read it again'),
    assistant([call('call_2', 'read', '{"path":"a.txt"}')]),
    result('call_2', body),
  ]

  const settings = { ...ALL_ON, stripMiddle: true, keepHeadTurns: 5, keepTailTurns: 5 }
  const first = trimMessages(messages, settings)
  const second = trimMessages(messages, settings)

  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.ok(first.length === messages.length)
})
