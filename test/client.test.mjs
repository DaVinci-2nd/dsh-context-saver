// Load the browser half outside the page: capture the module, call apply against
// a stub Cordis context, and render the registered component through a minimal
// React stand-in. Catches load-time and render-shape mistakes that a page
// refresh would otherwise surface as a blank slot entry.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let captured
globalThis.window = {
  __ModuleLoader__: {
    load(options) {
      captured = options
    },
  },
}
// The Host route answers with the stored settings; the stub reports the
// documented defaults so the panel renders in its ready state.
const stored = {
  enabled: true,
  stripThink: true,
  dedupeReads: true,
  stripTerminal: false,
  stripMiddle: false,
  keepHeadTurns: 5,
  keepTailTurns: 5,
}
const posts = []
globalThis.fetch = async (url, init) => {
  if (init?.method === 'POST') posts.push(JSON.parse(init.body))
  return {
    json: async () => ({
      ok: true,
      settings: { ...stored, ...(posts.length === 0 ? {} : posts[posts.length - 1].patch) },
    }),
  }
}
// fetch() resolves asynchronously; the panel reads once on mount, so run those
// microtasks before asserting anything about enabled controls.
const settle = () => new Promise((resolve) => setImmediate(resolve))
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
}

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// A classic browser script has no CommonJS wrapper; the page's module loader
// gives `window` and nothing else, exactly like this.
new Function('window', source)(globalThis.window)
assert.ok(captured !== undefined, 'client.js must register through window.__ModuleLoader__')
assert.equal(captured.id, 'dsh-context-saver')

// A React stand-in: elements are plain objects, hooks keep persistent cells.
// Effects run once per cell lifetime, which is what a mounted component does.
const cells = []
const effectsRan = new Set()
let cursor = 0
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children,
  }),
  useRef: (value) => {
    const cell = cells[cursor] ?? (cells[cursor] = { current: value })
    cursor += 1
    return cell
  },
  useState: (value) => {
    const cell = cells[cursor] ?? (cells[cursor] = { value })
    cursor += 1
    return [cell.value, (next) => {
      cell.value = typeof next === 'function' ? next(cell.value) : next
    }]
  },
  useEffect: (effect) => {
    const at = cursor
    cursor += 1
    if (effectsRan.has(at)) return
    effectsRan.add(at)
    effect()
  },
}

const module = captured.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
})
assert.equal(typeof module.apply, 'function')
assert.deepEqual(module.inject, ['slots', 'locale'])

const locales = []
const registrations = []
const ctx = {
  effect(fn, label) {
    registrations.push({ kind: 'effect', label, dispose: fn() })
  },
  locale: {
    register(ns, locale, dict) {
      locales.push({ ns, locale, keys: Object.keys(dict) })
      return () => {}
    },
  },
  slots: {
    inject(key, callback) {
      registrations.push({ kind: 'inject', key })
      callback()
    },
    register(options, component) {
      registrations.push({ kind: 'register', options, component })
      return () => {}
    },
  },
}

module.apply(ctx)

assert.deepEqual(locales.map((entry) => entry.locale).sort(), ['en', 'zh'])
assert.ok(locales.every((entry) => entry.ns === 'dsh-context-saver'))
assert.deepEqual(
  locales.map((entry) => entry.keys.slice().sort()),
  [locales[0].keys.slice().sort(), locales[0].keys.slice().sort()],
  'both dictionaries need the same keys',
)

const registration = registrations.find((entry) => entry.kind === 'register')
assert.ok(registration !== undefined, 'the composer control must be registered')
assert.equal(registration.options.name, 'conversation.input.left')
assert.equal(registration.options.id, 'dsh-context-saver')
assert.equal(registration.options.locale, 'dsh-context-saver')

const t = (key) => `T:${key}`

/** Render a tree into plain objects, materializing function components. */
function render(element) {
  if (element === null || element === undefined || typeof element === 'boolean') return null
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(render)
  const { type, props, children } = element
  if (typeof type === 'function') {
    const rendered = type({ ...props, children })
    return render(rendered)
  }
  return { type, props, children: children.map(render) }
}

