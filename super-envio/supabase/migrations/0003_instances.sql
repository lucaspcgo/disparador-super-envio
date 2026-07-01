-- Fase 1: instâncias de WhatsApp + credenciais no Vault + enforcement de limite.

create type public.wa_provider as enum ('evolution_byo','evolution_managed','meta_cloud');
create type public.wa_conn_status as enum ('connecting','connected','disconnected');

alter table public.organizations
  add column if not exists instance_limit int not null default 1;

create table public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.wa_provider not null,
  name text not null,
  status public.wa_conn_status not null default 'connecting',
  phone_number text,
  evolution_instance_name text,
  meta_phone_number_id text,
  meta_waba_id text,
  vault_secret_id uuid,
  hourly_limit int not null default 20,
  daily_limit int not null default 200,
  warmup_level int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.whatsapp_instances (organization_id);

alter table public.whatsapp_instances enable row level security;

-- Membros da org leem e atualizam (edição de rótulo/estado); insert e delete só via RPC.
create policy "wa_member_select" on public.whatsapp_instances
  for select using (public.is_org_member(organization_id));
create policy "wa_member_update" on public.whatsapp_instances
  for update using (public.is_org_member(organization_id));

-- Cria credencial cifrada no Vault + a linha da instância, com enforce de limite.
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
  select count(*) into v_count from public.whatsapp_instances where organization_id = p_org;
  select instance_limit into v_limit from public.organizations where id = p_org;
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

-- Leitura descriptografada: SOMENTE service_role (server-side). Nunca exposta ao cliente.
create or replace function public.get_instance_credential(p_instance uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select vault_secret_id into v_secret_id
    from public.whatsapp_instances where id = p_instance;
  if v_secret_id is null then
    return null;
  end if;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where id = v_secret_id;
  return v_secret::jsonb;
end; $$;

-- Atualiza estado/telefone após conexão (membro da org).
create or replace function public.set_instance_state(
  p_instance uuid, p_status public.wa_conn_status, p_phone text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.whatsapp_instances i
     set status = p_status,
         phone_number = coalesce(p_phone, i.phone_number),
         updated_at = now()
   where i.id = p_instance and public.is_org_member(i.organization_id);
  if not found then
    raise exception 'instance not found or not a member';
  end if;
end; $$;

-- Remove a linha + o segredo do Vault (membro da org).
create or replace function public.delete_instance(p_instance uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_secret_id uuid;
  v_org uuid;
begin
  select vault_secret_id, organization_id into v_secret_id, v_org
    from public.whatsapp_instances where id = p_instance;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'instance not found or not a member';
  end if;
  delete from public.whatsapp_instances where id = p_instance;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end; $$;

-- Grants: leitura de credencial é exclusiva de service_role.
revoke execute on function public.create_instance_credential(uuid, public.wa_provider, text, jsonb, jsonb) from public, anon;
grant  execute on function public.create_instance_credential(uuid, public.wa_provider, text, jsonb, jsonb) to authenticated;

revoke execute on function public.get_instance_credential(uuid) from public, anon, authenticated;
grant  execute on function public.get_instance_credential(uuid) to service_role;

revoke execute on function public.set_instance_state(uuid, public.wa_conn_status, text) from public, anon;
grant  execute on function public.set_instance_state(uuid, public.wa_conn_status, text) to authenticated;

revoke execute on function public.delete_instance(uuid) from public, anon;
grant  execute on function public.delete_instance(uuid) to authenticated;
