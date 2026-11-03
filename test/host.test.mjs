// Drive the Host half with a stub Cordis context: register the plugin, dispatch a
// request through the `llm/stream` waterfall, and read back what it re-dispatched.
// This is the only part of the plugin the browser cannot observe.
import assert from 'node:assert/strict'

const listeners = []
const dispatched = []
let route = null

const ctx = {
  on(name, listener) {
    listeners.push({ name, listener })
    return () => {}
  },
  inject(names, callback) {
    callback({
      effect(fn) {
        fn()
      },
      webServer: {
        register(definition) {
          route = definition
          return () => {}
        },
      },
    })
  },
  effect(fn) {
    fn()
  },
  llm: {
    stream(options) {
      dispatched.push(options)
      return (async function* empty() {})()
    },
  },
}

const plugin = await import('../index.js')
assert.equal(plugin.name, 'dsh-context-saver')
assert.deepEqual(plugin.inject, ['llm'])

plugin.apply(ctx)

const watcher = listeners.find((entry) => entry.name === 'llm/stream')
assert.ok(watcher !== undefined, 'the plugin must listen on llm/stream')
assert.equal(route?.path, '/dsh-context-saver/settings')

const text = (value) => ({ type: 'text', text: value })
const reasoning = (value) => ({ type: 'reasoning', text: value, signature: `sig-${value.length}` })
const user = (value) => ({ role: 'user', source: { kind: 'user' }, content: [text(value)] })
const assistant = (content) => ({ role: 'assistant', source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' }, content })
const call = (id, name, args) => ({ type: 'tool-call', id, name, arguments: args })
const result = (callId, value) => ({
  role: 'tool',
  source: { kind: 'tool', callId },
  toolCallId: callId,
  content: [text(value)],
})

const body = 'the same file body '.repeat(60)
const messages = Object.freeze([
  Object.freeze(user('read a.txt')),
  Object.freeze(assistant([reasoning('I should read the file first'), call('call_1', 'read', '{"path":"a.txt"}')])),
  Object.freeze(result('call_1', body)),
  Object.freeze(user('run the listing')),
  Object.freeze(assistant([reasoning('Now I list the directory'), call('call_2', 'pwsh', '{"command":"Get-ChildItem"}')])),
  Object.freeze(result('call_2', 'a.txt')),
  Object.freeze(user('read a.txt again')),
  Object.freeze(assistant([reasoning('I read it before but let me re-read'), call('call_3', 'read', '{"path":"a.txt"}')])),
  Object.freeze(result('call_3', body)),
])

// next() is the untouched continuation; ctx.llm.stream() is the re-dispatch.
let nextCalls = 0
const next = () => {
  nextCalls += 1
  return (async function* untouched() {})()
}

const options = Object.freeze({ provider: 'deepseek-official', model: 'deepseek-flash', messages })
watcher.listener(options, next)

assert.equal(nextCalls, 0, 'a trimmed request is re-dispatched, not passed through')
assert.equal(dispatched.length, 1)
const sent = dispatched[0]
assert.notEqual(sent.messages, messages)
assert.equal(sent.provider, 'deepseek-official')

// Structure preserved, content trimmed, nothing dropped.
assert.equal(sent.messages.length, messages.length)
assert.deepEqual(
  sent.messages.map((message) => message.role),
  messages.map((message) => message.role),
)

const thinking = sent.messages.filter((message) => message.role === 'assistant')
for (const message of thinking) {
  for (const block of message.content) {
    if (block.type !== 'reasoning') continue
    assert.equal(block.text, '')
    assert.equal(typeof block.signature, 'string', 'the replay signature must survive')
  }
}

const calls = sent.messages.flatMap((message) => message.content).filter((block) => block.type === 'tool-call')
assert.deepEqual(calls.map((block) => block.id), ['call_1', 'call_2', 'call_3'])
assert.equal(calls[1].arguments, '{"command":"Get-ChildItem"}', 'terminal stripping is off by default')
assert.equal(calls[2].arguments, '{"path":"a.txt"}', 'read arguments are untouched')

const results = sent.messages.filter((message) => message.role === 'tool')
assert.equal(results[0].content[0].text, body, 'the first read keeps its body')
assert.match(results[2].content[0].text, /^\[重复内容已省略/, 'the repeated read keeps only a marker')

// The original request is untouched: this is what the local session stores.
assert.deepEqual(
  messages[1].content[0],
  { type: 'reasoning', text: 'I should read the file first', signature: 'sig-28' },
)
assert.equal(messages[8].content[0].text, body)

// A request this plugin already rebuilt falls through to next() the second
// time, so one dispatch is never trimmed twice.
const before = dispatched.length
watcher.listener(sent, next)
assert.equal(dispatched.length, before, 'an already-trimmed request is not re-trimmed')
assert.equal(nextCalls, 1, 'it continues to the adapter instead')

// A different request object is trimmed on its own, from its own content.
const second = Object.freeze({ provider: 'deepseek-official', model: 'deepseek-flash', messages: Object.freeze([...messages]) })
watcher.listener(second, next)
assert.equal(dispatched.length, before + 1)
assert.notEqual(dispatched[dispatched.length - 1].messages, second.messages)

// A request carrying `purpose` is a summarization call; its own input must not
// change underneath it.
const compaction = Object.freeze({ provider: 'deepseek-official', model: 'deepseek-flash', purpose: 'compaction', messages })
watcher.listener(compaction, next)
assert.equal(dispatched.length, before + 1, 'tagged requests pass through untouched')
assert.equal(nextCalls, 2)

console.log(JSON.stringify({
  ok: true,
  messages: messages.length,
  reasoningBlocksEmptied: thinking.length,
  repeatedReadsCollapsed: 1,
  route: route?.path,
}))
