import { describe, it, expect } from 'vitest'
import { createGateway } from './factory'
import { EvolutionGateway } from './evolution'
import { MetaCloudGateway } from './meta'
import type { InstanceRow } from './types'

const base: InstanceRow = {
  id: 'i1', organization_id: 'o1', provider: 'evolution_byo', name: 'x',
  status: 'connected', phone_number: null, evolution_instance_name: 'inst1',
  meta_phone_number_id: null, meta_waba_id: null,
  hourly_limit: 20, daily_limit: 200, warmup_level: 0,
}

describe('createGateway', () => {
  it('evolution_byo → EvolutionGateway', async () => {
    const gw = await createGateway(base, async () => ({ baseUrl: 'https://ev', apiKey: 'K' }))
    expect(gw).toBeInstanceOf(EvolutionGateway)
    expect(gw.provider).toBe('evolution_byo')
  })

  it('evolution_managed → EvolutionGateway com provider correto', async () => {
    const gw = await createGateway(
      { ...base, provider: 'evolution_managed' },
      async () => ({ baseUrl: 'https://ev', apiKey: 'K' }),
    )
    expect(gw).toBeInstanceOf(EvolutionGateway)
    expect(gw.provider).toBe('evolution_managed')
  })

  it('meta_cloud → MetaCloudGateway', async () => {
    const gw = await createGateway(
      { ...base, provider: 'meta_cloud', meta_phone_number_id: 'PNID' },
      async () => ({ accessToken: 'TOK' }),
    )
    expect(gw).toBeInstanceOf(MetaCloudGateway)
    expect(gw.provider).toBe('meta_cloud')
  })
})
