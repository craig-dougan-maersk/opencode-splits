import { rgbToHex } from "@opentui/core"

export function hex(color: unknown, fallback: string): string {
  if (typeof color === "string" && color.length > 0) return color
  try {
    return color ? rgbToHex(color as any) : fallback
  } catch {
    return fallback
  }
}

const TOKENS: Record<string, (theme: any) => unknown> = {
  base: (theme) => theme?.text?.base,
  muted: (theme) => theme?.text?.muted,
  success: (theme) => theme?.text?.feedback?.success?.base,
  warning: (theme) => theme?.text?.feedback?.warning?.base,
  error: (theme) => theme?.text?.feedback?.error?.base,
  info: (theme) => theme?.text?.feedback?.info?.base ?? theme?.text?.action?.primary?.base,
  accent: (theme) => theme?.text?.action?.primary?.base,
}

export function textColor(context: any, token: string, fallback: string): string {
  const theme = context?.theme
  const getter = TOKENS[token]
  return hex(getter ? getter(theme) : theme?.text?.[token], fallback)
}

export function background(context: any): string {
  return hex(context?.theme?.background?.base, "#1e1e1e")
}

export function raisedBackground(context: any): string {
  return hex(context?.theme?.background?.raised?.base, "#2a2a2a")
}
