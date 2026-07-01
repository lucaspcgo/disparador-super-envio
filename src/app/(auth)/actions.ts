'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { slugify } from '@/lib/org/slug'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const email = String(formData.get('email'))
  const password = String(formData.get('password'))
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect('/login?error=' + encodeURIComponent(error.message))
  revalidatePath('/', 'layout')
  redirect('/app')
}

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const email = String(formData.get('email'))
  const password = String(formData.get('password'))
  const fullName = String(formData.get('full_name') ?? '')
  const orgName = String(formData.get('org_name') ?? '').trim() || 'Minha Empresa'

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error || !data.user) {
    redirect('/signup?error=' + encodeURIComponent(error?.message ?? 'Falha no cadastro'))
  }

  // Sem sessão = confirmação de e-mail ativa; provisiona a org após confirmar/login.
  if (!data.session) {
    redirect('/login?message=' + encodeURIComponent('Confirme seu e-mail para entrar.'))
  }

  // Bootstrap da organização via RPC controlada (não há insert direto por RLS).
  const slug = (slugify(orgName) || 'org') + '-' + data.user.id.slice(0, 8)
  const { error: rpcError } = await supabase.rpc('create_organization', {
    org_name: orgName,
    org_slug: slug,
  })
  if (rpcError) {
    redirect('/signup?error=' + encodeURIComponent(rpcError.message))
  }

  revalidatePath('/', 'layout')
  redirect('/app')
}
