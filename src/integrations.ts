/**
 * Integration with the optional opencode-env-manager, opencode-k8s-context and
 * opencode-ssh-manager plugins.
 *
 * Everything is read through the plugin RPC surface (`client.rpc(definition)`),
 * so this plugin keeps no dependency on the other packages. Each call degrades
 * to `undefined` when the peer plugin is absent, so a terminal still opens with
 * the inherited environment.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Rpc } from "@opencode/plugin/rpc"
import type { OpenCodeClient } from "@opencode/client"
import type { KubeSelection } from "./types.ts"

const string = { type: "string" } as const
const stringMap = { type: "object", additionalProperties: { type: "string" } } as const
const object = { type: "object", additionalProperties: true } as const

/** env.manager — only the methods this plugin needs. */
export const EnvManager = Rpc.define({
  id: "env.manager",
  events: {},
  methods: {
    state: {
      input: {
        type: "object",
        properties: { sessionID: string, baseEnv: stringMap },
        additionalProperties: false,
      },
      output: object,
    },
    activeProfile: {
      input: {
        type: "object",
        properties: { sessionID: string },
        additionalProperties: false,
      },
      output: object,
    },
    /**
     * Resolve a named profile without touching the session. Added to
     * env-manager so a terminal can run under a profile of its own. When the
     * running env-manager predates it the call fails and the terminal falls
     * back to the session's active profile.
     */
    resolveProfile: {
      input: {
        type: "object",
        properties: { profile: string, baseEnv: stringMap },
        required: ["profile"],
        additionalProperties: false,
      },
      output: object,
    },
  },
}) as unknown as Rpc.PortableDefinition

/** k8s.manager — read-only. Selector stubs are written by this plugin. */
export const K8sManager = Rpc.define({
  id: "k8s.manager",
  events: {},
  methods: {
    state: {
      input: {
        type: "object",
        properties: { sessionID: string },
        additionalProperties: false,
      },
      output: object,
    },
  },
}) as unknown as Rpc.PortableDefinition

/** ssh.manager — read plus key loading for the session agent. */
export const SshManager = Rpc.define({
  id: "ssh.manager",
  events: {},
  methods: {
    state: {
      input: {
        type: "object",
        properties: { sessionID: string, directory: string },
        additionalProperties: false,
      },
      output: object,
    },
    loadKey: {
      input: {
        type: "object",
        properties: { sessionID: string, keyID: string, directory: string },
        required: ["keyID"],
        additionalProperties: false,
      },
      output: object,
    },
    start: {
      input: {
        type: "object",
        properties: { sessionID: string, directory: string },
        additionalProperties: false,
      },
      output: object,
    },
  },
}) as unknown as Rpc.PortableDefinition

export interface LocationRef {
  directory?: string
}

export interface ProfileInfo {
  name: string
  description?: string
  variableCount?: number
  secretCount?: number
  envFiles?: string[]
  active?: boolean
  isDefault?: boolean
}

export interface EnvState {
  directory?: string
  profile: string
  defaultProfile?: string
  profiles: ProfileInfo[]
  environment: Record<string, string>
  unset?: Array<{ key: string }>
  warnings?: string[]
}

export interface K8sContextInfo {
  name: string
  cluster?: string
  user?: string
  namespace?: string
  source: string
  sourceLabel: string
}

export interface K8sSourceView {
  id: string
  label: string
  kind: string
  path?: string
  available: boolean
  enabled: boolean
  contexts: Array<{ name: string; cluster?: string; namespace?: string }>
  currentContext?: string
  error?: string
}

export interface K8sState {
  enabled: string[]
  sources: K8sSourceView[]
  contexts: K8sContextInfo[]
  context?: string
  kubeconfig?: string
  warnings?: string[]
}

export interface SshKeyInfo {
  id: string
  label?: string
  loaded?: boolean
  fingerprint?: string
  error?: string
}

export interface SshState {
  activeProfile?: string
  defaultProfile?: string
  agent?: { running?: boolean; socket?: string; pid?: number; error?: string }
  keys: SshKeyInfo[]
  profiles?: Array<{ name: string; description?: string; active?: boolean; isDefault?: boolean }>
  warnings?: string[]
}

