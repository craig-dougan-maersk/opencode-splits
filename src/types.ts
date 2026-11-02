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

export interface PaneState {
  id: string
  kind: PaneKind
  sessionID?: string
  directory?: string
  ptyID?: string
  title?: string
  readOnly?: boolean
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
