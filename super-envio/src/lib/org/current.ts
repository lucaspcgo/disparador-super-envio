import { createClient } from '@/lib/supabase/server'

// Retorna a organização "atual" do usuário (a primeira/mais antiga membership) ou null.
export async function getCurrentOrg() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('memberships')
    .select('role, organization:organizations(id, name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data?.organization) return null
  const org = data.organization as unknown as { id: string; name: string }
  return { id: org.id, name: org.name, role: data.role as string }
}
