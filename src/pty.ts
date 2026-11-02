import type { OpenCodeClient } from "@opencode/client"
import { ptyFrame } from "./pty-frame.ts"

export interface PtyHooks {
  onOutput?: (bytes: Uint8Array) => void
  onControl?: (message: PtyControlMessage) => void
  onClose?: () => void
  onError?: (error: unknown) => void
}

export type PtyControlMessage =
  | { type: "attached"; info?: any; role?: string; inputProtocol?: number }
  | { type: "replay_complete" }
  | { type: "resized"; cols: number; rows: number }
  | { type: "controller_changed"; attachmentID?: string | null }
  | { type: "exited"; exitCode?: number | null }
  | { type: "title_changed"; title: string }
  | { type: "foreground_process_changed"; process: string | null }
  | { type: string; [key: string]: unknown }

export interface CreatePtyInput {
  sessionID: string
  cwd?: string
  shell?: string
  env?: Record<string, string>
  title?: string
  cols?: number
  rows?: number
}

function attachmentID(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `splits-${Date.now()}-${Math.random().toString(36).slice(2)}`
  } catch {
    return `splits-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** One WebSocket attachment to a persistent PTY owned by the OpenCode server. */
export class PtyConnection {
  private socket: WebSocket | undefined
  private closed = false
  private cols: number
  private rows: number
  private cursor = 0
  readonly attachment = attachmentID()

  constructor(
    private readonly client: OpenCodeClient,
    private readonly hooks: PtyHooks = {},
    size: { cols?: number; rows?: number } = {},
  ) {
    this.cols = size.cols ?? 80
    this.rows = size.rows ?? 24
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows }
  }

  get connected(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN)
  }

  async connect(ptyID: string, cursor = 0, takeover = true): Promise<void> {
    this.close()
    this.closed = false
    this.cursor = cursor

    const info = await this.client.server.info()
    const address = info.urls?.[0]
    if (!address) throw new Error("OpenCode server did not report a URL")

    const token = await this.client.experimental.persistentPty.connectToken({
      ptyID,
      "x-opencode-ticket": "1",
    })

    const base = new URL(address)
    if (!base.pathname.endsWith("/")) base.pathname += "/"
    const url = new URL(`api/experimental/persistent-pty/${encodeURIComponent(ptyID)}/connect`, base)
    url.searchParams.set("ticket", token.ticket)
    url.searchParams.set("cursor", String(cursor))
    url.searchParams.set("attachment_id", this.attachment)
    url.searchParams.set("takeover", String(takeover))
    url.searchParams.set("input_protocol", "1")
    url.protocol = base.protocol === "https:" ? "wss:" : "ws:"

    const socket = new WebSocket(url)
    socket.binaryType = "arraybuffer"
    this.socket = socket

    socket.onopen = () => {
      if (this.closed) return
      socket.send(ptyFrame(this.cols, this.rows))
    }
    socket.onmessage = (event) => {
      if (this.closed) return
      const data = event.data
      if (typeof data === "string") {
        try {
          this.hooks.onControl?.(JSON.parse(data) as PtyControlMessage)
        } catch {
          // Ignore malformed control frames.
        }
        return
      }
      if (data instanceof ArrayBuffer) {
        this.hooks.onOutput?.(new Uint8Array(data))
        return
      }
      if (data instanceof Uint8Array) {
        this.hooks.onOutput?.(data)
      }
    }
    socket.onerror = (event) => {
      if (!this.closed) this.hooks.onError?.(event)
    }
    socket.onclose = () => {
      this.socket = undefined
      if (!this.closed) this.hooks.onClose?.()
    }
  }

  sendInput(data: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(ptyFrame(this.cols, this.rows, data))
  }

  sendText(text: string): void {
    this.sendInput(new TextEncoder().encode(text))
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return
    this.cols = cols
    this.rows = rows
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(ptyFrame(cols, rows))
    }
  }

  close(): void {
    this.closed = true
    const socket = this.socket
    this.socket = undefined
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
  }

  get replayCursor(): number {
    return this.cursor
  }
}

export async function createPersistentPty(
  client: OpenCodeClient,
  input: CreatePtyInput,
): Promise<string> {
  const info = await client.experimental.persistentPty.create({
    sessionID: input.sessionID,
    command: input.shell,
    args: [],
    cwd: input.cwd,
    title: input.title ?? "Terminal",
    env: input.env ?? {},
    size: {
      cols: input.cols ?? 80,
      rows: input.rows ?? 24,
    },
  })
  return info.id
}

export async function removePersistentPty(client: OpenCodeClient, ptyID: string): Promise<void> {
  try {
    await client.experimental.persistentPty.remove({ ptyID })
  } catch {
    // Already gone.
  }
}

export async function updatePersistentPtySize(
  client: OpenCodeClient,
  ptyID: string,
  cols: number,
  rows: number,
): Promise<void> {
  try {
    await client.experimental.persistentPty.update({ ptyID, size: { cols, rows } })
  } catch {
    // Best effort; the stream resize frame is authoritative for the live view.
  }
}
