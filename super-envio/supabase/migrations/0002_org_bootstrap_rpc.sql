-- Correção de segurança (multi-tenant boundary): a policy "memberships_self_insert"
-- permitia que qualquer autenticado se inserisse em QUALQUER organização.
-- Removemos os inserts diretos e criamos uma RPC controlada para o bootstrap.

drop policy if exists "memberships_self_insert" on public.memberships;
drop policy if exists "orgs_insert_auth" on public.organizations;

-- Bootstrap atômico: cria a organização e a membership de owner do próprio usuário.
create or replace function public.create_organization(org_name text, org_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.organizations (name, slug, created_by)
  values (org_name, org_slug, uid)
  returning id into new_org_id;

  insert into public.memberships (organization_id, user_id, role)
  values (new_org_id, uid, 'owner');

  return new_org_id;
end; $$;

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
