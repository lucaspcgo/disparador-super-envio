import type { Credential, InstanceRow, WhatsAppGateway } from './types'
import { EvolutionClient, EvolutionGateway } from './evolution'
import { MetaCloudGateway } from './meta'
import { createServiceClient } from '@/lib/supabase/service'
import { assertPublicHttpUrl } from './ssrf'

export type CredentialLoader = (instanceId: string) => Promise<Credential>

export async function loadCredentialViaRpc(instanceId: string): Promise<Credential> {
  const svc = createServiceClient()
  const { data, error } = await svc.rpc('get_instance_credential', { p_instance: instanceId })
  if (error || !data) throw new Error(error?.message ?? 'Credencial não encontrada')
  return data as Credential
}

export async function createGateway(
  row: InstanceRow,
  load: CredentialLoader = loadCredentialViaRpc,
): Promise<WhatsAppGateway> {
  const cred = await load(row.id)
  switch (row.provider) {
    case 'evolution_byo':
    case 'evolution_managed': {
      const c = cred as { baseUrl: string; apiKey: string }
      if (row.provider === 'evolution_byo') {
        // Re-valida o host BYO a cada uso (mitiga DNS-rebinding após a criação).
        await assertPublicHttpUrl(c.baseUrl)
      }
      return new EvolutionGateway(
        new EvolutionClient(c.baseUrl, c.apiKey),
        row.evolution_instance_name ?? '',
        row.provider,
      )
    }
    case 'meta_cloud': {
      const c = cred as { accessToken: string }
      return new MetaCloudGateway(row.meta_phone_number_id ?? '', c.accessToken)
    }
  }
}
