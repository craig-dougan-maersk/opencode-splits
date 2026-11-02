/** @jsxImportSource @opentui/solid */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { SyntaxStyle } from "@opentui/core"
import type { WorkspaceController } from "./controller.ts"
import { basename, number, shortTime, stringify, truncate } from "./format.ts"
import { textColor } from "./theme.ts"

function ToolView(props: { part: any; context: any }) {
  const part = () => props.part
  const state = () => part().state ?? {}
  const status = () => state().status ?? "running"
  const output = () => {
    const value = state()
    if (value.status === "completed" && Array.isArray(value.content)) {
      return value.content
        .map((entry: any) => (entry.type === "text" ? entry.text : `[file ${entry.name ?? entry.uri}]`))
        .join("\n")
    }
    if (value.status === "error") {
      return value.error?.message ?? "tool failed"
    }
    return stringify(value.input)
  }
  const statusColor = () =>
    status() === "error"
      ? textColor(props.context, "error", "red")
      : status() === "completed"
        ? textColor(props.context, "success", "green")
        : textColor(props.context, "warning", "yellow")

  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={1}>
      <box flexDirection="row">
        <text fg={statusColor()}>
          {`● ${part().name ?? "tool"} `}
          <span style={{ fg: textColor(props.context, "muted", "gray") }}>{status()}</span>
        </text>
      </box>
      <Show when={output()}>
        <text fg={textColor(props.context, "muted", "gray")}>{truncate(output(), 1200)}</text>
      </Show>
    </box>
  )
}

function AssistantView(props: {
  message: any
  deltas: Record<string, string>
  context: any
  style: any
}) {
  const message = () => props.message
  const content = () => (Array.isArray(message().content) ? message().content : [])
  const lastText = () => {
    let index = -1
    content().forEach((part: any, i: number) => {
      if (part?.type === "text") index = i
    })
    return index
  }
  const textFor = (part: any, index: number) => {
    const base = String(part?.text ?? "")
    if (index !== lastText()) return base
    const delta = props.deltas[message().id] ?? ""
    if (!delta) return base
    return base.endsWith(delta) ? base : base + delta
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      <For each={content()}>
        {(part: any, index) => (
          <Show
            when={part?.type === "text"}
            fallback={
              <Show
                when={part?.type === "reasoning"}
                fallback={<ToolView part={part} context={props.context} />}
              >
                <box flexDirection="column" marginBottom={1} paddingLeft={1}>
                  <text fg={textColor(props.context, "muted", "gray")}>
                    {`thinking · ${truncate(String(part?.text ?? ""), 800)}`}
                  </text>
                </box>
              </Show>
            }
          >
            <Show
              when={props.style}
              fallback={<text fg={textColor(props.context, "base", "white")}>{textFor(part, index())}</text>}
            >
              <markdown content={textFor(part, index())} syntaxStyle={props.style} />
            </Show>
          </Show>
        )}
      </For>
      <Show when={message().error}>
        <text fg={textColor(props.context, "error", "red")}>{message().error?.message ?? "error"}</text>
      </Show>
    </box>
  )
}

function UserView(props: { message: any; context: any }) {
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={1}>
      <text fg={textColor(props.context, "info", "cyan")}>
        <b>You</b>
        <span style={{ fg: textColor(props.context, "muted", "gray") }}>{`  ${shortTime(props.message?.time?.created)}`}</span>
      </text>
      <text fg={textColor(props.context, "base", "white")}>{String(props.message?.text ?? "")}</text>
      <Show when={Array.isArray(props.message?.files) && props.message.files.length > 0}>
        <text fg={textColor(props.context, "muted", "gray")}>
          {props.message.files.map((file: any) => file.name ?? file.uri).join(", ")}
        </text>
      </Show>
    </box>
  )
}

function ShellView(props: { message: any; context: any }) {
  const status = () => props.message?.status ?? "exited"
  return (
    <box flexDirection="column" marginBottom={1} paddingLeft={1}>
      <text fg={textColor(props.context, "warning", "yellow")}>
        {`$ ${props.message?.command ?? ""} `}
        <span style={{ fg: textColor(props.context, "muted", "gray") }}>{status()}</span>
      </text>
      <Show when={props.message?.output?.output}>
        <text fg={textColor(props.context, "muted", "gray")}>{truncate(props.message.output.output, 4000)}</text>
      </Show>
    </box>
  )
}

