export function basename(path: string | undefined): string {
  if (!path) return ""
  const parts = path.split("/").filter(Boolean)
  return parts.slice(-2).join("/") || path
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

export function shortTime(ms: number | undefined): string {
  if (!ms) return ""
  try {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

export function number(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "0"
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}m`
}

export function stringify(value: unknown, max = 600): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return truncate(value, max)
  try {
    return truncate(JSON.stringify(value, null, 2), max)
  } catch {
    return truncate(String(value), max)
  }
}

export function firstLine(value: string, max = 120): string {
  const line = value.split("\n").find((entry) => entry.trim().length > 0) ?? ""
  return truncate(line.trim(), max)
}
