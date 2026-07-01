import { createClient } from '@/lib/supabase/server'

export type ContactRow = { id: string; phone: string; name: string | null; tags: string[]; created_at: string }
export type ListRow = { id: string; name: string; created_at: string }

export async function listContacts(): Promise<ContactRow[]> {
  const s = await createClient()
  const { data } = await s.from('contacts')
    .select('id,phone,name,tags,created_at').order('created_at', { ascending: false }).limit(1000)
  return (data ?? []) as ContactRow[]
}
export async function listLists(): Promise<ListRow[]> {
  const s = await createClient()
  const { data } = await s.from('contact_lists')
    .select('id,name,created_at').order('created_at', { ascending: false })
  return (data ?? []) as ListRow[]
}
