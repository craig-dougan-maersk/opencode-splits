import { createEffect, createSignal, type Accessor } from "solid-js"
import type { OpenCodeClient } from "@opencode/client"
import {
  adjustRatio,
  clampRatio,
  cycleLeaf,
  equalize,
  leafIDs,
  normalizeState,
  removeLeaf,
  splitLeaf,
} from "./layout.ts"
import type { LayoutNode, PaneKind, PaneState, SplitDirection, WorkspaceState } from "./types.ts"
import { removePersistentPty } from "./pty.ts"
import type { SplitsOptions } from "./config.ts"

export interface OverlayState {
  open: boolean
  sessionID?: string
  ptyID?: string
}

export interface FocusHandle {
  focus(): void
  blur(): void
}

export interface WorkspaceController {
  readonly context: any
  readonly client: OpenCodeClient
  readonly options: SplitsOptions
  readonly state: WorkspaceState
  readonly zoom: Accessor<boolean>
  readonly overlay: Accessor<OverlayState>
  isWorkspace(): boolean
  focusedPane(): PaneState | undefined
  focusedSession(): string | undefined
  setFocused(paneID: string): void
  split(kind: PaneKind, direction: SplitDirection, sessionID?: string, directory?: string): string
  closeFocused(): void
  cycle(step: number): void
  resize(direction: "left" | "right" | "up" | "down", delta?: number): void
  equalize(): void
  toggleZoom(): void
  openWorkspace(data?: { sessionID?: string }): void
  back(): void
  ensureSession(paneID: string, preferred?: string): Promise<string | undefined>
  newSession(directory?: string): Promise<void>
  newTerminal(sessionID?: string): void
  pickSession(): Promise<void>
  toggleOverlay(): void
  closeOverlay(): void
  setOverlayPty(ptyID: string | undefined): void
  trackPty(ptyID: string): void
  forgetPty(ptyID: string): void
  setPanePty(paneID: string, ptyID: string | undefined): void
  setPaneTitle(paneID: string, title: string): void
  registerFocusable(id: string, handle: FocusHandle): () => void
  requestFocus(id: string): void
  cleanup(): Promise<void>
}

function initialState(): WorkspaceState {
  return {
    root: { type: "leaf", paneID: "p1" },
    panes: { p1: { id: "p1", kind: "session" } },
    focused: "p1",
    counter: 1,
  }
}

function sessionDirectory(context: any): string {
  return context.location?.directory ?? context.data.location.default()?.directory ?? process.cwd()
}

