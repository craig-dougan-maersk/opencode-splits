import type { LayoutNode, PaneState, SplitDirection, WorkspaceState } from "./types.ts"

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(0.9, Math.max(0.1, value))
}

export function leafIDs(node: LayoutNode | null | undefined): string[] {
  if (!node) return []
  if (node.type === "leaf") return [node.paneID]
  return [...leafIDs(node.a), ...leafIDs(node.b)]
}

export function findLeaf(node: LayoutNode | null | undefined, paneID: string): LayoutNode | undefined {
  if (!node) return undefined
  if (node.type === "leaf") return node.paneID === paneID ? node : undefined
  return findLeaf(node.a, paneID) ?? findLeaf(node.b, paneID)
}

export function firstLeaf(node: LayoutNode): string | undefined {
  return leafIDs(node)[0]
}

/**
 * Replace the target leaf with a split containing the old leaf and a new leaf.
 * The new leaf is placed after the old one (right or below).
 */
export function splitLeaf(
  node: LayoutNode,
  targetPaneID: string,
  newPaneID: string,
  splitID: string,
  direction: SplitDirection,
  ratio = 0.5,
): LayoutNode {
  if (node.type === "leaf") {
    if (node.paneID !== targetPaneID) return node
    return {
      type: "split",
      id: splitID,
      dir: direction,
      ratio: clampRatio(ratio),
      a: node,
      b: { type: "leaf", paneID: newPaneID },
    }
  }
  return {
    ...node,
    a: splitLeaf(node.a, targetPaneID, newPaneID, splitID, direction, ratio),
    b: splitLeaf(node.b, targetPaneID, newPaneID, splitID, direction, ratio),
  }
}

/** Remove a leaf and collapse its parent into the surviving sibling. */
export function removeLeaf(node: LayoutNode | null, paneID: string): LayoutNode | null {
  if (!node) return null
  if (node.type === "leaf") return node.paneID === paneID ? null : node
  const a = removeLeaf(node.a, paneID)
  const b = removeLeaf(node.b, paneID)
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

export function setSplitRatio(node: LayoutNode, splitID: string, ratio: number): LayoutNode {
  if (node.type === "leaf") return node
  if (node.id === splitID) return { ...node, ratio: clampRatio(ratio) }
  return {
    ...node,
    a: setSplitRatio(node.a, splitID, ratio),
    b: setSplitRatio(node.b, splitID, ratio),
  }
}

/**
 * Adjust the nearest ancestor split that matches the requested direction.
 * Returns the original node when there is no matching ancestor.
 */
export function adjustRatio(
  node: LayoutNode,
  paneID: string,
  direction: "left" | "right" | "up" | "down",
  delta: number,
): LayoutNode {
  const wanted: SplitDirection = direction === "left" || direction === "right" ? "row" : "column"
  const sign = direction === "right" || direction === "down" ? 1 : -1

  const walk = (current: LayoutNode): { node: LayoutNode; changed: boolean } => {
    if (current.type === "leaf") return { node: current, changed: false }
    const inA = Boolean(findLeaf(current.a, paneID))
    const inB = Boolean(findLeaf(current.b, paneID))
    const child = inA ? current.a : inB ? current.b : null
    if (!child) return { node: current, changed: false }

    // Prefer the nearest matching ancestor.
    const inner = walk(child)
    if (inner.changed) {
      return {
        node: { ...current, a: inA ? inner.node : current.a, b: inB ? inner.node : current.b },
        changed: true,
      }
    }
    if (current.dir !== wanted) return { node: current, changed: false }
    // The first child of a row grows to the right; the second grows to the left.
    const ratioDelta = inA ? sign * delta : -sign * delta
    return { node: { ...current, ratio: clampRatio(current.ratio + ratioDelta) }, changed: true }
  }

  return walk(node).node
}

export function equalize(node: LayoutNode): LayoutNode {
  if (node.type === "leaf") return node
  return { ...node, ratio: 0.5, a: equalize(node.a), b: equalize(node.b) }
}

/** Focus the next/previous leaf in depth-first order, wrapping around. */
export function cycleLeaf(node: LayoutNode, current: string, step: number): string {
  const ids = leafIDs(node)
  if (ids.length === 0) return current
  const index = ids.indexOf(current)
  if (index === -1) return ids[0]!
  const next = (index + step + ids.length) % ids.length
  return ids[next]!
}

export function countLeaves(node: LayoutNode): number {
  return leafIDs(node).length
}

export function validateTree(node: LayoutNode | null | undefined): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  const walk = (current: LayoutNode, path: string) => {
    if (current.type === "leaf") {
      if (!current.paneID) errors.push(`${path}: leaf without paneID`)
      if (seen.has(current.paneID)) errors.push(`${path}: duplicate pane ${current.paneID}`)
      seen.add(current.paneID)
      return
    }
    if (!current.id) errors.push(`${path}: split without id`)
    if (!Number.isFinite(current.ratio) || current.ratio <= 0 || current.ratio >= 1) {
      errors.push(`${path}: ratio out of range (${current.ratio})`)
    }
    walk(current.a, `${path}.a`)
    walk(current.b, `${path}.b`)
  }
  if (!node) {
    errors.push("root: missing")
    return errors
  }
  walk(node, "root")
  return errors
}

