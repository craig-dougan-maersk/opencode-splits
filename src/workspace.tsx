/** @jsxImportSource @opentui/solid */
import { For, Show, createEffect } from "solid-js"
import type { LayoutNode, PaneState, SplitNode } from "./types.ts"
import type { WorkspaceController } from "./controller.ts"
import { minimisedLeafIDs, pruneMinimised } from "./layout.ts"
import { SessionPane } from "./session-pane.tsx"
import { LayoutTerminalPane } from "./terminal-tabs.tsx"
import { background, textColor } from "./theme.ts"

function paneTitle(controller: WorkspaceController, pane: PaneState): string {
  if (pane.kind === "terminal") {
    const tab = controller.activeTab(pane.id)
    if (tab) return tab.title || tab.kube?.context || tab.profile || "terminal"
    return "terminal"
  }
  const session = pane.sessionID ? controller.context.data.session.get(pane.sessionID) : undefined
  return session?.title || (pane.sessionID ? "session" : "new session")
}

function paneSubtitle(controller: WorkspaceController, pane: PaneState): string {
  if (pane.kind === "terminal") {
    const count = controller.terminalTabs(pane.id).length
    return count > 1 ? `${count} tabs` : "pty"
  }
  const session = pane.sessionID ? controller.context.data.session.get(pane.sessionID) : undefined
  const directory = session?.location?.directory ?? pane.directory
  if (!directory) return ""
  const parts = String(directory).split("/").filter(Boolean)
  return parts.slice(-2).join("/")
}

export function PaneFrame(props: { controller: WorkspaceController; paneID: string }) {
  const controller = props.controller
  const context = controller.context
  const pane = () => controller.state.panes[props.paneID]
  const focused = () => controller.state.focused === props.paneID
  const active = () => focused() && !controller.overlay().open
  const border = () =>
    focused()
      ? textColor(context, "info", "cyan")
      : textColor(context, "muted", "gray")

  return (
    <Show when={pane()} fallback={<box flexGrow={1} />}>
      <box
        flexGrow={1}
        flexDirection="column"
        minWidth={0}
        minHeight={0}
        border
        borderStyle="rounded"
        borderColor={border()}
        title={` ${pane()!.kind === "terminal" ? "term" : "session"} · ${paneTitle(controller, pane()!)}${paneSubtitle(controller, pane()!) ? "  " + paneSubtitle(controller, pane()!) : ""} `}
        titleAlignment="left"
        onMouseDown={(event: any) => {
          event?.stopPropagation?.()
          controller.setFocused(props.paneID)
        }}
      >
        <Show
          when={pane()!.kind === "session"}
          fallback={
            <LayoutTerminalPane
              controller={controller}
              paneID={props.paneID}
              focused={active()}
            />
          }
        >
          <SessionPane
            controller={controller}
            paneID={props.paneID}
            focused={active()}
          />
        </Show>
      </box>
    </Show>
  )
}

function SplitView(props: { controller: WorkspaceController; node: SplitNode }) {
  const node = () => props.node
  return (
    <box
      flexGrow={1}
      flexBasis={0}
      flexDirection={node().dir}
      minWidth={0}
      minHeight={0}
    >
      <box flexGrow={node().ratio} flexBasis={0} minWidth={0} minHeight={0}>
        <PaneNode controller={props.controller} node={node().a} />
      </box>
      <box flexGrow={1 - node().ratio} flexBasis={0} minWidth={0} minHeight={0}>
        <PaneNode controller={props.controller} node={node().b} />
      </box>
    </box>
  )
}

export function PaneNode(props: { controller: WorkspaceController; node: LayoutNode }) {
  const node = () => props.node
  return (
    <Show
      when={node().type === "split"}
      fallback={<PaneFrame controller={props.controller} paneID={(node() as any).paneID} />}
    >
      <SplitView controller={props.controller} node={node() as SplitNode} />
    </Show>
  )
}

