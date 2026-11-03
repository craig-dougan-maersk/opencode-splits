import { createEffect, createSignal, type Accessor } from "solid-js"
import os from "node:os"
import path from "node:path"
import type { OpenCodeClient } from "@opencode/client"
import {
  adjustRatio,
  clampRatio,
  cycleLeaf,
  equalize,
  leafIDs,
  normalizeState,
  pruneMinimised,
  removeLeaf,
  splitLeaf,
  swapLeaf,
} from "./layout.ts"
import type { KubeSelection, LayoutNode, PaneKind, PaneState, SplitDirection, TerminalTab, WorkspaceState } from "./types.ts"
import { processEnv, type SplitsOptions } from "./config.ts"
import { buildTerminalEnv, createManagers, selectorYaml, writePrivateFile, type EnvState, type K8sState, type LocationRef, type Managers, type SshState } from "./integrations.ts"
import { launchWizard, type TerminalSelection } from "./launch.ts"
import { removePersistentPty } from "./pty.ts"

export interface OverlayState {
  open: boolean
  sessionID?: string
  ptyID?: string
}

export interface FocusHandle {
  focus(): void
  blur(): void
}

export interface TabSelection {
  profile?: string
  kube?: KubeSelection
  sshKey?: string
}

export interface Catalogue {
  loaded: boolean
  sessionID?: string
  env?: EnvState
  k8s?: K8sState
  ssh?: SshState
}

export interface TerminalEnvResult {
  env: Record<string, string>
  context?: string
  profile?: string
  sshSocket?: string
  warnings: string[]
}

export interface WorkspaceController {
  readonly context: any
  readonly client: OpenCodeClient
  readonly managers: Managers
  readonly options: SplitsOptions
  readonly state: WorkspaceState
  readonly zoom: Accessor<boolean>
  readonly overlay: Accessor<OverlayState>
  isWorkspace(): boolean
  focusedPane(): PaneState | undefined
  focusedSession(): string | undefined
  setFocused(paneID: string): void
  split(kind: PaneKind, direction: SplitDirection, sessionID?: string, directory?: string, selection?: TerminalSelection): string
  closeFocused(): void
  cycle(step: number): void
  resize(direction: "left" | "right" | "up" | "down", delta?: number): void
  equalize(): void
  toggleZoom(): void
  openWorkspace(data?: { sessionID?: string }): void
  back(): void
  ensureSession(paneID: string, preferred?: string): Promise<string | undefined>
  newSession(directory?: string): Promise<void>
  newTerminalWizard(sessionID?: string): Promise<void>
  newTerminalTab(paneID?: string): Promise<void>
  pickSession(): Promise<void>
  toggleOverlay(): void
  closeOverlay(): void
  setOverlayPty(ptyID: string | undefined): void
  trackPty(ptyID: string): void
  forgetPty(ptyID: string): void

  // terminal tabs
  terminalTabs(paneID: string): TerminalTab[]
  activeTab(paneID: string): TerminalTab | undefined
  setActiveTab(paneID: string, index: number): void
  nextTab(paneID: string, step: number): void
  addTerminalTab(paneID: string, selection?: TerminalSelection): string
  ensureTerminalTab(paneID: string): string
  closeTerminalTab(paneID: string, tabId?: string): void
  setTabPty(paneID: string, tabId: string, ptyID: string | undefined): void
  setTabTitle(paneID: string, tabId: string, title: string): void
  setTabSelection(paneID: string, tabId: string, selection: TabSelection): void
  buildEnvForTab(paneID: string, tabId: string): Promise<TerminalEnvResult>
  buildEnvForSession(sessionID?: string, directory?: string): Promise<TerminalEnvResult>

  // environment catalogue and locations
  catalogue(): Catalogue
  refreshCatalogue(sessionID?: string): Promise<void>
  sessionDirectoryFor(sessionID?: string): string
  locationFor(sessionID?: string): LocationRef

  // pty restart
  registerRestarter(id: string, fn: () => void): () => void
  restart(id: string): void

  // layout
  toggleMinimiseFocused(): void
  restorePane(paneID: string): void
  moveFocused(step: number): void

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

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_") || "selector"
}

