/** Input frame for the persistent-PTY WebSocket protocol (input_protocol=1). */
export function ptyFrame(cols: number, rows: number, data?: Uint8Array): Uint8Array {
  const payload = data ?? new Uint8Array(0)
  const out = new Uint8Array(5 + payload.length)
  const view = new DataView(out.buffer)
  out[0] = data ? 1 : 0
  view.setUint16(1, cols)
  view.setUint16(3, rows)
  if (data) out.set(data, 5)
  return out
}
