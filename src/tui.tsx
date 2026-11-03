/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { ErrorBoundary } from "solid-js"
import { appendFileSync } from "node:fs"
import { readOptions } from "./config.ts"
import { createWorkspace } from "./controller.ts"
import { Workspace } from "./workspace.tsx"
import { QuakeOverlay } from "./overlay.tsx"

export default Plugin.define({
  id: "splits.workspace",
  async setup(context) {
    const options = readOptions(context.options)
    const controller = createWorkspace(context, options)

    const unregisterRoute = context.ui.router.register({
      name: "workspace",
      render: ({ data }) => (
        <ErrorBoundary
          fallback={(error: any) => {
            try {
              appendFileSync(
                "/tmp/opencode/splits-error.log",
                `${new Date().toISOString()}\n${error?.stack ?? String(error)}\n\n`,
              )
            } catch {
              // ignore
            }
            return (
              <box flexDirection="column" padding={1}>
                <text fg="red">splits workspace error</text>
                <text>{String(error?.message ?? error)}</text>
              </box>
            )
          }}
        >
          <Workspace controller={controller} data={data} />
        </ErrorBoundary>
      ),
    })

    const stopOverlay = context.ui.slot({
      append: "app",
      render: () => <QuakeOverlay controller={controller} />,
    })

    const inWorkspace = () => controller.isWorkspace()
    const focusedTerminal = () => inWorkspace() && controller.focusedPane()?.kind === "terminal"

    context.keymap.layer(() => ({
      mode: "global",
      priority: 20,
      commands: [
        {
          id: "splits.open",
          title: "Open splits workspace",
          group: "Splits",
          bind: "<leader>v",
          palette: true,
          suggested: true,
          run: () => controller.openWorkspace(),
        },
        {
          id: "splits.quake",
          title: "Toggle drop-down terminal",
          group: "Splits",
          bind: options.overlayToggleKey,
          palette: true,
          enabled: () => !controller.overlay().open,
          run: () => controller.toggleOverlay(),
        },
        {
          id: "splits.quake.close",
          title: "Close drop-down terminal",
          group: "Splits",
          bind: options.overlayCloseKey,
          enabled: () => controller.overlay().open,
          run: () => controller.closeOverlay(),
        },
        {
          id: "splits.split.right",
          title: "Split pane right",
          group: "Splits",
          bind: "ctrl+alt+r",
          enabled: inWorkspace,
          run: () => controller.split("session", "row"),
        },
        {
          id: "splits.split.down",
          title: "Split pane down",
          group: "Splits",
          bind: "ctrl+alt+d",
          enabled: inWorkspace,
          run: () => controller.split("session", "column"),
        },
        {
          id: "splits.close",
          title: "Close focused pane",
          group: "Splits",
          bind: "ctrl+alt+x",
          enabled: inWorkspace,
          run: () => controller.closeFocused(),
        },
        {
          id: "splits.focus.prev",
          title: "Focus previous pane",
          group: "Splits",
          bind: "ctrl+alt+left",
          enabled: inWorkspace,
          run: () => controller.cycle(-1),
        },
        {
          id: "splits.focus.next",
          title: "Focus next pane",
          group: "Splits",
          bind: "ctrl+alt+right",
          enabled: inWorkspace,
          run: () => controller.cycle(1),
        },
        {
          id: "splits.focus.up",
          title: "Focus previous pane",
          group: "Splits",
          bind: "ctrl+alt+up",
          enabled: inWorkspace,
          run: () => controller.cycle(-1),
        },
        {
          id: "splits.focus.down",
          title: "Focus next pane",
          group: "Splits",
          bind: "ctrl+alt+down",
          enabled: inWorkspace,
          run: () => controller.cycle(1),
        },
        {
          id: "splits.resize.left",
          title: "Grow pane left",
          group: "Splits",
          bind: "ctrl+alt+shift+left",
          enabled: inWorkspace,
          run: () => controller.resize("left"),
        },
        {
          id: "splits.resize.right",
          title: "Grow pane right",
          group: "Splits",
          bind: "ctrl+alt+shift+right",
          enabled: inWorkspace,
          run: () => controller.resize("right"),
        },
        {
          id: "splits.resize.up",
          title: "Grow pane up",
          group: "Splits",
          bind: "ctrl+alt+shift+up",
          enabled: inWorkspace,
          run: () => controller.resize("up"),
        },
        {
          id: "splits.resize.down",
          title: "Grow pane down",
          group: "Splits",
          bind: "ctrl+alt+shift+down",
          enabled: inWorkspace,
          run: () => controller.resize("down"),
        },
        {
          id: "splits.zoom",
          title: "Zoom focused pane",
          group: "Splits",
          bind: "ctrl+alt+z",
          enabled: inWorkspace,
          run: () => controller.toggleZoom(),
        },
        {
          id: "splits.equalize",
          title: "Equalize panes",
          group: "Splits",
          bind: "ctrl+alt+e",
          enabled: inWorkspace,
          run: () => controller.equalize(),
        },
        {
          id: "splits.new.session",
          title: "New session in split",
          group: "Splits",
          bind: "ctrl+alt+n",
          enabled: inWorkspace,
          run: () => void controller.newSession(),
        },
        {
          id: "splits.terminal.new",
          title: "New terminal with profile and context",
          description: "Choose the environment profile, Kubernetes context and SSH key, then open the terminal",
          group: "Splits",
          bind: "ctrl+alt+t",
          palette: true,
          enabled: inWorkspace,
          run: () => void controller.newTerminalWizard(),
        },
        {
          id: "splits.shell",
          title: "Shell",
          description: "Open a terminal beside the session, choosing profile, Kubernetes context and SSH key",
          group: "Splits",
          palette: true,
          slash: { name: "shell", aliases: ["term", "terminal"] },
          run: () => void controller.newTerminalWizard(),
        },
        {
          id: "splits.tab.next",
          title: "Next terminal tab",
          group: "Splits",
          bind: "ctrl+alt+f",
          enabled: focusedTerminal,
          run: () => controller.nextTab(controller.state.focused, 1),
        },
        {
          id: "splits.tab.prev",
          title: "Previous terminal tab",
          group: "Splits",
          bind: "ctrl+alt+b",
          enabled: focusedTerminal,
          run: () => controller.nextTab(controller.state.focused, -1),
        },
        {
          id: "splits.tab.new",
          title: "New terminal tab",
          group: "Splits",
          bind: "ctrl+alt+shift+t",
          enabled: focusedTerminal,
          run: () => void controller.newTerminalTab(),
        },
        {
          id: "splits.tab.close",
          title: "Close terminal tab",
          group: "Splits",
          bind: "ctrl+alt+shift+x",
          enabled: focusedTerminal,
          run: () => controller.closeTerminalTab(controller.state.focused),
        },
        {
          id: "splits.pane.minimise",
          title: "Minimise or restore focused pane",
          group: "Splits",
          bind: "ctrl+alt+m",
          enabled: inWorkspace,
          run: () => controller.toggleMinimiseFocused(),
        },
        {
          id: "splits.pane.move.prev",
          title: "Move pane earlier",
          group: "Splits",
          bind: "ctrl+alt+shift+p",
          enabled: inWorkspace,
          run: () => controller.moveFocused(-1),
        },
        {
          id: "splits.pane.move.next",
          title: "Move pane later",
          group: "Splits",
          bind: "ctrl+alt+shift+l",
          enabled: inWorkspace,
          run: () => controller.moveFocused(1),
        },
        {
          id: "splits.open.session",
          title: "Open existing session in split",
          group: "Splits",
          bind: "ctrl+alt+o",
          enabled: inWorkspace,
          run: () => void controller.pickSession(),
        },
        {
          id: "splits.back",
          title: "Leave splits workspace",
          group: "Splits",
          bind: "ctrl+alt+w",
          enabled: inWorkspace,
          run: () => controller.back(),
        },
      ],
    }))

    return () => {
      unregisterRoute()
      stopOverlay()
    }
  },
})
