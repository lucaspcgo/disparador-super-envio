'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrg } from '@/lib/org/current'
import { getInstance } from './queries'
import { genManagedInstanceName } from './naming'
import { createGateway } from '@/lib/wa/factory'
import {
  EvolutionClient, EvolutionGateway, provisionManagedInstance, deleteManagedInstance,
} from '@/lib/wa/evolution'
import { MetaCloudGateway } from '@/lib/wa/meta'
import type { ConnState } from '@/lib/wa/types'

type Result = { ok: true; instanceId?: string; state?: ConnState } | { ok: false; error: string }

async function requireOrg() {
  const org = await getCurrentOrg()
  if (!org) throw new Error('sem organização')
  return org
}

async function createCredential(
  orgId: string, provider: string, name: string, config: object, secret: object,
): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_instance_credential', {
    p_org: orgId, p_provider: provider, p_name: name, p_config: config, p_secret: secret,
  })
  if (error) throw new Error(error.message)
  return data as string
}

// --- Evolution BYO: valida creds do cliente ANTES de persistir ---
export async function connectByo(formData: FormData): Promise<Result> {
  try {
    const org = await requireOrg()
    const name = String(formData.get('name') ?? 'Instância')
    const baseUrl = String(formData.get('baseUrl')).replace(/\/+$/, '')
    const apiKey = String(formData.get('apiKey'))
    const instanceName = String(formData.get('instanceName'))
    const probe = new EvolutionGateway(new EvolutionClient(baseUrl, apiKey), instanceName, 'evolution_byo')
    const state = await probe.ensureConnection() // lança se creds inválidas
    const id = await createCredential(
      org.id, 'evolution_byo', name, { evolution_instance_name: instanceName }, { baseUrl, apiKey })
    await setState(id, state)
    revalidatePath('/app/instancias')
    return { ok: true, instanceId: id, state }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// --- Evolution gerenciada: nós provisionamos ---
export async function connectManaged(formData: FormData): Promise<Result> {
  try {
    const org = await requireOrg()
    const name = String(formData.get('name') ?? 'Instância')
    const instanceName = genManagedInstanceName(org.id)
    const { apiKey, qr } = await provisionManagedInstance(instanceName)
    const baseUrl = process.env.EVOLUTION_MANAGED_URL!.replace(/\/+$/, '')
    const id = await createCredential(
      org.id, 'evolution_managed', name, { evolution_instance_name: instanceName }, { baseUrl, apiKey })
    revalidatePath('/app/instancias')
    return { ok: true, instanceId: id, state: { status: 'connecting', qr } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// --- Meta Cloud API ---
export async function connectMeta(formData: FormData): Promise<Result> {
  try {
    const org = await requireOrg()
    const name = String(formData.get('name') ?? 'Instância')
    const phoneNumberId = String(formData.get('phoneNumberId'))
    const wabaId = String(formData.get('wabaId'))
    const accessToken = String(formData.get('accessToken'))
    const probe = new MetaCloudGateway(phoneNumberId, accessToken)
    const state = await probe.getConnectionState()
    if (state.status !== 'connected') return { ok: false, error: 'Token/número Meta inválido' }
    const id = await createCredential(
      org.id, 'meta_cloud', name,
      { meta_phone_number_id: phoneNumberId, meta_waba_id: wabaId }, { accessToken })
    await setState(id, state)
    revalidatePath('/app/instancias')
    return { ok: true, instanceId: id, state }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function setState(instanceId: string, state: ConnState) {
  const supabase = await createClient()
  await supabase.rpc('set_instance_state', {
    p_instance: instanceId, p_status: state.status, p_phone: state.phoneNumber ?? null,
  })
}

// Polling do QR/estado (chamado pela UI). Verifica membership via getInstance (RLS).
export async function refreshState(instanceId: string): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    const gw = await createGateway(row)
    const state = await gw.getConnectionState()
    await setState(instanceId, state)
    revalidatePath('/app/instancias')
    return { ok: true, state }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function disconnectInstance(instanceId: string): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    const gw = await createGateway(row)
    await gw.disconnect()
    await setState(instanceId, { status: 'disconnected' })
    revalidatePath('/app/instancias')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deleteInstanceAction(instanceId: string): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    if (row.provider === 'evolution_managed' && row.evolution_instance_name) {
      await deleteManagedInstance(row.evolution_instance_name).catch(() => null)
    }
    const supabase = await createClient()
    const { error } = await supabase.rpc('delete_instance', { p_instance: instanceId })
    if (error) throw new Error(error.message)
    revalidatePath('/app/instancias')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Mensagem de teste — prova a cadeia gateway→provedor ponta-a-ponta.
export async function sendTest(
  instanceId: string, to: string, text: string, templateName?: string, vars: string[] = [],
): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    const gw = await createGateway(row)
    if (row.provider === 'meta_cloud') {
      if (!templateName) return { ok: false, error: 'Meta exige nome de template' }
      await gw.sendTemplate(to, templateName, vars)
    } else {
      await gw.sendText(to, text)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
