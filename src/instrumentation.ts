export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Evita múltiplos intervalos em HMR/dev.
  const g = globalThis as unknown as { __superEnvioWorker?: boolean }
  if (g.__superEnvioWorker) return
  g.__superEnvioWorker = true
  const { runDispatchTick } = await import('@/lib/campaigns/worker')
  const tick = async () => {
    try { await runDispatchTick() } catch (e) { console.error('[worker] tick erro:', e) }
  }
  setInterval(tick, 30_000)
  console.log('[worker] disparo in-process ativo (30s)')
}
