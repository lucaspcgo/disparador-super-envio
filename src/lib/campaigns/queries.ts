import { createClient } from '@/lib/supabase/server'

export type CampaignRow = { id: string; name: string; status: string; created_at: string; list_id: string | null }
export async function listCampaigns(): Promise<CampaignRow[]> {
  const s = await createClient()
  const { data } = await s.from('campaigns').select('id,name,status,created_at,list_id').order('created_at', { ascending: false })
  return (data ?? []) as CampaignRow[]
}
export async function getCampaign(id: string) {
  const s = await createClient()
  const { data: c } = await s.from('campaigns').select('*').eq('id', id).maybeSingle()
  if (!c) return null
  const { data: msgs } = await s.from('campaign_messages').select('status').eq('campaign_id', id)
  const counts: Record<string, number> = {}
  for (const m of msgs ?? []) counts[(m as { status: string }).status] = (counts[(m as { status: string }).status] ?? 0) + 1
  return { campaign: c, counts, total: (msgs ?? []).length }
}
export async function listConnectedInstances() {
  const s = await createClient()
  const { data } = await s.from('whatsapp_instances').select('id,name,provider,status,hourly_limit').order('created_at')
  return data ?? []
}
export async function listListsForSelect() {
  const s = await createClient()
  const { data } = await s.from('contact_lists').select('id,name').order('created_at', { ascending: false })
  return data ?? []
}