export interface Managers {
  envState(input: { sessionID?: string; baseEnv?: Record<string, string> }, location?: LocationRef): Promise<EnvState | undefined>
  envResolveProfile(input: { profile: string; baseEnv?: Record<string, string> }, location?: LocationRef): Promise<EnvState | undefined>
  k8sState(input: { sessionID?: string }, location?: LocationRef): Promise<K8sState | undefined>
  sshState(input: { sessionID?: string; directory?: string }, location?: LocationRef): Promise<SshState | undefined>
  sshLoadKey(input: { sessionID?: string; keyID: string; directory?: string }, location?: LocationRef): Promise<boolean>
  sshStart(input: { sessionID?: string; directory?: string }, location?: LocationRef): Promise<boolean>
}

export type LogFn = (message: string) => void

function isRpcFailure(value: unknown): value is { type: string; message: string } {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.message !== "string") return false
  if (candidate._tag === "RpcError") return true
  return typeof candidate.type === "string" && String(candidate.type).startsWith("rpc.")
}

function safeRpc(client: unknown, definition: Rpc.PortableDefinition): Record<string, unknown> | undefined {
  try {
    const scope = (client as any)?.rpc?.(definition)
    return scope && typeof scope === "object" ? (scope as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createManagers(client: OpenCodeClient, log?: LogFn): Managers {
  const env = safeRpc(client, EnvManager)
  const k8s = safeRpc(client, K8sManager)
  const ssh = safeRpc(client, SshManager)

  async function call<T>(
    scope: Record<string, unknown> | undefined,
    name: string,
    input: unknown,
    location?: LocationRef,
  ): Promise<T | undefined> {
    const fn = scope?.[name]
    if (typeof fn !== "function") return undefined
    try {
      const options = location ? { location } : undefined
      const result = await (fn as (input: unknown, options?: unknown) => Promise<unknown>).call(scope, input, options)
      if (isRpcFailure(result)) {
        log?.(`${name} failed: ${result.message}`)
        return undefined
      }
      return result as T
    } catch (error) {
      log?.(`${name} failed: ${messageOf(error)}`)
      return undefined
    }
  }

  return {
    envState: (input, location) => call<EnvState>(env, "state", input, location),
    envResolveProfile: (input, location) => call<EnvState>(env, "resolveProfile", input, location),
    k8sState: (input, location) => call<K8sState>(k8s, "state", input, location),
    sshState: (input, location) => call<SshState>(ssh, "state", input, location),
    sshLoadKey: async (input, location) => {
      const result = await call<unknown>(ssh, "loadKey", input, location)
      return result !== undefined
    },
    sshStart: async (input, location) => {
      const result = await call<unknown>(ssh, "start", input, location)
      return result !== undefined
    },
  }
}

/** Kubeconfig file paths for the enabled sources, in merge order. */
export function kubePaths(state: K8sState, enabled?: string[]): string[] {
  const selection = enabled && enabled.length ? new Set(enabled) : new Set(state.enabled ?? [])
  return (state.sources ?? [])
    .filter((source) => source.available && selection.has(source.id) && typeof source.path === "string" && source.path.length > 0)
    .map((source) => source.path as string)
}

/** Every context name reachable through the enabled sources. */
export function kubeContexts(state: K8sState): string[] {
  const names = new Set<string>()
  for (const context of state.contexts ?? []) names.add(context.name)
  for (const source of state.sources ?? []) {
    if (!source.enabled) continue
    for (const context of source.contexts ?? []) names.add(context.name)
  }
  return [...names]
}

export function selectorYaml(context: string): string {
  return `apiVersion: v1\nkind: Config\ncurrent-context: ${JSON.stringify(context)}\n`
}

export async function writePrivateFile(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.writeFile(file, contents, { mode: 0o600 })
  await fs.chmod(file, 0o600).catch(() => undefined)
}

export interface TerminalEnvInput {
  managers: Managers
  /** Base environment; the server/TUI environment plus configured extras. */
  base: Record<string, string>
  sessionID?: string
  directory?: string
  location?: LocationRef
  profile?: string
  kube?: KubeSelection
  sshKey?: string
  /** Absolute path for a per-terminal current-context selector stub. */
  selectorFile: (context: string) => string | Promise<string>
}

export interface TerminalEnvResult {
  env: Record<string, string>
  /** The context actually forced, after validation against the enabled set. */
  context?: string
  profile?: string
  sshSocket?: string
  warnings: string[]
}

/**
 * Compose a terminal environment with a fixed precedence:
 *   base  ->  env-manager profile  ->  Kubernetes KUBECONFIG  ->  SSH agent
 */
export async function buildTerminalEnv(input: TerminalEnvInput): Promise<TerminalEnvResult> {
  const env: Record<string, string> = { ...input.base }
  const warnings: string[] = []
  let profile: string | undefined

  const requested = input.profile
  let envState: EnvState | undefined
  if (requested) {
    envState = await input.managers.envResolveProfile({ profile: requested, baseEnv: input.base }, input.location)
    if (!envState) {
      warnings.push(`env-manager cannot resolve profile "${requested}"; using the session profile`)
    }
  }
  if (!envState) {
    envState = await input.managers.envState({ sessionID: input.sessionID, baseEnv: input.base }, input.location)
  }
  if (envState) {
    profile = envState.profile
    for (const [key, value] of Object.entries(envState.environment ?? {})) env[key] = value
    for (const entry of envState.unset ?? []) {
      if (entry && typeof entry.key === "string") delete env[entry.key]
    }
    for (const warning of envState.warnings ?? []) warnings.push(warning)
  } else if (requested) {
    warnings.push(`env-manager is not available; profile "${requested}" was not applied`)
  }

  let context = input.kube?.context
  const enabled = input.kube?.enabled
  const k8sState = await input.managers.k8sState({ sessionID: input.sessionID }, input.location)
  if (k8sState) {
    if (!context && !enabled?.length && typeof k8sState.kubeconfig === "string" && k8sState.kubeconfig.length > 0) {
      // Inherit the session's own KUBECONFIG, including its selector stub.
      env.KUBECONFIG = k8sState.kubeconfig
    } else {
      const paths = kubePaths(k8sState, enabled)
      const selector: string[] = []
      if (context) {
        if (kubeContexts(k8sState).includes(context)) {
          selector.push(await input.selectorFile(context))
        } else {
          warnings.push(`Kubernetes context "${context}" is not in the enabled kubeconfigs`)
          context = undefined
        }
      }
      if (paths.length) {
        env.KUBECONFIG = [...selector, ...paths].join(path.delimiter)
      } else if (selector.length) {
        env.KUBECONFIG = selector.join(path.delimiter)
      } else {
        warnings.push("No kubeconfig sources are enabled for this session")
      }
    }
    for (const warning of k8sState.warnings ?? []) warnings.push(warning)
  }

  let sshSocket: string | undefined
  if (input.sshKey || input.sessionID) {
    const query = { sessionID: input.sessionID, directory: input.directory }
    let sshState = await input.managers.sshState(query, input.location)
    if (input.sshKey && sshState) {
      const key = (sshState.keys ?? []).find((entry) => entry.id === input.sshKey)
      if (!key) {
        warnings.push(`SSH key "${input.sshKey}" is not configured in ssh-manager`)
      } else if (!key.loaded) {
        if (!sshState.agent?.running) {
          const started = await input.managers.sshStart(query, input.location)
          if (!started) warnings.push("ssh-manager could not start the SSH agent")
        }
        const loaded = await input.managers.sshLoadKey({ ...query, keyID: input.sshKey }, input.location)
        if (!loaded) warnings.push(`Could not load SSH key "${input.sshKey}"`)
        sshState = (await input.managers.sshState(query, input.location)) ?? sshState
      }
    }
    if (sshState?.agent?.running && sshState.agent.socket) {
      sshSocket = sshState.agent.socket
      env.SSH_AUTH_SOCK = sshState.agent.socket
      if (sshState.agent.pid) env.SSH_AGENT_PID = String(sshState.agent.pid)
    }
  }

  return { env, context, profile, sshSocket, warnings }
}
