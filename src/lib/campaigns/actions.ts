'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentOrg } from '@/lib/org/current'
import { renderMessage } from './render'
import { scheduleMessages, type SchedInstance } from './schedule'

type R = { ok: true; id?: string; count?: number } | { ok: false; error: string }
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function createCampaign(formData: FormData): Promise<R> {
  try {
    const org = await getCurrentOrg(); if (!org) return { ok: false, error: 'sem organização' }
    const name = String(formData.get('name') ?? '').trim() || 'Campanha'
    const message_template = String(formData.get('message_template') ?? '')
    const list_id = String(formData.get('list_id') ?? '') || null
    const instance_ids = formData.getAll('instance_ids').map(String)
    const min = Number(formData.get('min_delay_seconds') ?? 30)
    const max = Number(formData.get('max_delay_seconds') ?? 90)
    const s = await createClient()
    const { data, error } = await s.from('campaigns').insert({
      organization_id: org.id, name, message_template, list_id,
      instance_ids, min_delay_seconds: min, max_delay_seconds: max, status: 'draft',
    }).select('id').single()
    if (error) return { ok: false, error: error.message }
    revalidatePath('/app/campanhas')
    return { ok: true, id: data.id }
  } catch (e) { return { ok: false, error: msg(e) } }
}

export async function startCampaign(id: string): Promise<R> {
  try {
    const org = await getCurrentOrg(); if (!org) return { ok: false, error: 'sem organização' }
    const s = await createClient()
    const { data: c } = await s.from('campaigns').select('*').eq('id', id).maybeSingle()
    if (!c) return { ok: false, error: 'campanha não encontrada' }
    if (!c.list_id) return { ok: false, error: 'selecione uma lista' }
    if (!c.instance_ids?.length) return { ok: false, error: 'selecione ao menos uma instância' }

    // membros da lista + contatos
    const { data: members } = await s.from('contact_list_members')
      .select('contact:contacts(id,phone,name,custom_fields)').eq('list_id', c.list_id)
    const contacts = (members ?? []).map((m: { contact: unknown }) => m.contact as { id: string; phone: string; name: string | null; custom_fields: Record<string, string> }).filter(Boolean)
    if (contacts.length === 0) return { ok: false, error: 'lista vazia' }

    // limites por instância
    const { data: insts } = await s.from('whatsapp_instances')
      .select('id,hourly_limit').in('id', c.instance_ids)
    const schedInsts: SchedInstance[] = (insts ?? []).map((i: { id: string; hourly_limit: number }) => ({ id: i.id, hourlyLimit: i.hourly_limit }))
    if (schedInsts.length === 0) return { ok: false, error: 'instâncias inválidas' }

    const sched = scheduleMessages({
      count: contacts.length, instances: schedInsts,
      minDelaySeconds: c.min_delay_seconds, maxDelaySeconds: c.max_delay_seconds,
      startAtMs: Date.now(),
    })
    const rows = contacts.map((ct, i) => ({
      organization_id: org.id, campaign_id: id, contact_id: ct.id,
      instance_id: sched[i].instanceId, phone: ct.phone,
      rendered_text: renderMessage(c.message_template, { nome: ct.name ?? '', ...(ct.custom_fields ?? {}) }),
      send_at: new Date(sched[i].sendAt).toISOString(), status: 'pending' as const,
    }))
    // escrita pesada via service-role
    const svc = createServiceClient()
    // insere em lotes de 500
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await svc.from('campaign_messages').insert(rows.slice(i, i + 500))
      if (error) return { ok: false, error: error.message }
    }
    await s.from('campaigns').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', id)
    revalidatePath('/app/campanhas')
    return { ok: true, count: rows.length }
  } catch (e) { return { ok: false, error: msg(e) } }
}

async function setStatus(id: string, status: string): Promise<R> {
  const s = await createClient()
  const { error } = await s.from('campaigns').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/campanhas'); return { ok: true }
}
export async function pauseCampaign(id: string): Promise<R> { return setStatus(id, 'paused') }
export async function resumeCampaign(id: string): Promise<R> { return setStatus(id, 'running') }
export async function cancelCampaign(id: string): Promise<R> {
  // Checa membership via RLS ANTES do update com service-role (que bypassa RLS).
  const org = await getCurrentOrg(); if (!org) return { ok: false, error: 'sem organização' }
  const s = await createClient()
  const { data: c } = await s.from('campaigns').select('id').eq('id', id).maybeSingle()
  if (!c) return { ok: false, error: 'campanha não encontrada' }
  const svc = createServiceClient()
  await svc.from('campaign_messages').update({ status: 'failed', error: 'cancelada' })
    .eq('campaign_id', id).eq('organization_id', org.id).eq('status', 'pending')
  return setStatus(id, 'canceled')
}
export async function deleteCampaign(id: string): Promise<R> {
  const s = await createClient()
  const { error } = await s.from('campaigns').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/campanhas'); return { ok: true }
}
