/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import type { WorkspaceController } from "./controller.ts"
import { TerminalPane } from "./terminal-pane.tsx"
import { background, textColor } from "./theme.ts"

export function QuakeOverlay(props: { controller: WorkspaceController }) {
  const controller = props.controller
  const context = controller.context
  const overlay = () => controller.overlay()

  return (
    <Show when={overlay().open}>
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height={`${controller.options.overlayHeight}%`}
        zIndex={1000}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={textColor(context, "info", "cyan")}
        title={` terminal · ${controller.options.overlayCloseKey} close · ${controller.options.overlayToggleKey} toggle `}
        titleAlignment="left"
        backgroundColor={background(context)}
      >
        <TerminalPane
          controller={controller}
          focused={true}
          sessionID={overlay().sessionID}
          ptyID={overlay().ptyID}
          title="quake terminal"
          focusID="overlay"
          // The drop-down terminal inherits the session's own selection: the
          // active env-manager profile, the session's kubeconfigs and its SSH
          // agent.
          envBuilder={() => controller.buildEnvForSession(overlay().sessionID)}
          onPtyID={(ptyID) => controller.setOverlayPty(ptyID)}
        />
      </box>
    </Show>
  )
}
