# Super Envio — Fase 1: Instâncias + `WhatsAppGateway` — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a gestão de instâncias de WhatsApp (uma instância = uma conexão de número) e a abstração `WhatsAppGateway` para os três provedores (Evolution BYO, Evolution gerenciada, Meta Cloud API), com credenciais cifradas no Supabase Vault e enforcement de limite por organização.

**Architecture:** Uma interface `WhatsAppGateway` isola o resto do sistema das APIs dos provedores. Gateways são TS puros (testados com `fetch` mockado). As credenciais ficam cifradas no Vault; a **escrita** é via RPC `SECURITY DEFINER` chamável por `authenticated` (criar segredo não vaza nada), e a **leitura descriptografada** é restrita a `service_role`, usada só server-side no Next. Server actions orquestram gateway + RPCs; a UI (`/app/instancias`) lista/conecta/gerencia instâncias e faz polling de QR.

**Tech Stack:** Next.js 16.2.9 (App Router, `src/`, `proxy.ts`), React 19, TypeScript, `@supabase/ssr` + `@supabase/supabase-js`, Vitest, Postgres/Supabase (Vault, RLS), Evolution API v2, Meta Graph API v21.0.

## Global Constraints

- Produto: **Super Envio**. UI em **pt-BR**. Diretório do app: `super-envio/`.
- Projeto Supabase: ref `<SEU_PROJETO_REF>`, URL `https://<SEU_PROJETO_REF>.supabase.co`, sa-east-1.
- Migrations aplicadas via MCP `apply_migration` (Docker/CLI local indisponíveis); salvar cópia versionada em `super-envio/supabase/migrations/`. Próximo número: **0003**.
- **Next.js 16 é breaking vs. treino:** ler `node_modules/next/dist/docs/` antes de codar (AGENTS.md). `cookies()` é async; "middleware" é `proxy` (arquivo `src/proxy.ts`). Server-only: nunca prefixar segredo com `NEXT_PUBLIC_`.
- Toda tabela de domínio tem `organization_id` + RLS. Enforcement no servidor, nunca só no cliente.
- **Segredos de provedor nunca voltam ao cliente.** Leitura descriptografada só via `service_role` server-side.
- TDD onde a lógica carrega valor (gateways, factory, mapeamentos). Commits frequentes. Testes **nunca** batem em WhatsApp real (`fetch` mockado).
- Helper existente da Fase 0: `getCurrentOrg()` em `@/lib/org/current` → `{ id, name, role } | null`. Client SSR: `createClient()` (async) em `@/lib/supabase/server`.

---

### Task 1: Migration 0003 — schema `whatsapp_instances` + Vault RPCs + limite

**Files:**
- Create: `super-envio/supabase/migrations/0003_instances.sql`
- Aplicar via MCP `apply_migration` (project_id `<SEU_PROJETO_REF>`, name `instances`).

**Interfaces:**
- Consumes: `public.is_org_member(uuid)` (Fase 0), extensão `supabase_vault` (instalada).
- Produces (para tasks seguintes):
  - Enums `public.wa_provider` = (`evolution_byo`,`evolution_managed`,`meta_cloud`);
    `public.wa_conn_status` = (`connecting`,`connected`,`disconnected`).
  - Tabela `public.whatsapp_instances` (colunas conforme spec §3).
  - Coluna `public.organizations.instance_limit int not null default 1`.
  - RPC `public.create_instance_credential(p_org uuid, p_provider public.wa_provider, p_name text, p_config jsonb, p_secret jsonb) returns uuid` (authenticated).
  - RPC `public.get_instance_credential(p_instance uuid) returns jsonb` (**service_role only**).
  - RPC `public.set_instance_state(p_instance uuid, p_status public.wa_conn_status, p_phone text) returns void` (authenticated).
  - RPC `public.delete_instance(p_instance uuid) returns void` (authenticated).

- [ ] **Step 1: Escrever o SQL** — `super-envio/supabase/migrations/0003_instances.sql`

```sql
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
```

- [ ] **Step 2: Aplicar a migration**

Via MCP `apply_migration` — project_id `<SEU_PROJETO_REF>`, name `instances`, query = SQL do Step 1.

- [ ] **Step 3: Verificar estrutura**

- MCP `list_tables` (schema `public`) → `whatsapp_instances` presente com `rls_enabled: true`; `organizations` com coluna `instance_limit`.
- MCP `get_advisors` (type `security`) → sem novos erros críticos de RLS/`SECURITY DEFINER` (search_path fixo já mitiga).

- [ ] **Step 4: Verificar round-trip do Vault (sem auth)**

