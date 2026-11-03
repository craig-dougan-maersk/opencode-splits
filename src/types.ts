export type SplitDirection = "row" | "column"

export interface SplitNode {
  type: "split"
  id: string
  dir: SplitDirection
  ratio: number
  a: LayoutNode
  b: LayoutNode
}

export interface LeafNode {
  type: "leaf"
  paneID: string
}

export type LayoutNode = SplitNode | LeafNode

export type PaneKind = "session" | "terminal"

/**
 * Kubernetes selection for one terminal. `enabled` narrows the kubeconfig
 * sources used to build KUBECONFIG; when missing the terminal inherits the
 * session's enabled set. `context` forces `current-context` through a selector
 * stub prepended to KUBECONFIG.
 */
export interface KubeSelection {
  enabled?: string[]
  context?: string
}

/** One terminal inside a terminal pane. A pane holds one or more tabs. */
export interface TerminalTab {
  id: string
  title?: string
  ptyID?: string
  /** env-manager profile name; terminal-local, does not change the session. */
  profile?: string
  kube?: KubeSelection
  /** ssh-manager key id to load into the session agent for this terminal. */
  sshKey?: string
}

export interface PaneState {
  id: string
  kind: PaneKind
  sessionID?: string
  directory?: string
  readOnly?: boolean
  /** Terminal panes only: one or more terminals shown as tabs. */
  tabs?: TerminalTab[]
  activeTab?: number
  /** Render-only flag: the pane is hidden from the layout and listed in the dock. */
  minimised?: boolean

  // Legacy single-terminal fields, migrated into `tabs` by normalizeState.
  ptyID?: string
  title?: string
}

export interface WorkspaceState {
  root: LayoutNode
  panes: Record<string, PaneState>
  focused: string
  counter: number
}

export interface SplitOptions {
  direction?: SplitDirection
  ratio?: number
}
