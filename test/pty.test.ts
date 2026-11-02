import { test } from "node:test"
import assert from "node:assert/strict"
import { ptyFrame } from "../src/pty-frame.ts"
import { readOptions } from "../src/config.ts"

test("ptyFrame encodes a resize frame", () => {
  const frame = ptyFrame(120, 40)
  assert.equal(frame.length, 5)
  assert.equal(frame[0], 0)
  const view = new DataView(frame.buffer)
  assert.equal(view.getUint16(1), 120)
  assert.equal(view.getUint16(3), 40)
})

test("ptyFrame encodes input bytes after the header", () => {
  const payload = new TextEncoder().encode("ls\n")
  const frame = ptyFrame(80, 24, payload)
  assert.equal(frame.length, 5 + payload.length)
  assert.equal(frame[0], 1)
  const view = new DataView(frame.buffer)
  assert.equal(view.getUint16(1), 80)
  assert.equal(view.getUint16(3), 24)
  assert.deepEqual(Array.from(frame.slice(5)), Array.from(payload))
})

test("readOptions clamps the overlay height and keeps defaults", () => {
  const low = readOptions({ overlayHeight: 1 })
  assert.equal(low.overlayHeight, 15)
  const high = readOptions({ overlayHeight: 200 })
  assert.equal(high.overlayHeight, 90)
  const defaults = readOptions(undefined)
  assert.equal(defaults.overlayHeight, 45)
  assert.equal(defaults.confirmClose, true)
  assert.equal(defaults.terminalTitle, true)
})

test("readOptions accepts a shell and env map", () => {
  const options = readOptions({ shell: "/bin/zsh", env: { FOO: "bar" }, scrollback: 100 })
  assert.equal(options.shell, "/bin/zsh")
  assert.deepEqual(options.env, { FOO: "bar" })
  assert.equal(options.scrollback, 500)
})