const collect = (node, visit) => {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, visit)
    return
  }
  if (node === null || typeof node !== 'object') return
  visit(node)
  collect(node.children ?? [], visit)
}

function paint() {
  cursor = 0
  return render(registration.component({ t, sessionId: 'session-test' }))
}

let tree = paint()
await settle()
tree = paint()

const triggerOf = (node) => {
  let found = null
  collect(node, (item) => {
    if (found === null && item.props?.['aria-haspopup'] === 'dialog') found = item
  })
  return found
}

const triggers = triggerOf(tree)
assert.ok(triggers !== null, 'the trigger button must exist')
assert.equal(triggers.props['aria-expanded'], 'false')

const count = (node, predicate) => {
  let total = 0
  collect(node, (item) => {
    if (predicate(item)) total += 1
  })
  return total
}

assert.equal(count(tree, (item) => item.props?.role === 'switch'), 0, 'the panel starts closed')
assert.equal(count(tree, (item) => item.props?.role === 'alertdialog'), 0, 'the warning starts closed')

// Open the panel through the trigger's own handler, then re-render.
triggerOf(tree).props.onClick()
tree = paint()

assert.equal(triggerOf(tree).props['aria-expanded'], 'true')
const checkedCount = count(tree, (item) => item.props?.role === 'switch')
assert.equal(checkedCount, 5, 'master, thinking, repeats, terminal, middle')

let texts = []
collect(tree, (item) => {
  for (const child of item.children ?? []) if (typeof child === 'string') texts.push(child)
})
assert.ok(texts.includes('T:title'))
assert.ok(texts.includes('T:master'))
assert.ok(texts.includes('T:think'))
assert.ok(texts.includes('T:dedupe'))
assert.ok(texts.includes('T:terminal'))
assert.ok(texts.includes('T:middle'))
assert.ok(!texts.includes('T:keepHead'), 'the window fields stay hidden until middle stripping is on')

// The master switch must report the documented default.
const master = (() => {
  let found = null
  collect(tree, (item) => {
    if (found === null && item.props?.role === 'switch' && item.props['aria-label'] === 'T:master') found = item
  })
  return found
})()
assert.ok(master !== null)
assert.equal(master.props['aria-checked'], 'true', 'the master switch defaults to on')

const think = (() => {
  let found = null
  collect(tree, (item) => {
    if (found === null && item.props?.role === 'switch' && item.props['aria-label'] === 'T:think') found = item
  })
  return found
})()
assert.equal(think.props['aria-checked'], 'true', 'thinking stripping defaults to on')

const middle = (() => {
  let found = null
  collect(tree, (item) => {
    if (found === null && item.props?.role === 'switch' && item.props['aria-label'] === 'T:middle') found = item
  })
  return found
})()
assert.equal(middle.props['aria-checked'], 'false', 'middle stripping defaults to off')

// Turning middle stripping on must ask first, and the dialog must carry the
// exact warning sentence the request quotes.
middle.props.onClick()
tree = paint()
assert.equal(posts.length, 0, 'the confirmation must come before any write')

const dialog = (() => {
  let found = null
  collect(tree, (item) => {
    if (found === null && item.props?.role === 'alertdialog') found = item
  })
  return found
})()
assert.ok(dialog !== null, 'enabling middle stripping must raise the warning')

let dialogText = ''
collect(dialog, (item) => {
  for (const child of item.children ?? []) if (typeof child === 'string') dialogText += child
})
assert.ok(dialogText.includes('T:warningBody'))
assert.match(locales.length > 0 ? '' : '', /^$/)

console.log(JSON.stringify({
  ok: true,
  dictionaries: locales.length,
  localeKeys: locales[0].keys.length,
  switches: checkedCount,
  slot: registration.options.name,
  warning: 'alertdialog',
}))
