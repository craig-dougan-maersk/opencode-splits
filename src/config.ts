export interface SplitsOptions {
  overlayHeight: number
  overlayToggleKey: string
  overlayCloseKey: string
  shell: string
  env: Record<string, string>
  scrollback: number
  confirmClose: boolean
  terminalTitle: boolean
}

export function readOptions(raw: unknown): SplitsOptions {
  const value = (raw ?? {}) as Record<string, unknown>
  const height = Number(value.overlayHeight ?? 45)
  const scrollback = Number(value.scrollback ?? 5000)
  return {
    overlayHeight: Number.isFinite(height) ? Math.min(90, Math.max(15, height)) : 45,
    overlayToggleKey:
      typeof value.overlayToggleKey === "string" && value.overlayToggleKey.length > 0
        ? value.overlayToggleKey
        : "`",
    overlayCloseKey:
      typeof value.overlayCloseKey === "string" && value.overlayCloseKey.length > 0
        ? value.overlayCloseKey
        : "ctrl+`",
    shell:
      typeof value.shell === "string" && value.shell.length > 0
        ? value.shell
        : process.env.SHELL || "/bin/bash",
    env: isStringRecord(value.env) ? value.env : {},
    scrollback: Number.isFinite(scrollback) ? Math.max(500, scrollback) : 5000,
    confirmClose: value.confirmClose !== false,
    terminalTitle: value.terminalTitle !== false,
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}

export function processEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value
  }
  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...extra,
  }
}
