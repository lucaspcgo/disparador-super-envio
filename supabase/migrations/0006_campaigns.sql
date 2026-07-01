create type public.campaign_status as enum ('draft','scheduled','running','paused','completed','canceled');
create type public.message_status as enum ('pending','sending','sent','delivered','read','failed');

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status public.campaign_status not null default 'draft',
  message_template text not null default '',
  list_id uuid references public.contact_lists(id) on delete set null,
  instance_ids uuid[] not null default '{}',
  min_delay_seconds int not null default 30,
  max_delay_seconds int not null default 90,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.campaigns (organization_id);

create table public.campaign_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  instance_id uuid references public.whatsapp_instances(id) on delete set null,
  phone text not null,
  rendered_text text not null,
  send_at timestamptz not null,
  status public.message_status not null default 'pending',
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index on public.campaign_messages (organization_id);
create index on public.campaign_messages (campaign_id);
create index on public.campaign_messages (status, send_at);

alter table public.campaigns enable row level security;
alter table public.campaign_messages enable row level security;

-- Campanhas: membros CRUD. Mensagens: membros só LEEM (escrita via service-role no server/worker).
create policy "campaigns_member_all" on public.campaigns
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "cmsg_member_select" on public.campaign_messages
  for select using (public.is_org_member(organization_id));
