import { createClient } from '@/lib/supabase/server'
import type { InstanceRow } from '@/lib/wa/types'

const COLS =
  'id,organization_id,provider,name,status,phone_number,evolution_instance_name,meta_phone_number_id,meta_waba_id,hourly_limit,daily_limit,warmup_level'

export async function listInstances(): Promise<InstanceRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('whatsapp_instances')
    .select(COLS)
    .order('created_at', { ascending: true })
  return (data ?? []) as InstanceRow[]
}

export async function getInstance(id: string): Promise<InstanceRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('whatsapp_instances').select(COLS).eq('id', id).maybeSingle()
  return (data as InstanceRow | null) ?? null
}
