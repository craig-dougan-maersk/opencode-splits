/** @jsxImportSource @opentui/solid */
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { extend } from "@opentui/solid"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import type { WorkspaceController } from "./controller.ts"
import { processEnv } from "./config.ts"
import { textColor } from "./theme.ts"
import {
  PtyConnection,
  createPersistentPty,
  updatePersistentPtySize,
  type PtyControlMessage,
} from "./pty.ts"

extend({ embedded_terminal: EmbeddedTerminalRenderable as any })

type TerminalStatus = "creating" | "connecting" | "connected" | "exited" | "error" | "missing"

export function TerminalPane(props: {
  controller: WorkspaceController
  focused: boolean
  sessionID?: string
  ptyID?: string
  directory?: string
  title?: string
  focusID?: string
  onPtyID?: (ptyID: string) => void
  onTitle?: (title: string) => void
}) {
  const controller = props.controller
  const context = controller.context
  const client = controller.client
  const [ptyID, setPtyID] = createSignal<string | undefined>(props.ptyID)
  const [status, setStatus] = createSignal<TerminalStatus>("creating")
  const [message, setMessage] = createSignal("")
  const [title, setTitle] = createSignal(props.title ?? "terminal")
  const [ready, setReady] = createSignal(false)

  let term: any
  let connection: PtyConnection | undefined
  let started = false
  let disposed = false
  const focusID = props.focusID ?? "terminal"

  onCleanup(
    controller.registerFocusable(focusID, {
      focus: () => {
        try {
          term?.focus?.()
        } catch {
          // ignore
        }
      },
      blur: () => {
        try {
          term?.blur?.()
        } catch {
          // ignore
        }
      },
    }),
  )

  const applyTitle = (value: string) => {
    if (!value) return
    setTitle(value)
    props.onTitle?.(value)
  }

  const onControl = (control: PtyControlMessage) => {
    if (control.type === "attached") {
      setStatus("connected")
      const size = (control as any).info?.size
      if (size?.cols && size?.rows) {
        connection?.resize(size.cols, size.rows)
      }
      return
    }
    if (control.type === "title_changed") {
      applyTitle(String((control as any).title ?? ""))
      return
    }
    if (control.type === "exited") {
      setStatus("exited")
      setMessage(
        (control as any).exitCode === undefined || (control as any).exitCode === null
          ? "terminal exited"
          : `terminal exited (${(control as any).exitCode})`,
      )
      return
    }
    if (control.type === "resized") {
      connection?.resize(Number((control as any).cols), Number((control as any).rows))
    }
  }

  const attach = async (id: string) => {
    connection?.close()
    connection = new PtyConnection(
      client,
      {
        onOutput: (bytes) => {
          try {
            term?.write?.(bytes)
          } catch {
            // Renderable may be disposed.
          }
        },
        onControl,
        onClose: () => {
          if (!disposed) setStatus("exited")
        },
        onError: () => {
          if (!disposed) {
            setStatus("error")
            setMessage("terminal connection failed")
          }
        },
      },
      { cols: term?.cols ?? 80, rows: term?.rows ?? 24 },
    )
    setStatus("connecting")
    await connection.connect(id, 0, true)
    if (!disposed) setStatus("connected")
  }

  const createNew = async () => {
    const sessionID = props.sessionID
    if (!sessionID) {
      setStatus("missing")
      setMessage("focus a session pane first")
      return
    }
    setStatus("creating")
    try {
      const directory =
        props.directory ??
        context.data.session.get(sessionID)?.location?.directory ??
        context.location?.directory ??
        process.cwd()
      const id = await createPersistentPty(client, {
        sessionID,
        cwd: directory,
        shell: controller.options.shell,
        env: processEnv(controller.options.env),
        title: props.title ?? "Terminal",
        cols: term?.cols ?? 80,
        rows: term?.rows ?? 24,
      })
      if (disposed) return
      controller.trackPty(id)
      props.onPtyID?.(id)
      setPtyID(id)
      await attach(id)
    } catch (error) {
      if (disposed) return
      setStatus("error")
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const start = async () => {
    const existing = props.ptyID ?? ptyID()
    if (!existing) {
      await createNew()
      return
    }
    try {
      const info = await client.experimental.persistentPty.get({ ptyID: existing })
      if (disposed) return
      if (info.status === "running") {
        setPtyID(existing)
        await attach(existing)
        return
      }
    } catch {
      // Stale PTY; recreate below.
    }
    await createNew()
  }

  createEffect(() => {
    if (!ready() || started) return
    started = true
    void start()
  })

  onCleanup(() => {
    disposed = true
    connection?.close()
  })

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <Show when={status() === "missing" || status() === "error" || status() === "exited"}>
        <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1}>
          <text fg={textColor(context, status() === "exited" ? "warning" : "error", "red")}>
            {message() || status()}
          </text>
          <box flexGrow={1} />
          <box onMouseDown={() => void createNew()}>
            <text fg={textColor(context, "info", "cyan")}>[restart]</text>
          </box>
        </box>
      </Show>
      <embedded_terminal
        ref={(value: any) => {
          term = value
          setReady(Boolean(value))
          controller.requestFocus(focusID)
        }}
        flexGrow={1}
        cols={80}
        rows={24}
        onData={(data: Uint8Array) => connection?.sendInput(data)}
        onTerminalResize={(cols: number, rows: number) => {
          connection?.resize(cols, rows)
          const id = ptyID()
          if (id) void updatePersistentPtySize(client, id, cols, rows)
        }}
      />
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1}>
        <text fg={textColor(context, "muted", "gray")}>{`${title()} · ${status()}`}</text>
      </box>
    </box>
  )
}

export function LayoutTerminalPane(props: {
  controller: WorkspaceController
  paneID: string
  focused: boolean
}) {
  const pane = () => props.controller.state.panes[props.paneID]
  return (
    <TerminalPane
      controller={props.controller}
      focused={props.focused}
      focusID={props.paneID}
      sessionID={pane()?.sessionID}
      ptyID={pane()?.ptyID}
      directory={pane()?.directory}
      title={pane()?.title}
      onPtyID={(ptyID) => props.controller.setPanePty(props.paneID, ptyID)}
      onTitle={(title) => props.controller.setPaneTitle(props.paneID, title)}
    />
  )
}
