-- Correções pós-review da Fase 1 (Task 1).

-- 1) [CRÍTICO] RLS quebrada: is_org_member tinha EXECUTE revogado de authenticated (0001),
--    então policies que a chamam falham com "permission denied for function" no papel
--    authenticated via PostgREST. Concede EXECUTE (a função só retorna boolean de membership).
grant execute on function public.is_org_member(uuid) to authenticated;

-- 2) [SEGURANÇA/HIGH] policy de UPDATE direto sem WITH CHECK permitia mover a instância de org
--    (organization_id), repontar vault_secret_id e inflar limites. Nenhuma escrita usa .update()
--    direto (tudo via RPC SECURITY DEFINER), então removemos a policy — mutações só via RPC.
drop policy if exists "wa_member_update" on public.whatsapp_instances;

-- 3) [IMPORTANTE] TOCTOU no enforce de limite: trava a linha da org antes de contar/inserir,
--    serializando chamadas concorrentes da mesma org.
create or replace function public.create_instance_credential(
  p_org uuid, p_provider public.wa_provider, p_name text, p_config jsonb, p_secret jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_secret_id uuid;
  v_id uuid;
  v_count int;
  v_limit int;
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of organization';
  end if;
  -- trava a org para serializar o enforce de limite (evita corrida que ultrapassa o teto)
  select instance_limit into v_limit from public.organizations where id = p_org for update;
  select count(*) into v_count from public.whatsapp_instances where organization_id = p_org;
  if v_count >= v_limit then
    raise exception 'instance limit reached (% of %)', v_count, v_limit
      using errcode = 'P0001';
  end if;
  v_secret_id := vault.create_secret(
    p_secret::text, 'wa_' || gen_random_uuid()::text, 'Super Envio WA credential');
  insert into public.whatsapp_instances (
    organization_id, provider, name, status,
    evolution_instance_name, meta_phone_number_id, meta_waba_id, vault_secret_id)
  values (
    p_org, p_provider, p_name, 'connecting',
    p_config->>'evolution_instance_name',
    p_config->>'meta_phone_number_id',
    p_config->>'meta_waba_id',
    v_secret_id)
  returning id into v_id;
  return v_id;
end; $$;

revoke execute on function public.create_instance_credential(uuid, public.wa_provider, text, jsonb, jsonb) from public, anon;
grant  execute on function public.create_instance_credential(uuid, public.wa_provider, text, jsonb, jsonb) to authenticated;

-- 4) [MINOR] documenta responsabilidade de org-scoping no app (a função decripta por UUID sem checar org).
comment on function public.get_instance_credential(uuid) is
  'SERVICE_ROLE ONLY. Descriptografa a credencial da instancia por UUID sem checar org — o chamador (server action) DEVE validar a membership/org antes (via select RLS em whatsapp_instances).';