Via MCP `execute_sql` (roda como serviço; valida só o mecanismo do Vault, não a RPC autenticada):
```sql
select vault.create_secret('{"apiKey":"x"}','wa_test_0003','probe') as id \gset
select (decrypted_secret::jsonb)->>'apiKey' as k from vault.decrypted_secrets where name='wa_test_0003';
delete from vault.secrets where name='wa_test_0003';
```
Expected: `k = x`. (As RPCs autenticadas — membership/limite — são verificadas ponta-a-ponta na Task 8, com usuário logado real.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add super-envio/supabase/migrations/0003_instances.sql && \
  git commit -m "feat(db): whatsapp_instances + credenciais no Vault (RPCs) + instance_limit"
```

---

### Task 2: Contrato do gateway + gateway Evolution (BYO + gerenciada)

**Files:**
- Create: `super-envio/src/lib/wa/types.ts`
- Create: `super-envio/src/lib/wa/evolution.ts`
- Test: `super-envio/src/lib/wa/evolution.test.ts`

**Interfaces:**
- Consumes: nada (TS puro).
- Produces:
  - `types.ts`: `Provider`, `ConnState`, `WhatsAppGateway`, `InstanceRow`, `Credential` (union).
  - `evolution.ts`:
    - `class EvolutionClient(baseUrl: string, apiKey: string)` com `connectionState(i)`, `connect(i)`, `sendText(i, number, text)`, `logout(i)`, `createInstance(name)`, `deleteInstance(i)`.
    - `mapEvolutionState(state: string): ConnState['status']`.
    - `class EvolutionGateway implements WhatsAppGateway` (`new (client, instanceName, provider)`).
    - `provisionManagedInstance(instanceName): Promise<{ apiKey: string; qr?: string }>`.
    - `deleteManagedInstance(instanceName): Promise<void>`.

- [ ] **Step 1: Escrever `types.ts`**

```ts
export type Provider = 'evolution_byo' | 'evolution_managed' | 'meta_cloud'

export type ConnState = {
  status: 'connecting' | 'connected' | 'disconnected'
  qr?: string
  phoneNumber?: string
}

export interface WhatsAppGateway {
  readonly provider: Provider
  ensureConnection(): Promise<ConnState>
  getConnectionState(): Promise<ConnState>
  disconnect(): Promise<void>
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>
  sendTemplate(to: string, name: string, vars: string[]): Promise<{ providerMessageId: string }>
}

// Linha (não-secreta) de whatsapp_instances usada pela factory/UI.
export type InstanceRow = {
  id: string
  organization_id: string
  provider: Provider
  name: string
  status: ConnState['status']
  phone_number: string | null
  evolution_instance_name: string | null
  meta_phone_number_id: string | null
  meta_waba_id: string | null
  hourly_limit: number
  daily_limit: number
  warmup_level: number
}

// Segredo cifrado no Vault (formato por provedor).
export type Credential =
  | { baseUrl: string; apiKey: string }   // evolution_byo | evolution_managed
  | { accessToken: string }               // meta_cloud
```

- [ ] **Step 2: Teste que falha** — `super-envio/src/lib/wa/evolution.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EvolutionClient, EvolutionGateway, mapEvolutionState } from './evolution'

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const { status = 200, body } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  })
}

beforeEach(() => { vi.stubGlobal('fetch', mockFetch(() => ({ body: {} }))) })
afterEach(() => { vi.unstubAllGlobals() })

describe('mapEvolutionState', () => {
  it('mapeia estados da Evolution', () => {
    expect(mapEvolutionState('open')).toBe('connected')
    expect(mapEvolutionState('connecting')).toBe('connecting')
    expect(mapEvolutionState('close')).toBe('disconnected')
  })
})

describe('EvolutionClient', () => {
  it('envia apikey no header e faz GET no connectionState', async () => {
    const fetchMock = mockFetch((url) => {
      expect(url).toBe('https://ev.example.com/instance/connectionState/inst1')
      return { body: { instance: { instanceName: 'inst1', state: 'open' } } }
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new EvolutionClient('https://ev.example.com', 'KEY123')
    const r = await client.connectionState('inst1')
    expect(r.instance.state).toBe('open')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers)
      .toMatchObject({ apikey: 'KEY123' })
  })

  it('sendText faz POST com {number,text}', async () => {
    let sentBody: unknown
    const fetchMock = mockFetch((url, init) => {
      expect(url).toBe('https://ev.example.com/message/sendText/inst1')
      sentBody = JSON.parse(init.body as string)
      return { body: { key: { id: 'MSG-1' } } }
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new EvolutionClient('https://ev.example.com', 'KEY123')
    const r = await client.sendText('inst1', '5511999998888', 'oi')
    expect(sentBody).toEqual({ number: '5511999998888', text: 'oi' })
    expect(r.key.id).toBe('MSG-1')
  })

  it('lança erro em resposta não-ok', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 401, body: { error: 'Unauthorized' } })))
    const client = new EvolutionClient('https://ev.example.com', 'BAD')
    await expect(client.connectionState('inst1')).rejects.toThrow(/401/)
  })
})