function MessageView(props: { message: any; deltas: Record<string, string>; context: any; style: any }) {
  const type = () => props.message?.type
  return (
    <Show when={type() === "user"} fallback={
      <Show when={type() === "assistant"} fallback={
        <Show when={type() === "shell"} fallback={
          <Show when={type() === "system"} fallback={
            <Show when={type() === "compaction"} fallback={null}>
              <box marginBottom={1} paddingLeft={1}>
                <text fg={textColor(props.context, "muted", "gray")}>
                  {`compaction · ${truncate(String(props.message?.summary ?? props.message?.status ?? ""), 500)}`}
                </text>
              </box>
            </Show>
          }>
            <box marginBottom={1} paddingLeft={1}>
              <text fg={textColor(props.context, "muted", "gray")}>{String(props.message?.text ?? "")}</text>
            </box>
          </Show>
        }>
          <ShellView message={props.message} context={props.context} />
        </Show>
      }>
        <AssistantView
          message={props.message}
          deltas={props.deltas}
          context={props.context}
          style={props.style}
        />
      </Show>
    }>
      <UserView message={props.message} context={props.context} />
    </Show>
  )
}

function PermissionBar(props: { controller: WorkspaceController; sessionID: string }) {
  const context = props.controller.context
  const client = props.controller.client
  const [tick, setTick] = createSignal(0)
  const requests = createMemo(() => {
    tick()
    return context.data.session.permission.list(props.sessionID) ?? []
  })

  createEffect(() => {
    void context.data.session.permission.sync(props.sessionID).catch(() => undefined)
  })

  const reply = async (request: any, decision: "once" | "always" | "reject") => {
    try {
      await client.permission.reply({
        sessionID: props.sessionID,
        requestID: request.id,
        decision,
      })
      setTick((value) => value + 1)
    } catch (error) {
      context.ui.toast.show({
        message: `Splits: permission failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
    }
  }

  const replyFirst = (decision: "once" | "always" | "reject") => {
    const first = requests()[0]
    if (first) void reply(first, decision)
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 40,
    enabled: () => requests().length > 0,
    commands: [
      {
        id: "splits.permission.once",
        title: "Allow once",
        bind: "ctrl+alt+y",
        run: () => replyFirst("once"),
      },
      {
        id: "splits.permission.always",
        title: "Always allow",
        bind: "ctrl+alt+shift+y",
        run: () => replyFirst("always"),
      },
      {
        id: "splits.permission.reject",
        title: "Reject",
        bind: "ctrl+alt+shift+n",
        run: () => replyFirst("reject"),
      },
    ],
  }))

  return (
    <Show when={requests().length > 0}>
      <box flexDirection="column" flexShrink={0} border borderStyle="single" borderColor={textColor(context, "warning", "yellow")}>
        <For each={requests()}>
          {(request: any) => (
            <box flexDirection="column" paddingLeft={1}>
              <text fg={textColor(context, "warning", "yellow")}>
                {`permission · ${request.action ?? "action"}`}
              </text>
              <text fg={textColor(context, "muted", "gray")}>
                {truncate((request.resources ?? []).join(", "), 500)}
              </text>
              <box flexDirection="row">
                <box onMouseDown={() => void reply(request, "once")}>
                  <text fg={textColor(context, "success", "green")}>[ctrl+alt+y] once </text>
                </box>
                <box onMouseDown={() => void reply(request, "always")}>
                  <text fg={textColor(context, "info", "cyan")}>[ctrl+alt+shift+y] always </text>
                </box>
                <box onMouseDown={() => void reply(request, "reject")}>
                  <text fg={textColor(context, "error", "red")}>[ctrl+alt+shift+n] reject</text>
                </box>
              </box>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

export function SessionPane(props: {
  controller: WorkspaceController
  paneID: string
  focused: boolean
}) {
  const controller = props.controller
  const context = controller.context
  const client = controller.client
  const [tick, setTick] = createSignal(0)
  const [deltas, setDeltas] = createStore<Record<string, string>>({})
  const [draft, setDraft] = createSignal("")
  const [queue, setQueue] = createSignal(false)
  let textarea: any

  onCleanup(
    controller.registerFocusable(props.paneID, {
      focus: () => {
        try {
          textarea?.focus?.()
        } catch {
          // ignore
        }
      },
      blur: () => {
        try {
          textarea?.blur?.()
        } catch {
          // ignore
        }
      },
    }),
  )

  const pane = () => controller.state.panes[props.paneID]
  const sessionID = () => pane()?.sessionID
  const session = () => {
    const id = sessionID()
    return id ? context.data.session.get(id) : undefined
  }
  const location = () => ({
    directory:
      session()?.location?.directory ??
      pane()?.directory ??
      context.location?.directory ??
      process.cwd(),
  })
  const messages = createMemo(() => {
    tick()
    const id = sessionID()
    if (!id) return []
    try {
      return context.data.session.message.list(id) ?? []
    } catch {
      return []
    }
  })
  const status = () => {
    const id = sessionID()
    return id ? context.data.session.status(id) : "idle"
  }
  const lastAssistant = () => {
    const list = messages()
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index]?.type === "assistant") return list[index]
    }
    return undefined
  }
  const agentName = () => session()?.agent ?? lastAssistant()?.agent ?? "agent"
  const modelName = () => {
    const model = session()?.model ?? lastAssistant()?.model
    return model ? `${model.providerID}/${model.id}` : "model"
  }

  let style: any
  try {
    style = SyntaxStyle.fromStyles(
      { default: { fg: textColor(context, "base", "white") } },
      context.renderer.nativeScene,
    )
  } catch {
    style = undefined
  }
  onCleanup(() => {
    if (style) {
      void context.renderer.idle().then(() => {
        try {
          style.destroy()
        } catch {
          // ignore
        }
      })
    }
  })

  createEffect(() => {
    const id = sessionID()
    if (!id) {
      const current = pane()
      if (current && current.kind === "session") void controller.ensureSession(current.id)
      return
    }
    void context.data.session.sync(id).catch(() => undefined)
    void context.data.session.message.sync(id).catch(() => undefined)
    void context.data.session.permission.sync(id).catch(() => undefined)
    void context.data.location.command.sync(location()).catch(() => undefined)
    void context.data.location.model.sync(location()).catch(() => undefined)
    void context.data.location.agent.sync(location()).catch(() => undefined)
  })

  let syncTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleSync = (id: string) => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      void context.data.session.message.sync(id).catch(() => undefined)
      void context.data.session.sync(id).catch(() => undefined)
      setTick((value) => value + 1)
    }, 80)
  }

  const stop = context.data.listen((event: any) => {
    const details = event?.details ?? event
    const id = sessionID()
    if (!id) return
    const data = details?.data
    if (data?.sessionID && data.sessionID !== id) return
    const type = String(details?.type ?? "")
    if (type === "session.text.delta" && data?.assistantMessageID) {
      setDeltas(data.assistantMessageID, (previous) => (previous ?? "") + String(data.delta ?? ""))
      setTick((value) => value + 1)
      return
    }
    if (type === "session.reasoning.delta" && data?.assistantMessageID) {
      setDeltas(data.assistantMessageID, (previous) => (previous ?? "") + String(data.delta ?? ""))
      setTick((value) => value + 1)
      return
    }
    if (type === "session.text.ended" && data?.assistantMessageID) {
      setDeltas(data.assistantMessageID, "")
    }
    if (type === "session.message.content.updated") {
      for (const key of Object.keys(deltas)) setDeltas(key, "")
    }
    if (type.startsWith("session.") || type.startsWith("permission.") || type.startsWith("form.")) {
      scheduleSync(id)
      setTick((value) => value + 1)
    }
  })
  onCleanup(() => {
    stop()
    if (syncTimer) clearTimeout(syncTimer)
  })

  const send = async () => {
    const id = sessionID()
    const text = String(textarea?.plainText ?? draft()).trim()
    if (!id) return
    if (!text) return
    setDraft("")
    try {
      textarea?.setText?.("")
    } catch {
      // ignore
    }
    try {
      if (text.startsWith("/")) {
        const [name, ...rest] = text.slice(1).split(/\s+/)
        if (name) {
          await client.session.command({
            sessionID: id,
            name,
            text: rest.join(" "),
          })
          return
        }
      }
      await client.session.prompt({
        sessionID: id,
        text,
        delivery: queue() ? "queue" : "steer",
      })
      void context.data.session.sync(id).catch(() => undefined)
      void context.data.session.message.sync(id).catch(() => undefined)
      setTick((value) => value + 1)
    } catch (error) {
      context.ui.toast.show({
        message: `Splits: send failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
        duration: 5000,
      })
    }
  }

  const interrupt = async () => {
    const id = sessionID()
    if (!id) return
    try {
      await client.session.interrupt({ sessionID: id, resume: false })
    } catch (error) {
      context.ui.toast.show({
        message: `Splits: interrupt failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
    }
  }

  const pickModel = async () => {
    try {
      await pickModelInner()
    } catch (error) {
      context.ui.toast.show({
        message: `Splits: model picker failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
        duration: 5000,
      })
    }
  }

  const pickModelInner = async () => {
    const id = sessionID()
    if (!id) return
    const models = (context.data.location.model.list(location()) ?? []) as any[]
    if (!models.length) {
      context.ui.toast.show({ message: "Splits: no models available", variant: "warning" })
      return
    }
    const choice = await context.ui.dialog.select({
      title: "Model",
      options: models.map((model: any) => ({
        title: `${model.providerID}/${model.id}`,
        value: `${model.providerID}/${model.id}`,
        description: model.name,
      })),
    })
    if (!choice) {
      textarea?.focus?.()
      return
    }
    const [providerID, modelID] = String(choice).split("/")
    if (!providerID || !modelID) {
      textarea?.focus?.()
      return
    }
    await client.session.switchModel({ sessionID: id, model: { providerID, id: modelID } })
    textarea?.focus?.()
  }

  const pickAgent = async () => {
    try {
      await pickAgentInner()
    } catch (error) {
      context.ui.toast.show({
        message: `Splits: agent picker failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
        duration: 5000,
      })
    }
  }

  const pickAgentInner = async () => {
    const id = sessionID()
    if (!id) return
    const agents = (context.data.location.agent.list(location()) ?? []) as any[]
    if (!agents.length) {
      context.ui.toast.show({ message: "Splits: no agents available", variant: "warning" })
      return
    }
    const choice = await context.ui.dialog.select({
      title: "Agent",
      options: agents.map((agent: any) => ({
        title: agent.name ?? agent.id,
        value: agent.id,
        description: agent.description,
      })),
    })
    if (!choice) {
      textarea?.focus?.()
      return
    }
    await client.session.switchAgent({ sessionID: id, agent: String(choice) })
    textarea?.focus?.()
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 30,
    enabled: () => props.focused,
    commands: [
      {
        id: "splits.pane.interrupt",
        title: "Interrupt session",
        bind: "ctrl+alt+c",
        palette: true,
        run: () => void interrupt(),
      },
      {
        id: "splits.pane.queue",
        title: "Toggle steer/queue delivery",
        bind: "ctrl+alt+q",
        palette: true,
        run: () => setQueue((value) => !value),
      },
      {
        id: "splits.pane.model",
        title: "Choose model",
        bind: "ctrl+alt+shift+m",
        palette: true,
        run: () => void pickModel(),
      },
      {
        id: "splits.pane.agent",
        title: "Choose agent",
        bind: "ctrl+alt+a",
        palette: true,
        run: () => void pickAgent(),
      },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <Show
        when={sessionID()}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={textColor(context, "muted", "gray")}>Creating session…</text>
          </box>
        }
      >
        <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1}>
          <text fg={textColor(context, "muted", "gray")}>
            {`${basename(location().directory)} · ${status()} · ${agentName()} · ${modelName()}`}
          </text>
          <box flexGrow={1} />
          <text fg={textColor(context, "muted", "gray")}>
            {`${number(session()?.tokens?.input)} in · ${number(session()?.tokens?.output)} out`}
          </text>
        </box>
        <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom">
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            <For each={messages()}>
              {(message: any) => (
                <MessageView
                  message={message}
                  deltas={deltas}
                  context={context}
                  style={style}
                />
              )}
            </For>
          </box>
        </scrollbox>
        <PermissionBar controller={controller} sessionID={sessionID()!} />
        <box flexDirection="column" flexShrink={0} border borderStyle="single" borderColor={textColor(context, "muted", "gray")}>
          <textarea
            ref={(value: any) => {
              textarea = value
              controller.requestFocus(props.paneID)
            }}
            initialValue=""
            placeholder="Prompt · Enter send · Shift+Enter newline · /command"
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "kpenter", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "kpenter", shift: true, action: "newline" },
            ]}
            minHeight={2}
            maxHeight={6}
            focused={props.focused}
            onContentChange={(value: any) => {
              setDraft(typeof value === "string" ? value : String(textarea?.text ?? ""))
            }}
            onSubmit={() => void send()}
          />
          <box flexDirection="row" height={1} paddingLeft={1}>
            <text fg={textColor(context, "muted", "gray")}>
              {`delivery: ${queue() ? "queue" : "steer"} · ctrl+alt+q toggle · ctrl+alt+c interrupt`}
            </text>
            <box flexGrow={1} />
            <box onMouseDown={() => void pickModel()}>
              <text fg={textColor(context, "info", "cyan")}>model </text>
            </box>
            <box onMouseDown={() => void pickAgent()}>
              <text fg={textColor(context, "info", "cyan")}>agent</text>
            </box>
          </box>
        </box>
      </Show>
    </box>
  )
}
