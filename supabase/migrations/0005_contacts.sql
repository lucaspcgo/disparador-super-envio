-- Fase 2: contatos e listas.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  name text,
  custom_fields jsonb not null default '{}',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone)
);
create index on public.contacts (organization_id);

create table public.contact_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index on public.contact_lists (organization_id);

create table public.contact_list_members (
  list_id uuid not null references public.contact_lists(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, contact_id)
);

alter table public.contacts enable row level security;
alter table public.contact_lists enable row level security;
alter table public.contact_list_members enable row level security;

create policy "contacts_member_all" on public.contacts
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "lists_member_all" on public.contact_lists
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
-- membros: acesso via a lista (que é da org)
create policy "list_members_member_all" on public.contact_list_members
  for all using (exists (select 1 from public.contact_lists l where l.id = list_id and public.is_org_member(l.organization_id)))
  with check (exists (select 1 from public.contact_lists l where l.id = list_id and public.is_org_member(l.organization_id)));