export function createWorkspace(context: any, options: SplitsOptions): WorkspaceController {
  const client = context.client as OpenCodeClient
  const [state, update] = (context.storage.store as any)("workspace", {
    initial: normalizeState(initialState(), "p1"),
  })
  const [zoom, setZoom] = createSignal(false)
  const [overlay, setOverlay] = createSignal<OverlayState>({ open: false })
  const ptys = new Set<string>()
  const creating = new Map<string, Promise<string | undefined>>()
  const focusables = new Map<string, FocusHandle>()
  let activeFocus: string | undefined

  const mutate = (fn: (draft: WorkspaceState) => void) => {
    void update((draft: WorkspaceState) => {
      fn(draft)
      const normalized = normalizeState(draft, "p1")
      draft.root = normalized.root
      draft.panes = normalized.panes
      draft.focused = normalized.focused
      draft.counter = normalized.counter
    })
  }

  const targetFocus = () => (overlay().open ? "overlay" : state.focused)

  const requestFocus = (id: string) => {
    if (targetFocus() !== id) return
    const handle = focusables.get(id)
    if (!handle) return
    if (activeFocus && activeFocus !== id) {
      try {
        focusables.get(activeFocus)?.blur()
      } catch {
        // ignore
      }
    }
    try {
      handle.focus()
    } catch {
      // ignore
    }
    activeFocus = id
  }

  const registerFocusable = (id: string, handle: FocusHandle) => {
    focusables.set(id, handle)
    requestFocus(id)
    return () => {
      if (focusables.get(id) === handle) focusables.delete(id)
      if (activeFocus === id) activeFocus = undefined
    }
  }

  createEffect(() => {
    const target = targetFocus()
    if (target === activeFocus) return
    if (activeFocus) {
      try {
        focusables.get(activeFocus)?.blur()
      } catch {
        // ignore
      }
    }
    activeFocus = undefined
    const handle = focusables.get(target)
    if (handle) {
      try {
        handle.focus()
      } catch {
        // ignore
      }
      activeFocus = target
    }
  })

  const isWorkspace = () => {
    const route = context.ui.router.current()
    return route?.type === "plugin" && route.name === "workspace"
  }

  const focusedPane = (): PaneState | undefined => state.panes[state.focused]
  const focusedSession = (): string | undefined => focusedPane()?.sessionID

  const setFocused = (paneID: string) => {
    if (!state.panes[paneID]) return
    mutate((draft) => {
      draft.focused = paneID
    })
  }

  const newPaneID = () => {
    const next = (state.counter ?? 0) + 1
    return { id: `p${next}`, counter: next }
  }

  const split = (
    kind: PaneKind,
    direction: SplitDirection,
    sessionID?: string,
    directory?: string,
  ): string => {
    const target = state.focused
    const { id, counter } = newPaneID()
    const pane: PaneState = { id, kind, sessionID, directory }
    const splitID = `s${counter}`
    mutate((draft) => {
      draft.counter = counter
      draft.panes[id] = pane
      draft.root = splitLeaf(draft.root, target, id, splitID, direction, 0.5)
      draft.focused = id
    })
    return id
  }

  const closeFocused = () => {
    const target = state.focused
    if (leafIDs(state.root).length <= 1) {
      context.ui.toast.show({ message: "Splits: keep at least one pane", variant: "warning" })
      return
    }
    const pane = state.panes[target]
    if (pane?.kind === "terminal" && pane.ptyID) {
      void removePersistentPty(client, pane.ptyID)
      ptys.delete(pane.ptyID)
    }
    mutate((draft) => {
      const root = removeLeaf(draft.root, target)
      if (!root) return
      draft.root = root
      delete draft.panes[target]
    })
  }

  const cycle = (step: number) => {
    const next = cycleLeaf(state.root, state.focused, step)
    if (next) setFocused(next)
  }

  const resize = (direction: "left" | "right" | "up" | "down", delta = 0.05) => {
    mutate((draft) => {
      draft.root = adjustRatio(draft.root, draft.focused, direction, delta)
    })
  }

  const equalizeAll = () => {
    mutate((draft) => {
      draft.root = equalize(draft.root)
    })
  }

  const toggleZoom = () => setZoom((value) => !value)

  const openWorkspace = (data?: { sessionID?: string }) => {
    const route = context.ui.router.current()
    const sessionID = data?.sessionID ?? (route?.type === "session" ? route.sessionID : undefined)
    context.ui.router.navigate({
      type: "plugin",
      name: "workspace",
      data: sessionID ? { sessionID } : undefined,
    })
  }

  const back = () => {
    const sessionID = focusedSession()
    if (sessionID) {
      context.ui.router.navigate({ type: "session", sessionID })
      return
    }
    context.ui.router.navigate({ type: "home" })
  }

  const ensureSession = async (paneID: string, preferred?: string): Promise<string | undefined> => {
    const pane = state.panes[paneID]
    if (!pane) return undefined
    if (pane.sessionID) return pane.sessionID
    const existing = creating.get(paneID)
    if (existing) return existing
    if (preferred) {
      mutate((draft) => {
        const target = draft.panes[paneID]
        if (target && !target.sessionID) target.sessionID = preferred
      })
      return preferred
    }
    const pending = (async () => {
      try {
        const directory = pane.directory ?? sessionDirectory(context)
        const info = await client.session.create({
          location: { directory },
          title: "Splits session",
        })
        mutate((draft) => {
          const target = draft.panes[paneID]
          if (target) {
            target.sessionID = info.id
            target.directory = info.location?.directory ?? directory
          }
        })
        return info.id
      } catch (error) {
        context.ui.toast.show({
          message: `Splits: could not create session: ${error instanceof Error ? error.message : String(error)}`,
          variant: "error",
          duration: 5000,
        })
        return undefined
      } finally {
        creating.delete(paneID)
      }
    })()
    creating.set(paneID, pending)
    return pending
  }

  const newSession = async (directory?: string) => {
    let target = directory
    if (!target) {
      const value = await context.ui.dialog.prompt({
        title: "New session directory",
        placeholder: sessionDirectory(context),
        value: sessionDirectory(context),
      })
      if (value === undefined) return
      target = value.trim() || sessionDirectory(context)
    }
    const resolved = target ?? sessionDirectory(context)
    try {
      const info = await client.session.create({
        location: { directory: resolved },
        title: "Splits session",
      })
      split("session", "row", info.id, info.location?.directory ?? resolved)
    } catch (error) {
      context.ui.toast.show({
        message: `Splits: could not create session: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
        duration: 5000,
      })
    }
  }

  const newTerminal = (sessionID?: string) => {
    const targetSession = sessionID ?? focusedSession()
    split("terminal", "column", targetSession)
  }

  const pickSession = async () => {
    const sessions = context.data.session.list() as any[]
    if (!sessions.length) {
      context.ui.toast.show({ message: "Splits: no sessions found", variant: "info" })
      return
    }
    const choice = await context.ui.dialog.select({
      title: "Open session in a split",
      options: sessions.slice(0, 50).map((session: any) => ({
        title: session.title || session.id,
        value: session.id,
        description: session.location?.directory ?? "",
      })),
    })
    if (!choice) return
    const session = sessions.find((entry: any) => entry.id === choice)
    split("session", "row", choice, session?.location?.directory)
  }

  const toggleOverlay = () => {
    const current = overlay()
    if (current.open) {
      closeOverlay()
      return
    }
    const sessionID = focusedSession() ?? (context.ui.router.current()?.type === "session"
      ? context.ui.router.current().sessionID
      : undefined)
    if (!sessionID) {
      context.ui.toast.show({ message: "Splits: focus a session pane first", variant: "info" })
      return
    }
    setOverlay({ open: true, sessionID, ptyID: current.ptyID })
  }

  const closeOverlay = () => setOverlay((value) => ({ ...value, open: false }))
  const setOverlayPty = (ptyID: string | undefined) =>
    setOverlay((value) => ({ ...value, ptyID }))

  const trackPty = (ptyID: string) => {
    ptys.add(ptyID)
  }
  const forgetPty = (ptyID: string) => {
    ptys.delete(ptyID)
  }

  const setPanePty = (paneID: string, ptyID: string | undefined) => {
    mutate((draft) => {
      const pane = draft.panes[paneID]
      if (pane) pane.ptyID = ptyID
    })
  }

  const setPaneTitle = (paneID: string, title: string) => {
    mutate((draft) => {
      const pane = draft.panes[paneID]
      if (pane) pane.title = title
    })
  }

  const cleanup = async () => {
    for (const ptyID of ptys) {
      await removePersistentPty(client, ptyID)
    }
    ptys.clear()
  }

  return {
    context,
    client,
    options,
    state,
    zoom,
    overlay,
    isWorkspace,
    focusedPane,
    focusedSession,
    setFocused,
    split,
    closeFocused,
    cycle,
    resize,
    equalize: equalizeAll,
    toggleZoom,
    openWorkspace,
    back,
    ensureSession,
    newSession,
    newTerminal,
    pickSession,
    toggleOverlay,
    closeOverlay,
    setOverlayPty,
    trackPty,
    forgetPty,
    setPanePty,
    setPaneTitle,
    registerFocusable,
    requestFocus,
    cleanup,
  }
}

/** Clamp a ratio from a mouse drag or keyboard resize. */
export function nextRatio(current: number, delta: number): number {
  return clampRatio(current + delta)
}

export type { LayoutNode }
