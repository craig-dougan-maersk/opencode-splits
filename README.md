# opencode-splits

A split-pane workspace for the OpenCode terminal UI: multiple sessions side by side,
resizable and nestable panes, terminal panes backed by real PTYs, tabbed terminals that
each carry their own environment profile and Kubernetes context, and a quake-style
drop-down terminal on `` ` ``.

> Status: functional preview. Session panes are rendered by the plugin (not the host's
> built-in session view), so advanced host UI such as the full diff viewer and some
> permission/form flows are still being filled in.

## Features

- Recursive split layout: split right or down, resize, equalize, zoom, close, minimise
  to a dock, and move a pane earlier or later in the layout.
- One pane per session, each with its own transcript, streaming text/reasoning, tool
  rows, permission prompts, and composer.
- New sessions in a different project directory (`ctrl+alt+n`).
- Open an existing session in a split (`ctrl+alt+o`).
- Terminal panes backed by the OpenCode persistent-PTY service and OpenTUI's embedded
  terminal renderable. Terminals reattach after a TUI restart.
- Tabbed terminals: each tab is its own PTY with its own environment.
- `/shell` runs a short wizard — environment profile, Kubernetes context, SSH key —
  then opens the terminal beside the session, inheriting the kubeconfigs, profiles and
  SSH keys of the session that launched it.
- A picker row in every terminal's status bar switches the profile, Kubernetes context
  or SSH key for that terminal only. The PTY is restarted so the new environment applies.
- Quake-style drop-down terminal in the `app` slot, toggled with `` ` ``, closed with
  `` ctrl+` ``.
- Workspace layout, pane list, tab selections, PTY ids, and focus are persisted through
  the plugin storage API.

## Integrations

Terminals inherit from the optional plugins that are installed for the session:

| Plugin | What a terminal inherits |
| --- | --- |
| `opencode-env-manager` | The resolved environment of the session's profile, or of the profile chosen for that terminal. |
| `opencode-k8s-context` | The session's KUBECONFIG, including its selector stub. Choosing a context pins it with a per-terminal selector stub prepended to KUBECONFIG. |
| `opencode-ssh-manager` | The session agent's `SSH_AUTH_SOCK`/`SSH_AGENT_PID`, loading the chosen key into the agent if needed. |

Composition order is fixed: base environment → env-manager profile → KUBECONFIG → SSH
agent. Each integration is read over the plugin RPC surface, so a terminal still opens
with the inherited environment when a peer plugin is absent.

Two consequences are worth knowing:

- Picking a context for one terminal never changes the session's context, and two
  terminals in the same session can run against different clusters at the same time.
- A terminal's environment is fixed when its PTY is created, so changing profile,
  context or SSH key restarts that terminal's shell.

Choosing a profile other than the session's own needs the `resolveProfile` method in
`opencode-env-manager` (read-only: it resolves a named profile without touching the
session). With an older env-manager the picker still lists profiles, and the terminal
falls back to the session's active profile with a warning.

## Install

This is a **TUI-only** plugin, so it belongs in `~/.config/opencode/cli.json` (not
`opencode.json`). Add the package path to `plugins`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    "/home/craig/plugins/opencode-splits"
  ]
}
```

With options:

```jsonc
{
  "plugins": [
    {
      "package": "/home/craig/plugins/opencode-splits",
      "options": {
        "overlayHeight": 45,
        "shell": "/bin/bash",
        "env": { "MY_VAR": "value" }
      }
    }
  ]
}
```

OpenCode watches `cli.json`; a save reloads the plugin. If the plugin was already
loaded, `opencode service restart` forces a clean reload of the TUI side.

## Keybindings

| Action | Default |
| --- | --- |
| Open the splits workspace | `ctrl+x` then `v` |
| Split right | `ctrl+alt+r` |
| Split down | `ctrl+alt+d` |
| Close focused pane | `ctrl+alt+x` |
| Minimise or restore focused pane | `ctrl+alt+m` |
| Move focused pane earlier / later | `ctrl+alt+shift+p` / `ctrl+alt+shift+l` |
| Focus previous / next pane | `ctrl+alt+left` / `ctrl+alt+right` (also up/down) |
| Grow focused pane | `ctrl+alt+shift+left/right/up/down` |
| Equalize panes | `ctrl+alt+e` |
| Zoom focused pane (maximise) | `ctrl+alt+z` |
| New session (prompts for a directory) | `ctrl+alt+n` |
| Open an existing session | `ctrl+alt+o` |
| New terminal (profile/context/SSH wizard) | `ctrl+alt+t`, or `/shell` |
| Next / previous terminal tab | `ctrl+alt+f` / `ctrl+alt+b` |
| New terminal tab (wizard) | `ctrl+alt+shift+t` |
| Close terminal tab | `ctrl+alt+shift+x` |
| Leave the workspace (open focused session) | `ctrl+alt+w` |
| Toggle drop-down terminal | `` ` `` |
| Close drop-down terminal | `` ctrl+` `` |

