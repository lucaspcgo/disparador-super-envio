'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrg } from '@/lib/org/current'
import { parseContactsCsv } from './csv'

type Result = { ok: true; imported?: number; skipped?: number } | { ok: false; error: string }

export async function importContacts(formData: FormData): Promise<Result> {
  try {
    const org = await getCurrentOrg()
    if (!org) return { ok: false, error: 'sem organização' }
    const text = String(formData.get('file') ?? '')
    if (!text.trim()) return { ok: false, error: 'CSV vazio' }
    const listName = String(formData.get('list_name') ?? '').trim()
    const { rows, errors } = parseContactsCsv(text)
    if (rows.length === 0) return { ok: false, error: errors[0] ?? 'Nenhum contato válido' }

    const s = await createClient()
    // upsert dedupe por (organization_id, phone)
    const payload = rows.map((r) => ({
      organization_id: org.id, phone: r.phone, name: r.name ?? null, custom_fields: r.custom,
    }))
    const { data: upserted, error } = await s.from('contacts')
      .upsert(payload, { onConflict: 'organization_id,phone' }).select('id')
    if (error) return { ok: false, error: error.message }

    if (listName && upserted) {
      const { data: list } = await s.from('contact_lists')
        .insert({ organization_id: org.id, name: listName }).select('id').single()
      if (list) {
        await s.from('contact_list_members')
          .upsert(upserted.map((c) => ({ list_id: list.id, contact_id: c.id })), { onConflict: 'list_id,contact_id' })
      }
    }
    revalidatePath('/app/contatos')
    return { ok: true, imported: upserted?.length ?? 0, skipped: errors.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function createList(formData: FormData): Promise<Result> {
  try {
    const org = await getCurrentOrg()
    if (!org) return { ok: false, error: 'sem organização' }
    const name = String(formData.get('name') ?? '').trim()
    if (!name) return { ok: false, error: 'nome obrigatório' }
    const s = await createClient()
    const { error } = await s.from('contact_lists').insert({ organization_id: org.id, name })
    if (error) return { ok: false, error: error.message }
    revalidatePath('/app/contatos')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteContact(id: string): Promise<Result> {
  const s = await createClient()
  const { error } = await s.from('contacts').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/contatos')
  return { ok: true }
}
export async function deleteList(id: string): Promise<Result> {
  const s = await createClient()
  const { error } = await s.from('contact_lists').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/contatos')
  return { ok: true }
}
