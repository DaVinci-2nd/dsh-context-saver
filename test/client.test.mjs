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
// Capture the document listeners the panel installs while it is open, so the
// outside-click behaviour can be exercised the way the browser dispatches it.
const listeners = new Map()
globalThis.document = {
  addEventListener(name, listener) {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push(listener)
  },
  removeEventListener(name, listener) {
    const list = listeners.get(name)
    if (!list) return
    const at = list.indexOf(listener)
    if (at !== -1) list.splice(at, 1)
  },
}
const fire = (name, event) => {
  for (const listener of [...(listeners.get(name) ?? [])]) listener(event)
}

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// A classic browser script has no CommonJS wrapper; the page's module loader
// gives `window` and nothing else, exactly like this.
new Function('window', source)(globalThis.window)
assert.ok(captured !== undefined, 'client.js must register through window.__ModuleLoader__')
assert.equal(captured.id, 'dsh-context-saver')

// A React stand-in: elements are plain objects, hooks keep persistent cells.
// useState keeps a value per hook position; useEffect runs when its dependency
// list changes, cleaning up the previous run — which is what makes an effect
// guarded by `if (!open) return` install its listeners once the panel opens.
const cells = []
let cursor = 0
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children,
  }),
  useRef: (value) => {
    const cell = cells[cursor] ?? (cells[cursor] = { kind: 'ref', current: value })
    cursor += 1
    return cell
  },
  useState: (value) => {
    const cell = cells[cursor] ?? (cells[cursor] = { kind: 'state', value })
    cursor += 1
    return [cell.value, (next) => {
      cell.value = typeof next === 'function' ? next(cell.value) : next
    }]
  },
  useEffect: (effect, deps) => {
    const at = cursor
    cursor += 1
    const cell = cells[at] ?? (cells[at] = { kind: 'effect', deps: undefined, cleanup: undefined, ran: false })
    const same = cell.ran && deps !== undefined && cell.deps !== undefined
      && deps.length === cell.deps.length
      && deps.every((value, index) => Object.is(value, cell.deps[index]))
    if (same) return
    if (typeof cell.cleanup === 'function') cell.cleanup()
    cell.ran = true
    cell.deps = deps === undefined ? undefined : [...deps]
    cell.cleanup = effect()
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
  // Attach a hook ref the way React assigns it after mount, so contains() can
  // be exercised against a real element object.
  const node = { type, props, children: children.map(render) }
  Object.defineProperty(node, 'contains', {
    value(candidate) {
      if (candidate === node) return true
      const walk = (current) => {
        if (Array.isArray(current)) return current.some(walk)
        if (current === null || typeof current !== 'object') return false
        if (current === candidate) return true
        return (current.children ?? []).some(walk)
      }
      return walk(node.children ?? [])
    },
  })
  // The panel positions itself from this rectangle; a fixed box is enough.
  Object.defineProperty(node, 'getBoundingClientRect', {
    value: () => ({ left: 120, top: 600, right: 200, bottom: 628, width: 80, height: 28 }),
  })
  const ref = props?.ref
  if (ref !== null && typeof ref === 'object' && 'current' in ref) ref.current = node
  return node
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

// Every switch must paint a track that is visible against the panel in both
// themes. The theme's brand and border aliases cannot be used: in the dark theme
// brand-primary resolves to a near-white bluish-50 and border-l2 to transparent
// white, so a white knob on either is invisible. Assert a real, opaque colour.
const switchTracks = []
collect(tree, (item) => {
  if (item.props?.role !== 'switch') return
  switchTracks.push(item)
})
assert.ok(switchTracks.length > 0)
for (const track of switchTracks) {
  const background = track.props.style.background
  assert.match(background, /^#[0-9a-fA-F]{6}$/, `switch "${track.props['aria-label']}" must use an opaque colour, got ${background}`)
  assert.notEqual(background.toLowerCase(), '#ffffff', 'a white track makes the knob invisible')
}
const onTrack = switchTracks.find((track) => track.props['aria-checked'] === 'true')
const offTrack = switchTracks.find((track) => track.props['aria-checked'] === 'false')
assert.ok(onTrack !== undefined && offTrack !== undefined, 'both states must be on screen')
assert.notEqual(onTrack.props.style.background, offTrack.props.style.background, 'on and off must be distinguishable')

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

// Regression: the dialog renders outside the panel, so the document's
// outside-click handler must exempt it. Without that exemption the mousedown
// preceding a click on either button closed the panel and the dialog together,
// and the button's own onClick never ran — the reported bug.
const dialogNode = (() => {
  let found = null
  collect(tree, (item) => {
    if (found === null && item.props?.role === 'alertdialog') found = item
  })
  return found
})()
assert.ok(dialogNode !== null)

// Find the confirm button: the last button inside the dialog's action row.
const buttons = []
collect(dialogNode, (item) => {
  if (item.type === 'button') buttons.push(item)
})
const confirm = buttons[buttons.length - 1]
assert.ok(confirm !== undefined)

// Simulate the browser: mousedown on the dialog's own button, then its click.
// The pointerdown must be recognised as inside the dialog, so the panel survives.
const panelWasOpen = triggerOf(tree).props['aria-expanded']
fire('mousedown', { target: dialogNode, currentTarget: dialogNode })
tree = paint()
assert.equal(panelWasOpen, 'true')
assert.ok(
  count(tree, (item) => item.props?.role === 'alertdialog') === 1,
  'a mousedown inside the dialog must not dismiss it',
)

// The click itself still works and writes the setting.
const before = posts.length
confirm.props.onClick()
tree = paint()
assert.equal(posts.length, before + 1, 'confirming must write the setting')
assert.equal(posts[posts.length - 1].patch.stripMiddle, true)
assert.equal(count(tree, (item) => item.props?.role === 'alertdialog'), 0, 'the dialog closes after confirming')

// An outside click still closes everything, which is the behaviour it must keep.
fire('mousedown', { target: { outside: true }, currentTarget: null })
tree = paint()
assert.equal(triggerOf(tree).props['aria-expanded'], 'false', 'an outside click still closes the panel')

console.log(JSON.stringify({
  ok: true,
  dictionaries: locales.length,
  localeKeys: locales[0].keys.length,
  switches: checkedCount,
  slot: registration.options.name,
  warning: 'alertdialog',
  dialogSurvivesInsideClick: true,
}))
