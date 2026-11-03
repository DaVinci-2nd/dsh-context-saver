# dsh-context-saver · DSH context saving plugin

A send-time context trimmer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It trims only at the moment the context is submitted to the model. The local session log, the chat transcript, and the trajectory view stay complete. With the plugin disabled, or with every option off, the request is byte-identical to the untrimmed one.

English | [中文](README.zh.md)

---

## What it is for

What makes a long session expensive is not the number of turns, it is that every turn re-sends the same material:

- the model's own thinking is passed back on every request and grows monotonically;
- the same file or page is read again and again, so its content appears three or five times;
- a terminal command's full argument text is passed back every turn, while only its output matters;
- turns from long ago still occupy the window although they no longer inform the current decision.

This plugin removes that material from the **outbound copy** only; the local copy keeps everything.

## How it works

Every model request in DSH passes through the `llm/stream` waterfall, which carries the complete `messages` about to be submitted.

The plugin takes the request there, builds a new message array from the enabled rules, and re-dispatches it with `ctx.llm.stream()`. The original request is deep-frozen and is never modified, and no session event is ever written, so:

- the local session log, `session/event`, the trajectory view, and exports keep the full history;
- every request recomputes the trimmed copy from the complete local record;
- trimming is **deterministic** — the same input always produces the same output — so the common prefix of two consecutive requests stays byte-identical and the KV cache hit rate is essentially unaffected.

### Why the result cannot make DeepSeek reject the request

The DeepSeek Messages adapter imposes hard structural rules. Every shape this plugin emits was designed around them and verified against the live API:

| Risk | Handling | Verified |
|---|---|---|
| a `tool_result` without its `tool_use` | `tool-call` blocks are **never removed**, only `arguments` becomes `{}` | accepted |
| a `tool_use` without an immediate result | `tool` role messages are **never removed**, only their content is emptied | accepted |
| thinking block count out of step with local replay metadata | `reasoning` blocks are **never removed**, only `text` is emptied and the signature kept | accepted |
| an empty thinking block rejected | the real signature is still sent | accepted (empty + signature, empty without signature, and no thinking block all return 200) |

Compaction and session-title requests (`purpose` set) are never trimmed, so their own input cannot change underneath them.

## Interface

The control sits in the composer tool row, next to the model and sandbox selectors. Clicking it opens a floating panel:

- **Master switch** (on by default)
- **Strip thinking content** (on by default) — keeps each think block, empties its text, so the model receives the answer without the reasoning
- **Strip repeated reads** (on by default) — identical file and page reads keep only the first copy; later ones keep an identifier and an empty structure
- **Strip terminal inputs and process** (off by default) — terminal tool calls keep their output and lose the model-supplied arguments
- **Strip the middle of the context** (off by default) — turning it on raises a warning: *"Stripping the middle of the context can remove important content from the middle of a long conversation while it is being sent!"*
- **Leading turns kept** (5 by default, effective only with middle stripping on)
- **Trailing turns kept** (5 by default, effective only with middle stripping on)

The panel is localized in Chinese and English and follows the DSH language setting. Settings are stored on this machine and apply to every session:

```
$DSH_HOME/dsh-context-saver/settings.json
```

## Middle stripping rule

**One turn is one user message plus the model output that follows it**, so turn boundaries are the `user` messages.

With `N` turns in total, `H` leading turns kept, and `T` trailing turns kept:

- when `N ≤ H + T` nothing is stripped at all (the two retention windows overlap);
- otherwise a turn is stripped only when it is inside neither window. A stripped turn keeps its structure and loses its content: tool calls keep their id and name with empty arguments, reasoning blocks keep their position and signature with empty text, text and images are cleared, so tool calls and results stay paired.

Example: 17 turns, 7 leading, 8 trailing → turns 1–7 and 10–17 are kept and turns 8 and 9 are stripped (`7 + 8 = 15` turns retained).

> At least one turn is always kept at each end. The trailing turn carries the current question — emptying it would send a request with no question in it — and the leading one keeps the request starting on a user message. A configured `0` is raised to `1`.

## Measured on real sessions

Two independent measurements, both against the live `deepseek-flash` endpoint.

**A real 65-turn session log from this machine**, replayed through the adapter's own serialization rules with the session's own 34 tool declarations:

| | Prompt tokens | Reply |
|---|---|---|
| Untrimmed | 867,787 | accepted |
| **Trimmed (defaults)** | **574,347** | accepted |

33.8% fewer prompt tokens on a long agentic session, and the model still answered correctly.

**A 60-turn synthetic session with heavy repeated reads**, comparing the request for turn N against the request for turn N+1 to measure prefix reuse:

| Configuration | Prompt tokens | Cache hit rate |
|---|---|---|
| Trimming off | 21,102 | 98.9% |
| **Defaults** (thinking + repeated reads) | **3,242** | **94.8%** |
| Defaults + terminal | 3,242 | 94.8% |
| Defaults + terminal + middle | 1,847 | 90.1% |

So the default configuration sends **6.5× fewer prompt tokens at a 94.8% cache hit rate** — the "90% or better" goal holds for every configuration.

## KV cache and hit rate

- Stripped older turns are never rewritten, and new turns are only appended, so the shared prefix stays stable.
- The duplicate marker is a fixed string naming a stable ordinal ("the Nth tool result"), so it does not drift as the session grows. A read shorter than 200 characters is left alone, because the marker would cost more than it saves.
- With middle stripping on, a turn slides from the trailing window into the middle; at that moment its content is cleared and the prefix cache misses once from there. That cost is inherent to any middle-stripping scheme and does not exist while the option is off — hence the lower 90.1% figure.
- The trimmed shape is deterministic, so a retry or a repeated step reuses the cache exactly: two identical requests both measured 95.1%.

## Install

### As a DSH plugin

Install this directory from DSH — `install_bundle` of `plugin_manager` with the repository directory as the target — or choose the directory in the plugin manager UI.

The installed row is named `dsh-context-saver`:

```yaml
- insert:
    - id: dsh-context-saver
      name: dsh-context-saver
```

### Uninstall

Remove that row, or uninstall the bundle from the plugin manager. The settings file can be deleted by hand.

## Layout

| File | Role |
|---|---|
| `index.js` | Host half: the `llm/stream` interception and the settings route |
| `src/trim.js` | Pure trimming logic, side-effect free and unit tested |
| `src/settings.js` | Defaults and settings persistence |
| `client.js` | Browser half: the composer-row control and its floating panel |
| `locale/*.json` | Plugin Manager title and description (zh / en) |
| `test/trim.test.mjs` | Trimming tests |

## Test

```bash
node test/trim.test.mjs
```

## License

[MIT](LICENSE) © 2026 DaVinci-2nd
