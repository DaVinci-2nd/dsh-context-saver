/**
 * Browser half of the DSH context saver.
 *
 * Renders one compact control in the composer tool row — beside the model and
 * sandbox selectors — that opens a floating panel holding every option. The
 * panel reads and writes the Host route registered by `index.js`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-context-saver',
  factory(require) {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-context-saver'
    const ROUTE = '/dsh-context-saver/settings'
    const PANEL_WIDTH = 320

    const zh = {
      title: '上下文节省',
      hint: '只改动发送给模型的内容，本地记录完整保留',
      master: '总开关',
      masterHint: '关闭后按原样发送上下文',
      think: '剔除思考内容',
      thinkHint: '保留 think 块结构，清空其中内容',
      dedupe: '剔除重复获取的内容',
      dedupeHint: '内容完全相同的文件 / 网页读取只保留第一次',
      terminal: '剔除终端运行的输入和过程',
      terminalHint: '只保留终端输出，去掉模型的输入参数',
      middle: '剔除上下文中部',
      middleHint: '开头与结尾保留范围之外的回合，结构保留、内容清空',
      keepHead: '保留开头回合数',
      keepTail: '保留结尾回合数',
      warningTitle: '确认开启「剔除上下文中部」？',
      warningBody: '剔除上下文中部可能会导致长上下文中间的重要内容在发送过程中缺失！',
      warningConfirm: '仍然开启',
      warningCancel: '取消',
      close: '关闭',
      footer: '设置保存在本机，对所有会话生效',
    }

    const en = {
      title: 'Context Saver',
      hint: 'Only the request changes; the local transcript stays complete',
      master: 'Master switch',
      masterHint: 'Turned off, the request is sent unchanged',
      think: 'Strip thinking content',
      thinkHint: 'Keeps each think block and empties its text',
      dedupe: 'Strip repeated reads',
      dedupeHint: 'Identical file and page reads keep only the first copy',
      terminal: 'Strip terminal inputs and process',
      terminalHint: 'Keeps the terminal output, drops the model-supplied arguments',
      middle: 'Strip the middle of the context',
      middleHint: 'Turns outside the head and tail windows keep their structure, empty',
      keepHead: 'Leading turns kept',
      keepTail: 'Trailing turns kept',
      warningTitle: 'Enable stripping the middle of the context?',
      warningBody: 'Stripping the middle of the context can remove important content from the middle of a long conversation while it is being sent!',
      warningConfirm: 'Enable anyway',
      warningCancel: 'Cancel',
      close: 'Close',
      footer: 'Stored on this machine; applies to every session',
    }

    const FALLBACK = {
      enabled: true,
      stripThink: true,
      dedupeReads: true,
      stripTerminal: false,
      stripMiddle: false,
      keepHeadTurns: 5,
      keepTailTurns: 5,
    }

    const TRIGGER = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '28px',
      padding: '0 8px',
      margin: '0',
      border: '1px solid transparent',
      borderRadius: '8px',
      background: 'transparent',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
      color: 'var(--dsw-alias-label-secondary)',
    }

    const PANEL = {
      position: 'fixed',
      zIndex: 1000,
      boxSizing: 'border-box',
      padding: '12px',
      borderRadius: '12px',
      overflowY: 'auto',
      background: 'var(--dsw-alias-bg-overlay)',
      color: 'var(--dsw-alias-label-primary)',
      border: '1px solid var(--dsw-alias-border-l1)',
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.28)',
      fontSize: '12px',
      lineHeight: '18px',
      textAlign: 'left',
    }

    const HEADER = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      paddingBottom: '8px',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
    }

    const ROW = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '6px 0',
    }

    const ROW_TEXT = {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      minWidth: '0',
    }

    const ROW_HINT = {
      fontSize: '11px',
      lineHeight: '15px',
      color: 'var(--dsw-alias-label-secondary)',
    }

    const SECTION = {
      marginTop: '6px',
      paddingTop: '8px',
      borderTop: '1px solid var(--dsw-alias-border-l1)',
      fontSize: '11px',
      lineHeight: '15px',
      color: 'var(--dsw-alias-label-secondary)',
    }

    const NUMBER = {
      width: '60px',
      height: '26px',
      padding: '0 6px',
      boxSizing: 'border-box',
      borderRadius: '7px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '12px',
      textAlign: 'center',
    }

    const CLOSE_BUTTON = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '20px',
      height: '20px',
      padding: '0',
      border: 'none',
      borderRadius: '6px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: '14px',
      lineHeight: '14px',
      cursor: 'pointer',
    }

    const FOOTER = {
      marginTop: '8px',
      paddingTop: '8px',
      borderTop: '1px solid var(--dsw-alias-border-l1)',
      fontSize: '11px',
      lineHeight: '15px',
      color: 'var(--dsw-alias-label-secondary)',
    }

    const OVERLAY = {
      position: 'fixed',
      inset: '0',
      zIndex: 1100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.45)',
    }

    const DIALOG = {
      width: '380px',
      maxWidth: 'calc(100vw - 32px)',
      boxSizing: 'border-box',
      padding: '16px',
      borderRadius: '14px',
      background: 'var(--dsw-alias-bg-overlay)',
      color: 'var(--dsw-alias-label-primary)',
      border: '1px solid var(--dsw-alias-border-l1)',
      boxShadow: '0 20px 48px rgba(0, 0, 0, 0.35)',
      fontSize: '13px',
      lineHeight: '20px',
    }

    const BUTTON = {
      height: '30px',
      padding: '0 12px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: '12px',
      cursor: 'pointer',
    }

    const BUTTON_PRIMARY = {
      height: '30px',
      padding: '0 12px',
      borderRadius: '8px',
      border: '1px solid transparent',
      background: 'var(--dsw-alias-state-warn-primary)',
      color: '#FFFFFF',
      font: 'inherit',
      fontSize: '12px',
      cursor: 'pointer',
    }

    // The switch needs a track that stays visible in both themes. The brand and
    // border aliases cannot provide one: in the dark theme brand-primary resolves
    // to a near-white bluish-50 and border-l2 to transparent white, so a white
    // knob would sit on a near-white track. These two are mid-tone, so the knob
    // and the track keep their contrast on a light and on a dark panel.
    const SWITCH_ON = '#22c55e'
    const SWITCH_OFF = '#9aa0a6'
    const SWITCH_KNOB = '#ffffff'

    function Switcher(props) {
      const checked = props.checked === true
      const disabled = props.disabled === true
      const onChange = props.onChange
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled,
        onClick: () => {
          if (!disabled) onChange(!checked)
        },
        style: {
          position: 'relative',
          flex: '0 0 auto',
          width: '32px',
          height: '18px',
          padding: '0',
          border: 'none',
          borderRadius: '9px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          background: checked ? SWITCH_ON : SWITCH_OFF,
          transition: 'background 120ms ease',
        },
      }, h('span', {
        style: {
          position: 'absolute',
          top: '2px',
          left: checked ? '16px' : '2px',
          display: 'block',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: SWITCH_KNOB,
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
          transition: 'left 120ms ease',
        },
      }))
    }

    function NumberField(props) {
      const value = props.value
      const disabled = props.disabled === true
      const onCommit = props.onCommit
      const state = React.useState(String(value))
      const draft = state[0]
      const setDraft = state[1]

      React.useEffect(() => {
        setDraft(String(value))
      }, [value])

      const commit = () => {
        const parsed = Math.trunc(Number(draft))
        if (!Number.isFinite(parsed)) {
          setDraft(String(value))
          return
        }
        const clamped = Math.min(100, Math.max(1, parsed))
        setDraft(String(clamped))
        if (clamped !== value) onCommit(clamped)
      }

      return h('input', {
        type: 'number',
        min: 1,
        max: 100,
        step: 1,
        value: draft,
        disabled,
        'aria-label': props.label,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        },
        style: Object.assign({}, NUMBER, disabled ? { opacity: 0.45, cursor: 'not-allowed' } : null),
      })
    }

    function Icon() {
      return h('svg', {
        viewBox: '0 0 64 64',
        width: 14,
        height: 14,
        'aria-hidden': 'true',
        style: { display: 'block', flex: '0 0 auto' },
      },
      h('rect', { x: 6, y: 10, width: 52, height: 8, rx: 4, fill: 'currentColor' }),
      h('rect', { x: 6, y: 22, width: 40, height: 8, rx: 4, fill: 'currentColor', opacity: 0.75 }),
      h('rect', { x: 6, y: 34, width: 32, height: 8, rx: 4, fill: 'currentColor', opacity: 0.28 }),
      h('rect', { x: 6, y: 46, width: 52, height: 8, rx: 4, fill: 'currentColor', opacity: 0.75 }))
    }

    function readSettings() {
      return fetch(ROUTE, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }).then((response) => response.json()).then((body) => (
        body !== null && typeof body === 'object' && body.ok === true ? body.settings : undefined
      )).catch(() => undefined)
    }

    function writeSettings(patch) {
      return fetch(ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      }).then((response) => response.json()).then((body) => (
        body !== null && typeof body === 'object' && body.ok === true ? body.settings : undefined
      )).catch(() => undefined)
    }

    function SaverControl(props) {
      const t = props.t
      const settingsState = React.useState(null)
      const settings = settingsState[0]
      const setSettings = settingsState[1]
      const openState = React.useState(false)
      const open = openState[0]
      const setOpen = openState[1]
      const confirmState = React.useState(false)
      const confirming = confirmState[0]
      const setConfirming = confirmState[1]
      const positionState = React.useState(null)
      const position = positionState[0]
      const setPosition = positionState[1]
      const hoverState = React.useState(false)
      const hover = hoverState[0]
      const setHover = hoverState[1]
      const triggerRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const dialogRef = React.useRef(null)
      const aliveRef = React.useRef(true)
      const busyRef = React.useRef(false)

      React.useEffect(() => {
        aliveRef.current = true
        readSettings().then((value) => {
          if (aliveRef.current && value !== undefined) setSettings(value)
        })
        return () => {
          aliveRef.current = false
        }
      }, [])

      const patch = (change) => {
        if (busyRef.current) return
        busyRef.current = true
        setSettings((current) => Object.assign({}, current ?? FALLBACK, change))
        writeSettings(change).then((value) => {
          busyRef.current = false
          if (!aliveRef.current) return
          if (value !== undefined) setSettings(value)
          else readSettings().then((fresh) => {
            if (aliveRef.current && fresh !== undefined) setSettings(fresh)
          })
        })
      }

      const openPanel = () => {
        const node = triggerRef.current
        if (node !== null) {
          const rect = node.getBoundingClientRect()
          const margin = 8
          const left = Math.min(
            Math.max(margin, rect.left),
            Math.max(margin, window.innerWidth - PANEL_WIDTH - margin),
          )
          const bottom = Math.max(margin, window.innerHeight - rect.top + 8)
          setPosition({
            left: `${left}px`,
            bottom: `${bottom}px`,
            width: `${PANEL_WIDTH}px`,
            maxHeight: `${Math.max(180, window.innerHeight - bottom - margin)}px`,
          })
        }
        setOpen(true)
        readSettings().then((value) => {
          if (aliveRef.current && value !== undefined) setSettings(value)
        })
      }

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (panelRef.current !== null && panelRef.current.contains(event.target)) return
          if (triggerRef.current !== null && triggerRef.current.contains(event.target)) return
          // The warning dialog renders outside the panel, so without this the
          // mousedown that precedes a click on its buttons would close the panel
          // and the dialog together, and the button would never fire.
          if (dialogRef.current !== null && dialogRef.current.contains(event.target)) return
          setOpen(false)
          setConfirming(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          setConfirming(false)
          setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      const value = settings ?? FALLBACK
      const ready = settings !== null
      const master = value.enabled === true

      const row = (label, hint, control, disabled) => h('div', { style: Object.assign({}, ROW, disabled ? { opacity: 0.45 } : null) },
        h('div', { style: ROW_TEXT },
          h('span', null, label),
          hint === undefined ? null : h('span', { style: ROW_HINT }, hint)),
        control)

      const masterRow = row(
        t('master'),
        t('masterHint'),
        h(Switcher, {
          checked: master,
          disabled: !ready,
          label: t('master'),
          onChange: (next) => patch({ enabled: next }),
        }),
        false,
      )

      const thinkRow = row(
        t('think'),
        t('thinkHint'),
        h(Switcher, {
          checked: value.stripThink === true,
          disabled: !ready || !master,
          label: t('think'),
          onChange: (next) => patch({ stripThink: next }),
        }),
        !master,
      )

      const dedupeRow = row(
        t('dedupe'),
        t('dedupeHint'),
        h(Switcher, {
          checked: value.dedupeReads === true,
          disabled: !ready || !master,
          label: t('dedupe'),
          onChange: (next) => patch({ dedupeReads: next }),
        }),
        !master,
      )

      const terminalRow = row(
        t('terminal'),
        t('terminalHint'),
        h(Switcher, {
          checked: value.stripTerminal === true,
          disabled: !ready || !master,
          label: t('terminal'),
          onChange: (next) => patch({ stripTerminal: next }),
        }),
        !master,
      )

      const middleRow = row(
        t('middle'),
        t('middleHint'),
        h(Switcher, {
          checked: value.stripMiddle === true,
          disabled: !ready || !master,
          label: t('middle'),
          onChange: (next) => {
            if (next) {
              setConfirming(true)
              return
            }
            patch({ stripMiddle: false })
          },
        }),
        !master,
      )

      const middleWindow = value.stripMiddle === true && master
        ? h('div', null,
            row(
              t('keepHead'),
              undefined,
              h(NumberField, {
                value: value.keepHeadTurns,
                disabled: !ready,
                label: t('keepHead'),
                onCommit: (next) => patch({ keepHeadTurns: next }),
              }),
              false,
            ),
            row(
              t('keepTail'),
              undefined,
              h(NumberField, {
                value: value.keepTailTurns,
                disabled: !ready,
                label: t('keepTail'),
                onCommit: (next) => patch({ keepTailTurns: next }),
              }),
              false,
            ))
        : null

      const panel = !open ? null : h('div', {
        ref: panelRef,
        role: 'dialog',
        'aria-label': t('title'),
        style: Object.assign({}, PANEL, position ?? {}),
      },
      h('div', { style: HEADER },
        h('span', { style: { fontWeight: 600 } }, t('title')),
        h('button', {
          type: 'button',
          onClick: () => setOpen(false),
          'aria-label': t('close'),
          title: t('close'),
          style: CLOSE_BUTTON,
        }, '\u00d7')),
      masterRow,
      h('div', { style: SECTION }, t('hint')),
      thinkRow,
      dedupeRow,
      terminalRow,
      middleRow,
      middleWindow,
      h('div', { style: FOOTER }, t('footer')))

      const dialog = !confirming ? null : h('div', {
        ref: dialogRef,
        style: OVERLAY,
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) setConfirming(false)
        },
      }, h('div', {
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': t('warningTitle'),
        style: DIALOG,
      },
      h('div', { style: { fontWeight: 600, marginBottom: '8px', color: 'var(--dsw-alias-state-warn-primary)' } }, t('warningTitle')),
      h('div', null, t('warningBody')),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' } },
        h('button', {
          type: 'button',
          onClick: () => setConfirming(false),
          style: BUTTON,
        }, t('warningCancel')),
        h('button', {
          type: 'button',
          onClick: () => {
            setConfirming(false)
            patch({ stripMiddle: true })
          },
          style: BUTTON_PRIMARY,
        }, t('warningConfirm')))))

      return h('span', { style: { display: 'inline-flex', position: 'relative' } },
        h('button', {
          ref: triggerRef,
          type: 'button',
          'aria-haspopup': 'dialog',
          'aria-expanded': open ? 'true' : 'false',
          title: t('title'),
          onClick: () => {
            if (open) {
              setOpen(false)
              setConfirming(false)
              return
            }
            openPanel()
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: Object.assign({}, TRIGGER, {
            color: master ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
            background: open || hover ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
            borderColor: open ? 'var(--dsw-alias-border-l1)' : 'transparent',
          }),
        },
        h(Icon),
        h('span', null, t('title'))),
        panel,
        dialog)
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'dsh-context-saver: zh dictionary')
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'dsh-context-saver: en dictionary')

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-context-saver',
        order: 20,
        locale: NS,
      }, SaverControl))
    }

    module.exports = { apply, inject }
    return module.exports
  },
})
