-- Fase 0: Fundação multi-tenant (organizations / profiles / memberships) + RLS
-- Aplicada no projeto Supabase zolkdsjjrmpsslftfbjw via MCP apply_migration.

create type public.member_role as enum ('owner','admin','member');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on public.memberships (user_id);
create index on public.memberships (organization_id);

-- Helper: usuário é membro da org? (SECURITY DEFINER evita recursão de RLS)
create or replace function public.is_org_member(org uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

-- Trigger: cria profile ao criar usuário
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;

create policy "profiles_self_select" on public.profiles for select using (id = auth.uid());
create policy "profiles_self_update" on public.profiles for update using (id = auth.uid());

create policy "orgs_member_select" on public.organizations for select using (public.is_org_member(id));
create policy "orgs_insert_auth" on public.organizations for insert with check (auth.uid() = created_by);
create policy "orgs_owner_update" on public.organizations for update using (
  exists (select 1 from public.memberships m
          where m.organization_id = id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

create policy "memberships_member_select" on public.memberships for select using (public.is_org_member(organization_id));
create policy "memberships_self_insert" on public.memberships for insert with check (user_id = auth.uid());

-- Hardening: funções SECURITY DEFINER não devem ser chamáveis via RPC.
-- (o trigger e a avaliação de RLS não dependem desses grants)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_org_member(uuid) from public, anon, authenticated;