/** Exchange the positions of two panes in the tree. */
export function swapLeaf(node: LayoutNode, a: string, b: string): LayoutNode {
  if (node.type === "leaf") {
    if (node.paneID === a) return { ...node, paneID: b }
    if (node.paneID === b) return { ...node, paneID: a }
    return node
  }
  return { ...node, a: swapLeaf(node.a, a, b), b: swapLeaf(node.b, a, b) }
}

/**
 * Render-only projection of the tree with minimised panes removed. The stored
 * tree is left intact, so restoring a pane is just clearing its flag.
 */
export function pruneMinimised(
  node: LayoutNode | null | undefined,
  panes: Record<string, PaneState>,
): LayoutNode | null {
  if (!node) return null
  if (node.type === "leaf") return panes[node.paneID]?.minimised ? null : node
  const a = pruneMinimised(node.a, panes)
  const b = pruneMinimised(node.b, panes)
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

/** Pane ids that are present in the tree but hidden by the minimise flag. */
export function minimisedLeafIDs(node: LayoutNode, panes: Record<string, PaneState>): string[] {
  return leafIDs(node).filter((id) => panes[id]?.minimised)
}

/** Repair a persisted state so it can always be rendered. */
export function normalizeState(state: WorkspaceState, fallbackPaneID: string): WorkspaceState {
  const panes: Record<string, PaneState> = { ...state.panes }
  const root = state.root ?? { type: "leaf", paneID: fallbackPaneID } as LayoutNode
  const ids = leafIDs(root)
  if (ids.length === 0) {
    panes[fallbackPaneID] = panes[fallbackPaneID] ?? {
      id: fallbackPaneID,
      kind: "session",
    }
    return { ...state, root: { type: "leaf", paneID: fallbackPaneID }, panes, focused: fallbackPaneID }
  }
  for (const id of ids) {
    if (!panes[id]) panes[id] = { id, kind: "session" }
  }
  for (const id of Object.keys(panes)) {
    if (!ids.includes(id)) delete panes[id]
  }
  for (const id of ids) normalizePane(panes[id]!)
  const focused = pickFocus(ids, panes, state.focused)
  return { ...state, root, panes, focused }
}

/**
 * A terminal pane always has at least one tab. Legacy workspaces stored a
 * single terminal on the pane itself; migrate those into a tab in place.
 */
function normalizePane(pane: PaneState): void {
  if (pane.kind !== "terminal") return
  if (!Array.isArray(pane.tabs) || pane.tabs.length === 0) {
    pane.tabs = [{ id: `${pane.id}-1`, ptyID: pane.ptyID, title: pane.title }]
  }
  for (const [index, tab] of pane.tabs.entries()) {
    if (!tab.id) tab.id = `${pane.id}-${index + 1}`
  }
  const active = Number.isInteger(pane.activeTab) ? (pane.activeTab as number) : 0
  pane.activeTab = Math.min(Math.max(0, active), pane.tabs.length - 1)
}

/** Keep focus on a pane that is actually visible. */
function pickFocus(
  ids: string[],
  panes: Record<string, PaneState>,
  focused: string,
): string {
  const visible = ids.filter((id) => !panes[id]?.minimised)
  const pool = visible.length ? visible : ids
  return pool.includes(focused) ? focused : pool[0]!
}