describe('EvolutionGateway', () => {
  it('ensureConnection retorna connected quando state=open', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ body: { instance: { state: 'open' } } })))
    const gw = new EvolutionGateway(new EvolutionClient('https://ev', 'K'), 'inst1', 'evolution_byo')
    expect(gw.provider).toBe('evolution_byo')
    expect(await gw.ensureConnection()).toEqual({ status: 'connected' })
  })

  it('ensureConnection retorna QR quando desconectado', async () => {
    vi.stubGlobal('fetch', mockFetch((url) => {
      if (url.includes('/connectionState/')) return { body: { instance: { state: 'close' } } }
      return { body: { base64: 'data:image/png;base64,QRQR', code: '2@abc' } }
    }))
    const gw = new EvolutionGateway(new EvolutionClient('https://ev', 'K'), 'inst1', 'evolution_managed')
    expect(await gw.ensureConnection()).toEqual({ status: 'connecting', qr: 'data:image/png;base64,QRQR' })
  })

  it('sendTemplate lança erro (Evolution não suporta)', async () => {
    const gw = new EvolutionGateway(new EvolutionClient('https://ev', 'K'), 'inst1', 'evolution_byo')
    await expect(gw.sendTemplate('x', 'y', [])).rejects.toThrow(/template/i)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/wa/evolution.test.ts`
Expected: FAIL (módulo `./evolution` não existe).

- [ ] **Step 4: Implementar** — `super-envio/src/lib/wa/evolution.ts`

```ts
import type { ConnState, Provider, WhatsAppGateway } from './types'

export class EvolutionClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  private async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Evolution API ${res.status} em ${method} ${path}`)
    }
    return res.json()
  }

  connectionState(instance: string): Promise<{ instance: { state: string } }> {
    return this.req('GET', `/instance/connectionState/${instance}`)
  }
  connect(instance: string): Promise<{ base64?: string; code?: string; pairingCode?: string }> {
    return this.req('GET', `/instance/connect/${instance}`)
  }
  sendText(instance: string, number: string, text: string): Promise<{ key: { id: string } }> {
    return this.req('POST', `/message/sendText/${instance}`, { number, text })
  }
  logout(instance: string) {
    return this.req('DELETE', `/instance/logout/${instance}`)
  }
  createInstance(name: string): Promise<{ hash: string | { apikey: string }; qrcode?: { base64?: string; code?: string } }> {
    return this.req('POST', '/instance/create', {
      instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true,
    })
  }
  deleteInstance(instance: string) {
    return this.req('DELETE', `/instance/delete/${instance}`)
  }
}

export function mapEvolutionState(state: string): ConnState['status'] {
  if (state === 'open') return 'connected'
  if (state === 'connecting') return 'connecting'
  return 'disconnected'
}

export class EvolutionGateway implements WhatsAppGateway {
  constructor(
    private client: EvolutionClient,
    private instanceName: string,
    readonly provider: Provider,
  ) {}

  async ensureConnection(): Promise<ConnState> {
    const s = await this.client.connectionState(this.instanceName)
    const status = mapEvolutionState(s.instance.state)
    if (status === 'connected') return { status }
    const q = await this.client.connect(this.instanceName).catch(() => null)
    return { status: 'connecting', qr: q?.base64 ?? q?.code }
  }

  async getConnectionState(): Promise<ConnState> {
    const s = await this.client.connectionState(this.instanceName)
    const status = mapEvolutionState(s.instance.state)
    if (status === 'connected') return { status }
    const q = await this.client.connect(this.instanceName).catch(() => null)
    return { status, qr: q?.base64 ?? q?.code }
  }

  async disconnect(): Promise<void> {
    await this.client.logout(this.instanceName)
  }

  async sendText(to: string, body: string) {
    const r = await this.client.sendText(this.instanceName, to, body)
    return { providerMessageId: r.key.id }
  }

  async sendTemplate(): Promise<{ providerMessageId: string }> {
    throw new Error('Evolution não suporta templates; use sendText')
  }
}

function managedClient(): EvolutionClient {
  const url = process.env.EVOLUTION_MANAGED_URL
  const key = process.env.EVOLUTION_MANAGED_GLOBAL_KEY
  if (!url || !key) throw new Error('EVOLUTION_MANAGED_URL/GLOBAL_KEY não configurados')
  return new EvolutionClient(url, key)
}

export async function provisionManagedInstance(instanceName: string): Promise<{ apiKey: string; qr?: string }> {
  const r = await managedClient().createInstance(instanceName)
  const apiKey = typeof r.hash === 'string' ? r.hash : r.hash?.apikey
  if (!apiKey) throw new Error('Evolution não retornou apikey da instância')
  return { apiKey, qr: r.qrcode?.base64 ?? r.qrcode?.code }
}

export async function deleteManagedInstance(instanceName: string): Promise<void> {
  await managedClient().deleteInstance(instanceName)
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/wa/evolution.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add super-envio/src/lib/wa/types.ts super-envio/src/lib/wa/evolution.ts super-envio/src/lib/wa/evolution.test.ts && \
  git commit -m "feat(wa): contrato WhatsAppGateway + gateway Evolution (BYO/managed) [TDD]"
```

---

### Task 3: Gateway Meta Cloud API

**Files:**
- Create: `super-envio/src/lib/wa/meta.ts`
- Test: `super-envio/src/lib/wa/meta.test.ts`

**Interfaces:**
- Consumes: `WhatsAppGateway`, `ConnState` de `./types`.
- Produces: `class MetaCloudGateway implements WhatsAppGateway` (`new (phoneNumberId, accessToken)`); const `META_API_VERSION`.

- [ ] **Step 1: Teste que falha** — `super-envio/src/lib/wa/meta.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MetaCloudGateway } from './meta'

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const { status = 200, body } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  })
}
afterEach(() => vi.unstubAllGlobals())

describe('MetaCloudGateway', () => {
  it('getConnectionState=connected valida token e lê telefone', async () => {
    vi.stubGlobal('fetch', mockFetch((url, init) => {
      expect(url).toContain('/PNID?fields=display_phone_number,verified_name')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK')
      return { body: { display_phone_number: '+55 11 99999-8888', verified_name: 'Loja' } }
    }))
    const gw = new MetaCloudGateway('PNID', 'TOK')
    expect(gw.provider).toBe('meta_cloud')
    expect(await gw.getConnectionState()).toEqual({ status: 'connected', phoneNumber: '+55 11 99999-8888' })
  })

  it('getConnectionState=disconnected quando token inválido', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 401, body: { error: {} } })))
    const gw = new MetaCloudGateway('PNID', 'BAD')
    expect(await gw.getConnectionState()).toEqual({ status: 'disconnected' })
  })

  it('sendText monta payload de texto e retorna id', async () => {
    let sent: unknown
    vi.stubGlobal('fetch', mockFetch((url, init) => {
      expect(url).toContain('/PNID/messages')
      sent = JSON.parse(init.body as string)
      return { body: { messages: [{ id: 'wamid.ABC' }] } }
    }))
    const gw = new MetaCloudGateway('PNID', 'TOK')
    const r = await gw.sendText('5511999998888', 'oi')
    expect(sent).toEqual({ messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'oi' } })
    expect(r.providerMessageId).toBe('wamid.ABC')
  })

  it('sendTemplate monta componentes de parâmetros posicionais', async () => {
    let sent: any
    vi.stubGlobal('fetch', mockFetch((_url, init) => {
      sent = JSON.parse(init.body as string)
      return { body: { messages: [{ id: 'wamid.T' }] } }
    }))
    const gw = new MetaCloudGateway('PNID', 'TOK')
    const r = await gw.sendTemplate('5511999998888', 'boas_vindas', ['Ana', 'Premium'])
    expect(sent.type).toBe('template')
    expect(sent.template.name).toBe('boas_vindas')
    expect(sent.template.components[0]).toEqual({
      type: 'body',
      parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Premium' }],
    })
    expect(r.providerMessageId).toBe('wamid.T')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/wa/meta.test.ts`
Expected: FAIL (módulo `./meta` não existe).

- [ ] **Step 3: Implementar** — `super-envio/src/lib/wa/meta.ts`

```ts
import type { ConnState, WhatsAppGateway } from './types'

export const META_API_VERSION = 'v21.0'

export class MetaCloudGateway implements WhatsAppGateway {
  readonly provider = 'meta_cloud' as const
  private base = `https://graph.facebook.com/${META_API_VERSION}`

  constructor(private phoneNumberId: string, private accessToken: string) {}

  private async req(path: string, method = 'GET', body?: unknown) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Meta API ${res.status} em ${method} ${path}`)
    return res.json()
  }

  async ensureConnection(): Promise<ConnState> {
    return this.getConnectionState()
  }

  async getConnectionState(): Promise<ConnState> {
    try {
      const r = await this.req(`/${this.phoneNumberId}?fields=display_phone_number,verified_name`)
      return { status: 'connected', phoneNumber: r.display_phone_number }
    } catch {
      return { status: 'disconnected' }
    }
  }

  async disconnect(): Promise<void> {
    // Meta Cloud: não há sessão para encerrar; desconexão é lógica (remover instância).
  }

  async sendText(to: string, body: string) {
    const r = await this.req(`/${this.phoneNumberId}/messages`, 'POST', {
      messaging_product: 'whatsapp', to, type: 'text', text: { body },
    })
    return { providerMessageId: r.messages[0].id }
  }

  async sendTemplate(to: string, name: string, vars: string[]) {
    const components = vars.length
      ? [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: v })) }]
      : []
    const r = await this.req(`/${this.phoneNumberId}/messages`, 'POST', {
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name, language: { code: 'pt_BR' }, components },
    })
    return { providerMessageId: r.messages[0].id }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/wa/meta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add super-envio/src/lib/wa/meta.ts super-envio/src/lib/wa/meta.test.ts && \
  git commit -m "feat(wa): gateway Meta Cloud API (texto + template HSM) [TDD]"
```

---

### Task 4: Client service-role + factory de gateway

**Files:**
- Create: `super-envio/src/lib/supabase/service.ts`
- Create: `super-envio/src/lib/wa/factory.ts`
- Test: `super-envio/src/lib/wa/factory.test.ts`
- Modify: `super-envio/.env.local`, `super-envio/.env.example`

**Interfaces:**
- Consumes: `InstanceRow`, `Credential` de `./types`; `EvolutionClient`, `EvolutionGateway` de `./evolution`; `MetaCloudGateway` de `./meta`.
- Produces:
  - `createServiceClient()` (server-only) em `@/lib/supabase/service`.
  - `type CredentialLoader = (instanceId: string) => Promise<Credential>`.
  - `loadCredentialViaRpc(instanceId): Promise<Credential>` (usa service client + RPC `get_instance_credential`).
  - `createGateway(row: InstanceRow, load?: CredentialLoader): Promise<WhatsAppGateway>`.

- [ ] **Step 1: Env server-only** — acrescentar em `super-envio/.env.local` e `.env.example`

`.env.local` (valores reais no ambiente do usuário; nunca commitado):
```
SUPABASE_SERVICE_ROLE_KEY=
EVOLUTION_MANAGED_URL=
EVOLUTION_MANAGED_GLOBAL_KEY=
```
`.env.example` (mesmas chaves, vazias). Confirmar que `.env.local` está no `.gitignore`.

- [ ] **Step 2: Client service-role** — `super-envio/src/lib/supabase/service.ts`

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'

// SERVER-ONLY. Usa a service_role key (bypassa RLS). Nunca importar em Client Components.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
```
> Nota: instalar o pacote `server-only` se ainda não existir: `npm i server-only`.

- [ ] **Step 3: Teste que falha** — `super-envio/src/lib/wa/factory.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { createGateway } from './factory'
import { EvolutionGateway } from './evolution'
import { MetaCloudGateway } from './meta'
import type { InstanceRow } from './types'

const base: InstanceRow = {
  id: 'i1', organization_id: 'o1', provider: 'evolution_byo', name: 'x',
  status: 'connected', phone_number: null, evolution_instance_name: 'inst1',
  meta_phone_number_id: null, meta_waba_id: null,
  hourly_limit: 20, daily_limit: 200, warmup_level: 0,
}

describe('createGateway', () => {
  it('evolution_byo → EvolutionGateway', async () => {
    const gw = await createGateway(base, async () => ({ baseUrl: 'https://ev', apiKey: 'K' }))
    expect(gw).toBeInstanceOf(EvolutionGateway)
    expect(gw.provider).toBe('evolution_byo')
  })

  it('evolution_managed → EvolutionGateway com provider correto', async () => {
    const gw = await createGateway(
      { ...base, provider: 'evolution_managed' },
      async () => ({ baseUrl: 'https://ev', apiKey: 'K' }),
    )
    expect(gw).toBeInstanceOf(EvolutionGateway)
    expect(gw.provider).toBe('evolution_managed')
  })

  it('meta_cloud → MetaCloudGateway', async () => {
    const gw = await createGateway(
      { ...base, provider: 'meta_cloud', meta_phone_number_id: 'PNID' },
      async () => ({ accessToken: 'TOK' }),
    )
    expect(gw).toBeInstanceOf(MetaCloudGateway)
    expect(gw.provider).toBe('meta_cloud')
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/wa/factory.test.ts`
Expected: FAIL (módulo `./factory` não existe).

- [ ] **Step 5: Implementar** — `super-envio/src/lib/wa/factory.ts`

```ts
import type { Credential, InstanceRow, WhatsAppGateway } from './types'
import { EvolutionClient, EvolutionGateway } from './evolution'
import { MetaCloudGateway } from './meta'
import { createServiceClient } from '@/lib/supabase/service'

export type CredentialLoader = (instanceId: string) => Promise<Credential>

export async function loadCredentialViaRpc(instanceId: string): Promise<Credential> {
  const svc = createServiceClient()
  const { data, error } = await svc.rpc('get_instance_credential', { p_instance: instanceId })
  if (error || !data) throw new Error(error?.message ?? 'Credencial não encontrada')
  return data as Credential
}

export async function createGateway(
  row: InstanceRow,
  load: CredentialLoader = loadCredentialViaRpc,
): Promise<WhatsAppGateway> {
  const cred = await load(row.id)
  switch (row.provider) {
    case 'evolution_byo':
    case 'evolution_managed': {
      const c = cred as { baseUrl: string; apiKey: string }
      return new EvolutionGateway(
        new EvolutionClient(c.baseUrl, c.apiKey),
        row.evolution_instance_name ?? '',
        row.provider,
      )
    }
    case 'meta_cloud': {
      const c = cred as { accessToken: string }
      return new MetaCloudGateway(row.meta_phone_number_id ?? '', c.accessToken)
    }
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/wa/factory.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add super-envio/src/lib/supabase/service.ts super-envio/src/lib/wa/factory.ts super-envio/src/lib/wa/factory.test.ts super-envio/.env.example super-envio/package.json super-envio/package-lock.json && \
  git commit -m "feat(wa): client service-role + factory de gateway (creds via Vault RPC)"
```

---

### Task 5: Query de listagem + server actions de instâncias

**Files:**
- Create: `super-envio/src/lib/instances/queries.ts`
- Create: `super-envio/src/lib/instances/actions.ts`
- Test: `super-envio/src/lib/instances/instance-name.test.ts`

**Interfaces:**
- Consumes: `getCurrentOrg` (`@/lib/org/current`); `createClient` (`@/lib/supabase/server`); `createGateway`, gateways/provisionamento de `@/lib/wa/*`.
- Produces:
  - `listInstances(): Promise<InstanceRow[]>`.
  - `genManagedInstanceName(orgId: string): string` (helper puro, testável).
  - Server actions: `connectByo`, `connectManaged`, `connectMeta`, `refreshState`, `disconnectInstance`, `deleteInstanceAction`, `sendTest` (assinaturas no código abaixo).

- [ ] **Step 1: Teste que falha (helper puro)** — `super-envio/src/lib/instances/instance-name.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { genManagedInstanceName } from './queries'

describe('genManagedInstanceName', () => {
  it('gera nome estável por org com prefixo se', () => {
    const n = genManagedInstanceName('abc12345-0000-0000-0000-000000000000')
    expect(n).toMatch(/^se-abc12345-[a-z0-9]{6}$/)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/instances/instance-name.test.ts`
Expected: FAIL (`genManagedInstanceName` não existe).

- [ ] **Step 3: Implementar `queries.ts`** — `super-envio/src/lib/instances/queries.ts`

```ts
import { createClient } from '@/lib/supabase/server'
import type { InstanceRow } from '@/lib/wa/types'

const COLS =
  'id,organization_id,provider,name,status,phone_number,evolution_instance_name,meta_phone_number_id,meta_waba_id,hourly_limit,daily_limit,warmup_level'

export async function listInstances(): Promise<InstanceRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('whatsapp_instances')
    .select(COLS)
    .order('created_at', { ascending: true })
  return (data ?? []) as InstanceRow[]
}

export async function getInstance(id: string): Promise<InstanceRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('whatsapp_instances').select(COLS).eq('id', id).maybeSingle()
  return (data as InstanceRow | null) ?? null
}

// Nome determinístico-curto para instância gerenciada (prefixo do id da org + sufixo aleatório).
export function genManagedInstanceName(orgId: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `se-${orgId.slice(0, 8)}-${rand}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/instances/instance-name.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `actions.ts`** — `super-envio/src/lib/instances/actions.ts`

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrg } from '@/lib/org/current'
import { getInstance, genManagedInstanceName } from './queries'
import { createGateway } from '@/lib/wa/factory'
import {
  EvolutionClient, EvolutionGateway, provisionManagedInstance, deleteManagedInstance,
} from '@/lib/wa/evolution'
import { MetaCloudGateway } from '@/lib/wa/meta'
import type { ConnState } from '@/lib/wa/types'

type Result = { ok: true; instanceId?: string; state?: ConnState } | { ok: false; error: string }

async function requireOrg() {
  const org = await getCurrentOrg()
  if (!org) throw new Error('sem organização')
  return org
}

async function createCredential(
  orgId: string, provider: string, name: string, config: object, secret: object,
): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_instance_credential', {
    p_org: orgId, p_provider: provider, p_name: name, p_config: config, p_secret: secret,
  })
  if (error) throw new Error(error.message)
  return data as string
}

// --- Evolution BYO: valida creds do cliente ANTES de persistir ---
export async function connectByo(formData: FormData): Promise<Result> {
  try {
    const org = await requireOrg()
    const name = String(formData.get('name') ?? 'Instância')
    const baseUrl = String(formData.get('baseUrl')).replace(/\/+$/, '')
    const apiKey = String(formData.get('apiKey'))
    const instanceName = String(formData.get('instanceName'))
    const probe = new EvolutionGateway(new EvolutionClient(baseUrl, apiKey), instanceName, 'evolution_byo')
    const state = await probe.ensureConnection() // lança se creds inválidas
    const id = await createCredential(
      org.id, 'evolution_byo', name, { evolution_instance_name: instanceName }, { baseUrl, apiKey })
    await setState(id, state)
    revalidatePath('/app/instancias')
    return { ok: true, instanceId: id, state }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// --- Evolution gerenciada: nós provisionamos ---
export async function connectManaged(formData: FormData): Promise<Result> {
  try {
    const org = await requireOrg()
    const name = String(formData.get('name') ?? 'Instância')
    const instanceName = genManagedInstanceName(org.id)
    const { apiKey, qr } = await provisionManagedInstance(instanceName)
    const baseUrl = process.env.EVOLUTION_MANAGED_URL!.replace(/\/+$/, '')
    const id = await createCredential(
      org.id, 'evolution_managed', name, { evolution_instance_name: instanceName }, { baseUrl, apiKey })
    revalidatePath('/app/instancias')
    return { ok: true, instanceId: id, state: { status: 'connecting', qr } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// --- Meta Cloud API ---
export async function connectMeta(formData: FormData): Promise<Result> {
  try {
    const org = await requireOrg()
    const name = String(formData.get('name') ?? 'Instância')
    const phoneNumberId = String(formData.get('phoneNumberId'))
    const wabaId = String(formData.get('wabaId'))
    const accessToken = String(formData.get('accessToken'))
    const probe = new MetaCloudGateway(phoneNumberId, accessToken)
    const state = await probe.getConnectionState()
    if (state.status !== 'connected') return { ok: false, error: 'Token/número Meta inválido' }
    const id = await createCredential(
      org.id, 'meta_cloud', name,
      { meta_phone_number_id: phoneNumberId, meta_waba_id: wabaId }, { accessToken })
    await setState(id, state)
    revalidatePath('/app/instancias')
    return { ok: true, instanceId: id, state }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function setState(instanceId: string, state: ConnState) {
  const supabase = await createClient()
  await supabase.rpc('set_instance_state', {
    p_instance: instanceId, p_status: state.status, p_phone: state.phoneNumber ?? null,
  })
}

// Polling do QR/estado (chamado pela UI). Verifica membership via getInstance (RLS).
export async function refreshState(instanceId: string): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    const gw = await createGateway(row)
    const state = await gw.getConnectionState()
    await setState(instanceId, state)
    revalidatePath('/app/instancias')
    return { ok: true, state }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function disconnectInstance(instanceId: string): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    const gw = await createGateway(row)
    await gw.disconnect()
    await setState(instanceId, { status: 'disconnected' })
    revalidatePath('/app/instancias')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deleteInstanceAction(instanceId: string): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    if (row.provider === 'evolution_managed' && row.evolution_instance_name) {
      await deleteManagedInstance(row.evolution_instance_name).catch(() => null)
    }
    const supabase = await createClient()
    const { error } = await supabase.rpc('delete_instance', { p_instance: instanceId })
    if (error) throw new Error(error.message)
    revalidatePath('/app/instancias')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Mensagem de teste — prova a cadeia gateway→provedor ponta-a-ponta.
export async function sendTest(
  instanceId: string, to: string, text: string, templateName?: string, vars: string[] = [],
): Promise<Result> {
  try {
    const row = await getInstance(instanceId)
    if (!row) return { ok: false, error: 'instância não encontrada' }
    const gw = await createGateway(row)
    if (row.provider === 'meta_cloud') {
      if (!templateName) return { ok: false, error: 'Meta exige nome de template' }
      await gw.sendTemplate(to, templateName, vars)
    } else {
      await gw.sendText(to, text)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
```

- [ ] **Step 6: Verificar build/tipos**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm run build`
Expected: sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add super-envio/src/lib/instances/ && \
  git commit -m "feat(instances): query de listagem + server actions (connect/refresh/disconnect/delete/test)"
```

---

### Task 6: UI `/app/instancias` — lista, wizard de conexão, QR e ações

**Files:**
- Create: `super-envio/src/app/app/instancias/page.tsx`
- Create: `super-envio/src/app/app/instancias/instances-client.tsx`
- Modify: `super-envio/src/app/app/layout.tsx` (link de navegação)

**Interfaces:**
- Consumes: `listInstances` (`@/lib/instances/queries`), `getCurrentOrg`; server actions de `@/lib/instances/actions`.
- Produces: rota `/app/instancias`.

- [ ] **Step 1: Página server** — `super-envio/src/app/app/instancias/page.tsx`

```tsx
import { getCurrentOrg } from '@/lib/org/current'
import { createClient } from '@/lib/supabase/server'
import { listInstances } from '@/lib/instances/queries'
import { InstancesClient } from './instances-client'

export default async function InstancesPage() {
  const org = await getCurrentOrg()
  const instances = await listInstances()
  const supabase = await createClient()
  const { data: orgRow } = await supabase
    .from('organizations').select('instance_limit').eq('id', org!.id).maybeSingle()
  const limit = orgRow?.instance_limit ?? 1
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Instâncias</h1>
          <p className="text-sm text-gray-600">{instances.length} de {limit} conexões usadas</p>
        </div>
      </div>
      <InstancesClient instances={instances} limit={limit} />
    </div>
  )
}
```

- [ ] **Step 2: Componente client** — `super-envio/src/app/app/instancias/instances-client.tsx`

```tsx
'use client'
import { useState, useTransition } from 'react'
import {
  connectByo, connectManaged, connectMeta,
  refreshState, disconnectInstance, deleteInstanceAction, sendTest,
} from '@/lib/instances/actions'
import type { InstanceRow } from '@/lib/wa/types'

type Provider = 'evolution_byo' | 'evolution_managed' | 'meta_cloud'
const PROVIDER_LABEL: Record<Provider, string> = {
  evolution_byo: 'Evolution (própria)',
  evolution_managed: 'Evolution (gerenciada)',
  meta_cloud: 'Meta Cloud API',
}
const STATUS_LABEL: Record<string, string> = {
  connecting: 'Conectando', connected: 'Conectado', disconnected: 'Desconectado',
}

export function InstancesClient({ instances, limit }: { instances: InstanceRow[]; limit: number }) {
  const [open, setOpen] = useState<Provider | null>(null)
  const [qr, setQr] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [pending, start] = useTransition()
  const atLimit = instances.length >= limit

  function handle(action: () => Promise<{ ok: boolean; error?: string; state?: { qr?: string } }>) {
    setError(undefined)
    start(async () => {
      const r = await action()
      if (!r.ok) setError(r.error)
      else { setQr(r.state?.qr); if (!r.state?.qr) setOpen(null) }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button disabled={atLimit} onClick={() => { setQr(undefined); setError(undefined); setOpen('evolution_byo') }}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-40">Conectar instância</button>
        {atLimit && <span className="self-center text-sm text-amber-600">Limite do plano atingido — faça upgrade.</span>}
      </div>

      {open && (
        <div className="rounded-xl border p-4">
          <div className="mb-3 flex gap-2">
            {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
              <button key={p} onClick={() => { setQr(undefined); setError(undefined); setOpen(p) }}
                className={`rounded border px-3 py-1 text-sm ${open === p ? 'bg-gray-900 text-white' : ''}`}>
                {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>

          {open === 'evolution_byo' && (
            <form action={(fd) => handle(() => connectByo(fd))} className="grid gap-2 max-w-md">
              <input name="name" placeholder="Nome (rótulo)" className="rounded border px-3 py-2" />
              <input name="baseUrl" required placeholder="URL da Evolution (https://...)" className="rounded border px-3 py-2" />
              <input name="apiKey" required placeholder="API key" className="rounded border px-3 py-2" />
              <input name="instanceName" required placeholder="Nome da instância na Evolution" className="rounded border px-3 py-2" />
              <button disabled={pending} className="rounded bg-black py-2 text-white">Validar e conectar</button>
            </form>
          )}
          {open === 'evolution_managed' && (
            <form action={(fd) => handle(() => connectManaged(fd))} className="grid gap-2 max-w-md">
              <input name="name" placeholder="Nome (rótulo)" className="rounded border px-3 py-2" />
              <button disabled={pending} className="rounded bg-black py-2 text-white">Provisionar e gerar QR</button>
            </form>
          )}
          {open === 'meta_cloud' && (
            <form action={(fd) => handle(() => connectMeta(fd))} className="grid gap-2 max-w-md">
              <input name="name" placeholder="Nome (rótulo)" className="rounded border px-3 py-2" />
              <input name="phoneNumberId" required placeholder="Phone Number ID" className="rounded border px-3 py-2" />
              <input name="wabaId" required placeholder="WABA ID" className="rounded border px-3 py-2" />
              <input name="accessToken" required placeholder="Access token" className="rounded border px-3 py-2" />
              <button disabled={pending} className="rounded bg-black py-2 text-white">Verificar e conectar</button>
            </form>
          )}

          {qr && (
            <div className="mt-4">
              <p className="text-sm text-gray-600">Escaneie no WhatsApp (Aparelhos conectados):</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="QR" src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} className="mt-2 h-56 w-56" />
              <button onClick={() => setOpen(null)} className="mt-2 rounded border px-3 py-1 text-sm">Fechar</button>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      )}

      <ul className="divide-y rounded-xl border">
        {instances.length === 0 && <li className="p-6 text-gray-500">Nenhuma instância. Conecte a primeira acima.</li>}
        {instances.map((i) => (
          <li key={i.id} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium">{i.name}</div>
              <div className="text-sm text-gray-600">
                {PROVIDER_LABEL[i.provider]} · {STATUS_LABEL[i.status] ?? i.status}
                {i.phone_number ? ` · ${i.phone_number}` : ''}
              </div>
            </div>
            <div className="flex gap-2 text-sm">
              <button onClick={() => handle(() => refreshState(i.id))} className="rounded border px-2 py-1">Atualizar</button>
              <button onClick={() => handle(() => disconnectInstance(i.id))} className="rounded border px-2 py-1">Desconectar</button>
              <button onClick={() => {
                const to = prompt('Número (E.164, ex: 5511999998888):'); if (!to) return
                if (i.provider === 'meta_cloud') {
                  const tpl = prompt('Nome do template aprovado:'); if (!tpl) return
                  handle(() => sendTest(i.id, to, '', tpl, []))
                } else {
                  const txt = prompt('Texto da mensagem de teste:') ?? 'Teste Super Envio'
                  handle(() => sendTest(i.id, to, txt))
                }
              }} className="rounded border px-2 py-1">Testar</button>
              <button onClick={() => { if (confirm('Excluir instância?')) handle(() => deleteInstanceAction(i.id)) }}
                className="rounded border border-red-300 px-2 py-1 text-red-600">Excluir</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Link de navegação** — em `super-envio/src/app/app/layout.tsx`

No `<header>`, adicionar um link para instâncias antes do bloco do usuário. Trocar o conteúdo do header por:
```tsx
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="font-semibold">Super Envio</div>
          <nav className="flex gap-4 text-sm text-gray-600">
            <a href="/app">Painel</a>
            <a href="/app/instancias">Instâncias</a>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-600">{org.name} · {org.role}</span>
          <form action="/auth/signout" method="post">
            <button className="rounded border px-3 py-1">Sair</button>
          </form>
        </div>
      </header>
```

- [ ] **Step 4: Verificar build**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm run build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add super-envio/src/app/app/instancias/ super-envio/src/app/app/layout.tsx && \
  git commit -m "feat(ui): tela de instâncias (lista, wizard, QR, ações) + nav"
```

---

### Task 7: Suíte completa verde + advisors

**Files:** nenhum novo (verificação integrada).

- [ ] **Step 1: Rodar toda a suíte**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm test`
Expected: PASS em todos (`evolution`, `meta`, `factory`, `instance-name`, mais os da Fase 0).

- [ ] **Step 2: Build de produção**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm run build`
Expected: sem erros.

- [ ] **Step 3: Advisors de segurança**

Via MCP `get_advisors` (project_id `<SEU_PROJETO_REF>`, type `security`). Expected: nenhum erro crítico novo referente a `whatsapp_instances` ou às RPCs (search_path fixo + grants restritos já aplicados).

- [ ] **Step 4: Commit (se algo ajustado)**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add -A && git commit -m "test: suíte Fase 1 verde + advisors" || echo "nada a commitar"
```

---

### Task 8: Verificação manual ponta-a-ponta (endpoints reais)

**Files:** nenhum (checklist manual; requer credenciais reais do usuário no `.env.local`).

> Esta task valida o caminho autenticado real (membership, limite, Vault, provedores) que não é coberto no CI. Requer usuário logado e `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_MANAGED_URL`, `EVOLUTION_MANAGED_GLOBAL_KEY` preenchidos.

- [ ] **Step 1: Subir o app**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm run dev`
Abrir `http://localhost:3000/app/instancias` logado.

- [ ] **Step 2: Evolution BYO** — conectar com URL+API key+instanceName da instância real; confirmar status `Conectado` (ou QR se desconectada); "Testar" → enviar texto para um número próprio; confirmar recebimento.

- [ ] **Step 3: Evolution gerenciada** — "Provisionar e gerar QR"; escanear o QR no WhatsApp; "Atualizar" até `Conectado`; "Testar" texto.

- [ ] **Step 4: Meta Cloud** — conectar com Phone Number ID + WABA ID + token de teste; confirmar `Conectado` + telefone; "Testar" com um template aprovado (ex.: `hello_world`); confirmar recebimento.

- [ ] **Step 5: Enforcement de limite** — com `organizations.instance_limit = 1` (default), tentar conectar uma 2ª instância → deve falhar com "instance limit reached". (Ajustar `instance_limit` via SQL para liberar mais durante o teste.)

- [ ] **Step 6: Segredo não vaza** — no navegador (DevTools → Network/console), confirmar que nenhuma resposta de server action/consulta expõe `apiKey`/`accessToken`. Confirmar que `get_instance_credential` chamada pelo client `authenticated` (via supabase-js no console) retorna erro de permissão.

- [ ] **Step 7: Excluir** — excluir cada instância; confirmar remoção da lista e (managed) no servidor Evolution.

---

## Self-Review

**Spec coverage (Fase 1):**
- §2 `WhatsAppGateway` (interface + BYO/managed/meta) → Tasks 2, 3, 4. ✔
- §3 `whatsapp_instances` + Vault + RPCs → Task 1. ✔
- §4 ponte de enforcement (`instance_limit`) → Task 1 (coluna + RPC) + Task 8 Step 5 (verificação). ✔
- §5 telas `/app/instancias` (lista, wizard, QR poll, ações, botão bloqueado no limite) → Task 6. ✔
- §6 estrutura de código (`wa/*`, `instances/*`, migration, UI) → Tasks 2–6. ✔
- §7 testes (gateways fetch-mockado, factory, RLS/limite via manual, mapeamentos) → Tasks 2–5, 7, 8. ✔
- §8 env server-only (`EVOLUTION_MANAGED_URL/GLOBAL_KEY`; + `SUPABASE_SERVICE_ROLE_KEY`) → Task 4 Step 1. ✔
- §9 riscos (Vault via service_role, poll de QR, janela Meta 24h) → refletidos em Tasks 1/5/3. ✔

**Correção de segurança vs. spec:** a leitura descriptografada (`get_instance_credential`) é restrita a `service_role` (não `authenticated`), evitando vazamento de segredo a membros — mais seguro que o texto original do spec; a escrita e o membership seguem via RPC `authenticated`. Documentado em Global Constraints e Task 1.

**Placeholders:** nenhum "TODO/TBD"; todo passo de código traz o código. Valores de credencial no `.env.local` são preenchidos pelo usuário (segredos reais, corretamente fora do plano). ✔

**Type consistency:** `WhatsAppGateway`, `ConnState`, `InstanceRow`, `Credential`, `CredentialLoader` consistentes entre types/evolution/meta/factory/actions; `create_instance_credential`/`get_instance_credential`/`set_instance_state`/`delete_instance` batem entre migration (Task 1) e actions/factory (Tasks 4/5); nomes de provider (`evolution_byo`/`evolution_managed`/`meta_cloud`) idênticos em enum SQL e TS. ✔
