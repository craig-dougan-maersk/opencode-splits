/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { TerminalTab } from "./types.ts"
import type { WorkspaceController } from "./controller.ts"
import { TerminalPane } from "./terminal-pane.tsx"
import { raisedBackground, textColor } from "./theme.ts"

/** Short label for a tab: the process title, else the selection, else "term". */
export function tabLabel(tab: TerminalTab | undefined, index: number): string {
  if (!tab) return `${index + 1}`
  return tab.title || tab.kube?.context || tab.profile || `term ${index + 1}`
}

/** Plugin-owned tab strip, bound to one terminal pane. */
export function TerminalTabBar(props: { controller: WorkspaceController; paneID: string }) {
  const controller = props.controller
  const context = controller.context
  const tabs = () => controller.terminalTabs(props.paneID)
  const active = () => controller.state.panes[props.paneID]?.activeTab ?? 0
  const activeID = () => tabs()[active()]?.id

  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      paddingLeft={1}
      backgroundColor={raisedBackground(context)}
    >
      <For each={tabs()}>
        {(tab, index) => (
          <box
            flexDirection="row"
            onMouseDown={(event: any) => {
              event?.stopPropagation?.()
              controller.setFocused(props.paneID)
              controller.setActiveTab(props.paneID, index())
            }}
          >
            <text
              fg={
                tab.id === activeID()
                  ? textColor(context, "info", "cyan")
                  : textColor(context, "muted", "gray")
              }
            >
              {`${tab.id === activeID() ? "▸" : " "}${tabLabel(tab, index())} `}
            </text>
            <Show when={tabs().length > 1}>
              <text
                fg={textColor(context, "muted", "gray")}
                onMouseDown={(event: any) => {
                  event?.stopPropagation?.()
                  controller.closeTerminalTab(props.paneID, tab.id)
                }}
              >
                ×
              </text>
            </Show>
          </box>
        )}
      </For>
      <box flexGrow={1} />
      <box
        onMouseDown={(event: any) => {
          event?.stopPropagation?.()
          controller.setFocused(props.paneID)
          void controller.newTerminalTab(props.paneID)
        }}
      >
        <text fg={textColor(context, "info", "cyan")}>{" [+] "}</text>
      </box>
    </box>
  )
}

/**
 * A workspace pane holding one or more terminals. Only the active tab is
 * mounted; switching tabs remounts the pane against the tab's existing PTY, so
 * each terminal keeps its own process and environment.
 */
export function LayoutTerminalPane(props: {
  controller: WorkspaceController
  paneID: string
  focused: boolean
}) {
  const controller = props.controller
  const pane = () => controller.state.panes[props.paneID]
  const tab = () => controller.activeTab(props.paneID)
  // Keyed on the tab id, so a tab switch (and only a tab switch) remounts.
  const activeID = () => tab()?.id

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <TerminalTabBar controller={controller} paneID={props.paneID} />
      <Show when={activeID()} keyed fallback={<box flexGrow={1} />}>
        {(tabId: string) => (
          <TerminalPane
            controller={controller}
            focused={props.focused}
            focusID={props.paneID}
            paneID={props.paneID}
            tabId={tabId}
            sessionID={pane()?.sessionID}
            directory={pane()?.directory}
            ptyID={tab()?.ptyID}
            title={tab()?.title}
            profile={tab()?.profile}
            kubeContext={tab()?.kube?.context}
            sshKey={tab()?.sshKey}
            envBuilder={() => controller.buildEnvForTab(props.paneID, tabId)}
            onPtyID={(ptyID) => controller.setTabPty(props.paneID, tabId, ptyID)}
            onTitle={(title) => controller.setTabTitle(props.paneID, tabId, title)}
          />
        )}
      </Show>
    </box>
  )
}
