# opencode-splits

A split-pane workspace for the OpenCode terminal UI: multiple sessions side by side,
resizable and nestable panes, terminal panes backed by real PTYs, and a quake-style
drop-down terminal on `` ` ``.

> Status: functional preview. Session panes are rendered by the plugin (not the host's
> built-in session view), so advanced host UI such as the full diff viewer and some
> permission/form flows are still being filled in.

## Features

- Recursive split layout: split right or down, resize, equalize, zoom, close.
- One pane per session, each with its own transcript, streaming text/reasoning, tool
  rows, permission prompts, and composer.
- New sessions in a different project directory (`ctrl+alt+n`).
- Open an existing session in a split (`ctrl+alt+o`).
- Terminal panes backed by the OpenCode persistent-PTY service and OpenTUI's embedded
  terminal renderable. Terminals reattach after a TUI restart.
- Quake-style drop-down terminal in the `app` slot, toggled with `` ` ``, closed with
  `` ctrl+` ``.
- Workspace layout, pane list, PTY ids, and focus are persisted through the plugin
  storage API.

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
| Focus previous / next pane | `ctrl+alt+left` / `ctrl+alt+right` (also up/down) |
| Grow focused pane | `ctrl+alt+shift+left/right/up/down` |
| Equalize panes | `ctrl+alt+e` |
| Zoom focused pane | `ctrl+alt+z` |
| New session (prompts for a directory) | `ctrl+alt+n` |
| Open an existing session | `ctrl+alt+o` |
| New terminal pane | `ctrl+alt+t` |
| Leave the workspace (open focused session) | `ctrl+alt+w` |
| Toggle drop-down terminal | `` ` `` |
| Close drop-down terminal | `` ctrl+` `` |

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
- **Environment:** PTYs inherit the OpenCode server process environment. A session's
  `PUT /session/{id}/environment` override is not readable through the public API, so
  plugin-created terminals cannot mirror it exactly; pass values through the `env`
  option instead.
- **Terminal panes require a session.** A terminal is created for the focused session's
  working directory and environment. If a pane has no session yet, focus a session pane
  first.
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
  tui.tsx           plugin entry: route, overlay slot, global keymap
  controller.ts     workspace state, pane actions, persistence
  layout.ts         pure split-tree operations (tested)
  workspace.tsx     recursive pane grid, frames, header
  session-pane.tsx  transcript, composer, permissions, model/agent pickers
  terminal-pane.tsx embedded terminal + persistent PTY
  overlay.tsx       quake drop-down
  pty.ts            PTY create/connect/frame protocol
  pty-frame.ts      binary input frame (tested)
  theme.ts          host theme -> hex colors
  config.ts         options and environment
  format.ts         small formatting helpers
test/
  layout.test.ts    split/close/resize/cycle/normalize
  pty.test.ts       frame encoding and option parsing
```

## License

MIT
