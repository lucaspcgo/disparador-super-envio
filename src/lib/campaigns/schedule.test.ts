import { describe, it, expect } from 'vitest'
import { scheduleMessages } from './schedule'

const T0 = 1_700_000_000_000 // epoch ms fixo

describe('scheduleMessages', () => {
  it('rotaciona round-robin entre instâncias', () => {
    const r = scheduleMessages({ count: 4, instances: [{ id: 'a', hourlyLimit: 100 }, { id: 'b', hourlyLimit: 100 }], minDelaySeconds: 10, maxDelaySeconds: 10, startAtMs: T0, rng: () => 0 })
    expect(r.map((x) => x.instanceId)).toEqual(['a', 'b', 'a', 'b'])
  })
  it('acumula delay por instância (rng=0 → min)', () => {
    const r = scheduleMessages({ count: 2, instances: [{ id: 'a', hourlyLimit: 100 }], minDelaySeconds: 10, maxDelaySeconds: 10, startAtMs: T0, rng: () => 0 })
    expect(r[0].sendAt).toBe(T0 + 10_000)
    expect(r[1].sendAt).toBe(T0 + 20_000)
  })
  it('respeita hourlyLimit empurrando p/ próxima janela', () => {
    const r = scheduleMessages({ count: 3, instances: [{ id: 'a', hourlyLimit: 2 }], minDelaySeconds: 10, maxDelaySeconds: 10, startAtMs: T0, rng: () => 0 })
    // 3ª msg da instância 'a' ultrapassa o teto de 2/h → vai p/ depois de 1h do 1º envio
    expect(r[2].sendAt).toBeGreaterThanOrEqual(r[0].sendAt + 3_600_000)
  })
})
