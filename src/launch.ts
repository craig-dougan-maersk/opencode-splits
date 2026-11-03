/**
 * Dialog helpers for choosing a terminal's environment profile, Kubernetes
 * context and SSH key, plus the launch wizard that chains them.
 *
 * The TUI dialog API has no multi-field form, so the wizard is a short
 * sequence of single-choice selects. Every step is skippable when its peer
 * plugin is not installed.
 */
import { processEnv } from "./config.ts"
import type { KubeSelection } from "./types.ts"
import {
  kubeContexts,
  type LocationRef,
  type Managers,
  type ProfileInfo,
  type SshKeyInfo,
} from "./integrations.ts"

export const SESSION_DEFAULT = "\u0000session-default"
export const NO_KEY = "\u0000no-key"

export type PickResult<T> = { status: "ok"; value: T } | { status: "skip" } | { status: "cancel" }

export interface WizardTarget {
  sessionID?: string
  directory?: string
  location?: LocationRef
}

export interface TerminalSelection {
  sessionID?: string
  directory?: string
  title?: string
  profile?: string
  kube?: KubeSelection
  sshKey?: string
}

function profileLabel(profile: ProfileInfo): string {
  const parts: string[] = []
  const variables = profile.variableCount ?? 0
  parts.push(`${variables} variable${variables === 1 ? "" : "s"}`)
  if (profile.secretCount) parts.push(`${profile.secretCount} secret${profile.secretCount === 1 ? "" : "s"}`)
  if (profile.envFiles?.length) parts.push(profile.envFiles.join(", "))
  if (profile.isDefault) parts.push("default for new sessions")
  if (profile.active) parts.push("active")
  return parts.join(" · ")
}

function keyLabel(key: SshKeyInfo): string {
  const parts: string[] = []
  if (key.loaded) parts.push("loaded")
  if (key.fingerprint) parts.push(key.fingerprint)
  if (key.error) parts.push(key.error)
  return parts.join(" · ")
}

export async function pickProfile(
  context: any,
  managers: Managers,
  target: WizardTarget,
  baseEnv: Record<string, string>,
  current?: string,
): Promise<PickResult<string>> {
  const state = await managers.envState({ sessionID: target.sessionID, baseEnv }, target.location)
  if (!state) return { status: "skip" }

  const options = [
    {
      title: "Session default",
      value: SESSION_DEFAULT,
      description: `follow the session (${state.profile})`,
      category: "Inherit",
    },
    ...state.profiles.map((profile) => ({
      title: profile.name,
      value: profile.name,
      description: profileLabel(profile),
      category: profile.active ? "Active" : undefined,
    })),
  ]

  const choice = await context.ui.dialog.select({
    title: "Terminal environment profile",
    placeholder: "Search profiles",
    options,
    current: current ?? SESSION_DEFAULT,
  })
  if (choice === undefined || choice === null) return { status: "cancel" }
  return { status: "ok", value: String(choice) }
}

export async function pickKube(
  context: any,
  managers: Managers,
  target: WizardTarget,
  current?: KubeSelection,
): Promise<PickResult<KubeSelection>> {
  const state = await managers.k8sState({ sessionID: target.sessionID }, target.location)
  if (!state) return { status: "skip" }

  const names = kubeContexts(state)
  if (!names.length) {
    await context.ui.dialog.alert({
      title: "Kubernetes",
      message:
        state.enabled.length === 0
          ? "No kubeconfig sources are enabled for this session, so no context can be chosen."
          : "The enabled kubeconfigs define no contexts.",
    })
    return { status: "skip" }
  }

  const options = [
    {
      title: "Session default",
      value: SESSION_DEFAULT,
      description: state.context ? `current: ${state.context}` : "no current context",
      category: "Inherit",
    },
    ...state.contexts.map((entry) => ({
      title: entry.name,
      value: entry.name,
      description: [entry.cluster, entry.namespace ? `ns ${entry.namespace}` : undefined, `from ${entry.sourceLabel}`]
        .filter(Boolean)
        .join(" · "),
      category: "Enabled",
    })),
  ]

  const choice = await context.ui.dialog.select({
    title: "Kubernetes context",
    placeholder: "Search contexts",
    options,
    current: current?.context ?? SESSION_DEFAULT,
  })
  if (choice === undefined || choice === null) return { status: "cancel" }
  if (choice === SESSION_DEFAULT) return { status: "ok", value: {} }
  return { status: "ok", value: { context: String(choice) } }
}

export async function pickSshKey(
  context: any,
  managers: Managers,
  target: WizardTarget,
  current?: string,
): Promise<PickResult<string>> {
  const state = await managers.sshState(
    { sessionID: target.sessionID, directory: target.directory },
    target.location,
  )
  if (!state) return { status: "skip" }

  const keys = state.keys ?? []
  const options = [
    {
      title: "None",
      value: NO_KEY,
      description: state.agent?.running ? "leave the running SSH agent alone" : "do not touch the SSH agent",
      category: "Inherit",
    },
    ...keys.map((key) => ({
      title: key.label || key.id,
      value: key.id,
      description: keyLabel(key),
      category: key.loaded ? "Loaded" : "Available",
    })),
  ]

  const choice = await context.ui.dialog.select({
    title: "SSH key",
    placeholder: "Search keys",
    options,
    current: current ?? NO_KEY,
  })
  if (choice === undefined || choice === null) return { status: "cancel" }
  return { status: "ok", value: String(choice) }
}

/** Chain the pickers. Returns undefined when the user cancels. */
export async function launchWizard(
  context: any,
  managers: Managers,
  target: WizardTarget,
): Promise<TerminalSelection | undefined> {
  const baseEnv = processEnv()
  const selection: TerminalSelection = { sessionID: target.sessionID, directory: target.directory }

  const profile = await pickProfile(context, managers, target, baseEnv)
  if (profile.status === "cancel") return undefined
  if (profile.status === "ok" && profile.value !== SESSION_DEFAULT) selection.profile = profile.value

  const kube = await pickKube(context, managers, target)
  if (kube.status === "cancel") return undefined
  if (kube.status === "ok" && (kube.value.context || kube.value.enabled)) selection.kube = kube.value

  const ssh = await pickSshKey(context, managers, target)
  if (ssh.status === "cancel") return undefined
  if (ssh.status === "ok" && ssh.value !== NO_KEY) selection.sshKey = ssh.value

  return selection
}
