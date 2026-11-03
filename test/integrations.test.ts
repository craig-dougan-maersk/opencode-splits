import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import {
  buildTerminalEnv,
  kubeContexts,
  kubePaths,
  selectorYaml,
  type EnvState,
  type K8sState,
  type Managers,
  type SshState,
} from "../src/integrations.ts"

const K8S: K8sState = {
  enabled: ["a"],
  sources: [
    {
      id: "a",
      label: "Prod",
      kind: "file",
      path: "/tmp/kube/a.yaml",
      available: true,
      enabled: true,
      contexts: [{ name: "prod-1" }],
    },
    {
      id: "b",
      label: "Dev",
      kind: "file",
      path: "/tmp/kube/b.yaml",
      available: true,
      enabled: false,
      contexts: [{ name: "dev-1" }],
    },
    {
      id: "c",
      label: "Missing",
      kind: "file",
      path: "/tmp/kube/c.yaml",
      available: false,
      enabled: true,
      contexts: [],
    },
  ],
  contexts: [{ name: "prod-1", source: "a", sourceLabel: "Prod" }],
  context: "prod-1",
  kubeconfig: "/tmp/kube/session-stub.yaml:/tmp/kube/a.yaml",
}

const ENV: EnvState = {
  profile: "dev",
  profiles: [{ name: "dev", active: true }],
  environment: { FROM_PROFILE: "dev", OVERRIDE: "profile" },
  unset: [{ key: "DROP_ME" }],
}

const SSH: SshState = {
  keys: [{ id: "k1", label: "git key", loaded: true }],
  agent: { running: true, socket: "/tmp/agent/sock", pid: 4242 },
}

function managers(overrides: Partial<Managers> = {}): Managers {
  return {
    envState: async () => ENV,
    envResolveProfile: async (input) => ({
      profile: input.profile,
      profiles: [],
      environment: { FROM_PROFILE: input.profile },
    }),
    k8sState: async () => K8S,
    sshState: async () => SSH,
    sshLoadKey: async () => true,
    sshStart: async () => true,
    ...overrides,
  }
}

test("kubePaths keeps only available, enabled sources in merge order", () => {
  assert.deepEqual(kubePaths(K8S), ["/tmp/kube/a.yaml"])
  assert.deepEqual(kubePaths(K8S, ["a", "b"]), ["/tmp/kube/a.yaml", "/tmp/kube/b.yaml"])
  // An explicit selection is narrowed to sources that are actually available.
  assert.deepEqual(kubePaths(K8S, ["b", "c"]), ["/tmp/kube/b.yaml"])
})

test("kubeContexts unions the reachable contexts of the enabled sources", () => {
  assert.deepEqual(kubeContexts(K8S).sort(), ["prod-1"])
  const wider: K8sState = { ...K8S, enabled: ["a", "b"], sources: K8S.sources.map((s) => ({ ...s, enabled: true })) }
  assert.deepEqual(kubeContexts(wider).sort(), ["dev-1", "prod-1"])
})

test("selectorYaml pins current-context", () => {
  const yaml = selectorYaml("prod-1")
  assert.match(yaml, /kind: Config/)
  assert.match(yaml, /current-context: "prod-1"/)
})

test("buildTerminalEnv applies base, profile, kubeconfig then ssh", async () => {
  const result = await buildTerminalEnv({
    managers: managers(),
    base: { BASE: "1", DROP_ME: "x", OVERRIDE: "base" },
    sessionID: "s1",
    directory: "/work",
    selectorFile: (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.env.BASE, "1")
  assert.equal(result.env.OVERRIDE, "profile")
  assert.equal(result.env.DROP_ME, undefined)
  assert.equal(result.profile, "dev")
  // No context selected: the session's own KUBECONFIG is inherited verbatim.
  assert.equal(result.env.KUBECONFIG, K8S.kubeconfig)
  assert.equal(result.env.SSH_AUTH_SOCK, "/tmp/agent/sock")
  assert.equal(result.env.SSH_AGENT_PID, "4242")
  assert.deepEqual(result.warnings, [])
})

test("an explicit kubeconfig selection rebuilds KUBECONFIG from the chosen sources", async () => {
  const result = await buildTerminalEnv({
    managers: managers(),
    base: {},
    sessionID: "s1",
    kube: { enabled: ["a", "b"] },
    selectorFile: (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.env.KUBECONFIG, `/tmp/kube/a.yaml${path.delimiter}/tmp/kube/b.yaml`)
  assert.equal(result.context, undefined)
})

test("a selected context is pinned by a prepended selector stub", async () => {
  const result = await buildTerminalEnv({
    managers: managers(),
    base: {},
    sessionID: "s1",
    kube: { context: "prod-1" },
    selectorFile: async (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.context, "prod-1")
  assert.equal(result.env.KUBECONFIG, `/tmp/sel/prod-1.yaml${path.delimiter}/tmp/kube/a.yaml`)
})

test("a context outside the enabled kubeconfigs is refused with a warning", async () => {
  const result = await buildTerminalEnv({
    managers: managers(),
    base: {},
    sessionID: "s1",
    kube: { context: "dev-1" },
    selectorFile: (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.context, undefined)
  assert.equal(result.env.KUBECONFIG, "/tmp/kube/a.yaml")
  assert.ok(result.warnings.some((warning) => warning.includes("dev-1")))
})

test("a requested profile is resolved without touching the session profile", async () => {
  let sawState = false
  const result = await buildTerminalEnv({
    managers: managers({
      envState: async () => {
        sawState = true
        return ENV
      },
    }),
    base: { BASE: "1" },
    sessionID: "s1",
    profile: "prod-readonly",
    selectorFile: (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.profile, "prod-readonly")
  assert.equal(result.env.FROM_PROFILE, "prod-readonly")
  assert.equal(sawState, false)
})

test("a missing env-manager degrades to the base environment with a warning", async () => {
  const result = await buildTerminalEnv({
    managers: managers({
      envState: async () => undefined,
      envResolveProfile: async () => undefined,
    }),
    base: { BASE: "1" },
    sessionID: "s1",
    profile: "prod-readonly",
    selectorFile: (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.env.BASE, "1")
  assert.equal(result.profile, undefined)
  assert.ok(result.warnings.some((warning) => warning.includes("env-manager is not available")))
})

test("a missing k8s plugin leaves KUBECONFIG and the SSH agent alone", async () => {
  const result = await buildTerminalEnv({
    managers: managers({ k8sState: async () => undefined, sshState: async () => undefined }),
    base: { BASE: "1" },
    sessionID: "s1",
    selectorFile: (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.env.KUBECONFIG, undefined)
  assert.equal(result.env.SSH_AUTH_SOCK, undefined)
  assert.deepEqual(result.warnings, [])
})

test("an enabled-but-empty kubeconfig set warns instead of clearing KUBECONFIG", async () => {
  const result = await buildTerminalEnv({
    managers: managers({ k8sState: async () => ({ ...K8S, enabled: [], sources: [], kubeconfig: undefined }) }),
    base: {},
    sessionID: "s1",
    selectorFile: (context) => `/tmp/sel/${context}.yaml`,
  })

  assert.equal(result.env.KUBECONFIG, undefined)
  assert.ok(result.warnings.some((warning) => warning.includes("No kubeconfig sources")))
})
