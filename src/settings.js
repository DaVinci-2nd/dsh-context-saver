/**
 * Persisted settings for the context saver.
 *
 * The Web GUI control writes through the Host route; the same file is read at
 * startup, so the choice survives a restart of the profile.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** @typedef {object} ContextSaverSettings
 * @property {boolean} enabled master switch
 * @property {boolean} stripThink empty the text of `reasoning` blocks
 * @property {boolean} dedupeReads collapse byte-identical file and page reads
 * @property {boolean} stripTerminal empty terminal tool arguments
 * @property {boolean} stripMiddle empty turns between the head and tail windows
 * @property {number} keepHeadTurns leading turns kept when `stripMiddle` is on
 * @property {number} keepTailTurns trailing turns kept when `stripMiddle` is on
 */

const MAX_TURNS = 1000

/** @type {Readonly<ContextSaverSettings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  stripThink: true,
  dedupeReads: true,
  stripTerminal: false,
  stripMiddle: false,
  keepHeadTurns: 5,
  keepTailTurns: 5,
})

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function turns(value, fallback) {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  // At least one turn is always kept at each end: the last turn carries the
  // current prompt, and the first keeps the request starting on a user message.
  return Math.min(MAX_TURNS, Math.max(1, parsed))
}

/**
 * Coerce arbitrary JSON into a complete settings object, so a hand-edited or
 * outdated file can never produce a partial state.
 *
 * @param {unknown} raw
 * @returns {ContextSaverSettings}
 */
export function normalizeSettings(raw) {
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: boolean(value.enabled, DEFAULT_SETTINGS.enabled),
    stripThink: boolean(value.stripThink, DEFAULT_SETTINGS.stripThink),
    dedupeReads: boolean(value.dedupeReads, DEFAULT_SETTINGS.dedupeReads),
    stripTerminal: boolean(value.stripTerminal, DEFAULT_SETTINGS.stripTerminal),
    stripMiddle: boolean(value.stripMiddle, DEFAULT_SETTINGS.stripMiddle),
    keepHeadTurns: turns(value.keepHeadTurns, DEFAULT_SETTINGS.keepHeadTurns),
    keepTailTurns: turns(value.keepTailTurns, DEFAULT_SETTINGS.keepTailTurns),
  }
}

/** Settings directory under the DSH home, created on first write. */
export function settingsDirectory() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'dsh-context-saver')
}

function settingsPath() {
  return join(settingsDirectory(), 'settings.json')
}

/**
 * Read the stored settings, falling back to the defaults for a missing or
 * unreadable file.
 *
 * @returns {ContextSaverSettings}
 */
export function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return normalizeSettings(undefined)
  }
}

/**
 * Persist settings through a temporary sibling and a rename, so a crash cannot
 * leave a truncated file behind.
 *
 * @param {ContextSaverSettings} settings
 */
export function saveSettings(settings) {
  mkdirSync(settingsDirectory(), { recursive: true })
  const target = settingsPath()
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  renameSync(temporary, target)
}
