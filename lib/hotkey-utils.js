(function attachHotkeyUtils(root) {
  const MODIFIER_LABELS = {
    Control: 'Ctrl',
    Ctrl: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
    Meta: 'Meta'
  }

  const RESERVED_HOTKEYS = new Set([
    'Ctrl+A',
    'Ctrl+C',
    'Ctrl+V',
    'Ctrl+X',
    'Ctrl+Z',
    'Enter',
    'Esc',
    'Tab'
  ])

  function eventToHotkey(event) {
    if (!event) {
      return ''
    }

    const normalizedKey = normalizeEventKey(event.key)

    if (!normalizedKey || isModifierKey(normalizedKey)) {
      return ''
    }

    const parts = []

    if (event.ctrlKey) {
      parts.push('Ctrl')
    }

    if (event.altKey) {
      parts.push('Alt')
    }

    if (event.shiftKey) {
      parts.push('Shift')
    }

    if (event.metaKey) {
      parts.push('Meta')
    }

    parts.push(normalizedKey)
    return parts.join('+')
  }

  function normalizeHotkey(hotkey) {
    const pieces = String(hotkey || '')
      .split('+')
      .map((piece) => normalizeEventKey(piece))
      .filter(Boolean)

    if (!pieces.length) {
      return ''
    }

    const modifiers = []

    for (const label of ['Ctrl', 'Alt', 'Shift', 'Meta']) {
      if (pieces.includes(label)) {
        modifiers.push(label)
      }
    }

    const primary = pieces.find((piece) => !isModifierKey(piece))

    if (!primary) {
      return ''
    }

    return [...modifiers, primary].join('+')
  }

  function matchesHotkey(event, hotkey) {
    const normalizedHotkey = normalizeHotkey(hotkey)

    if (!normalizedHotkey) {
      return false
    }

    return eventToHotkey(event) === normalizedHotkey
  }

  function formatHotkeyLabel(hotkey, fallback = 'Not set') {
    const normalizedHotkey = normalizeHotkey(hotkey)
    return normalizedHotkey || fallback
  }

  function isBindableHotkey(hotkey) {
    const normalizedHotkey = normalizeHotkey(hotkey)

    if (!normalizedHotkey || RESERVED_HOTKEYS.has(normalizedHotkey)) {
      return false
    }

    const primary = getHotkeyPrimary(normalizedHotkey)

    if (!primary) {
      return false
    }

    if (/^F\d{1,2}$/i.test(primary)) {
      return true
    }

    return normalizedHotkey.includes('Ctrl+') || normalizedHotkey.includes('Alt+') || normalizedHotkey.includes('Meta+')
  }

  function getHotkeyPrimary(hotkey) {
    const normalizedHotkey = normalizeHotkey(hotkey)

    if (!normalizedHotkey) {
      return ''
    }

    const parts = normalizedHotkey.split('+')
    return parts[parts.length - 1] || ''
  }

  function isModifierKey(key) {
    return key === 'Ctrl' || key === 'Alt' || key === 'Shift' || key === 'Meta'
  }

  function normalizeEventKey(key) {
    const raw = String(key || '').trim()

    if (!raw) {
      return ''
    }

    if (MODIFIER_LABELS[raw]) {
      return MODIFIER_LABELS[raw]
    }

    if (raw === ' ') {
      return 'Space'
    }

    if (raw === 'Spacebar') {
      return 'Space'
    }

    if (raw === 'Escape') {
      return 'Esc'
    }

    if (/^Arrow(?:Up|Down|Left|Right)$/i.test(raw)) {
      return raw[0].toUpperCase() + raw.slice(1)
    }

    if (/^F\d{1,2}$/i.test(raw)) {
      return raw.toUpperCase()
    }

    if (raw.length === 1 && /[a-z0-9]/i.test(raw)) {
      return raw.toUpperCase()
    }

    return raw[0].toUpperCase() + raw.slice(1)
  }

  const api = {
    eventToHotkey,
    formatHotkeyLabel,
    isBindableHotkey,
    matchesHotkey,
    normalizeHotkey
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalHotkeyUtils = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
