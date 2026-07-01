export type SchedInstance = { id: string; hourlyLimit: number }
export type Sched = { instanceId: string; sendAt: number }

export function scheduleMessages(opts: {
  count: number; instances: SchedInstance[]
  minDelaySeconds: number; maxDelaySeconds: number
  startAtMs: number; rng?: () => number
}): Sched[] {
  const { count, instances, minDelaySeconds, maxDelaySeconds, startAtMs } = opts
  const rng = opts.rng ?? Math.random
  if (instances.length === 0) return []
  const min = Math.min(minDelaySeconds, maxDelaySeconds)
  const max = Math.max(minDelaySeconds, maxDelaySeconds)
  // estado por instância: cursor de tempo + timestamps da janela de 1h
  const state = instances.map((i) => ({ inst: i, cursor: startAtMs, window: [] as number[] }))
  const out: Sched[] = []
  for (let n = 0; n < count; n++) {
    const st = state[n % state.length]
    const delayMs = Math.round((min + rng() * (max - min)) * 1000)
    let sendAt = st.cursor + delayMs
    // limpa janela: mantém só envios na última 1h relativa a sendAt
    st.window = st.window.filter((t) => t > sendAt - 3_600_000)
    if (st.window.length >= st.inst.hourlyLimit) {
      // empurra p/ 1h após o envio mais antigo da janela + 1ms
      sendAt = st.window[0] + 3_600_000 + 1
      st.window = st.window.filter((t) => t > sendAt - 3_600_000)
    }
    st.window.push(sendAt)
    st.cursor = sendAt
    out.push({ instanceId: st.inst.id, sendAt })
  }
  return out
}
