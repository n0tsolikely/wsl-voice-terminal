function parseApprovalPrompt(text) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  const anchorMatch = /would you like to run the following command\?/i.exec(normalized)
  const relevantText = anchorMatch ? normalized.slice(anchorMatch.index) : normalized
  const lines = relevantText
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)

  const commandLine =
    lines.find((line) => /^[$#]\s+/.test(line)) ||
    lines.find((line) => /^(?:cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\b|bash\b|sh\b)/i.test(line)) ||
    ''
  const command = commandLine.replace(/^[$#]\s+/, '').trim()

  if (!command) {
    return null
  }

  const effect = describeCommandEffect(command)
  const spokenText = [
    'Approval needed.',
    `Codex wants to run command: ${command}.`,
    `Effect: ${effect}.`,
    "Options: 1, yes proceed. 2, yes and don't ask again for this command. 3, no, and tell Codex what to do differently.",
    'Press Enter to confirm or Escape to cancel.'
  ].join(' ')

  return {
    command,
    effect,
    text: spokenText
  }
}

function describeCommandEffect(command) {
  const normalized = String(command || '').trim()

  if (!normalized) {
    return 'This will run the requested command'
  }

  if (/\b(?:rm|del|erase|rmdir|rd|remove-item)\b/i.test(normalized)) {
    if (/\b(?:-r|-rf|-fr|\/s|\/q|-recurse)\b/i.test(normalized)) {
      return 'This will recursively delete files or directories'
    }

    return 'This will delete files or directories'
  }

  if (/\b(?:mv|ren|rename-item|move-item)\b/i.test(normalized)) {
    return 'This will move or rename files or directories'
  }

  if (/\b(?:cp|copy-item|xcopy|robocopy)\b/i.test(normalized)) {
    return 'This will copy files or directories'
  }

  if (/\bgit\s+push\b/i.test(normalized)) {
    return 'This will push git commits to a remote repository'
  }

  if (/\bgit\s+commit\b/i.test(normalized)) {
    return 'This will create a git commit from the current staged changes'
  }

  if (/\bgit\s+(?:checkout|switch)\b/i.test(normalized)) {
    return 'This will change the current git branch or restore tracked files'
  }

  if (/\b(?:npm|pnpm|yarn|pip|pip3|uv|poetry)\s+(?:install|add)\b/i.test(normalized)) {
    return 'This will install or add packages to the environment'
  }

  if (/\b(?:curl|wget|invoke-webrequest)\b/i.test(normalized)) {
    return 'This will contact a network resource and download or request data'
  }

  if (/\b(?:chmod|chown|icacls)\b/i.test(normalized)) {
    return 'This will change file permissions or ownership'
  }

  if (/\b(?:apply_patch|sed\s+-i|perl\s+-pi|python(?:3)?\s+-c|node\s+-e)\b/i.test(normalized)) {
    return 'This may modify files in the workspace'
  }

  return 'This will run the requested command'
}

module.exports = {
  describeCommandEffect,
  parseApprovalPrompt
}
