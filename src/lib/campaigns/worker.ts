import { createServiceClient } from '@/lib/supabase/service'
import { createGateway } from '@/lib/wa/factory'
import type { InstanceRow } from '@/lib/wa/types'

const INST_COLS = 'id,organization_id,provider,name,status,phone_number,evolution_instance_name,meta_phone_number_id,meta_waba_id,hourly_limit,daily_limit,warmup_level'
const TICK_LIMIT = 50

export async function runDispatchTick(): Promise<{ sent: number; failed: number }> {
  const svc = createServiceClient()
  const nowIso = new Date().toISOString()
  // campanhas em execução
  const { data: running } = await svc.from('campaigns').select('id').eq('status', 'running')
  const ids = (running ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return { sent: 0, failed: 0 }

  // seleciona vencidas
  const { data: due } = await svc.from('campaign_messages')
    .select('id,instance_id,phone,rendered_text')
    .in('campaign_id', ids).eq('status', 'pending').lte('send_at', nowIso)
    .order('send_at', { ascending: true }).limit(TICK_LIMIT)
  if (!due || due.length === 0) { await markCompleted(svc, ids); return { sent: 0, failed: 0 } }

  let sent = 0, failed = 0
  const gwCache = new Map<string, Awaited<ReturnType<typeof createGateway>>>()
  for (const m of due as { id: string; instance_id: string; phone: string; rendered_text: string }[]) {
    // claim atômico: só processa se ainda estava pending
    const { data: claimed } = await svc.from('campaign_messages')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', m.id).eq('status', 'pending').select('id')
    if (!claimed || claimed.length === 0) continue
    try {
      let gw = gwCache.get(m.instance_id)
      if (!gw) {
        const { data: inst } = await svc.from('whatsapp_instances').select(INST_COLS).eq('id', m.instance_id).maybeSingle()
        if (!inst) throw new Error('instância não encontrada')
        gw = await createGateway(inst as unknown as InstanceRow)
        gwCache.set(m.instance_id, gw)
      }
      const res = await gw.sendText(m.phone, m.rendered_text)
      await svc.from('campaign_messages').update({
        status: 'sent', provider_message_id: res.providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', m.id)
      sent++
    } catch (e) {
      await svc.from('campaign_messages').update({
        status: 'failed', error: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString(),
      }).eq('id', m.id)
      failed++
    }
  }
  await markCompleted(svc, ids)
  return { sent, failed }
}

async function markCompleted(svc: ReturnType<typeof createServiceClient>, ids: string[]) {
  for (const id of ids) {
    const { count } = await svc.from('campaign_messages')
      .select('id', { count: 'exact', head: true }).eq('campaign_id', id).in('status', ['pending', 'sending'])
    if ((count ?? 0) === 0) await svc.from('campaigns').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', id)
  }
}
