/** @jsxImportSource @opentui/solid */
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { extend } from "@opentui/solid"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import type { TerminalEnvResult, WorkspaceController } from "./controller.ts"
import { processEnv } from "./config.ts"
import { NO_KEY, SESSION_DEFAULT, pickKube, pickProfile, pickSshKey } from "./launch.ts"
import { textColor } from "./theme.ts"
import {
  PtyConnection,
  createPersistentPty,
  removePersistentPty,
  updatePersistentPtySize,
  type PtyControlMessage,
} from "./pty.ts"

extend({ embedded_terminal: EmbeddedTerminalRenderable as any })

type TerminalStatus = "creating" | "connecting" | "connected" | "exited" | "error" | "missing"

/**
 * One terminal attached to a persistent PTY owned by the OpenCode server.
 *
 * The process environment is fixed when the PTY is created, so changing the
 * profile, Kubernetes context or SSH key restarts the PTY (see `recreate`).
 */
export function TerminalPane(props: {
  controller: WorkspaceController
  focused: boolean
  /** Focus registry id. Unique per mounted pane instance. */
  focusID: string
  sessionID?: string
  directory?: string
  /** Present for terminals held in a workspace pane; enables the pickers. */
  paneID?: string
  tabId?: string
  ptyID?: string
  title?: string
  /** Requested selection, shown when the effective value is not known yet. */
  profile?: string
  kubeContext?: string
  sshKey?: string
  envBuilder?: () => Promise<TerminalEnvResult>
  onPtyID?: (ptyID: string | undefined) => void
  onTitle?: (title: string) => void
}) {
  const controller = props.controller
  const context = controller.context
  const client = controller.client
  const [pty, setPty] = createSignal<string | undefined>(props.ptyID)
  const [status, setStatus] = createSignal<TerminalStatus>("creating")
  const [message, setMessage] = createSignal("")
  const [title, setTitle] = createSignal(props.title ?? "terminal")
  const [ready, setReady] = createSignal(false)
  const [effective, setEffective] = createSignal<{ profile?: string; context?: string; ssh?: string }>({})

  let term: any
  let connection: PtyConnection | undefined
  let started = false
  let disposed = false
  let generation = 0
  let lastWarning = ""
  const focusID = props.focusID

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

  // The terminal's own restart hook, so a selection change in the status bar
  // rebuilds the process with the new environment.
  onCleanup(controller.registerRestarter(focusID, () => void recreate()))

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

  const buildEnv = async (): Promise<TerminalEnvResult> => {
    if (props.envBuilder) return props.envBuilder()
    return controller.buildEnvForSession(props.sessionID, props.directory)
  }

  const reportWarnings = (result: TerminalEnvResult) => {
    const warnings = result.warnings ?? []
    if (!warnings.length) return
    const text = warnings.length > 1 ? `${warnings[0]} (+${warnings.length - 1} more)` : warnings[0]!
    if (text === lastWarning) return
    lastWarning = text
    context.ui.toast.show({
      title: "Terminal environment",
      message: text,
      variant: "warning",
      duration: 6000,
    })
  }

  const createNew = async () => {
    const sessionID = props.sessionID
    if (!sessionID) {
      setStatus("missing")
      setMessage("focus a session pane first")
      return
    }
    const mine = ++generation
    setStatus("creating")
    try {
      const result = await buildEnv()
      if (disposed || mine !== generation) return
      setEffective({ profile: result.profile, context: result.context, ssh: result.sshSocket })
      reportWarnings(result)
      const directory =
        props.directory ??
        context.data.session.get(sessionID)?.location?.directory ??
        context.location?.directory ??
        process.cwd()
      const id = await createPersistentPty(client, {
        sessionID,
        cwd: directory,
        shell: controller.options.shell,
        env: result.env,
        title: props.title ?? "Terminal",
        cols: term?.cols ?? 80,
        rows: term?.rows ?? 24,
      })
      if (disposed || mine !== generation) {
        void removePersistentPty(client, id)
        return
      }
      controller.trackPty(id)
      props.onPtyID?.(id)
      setPty(id)
      await attach(id)
    } catch (error) {
      if (disposed || mine !== generation) return
      setStatus("error")
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const start = async () => {
    const existing = pty() ?? props.ptyID
    if (!existing) {
      await createNew()
      return
    }
    try {
      const info = await client.experimental.persistentPty.get({ ptyID: existing })
      if (disposed) return
      if (info.status === "running") {
        setPty(existing)
        await attach(existing)
        return
      }
    } catch {
      // Stale PTY; recreate below.
    }
    await createNew()
  }

  /** Rebuild the PTY so the freshly selected environment takes effect. */
  async function recreate() {
    if (disposed) return
    connection?.close()
    connection = undefined
    const previous = pty()
    if (previous) {
      controller.forgetPty(previous)
      setPty(undefined)
      props.onPtyID?.(undefined)
      await removePersistentPty(client, previous)
    }
    if (disposed) return
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

  const canPick = () => Boolean(props.paneID && props.tabId)

  const wizardTarget = () => ({
    sessionID: props.sessionID,
    directory: props.directory ?? controller.sessionDirectoryFor(props.sessionID),
    location: controller.locationFor(props.sessionID),
  })

  const changeProfile = async () => {
    if (!props.paneID || !props.tabId) return
    const result = await pickProfile(
      context,
      controller.managers,
      wizardTarget(),
      processEnv(controller.options.env),
      props.profile,
    )
    if (result.status !== "ok") return
    controller.setTabSelection(props.paneID, props.tabId, {
      profile: result.value === SESSION_DEFAULT ? undefined : result.value,
    })
    void recreate()
  }

  const changeKube = async () => {
    if (!props.paneID || !props.tabId) return
    const result = await pickKube(context, controller.managers, wizardTarget(), undefined)
    if (result.status !== "ok") return
    controller.setTabSelection(props.paneID, props.tabId, { kube: result.value })
    void recreate()
  }

  const changeSshKey = async () => {
    if (!props.paneID || !props.tabId) return
    const result = await pickSshKey(context, controller.managers, wizardTarget(), props.sshKey)
    if (result.status !== "ok") return
    controller.setTabSelection(props.paneID, props.tabId, {
      sshKey: result.value === NO_KEY ? undefined : result.value,
    })
    void recreate()
  }

  const profileLabel = () => effective().profile ?? props.profile ?? "session"
  const kubeLabel = () => effective().context ?? props.kubeContext ?? "session"
  const sshLabel = () => props.sshKey ?? "session"

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <Show when={status() === "missing" || status() === "error" || status() === "exited"}>
        <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1}>
          <text fg={textColor(context, status() === "exited" ? "warning" : "error", "red")}>
            {message() || status()}
          </text>
          <box flexGrow={1} />
          <box onMouseDown={() => void recreate()}>
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
          const id = pty()
          if (id) void updatePersistentPtySize(client, id, cols, rows)
        }}
      />
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1}>
        <text fg={textColor(context, "muted", "gray")}>{`${title()} · ${status()} · `}</text>
        <Show
          when={canPick()}
          fallback={
            <text fg={textColor(context, "muted", "gray")}>
              {`profile:${profileLabel()} · kube:${kubeLabel()} · ssh:${sshLabel()}`}
            </text>
          }
        >
          <box onMouseDown={() => void changeProfile()}>
            <text fg={textColor(context, "info", "cyan")}>{`profile:${profileLabel()}`}</text>
          </box>
          <text fg={textColor(context, "muted", "gray")}>{" · "}</text>
          <box onMouseDown={() => void changeKube()}>
            <text fg={textColor(context, "info", "cyan")}>{`kube:${kubeLabel()}`}</text>
          </box>
          <text fg={textColor(context, "muted", "gray")}>{" · "}</text>
          <box onMouseDown={() => void changeSshKey()}>
            <text fg={textColor(context, "info", "cyan")}>{`ssh:${sshLabel()}`}</text>
          </box>
        </Show>
        <box flexGrow={1} />
        <Show when={pty()}>
          <box onMouseDown={() => void recreate()}>
            <text fg={textColor(context, "muted", "gray")}>[restart]</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