function Header(props: { controller: WorkspaceController }) {
  const controller = props.controller
  const context = controller.context
  const pane = () => controller.focusedPane()
  const status = () => {
    const sessionID = pane()?.sessionID
    if (!sessionID) return "idle"
    return context.data.session.status(sessionID) ?? "idle"
  }
  const count = () => Object.keys(controller.state.panes).length

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={background(context)}
    >
      <text fg={textColor(context, "info", "cyan")}>
        <b>SPLITS</b>
        <span style={{ fg: textColor(context, "muted", "gray") }}>
          {`  ${count()} pane${count() === 1 ? "" : "s"} · ${controller.state.focused} · ${pane()?.kind ?? "none"} · ${status()}`}
          {controller.zoom() ? " · ZOOM" : ""}
        </span>
      </text>
      <box flexGrow={1} />
      <text fg={textColor(context, "muted", "gray")}>
        ctrl+alt+r split · ctrl+alt+t terminal · ctrl+alt+m minimise · /shell
      </text>
    </box>
  )
}

/** Panes that are hidden from the layout and can be restored from the dock. */
function MinimisedDock(props: { controller: WorkspaceController }) {
  const controller = props.controller
  const context = controller.context
  const ids = () => minimisedLeafIDs(controller.state.root, controller.state.panes)

  return (
    <Show when={ids().length > 0}>
      <box flexDirection="row" width="100%" height={1} flexShrink={0} paddingLeft={1}>
        <text fg={textColor(context, "muted", "gray")}>{"docked: "}</text>
        <For each={ids()}>
          {(paneID) => (
            <box
              onMouseDown={(event: any) => {
                event?.stopPropagation?.()
                controller.restorePane(paneID)
              }}
            >
              <text fg={textColor(context, "info", "cyan")}>{`[${paneTitle(controller, controller.state.panes[paneID])}] `}</text>
            </box>
          )}
        </For>
        <box flexGrow={1} />
        <text fg={textColor(context, "muted", "gray")}>click to restore</text>
      </box>
    </Show>
  )
}

function Welcome(props: { controller: WorkspaceController }) {
  const controller = props.controller
  const context = controller.context
  return (
    <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
      <text fg={textColor(context, "info", "cyan")}>
        <b>Splits workspace</b>
      </text>
      <text fg={textColor(context, "muted", "gray")}>No panes yet.</text>
      <text fg={textColor(context, "base", "white")}>ctrl+alt+n  new session</text>
      <text fg={textColor(context, "base", "white")}>ctrl+alt+o  open session</text>
      <text fg={textColor(context, "base", "white")}>/shell      terminal wizard</text>
    </box>
  )
}

export function Workspace(props: {
  controller: WorkspaceController
  data?: Record<string, any>
}) {
  const controller = props.controller
  const context = controller.context
  const visibleRoot = () =>
    pruneMinimised(controller.state.root, controller.state.panes) ?? controller.state.root

  // Bind the session that launched the workspace to a session pane, and make
  // sure every session pane has a session (create one lazily if needed).
  createEffect(() => {
    const preferred = props.data?.sessionID
    const panes = Object.values(controller.state.panes) as PaneState[]
    if (preferred) {
      const target = panes.find((pane) => pane.kind === "session" && !pane.sessionID)
      if (target) {
        void controller.ensureSession(target.id, preferred)
        return
      }
    }
    const empty = panes.find((pane) => pane.kind === "session" && !pane.sessionID)
    if (empty) void controller.ensureSession(empty.id)
  })

  createEffect(() => {
    void controller.refreshCatalogue(controller.focusedPane()?.sessionID)
  })

  return (
    <box flexDirection="column" width="100%" height="100%" minWidth={0} minHeight={0}>
      <Header controller={controller} />
      <Show when={Object.keys(controller.state.panes).length > 0} fallback={<Welcome controller={controller} />}>
        <Show
          when={controller.zoom()}
          fallback={<PaneNode controller={controller} node={visibleRoot()} />}
        >
          <PaneFrame controller={controller} paneID={controller.state.focused} />
        </Show>
      </Show>
      <MinimisedDock controller={controller} />
      <box flexDirection="row" width="100%" height={1} flexShrink={0} paddingLeft={1}>
        <text fg={textColor(context, "muted", "gray")}>
          ctrl+alt+←/→ focus · ctrl+alt+shift+←/→ resize · ctrl+alt+e equalize · ctrl+alt+w back
        </text>
      </box>
    </box>
  )
}