function newTabID(): string {
  try {
    return `t-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)}`
  } catch {
    return `t-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function createWorkspace(context: any, options: SplitsOptions): WorkspaceController {
  const client = context.client as OpenCodeClient
  const managers = createManagers(client, (message) => console.error(`[splits] ${message}`))
  const selectorDir = path.join(os.homedir(), ".local", "state", "opencode", "splits", "k8s")
  const [state, update] = (context.storage.store as any)("workspace", {
    initial: normalizeState(initialState(), "p1"),
  })
  const [zoom, setZoom] = createSignal(false)
  const [overlay, setOverlay] = createSignal<OverlayState>({ open: false })
  const [catalogue, setCatalogue] = createSignal<Catalogue>({ loaded: false })
  const ptys = new Set<string>()
  const creating = new Map<string, Promise<string | undefined>>()
  const focusables = new Map<string, FocusHandle>()
  const restarters = new Map<string, () => void>()
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

  const registerRestarter = (id: string, fn: () => void) => {
    restarters.set(id, fn)
    return () => {
      if (restarters.get(id) === fn) restarters.delete(id)
    }
  }

  const restart = (id: string) => {
    restarters.get(id)?.()
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

  const routeSession = (): string | undefined => {
    try {
      const route = context.ui.router.current()
      return route?.type === "session" ? route.sessionID : undefined
    } catch {
      return undefined
    }
  }

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
    selection?: TerminalSelection,
  ): string => {
    const target = state.focused
    const { id, counter } = newPaneID()
    const pane: PaneState = { id, kind, sessionID, directory }
    if (kind === "terminal") {
      pane.tabs = [
        {
          id: newTabID(),
          title: selection?.title,
          profile: selection?.profile,
          kube: selection?.kube,
          sshKey: selection?.sshKey,
        },
      ]
      pane.activeTab = 0
    }
    const splitID = `s${counter}`
    mutate((draft) => {
      draft.counter = counter
      draft.panes[id] = pane
      draft.root = splitLeaf(draft.root, target, id, splitID, direction, 0.5)
      draft.focused = id
    })
    return id
  }

  const panePtys = (pane: PaneState | undefined): string[] => {
    if (!pane) return []
    if (pane.kind === "terminal") {
      return (pane.tabs ?? []).map((tab) => tab.ptyID).filter((value): value is string => Boolean(value))
    }
    return pane.ptyID ? [pane.ptyID] : []
  }

  const closePane = (paneID: string): boolean => {
    if (leafIDs(state.root).length <= 1) {
      context.ui.toast.show({ message: "Splits: keep at least one pane", variant: "warning" })
      return false
    }
    const pane = state.panes[paneID]
    for (const ptyID of panePtys(pane)) {
      void removePersistentPty(client, ptyID)
      ptys.delete(ptyID)
    }
    mutate((draft) => {
      const root = removeLeaf(draft.root, paneID)
      if (!root) return
      draft.root = root
      delete draft.panes[paneID]
    })
    return true
  }

  const closeFocused = () => {
    closePane(state.focused)
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

  const toggleMinimiseFocused = () => {
    const id = state.focused
    const pane = state.panes[id]
    if (!pane) return
    const next = !pane.minimised
    mutate((draft) => {
      const target = draft.panes[id]
      if (target) target.minimised = next
    })
  }

  const restorePane = (paneID: string) => {
    mutate((draft) => {
      const target = draft.panes[paneID]
      if (target) target.minimised = false
    })
    setFocused(paneID)
  }

  const moveFocused = (step: number) => {
    const ids = leafIDs(state.root)
    const current = state.focused
    const index = ids.indexOf(current)
    if (index < 0) return
    const target = ids[(index + step + ids.length) % ids.length]
    if (!target || target === current) return
    mutate((draft) => {
      draft.root = swapLeaf(draft.root, current, target)
      draft.focused = current
    })
  }

  // ---- terminal tabs -------------------------------------------------------

  const paneOf = (paneID: string): PaneState | undefined =>
    (state.panes as Record<string, PaneState>)[paneID]

  const tabsOf = (paneID: string): TerminalTab[] => paneOf(paneID)?.tabs ?? []

  const terminalTabs = (paneID: string): TerminalTab[] => tabsOf(paneID)

  const activeTab = (paneID: string): TerminalTab | undefined => {
    const pane = paneOf(paneID)
    if (pane?.kind !== "terminal" || !pane.tabs?.length) return undefined
    const index = pane.activeTab ?? 0
    return pane.tabs[index] ?? pane.tabs[0]
  }

  const setActiveTab = (paneID: string, index: number) => {
    mutate((draft) => {
      const pane = draft.panes[paneID]
      if (pane?.tabs?.length) pane.activeTab = Math.min(Math.max(0, index), pane.tabs.length - 1)
    })
  }

  const nextTab = (paneID: string, step: number) => {
    const pane = paneOf(paneID)
    if (!pane?.tabs?.length) return
    const count = pane.tabs.length
    setActiveTab(paneID, ((pane.activeTab ?? 0) + step + count) % count)
  }

  const addTerminalTab = (paneID: string, selection?: TerminalSelection): string => {
    const tabId = newTabID()
    mutate((draft) => {
      const pane = draft.panes[paneID]
      if (!pane || pane.kind !== "terminal") return
      pane.tabs = [
        ...(pane.tabs ?? []),
        {
          id: tabId,
          title: selection?.title,
          profile: selection?.profile,
          kube: selection?.kube,
          sshKey: selection?.sshKey,
        },
      ]
      pane.activeTab = pane.tabs.length - 1
      pane.minimised = false
    })
    return tabId
  }

  const ensureTerminalTab = (paneID: string): string => {
    const pane = paneOf(paneID)
    if (pane?.kind === "terminal" && pane.tabs?.length) {
      return pane.tabs[pane.activeTab ?? 0]?.id ?? pane.tabs[0]!.id
    }
    return addTerminalTab(paneID)
  }

  const closeTerminalTab = (paneID: string, tabId?: string) => {
    const pane = paneOf(paneID)
    if (pane?.kind !== "terminal" || !pane.tabs?.length) return
    const index = tabId ? pane.tabs.findIndex((tab) => tab.id === tabId) : pane.activeTab ?? 0
    const tab = pane.tabs[index]
    if (!tab) return
    if (tab.ptyID) {
      void removePersistentPty(client, tab.ptyID)
      ptys.delete(tab.ptyID)
    }
    if (pane.tabs.length <= 1) {
      closePane(paneID)
      return
    }
    mutate((draft) => {
      const target = draft.panes[paneID]
      if (!target?.tabs) return
      target.tabs = target.tabs.filter((entry) => entry.id !== tab.id)
      target.activeTab = Math.min(index, target.tabs.length - 1)
    })
  }

  const setTabPty = (paneID: string, tabId: string, ptyID: string | undefined) => {
    mutate((draft) => {
      const tab = draft.panes[paneID]?.tabs?.find((entry) => entry.id === tabId)
      if (tab) tab.ptyID = ptyID
    })
  }

  const setTabTitle = (paneID: string, tabId: string, title: string) => {
    mutate((draft) => {
      const tab = draft.panes[paneID]?.tabs?.find((entry) => entry.id === tabId)
      if (tab && tab.title !== title) tab.title = title
    })
  }

  const setTabSelection = (paneID: string, tabId: string, selection: TabSelection) => {
    mutate((draft) => {
      const tab = draft.panes[paneID]?.tabs?.find((entry) => entry.id === tabId)
      if (!tab) return
      if ("profile" in selection) tab.profile = selection.profile
      if ("kube" in selection) tab.kube = selection.kube
      if ("sshKey" in selection) tab.sshKey = selection.sshKey
    })
  }

  const locationFor = (sessionID?: string): LocationRef => {
    const info = sessionID ? context.data.session.get(sessionID) : undefined
    return info?.location ?? context.location ?? context.data.location.default()
  }

  const sessionDirectoryFor = (sessionID?: string): string => {
    const info = sessionID ? context.data.session.get(sessionID) : undefined
    return info?.location?.directory ?? context.location?.directory ?? process.cwd()
  }

  /**
   * Compose the environment for a terminal. Precedence is fixed in
   * buildTerminalEnv: base -> env-manager profile -> KUBECONFIG -> SSH agent.
   */
  const composeEnv = async (input: {
    sessionID?: string
    directory?: string
    profile?: string
    kube?: KubeSelection
    sshKey?: string
    selectorName: string
  }) => {
    const result = await buildTerminalEnv({
      managers,
      base: processEnv(options.env),
      sessionID: input.sessionID,
      directory: input.directory ?? sessionDirectoryFor(input.sessionID),
      location: locationFor(input.sessionID),
      profile: input.profile,
      kube: input.kube,
      sshKey: input.sshKey,
      selectorFile: async (selected) => {
        const file = path.join(selectorDir, `${safeName(input.selectorName)}.yaml`)
        await writePrivateFile(file, selectorYaml(selected))
        return file
      },
    })
    return { env: result.env, context: result.context, profile: result.profile, sshSocket: result.sshSocket, warnings: result.warnings }
  }

  const buildEnvForTab = (paneID: string, tabId: string) => {
    const pane = paneOf(paneID)
    const tab = pane?.tabs?.find((entry) => entry.id === tabId)
    return composeEnv({
      sessionID: pane?.sessionID,
      directory: pane?.directory,
      profile: tab?.profile,
      kube: tab?.kube,
      sshKey: tab?.sshKey,
      selectorName: `${paneID}-${tabId}`,
    })
  }

  /** Environment for a terminal that follows the session's own selection. */
  const buildEnvForSession = (sessionID?: string, directory?: string) =>
    composeEnv({ sessionID, directory, selectorName: `session-${sessionID ?? "default"}` })

  const refreshCatalogue = async (sessionID?: string) => {
    const target = sessionID ?? focusedSession() ?? routeSession()
    const location = locationFor(target)
    const [env, k8s, ssh] = await Promise.all([
      managers.envState({ sessionID: target, baseEnv: processEnv(options.env) }, location),
      managers.k8sState({ sessionID: target }, location),
      managers.sshState({ sessionID: target, directory: sessionDirectoryFor(target) }, location),
    ])
    setCatalogue({ loaded: true, sessionID: target, env, k8s, ssh })
  }

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

  /** Add a terminal, reusing the focused terminal pane as a new tab when possible. */
  const openTerminal = (sessionID?: string, selection?: TerminalSelection): string => {
    const targetSession = sessionID ?? focusedSession()
    const focused = focusedPane()
    if (focused?.kind === "terminal") {
      addTerminalTab(focused.id, selection)
      return focused.id
    }
    return split("terminal", "column", targetSession, sessionDirectoryFor(targetSession), selection)
  }

  const newTerminalWizard = async (sessionID?: string) => {
    const targetSession = sessionID ?? focusedSession() ?? routeSession()
    if (!targetSession) {
      context.ui.toast.show({
        message: "Splits: open a session before adding a terminal",
        variant: "info",
      })
      return
    }
    const selection = await launchWizard(context, managers, {
      sessionID: targetSession,
      directory: sessionDirectoryFor(targetSession),
      location: locationFor(targetSession),
    })
    if (!selection) return
    if (!isWorkspace()) openWorkspace({ sessionID: targetSession })
    openTerminal(targetSession, selection)
    void refreshCatalogue(targetSession)
  }

  /**
   * Add a tab to a terminal pane (or create a terminal pane when the focused
   * pane is a session), choosing the environment through the wizard.
   */
  const newTerminalTab = async (paneID?: string) => {
    const target = paneID ?? focusedPane()?.id
    const pane = target ? paneOf(target) : undefined
    if (!pane || pane.kind !== "terminal") {
      await newTerminalWizard(pane?.sessionID)
      return
    }
    const sessionID = pane.sessionID ?? focusedSession() ?? routeSession()
    if (!sessionID) {
      context.ui.toast.show({
        message: "Splits: the terminal pane has no session to inherit from",
        variant: "info",
      })
      return
    }
    const selection = await launchWizard(context, managers, {
      sessionID,
      directory: pane.directory ?? sessionDirectoryFor(sessionID),
      location: locationFor(sessionID),
    })
    if (!selection) return
    addTerminalTab(pane.id, selection)
    void refreshCatalogue(sessionID)
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
    const sessionID = focusedSession() ?? routeSession()
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

  const cleanup = async () => {
    for (const ptyID of ptys) {
      await removePersistentPty(client, ptyID)
    }
    ptys.clear()
  }

  return {
    context,
    client,
    managers,
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
    newTerminalWizard,
    newTerminalTab,
    pickSession,
    toggleOverlay,
    closeOverlay,
    setOverlayPty,
    trackPty,
    forgetPty,
    terminalTabs,
    activeTab,
    setActiveTab,
    nextTab,
    addTerminalTab,
    ensureTerminalTab,
    closeTerminalTab,
    setTabPty,
    setTabTitle,
    setTabSelection,
    buildEnvForTab,
    buildEnvForSession,
    catalogue,
    refreshCatalogue,
    sessionDirectoryFor,
    locationFor,
    registerRestarter,
    restart,
    toggleMinimiseFocused,
    restorePane,
    moveFocused,
    registerFocusable,
    requestFocus,
    cleanup,
  }
}

/** Clamp a ratio from a mouse drag or keyboard resize. */
export function nextRatio(current: number, delta: number): number {
  return clampRatio(current + delta)
}

export { pruneMinimised }

export type { LayoutNode }
