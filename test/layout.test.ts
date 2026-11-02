import { test } from "node:test"
import assert from "node:assert/strict"
import {
  adjustRatio,
  clampRatio,
  cycleLeaf,
  equalize,
  findLeaf,
  leafIDs,
  normalizeState,
  removeLeaf,
  setSplitRatio,
  splitLeaf,
  validateTree,
} from "../src/layout.ts"
import type { LayoutNode, WorkspaceState } from "../src/types.ts"

const leaf = (id: string): LayoutNode => ({ type: "leaf", paneID: id })

test("splitLeaf replaces the target leaf and keeps both panes", () => {
  const root = splitLeaf(leaf("a"), "a", "b", "s1", "row", 0.6)
  assert.deepEqual(leafIDs(root), ["a", "b"])
  assert.equal(root.type, "split")
  if (root.type === "split") {
    assert.equal(root.dir, "row")
    assert.equal(root.ratio, 0.6)
  }
  assert.deepEqual(validateTree(root), [])
})

test("splitLeaf can split a nested pane", () => {
  const first = splitLeaf(leaf("a"), "a", "b", "s1", "row")
  const second = splitLeaf(first, "b", "c", "s2", "column")
  assert.deepEqual(leafIDs(second), ["a", "b", "c"])
  assert.ok(findLeaf(second, "c"))
  assert.deepEqual(validateTree(second), [])
})

test("removeLeaf collapses the parent and keeps the sibling", () => {
  const root = splitLeaf(leaf("a"), "a", "b", "s1", "row")
  const removed = removeLeaf(root, "b")
  assert.ok(removed)
  assert.deepEqual(leafIDs(removed), ["a"])
  assert.equal(removeLeaf(leaf("a"), "a"), null)
})

test("removeLeaf on a nested tree keeps the rest", () => {
  const first = splitLeaf(leaf("a"), "a", "b", "s1", "row")
  const second = splitLeaf(first, "b", "c", "s2", "column")
  const removed = removeLeaf(second, "b")
  assert.ok(removed)
  assert.deepEqual(leafIDs(removed), ["a", "c"])
  assert.deepEqual(validateTree(removed), [])
})

test("ratios are clamped and adjustable", () => {
  assert.equal(clampRatio(0), 0.1)
  assert.equal(clampRatio(1), 0.9)
  assert.equal(clampRatio(Number.NaN), 0.5)
  const root = splitLeaf(leaf("a"), "a", "b", "s1", "row", 0.5)
  const wider = adjustRatio(root, "b", "right", 0.1)
  assert.equal(wider.type, "split")
  if (wider.type === "split") assert.ok(wider.ratio < 0.5)
  const reset = equalize(wider)
  if (reset.type === "split") assert.equal(reset.ratio, 0.5)
})

test("adjustRatio prefers the nearest matching ancestor", () => {
  const first = splitLeaf(leaf("a"), "a", "b", "s1", "row", 0.5)
  const second = splitLeaf(first, "b", "c", "s2", "column", 0.5)
  const changed = adjustRatio(second, "c", "down", 0.2)
  const findSplit = (node: LayoutNode, id: string): any => {
    if (node.type === "leaf") return undefined
    if (node.id === id) return node
    return findSplit(node.a, id) ?? findSplit(node.b, id)
  }
  // Growing the bottom pane shrinks the top pane's ratio.
  assert.equal(findSplit(changed, "s2").ratio, 0.3)
  assert.equal(findSplit(changed, "s1").ratio, 0.5)
})

test("cycleLeaf wraps in traversal order", () => {
  const first = splitLeaf(leaf("a"), "a", "b", "s1", "row")
  const second = splitLeaf(first, "b", "c", "s2", "column")
  assert.equal(cycleLeaf(second, "a", 1), "b")
  assert.equal(cycleLeaf(second, "c", 1), "a")
  assert.equal(cycleLeaf(second, "a", -1), "c")
})

test("setSplitRatio only changes the requested split", () => {
  const first = splitLeaf(leaf("a"), "a", "b", "s1", "row", 0.5)
  const second = splitLeaf(first, "b", "c", "s2", "column", 0.5)
  const changed = setSplitRatio(second, "s1", 0.25)
  const findSplit = (node: LayoutNode, id: string): any => {
    if (node.type === "leaf") return undefined
    if (node.id === id) return node
    return findSplit(node.a, id) ?? findSplit(node.b, id)
  }
  assert.equal(findSplit(changed, "s1").ratio, 0.25)
  assert.equal(findSplit(changed, "s2").ratio, 0.5)
})

test("validateTree reports duplicates and bad ratios", () => {
  const bad: LayoutNode = {
    type: "split",
    id: "",
    dir: "row",
    ratio: 2,
    a: leaf("a"),
    b: leaf("a"),
  }
  const errors = validateTree(bad)
  assert.ok(errors.some((e) => e.includes("duplicate")))
  assert.ok(errors.some((e) => e.includes("ratio")))
})

test("normalizeState repairs missing panes and focus", () => {
  const state: WorkspaceState = {
    root: { type: "split", id: "s1", dir: "row", ratio: 0.5, a: leaf("a"), b: leaf("b") },
    panes: { a: { id: "a", kind: "session" } },
    focused: "missing",
    counter: 2,
  }
  const fixed = normalizeState(state, "a")
  assert.equal(fixed.focused, "a")
  assert.ok(fixed.panes.b)
  assert.equal(fixed.panes.b.kind, "session")
})