In a terminal pane, `[+]` adds a tab, the tab titles switch tabs, `×` closes a tab, and
the status bar's `profile:` / `kube:` / `ssh:` segments open their pickers. A minimised
pane is listed in the `docked:` strip under the layout; click it to restore.

Session pane commands (when that pane is focused):

| Action | Default |
| --- | --- |
| Interrupt the running turn | `ctrl+alt+c` |
| Toggle steer/queue delivery | `ctrl+alt+q` |
| Choose model | `ctrl+alt+shift+m` (also in the command palette) |
| Choose agent | `ctrl+alt+a` |
| Allow a pending permission once | `ctrl+alt+y` |
| Always allow a pending permission | `ctrl+alt+shift+y` |
| Reject a pending permission | `ctrl+alt+shift+n` |

The command palette (`ctrl+p`) also lists the workspace commands, which is useful when
a terminal or terminal multiplexer eats an `alt` chord.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `overlayHeight` | `45` | Drop-down height as a percentage of the terminal, clamped to 15–90. |
| `overlayToggleKey` | `` ` `` | Key that opens the drop-down terminal. |
| `overlayCloseKey` | `ctrl+\`` | Key that closes the drop-down terminal. |
| `shell` | `$SHELL` or `/bin/bash` | Shell used for terminal panes. |
| `env` | `{}` | Extra environment variables for PTYs. The server environment is inherited. |
| `scrollback` | `5000` | Reserved for transcript scrollback tuning. |
| `confirmClose` | `true` | Reserved for close confirmation. |
| `terminalTitle` | `true` | Follow the shell's terminal title. |

## Notes and limitations

- **Session panes are plugin-rendered.** The host does not expose its session
  renderable to plugins, so this plugin draws its own transcript and composer. It
  supports text, reasoning, tool rows, shell rows, errors, permissions, model/agent
  switching, and slash commands. The full host diff viewer, attachment previews, and
  some form controls are not reimplemented yet. Use `ctrl+alt+w` to open the focused
  session in the built-in view when you need them.
- **Environment:** PTYs inherit the OpenCode server process environment, then the
  env-manager profile for the terminal, then KUBECONFIG and the SSH agent. A session's
  `PUT /session/{id}/environment` override is still not readable through the public API;
  install `opencode-env-manager` and use a profile, or pass values through the `env`
  option.
- **Terminal panes require a session.** A terminal is created for a session's working
  directory and environment, and inherits that session's enabled kubeconfigs. `/shell`
  or `ctrl+alt+t` reports when no session is available; focus a session pane first.
- **Each terminal is a separate process.** Tabs do not share a shell, and changing the
  profile, Kubernetes context or SSH key restarts that tab's shell. The old PTY is
  removed before the new one is created.
- **Persistent PTYs are an experimental API.** The plugin checks
  `server.info().capabilities.persistentPty` indirectly by using the endpoint; if the
  server does not support it, the terminal pane shows an error and the session panes
  continue to work.
- **The `` ` `` key is reserved** while the overlay is closed, so typing a backtick into
  a composer opens the overlay instead. Use `ctrl+\`` to close it; the key is sent to the
  terminal while the overlay is focused.
- **Multiple TUI clients** already share session data through the OpenCode server. This
  plugin gives you multiple views inside one TUI; it does not create additional OS
  windows.

## Development

```sh
cd ~/plugins/opencode-splits
npm install
npm run typecheck
npm test
```

The plugin is loaded from `src/tui.tsx` directly; there is no build step. OpenTUI is a
peer dependency so the plugin uses the copy bundled with OpenCode.

### Layout

```
src/
  tui.tsx           plugin entry: route, overlay slot, global keymap and /shell
  controller.ts     workspace state, panes, tabs, restarters, persistence
  layout.ts         pure split-tree operations (tested)
  workspace.tsx     recursive pane grid, frames, header, minimised dock
  session-pane.tsx  transcript, composer, permissions, model/agent pickers
  terminal-pane.tsx embedded terminal, persistent PTY, status-bar pickers
  terminal-tabs.tsx tab strip and the tab-aware terminal pane
  overlay.tsx       quake drop-down
  launch.ts         profile / context / SSH-key pickers and the launch wizard
  integrations.ts   env-manager, k8s-context and ssh-manager RPC + env composition (tested)
  pty.ts            PTY create/connect/frame protocol
  pty-frame.ts      binary input frame (tested)
  theme.ts          host theme -> hex colors
  config.ts         options and environment
  format.ts         small formatting helpers
test/
  layout.test.ts        split/close/resize/cycle/normalize/swap/minimise
  integrations.test.ts  kubeconfig selection and terminal environment composition
  pty.test.ts           frame encoding and option parsing
```

## License

MIT
