# Super Envio — Fase 3+4: Motor de Disparo + Anti-ban — Plano

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** Campanhas de disparo em massa: expandir lista → renderizar (spintax+variáveis) → agendar `send_at` com delays/rate anti-ban e rotação de instâncias → worker in-process envia as vencidas via `WhatsAppGateway` → monitor com status por mensagem e pausar/retomar/cancelar.

**Architecture:** Tabelas `campaigns` + `campaign_messages` (RLS por org; escrita pesada via service-role no server). Renderer e scheduler são funções **puras testáveis** (rng injetável). Expansão numa Server Action (service-role). **Worker in-process** via `instrumentation.ts` (setInterval ~30s) — adequado ao container persistente do EasyPanel; claim atômico (`update ... returning`) evita envio duplicado. UI em `/app/campanhas`.

**Tech Stack:** Next 16 (`instrumentation.ts`), Supabase (Postgres/RLS + service-role), Vitest. Migration **0006**. Projeto Supabase real: `zolkdsjjrmpsslftfbjw`.

## Global Constraints
- App na RAIZ. UI pt-BR. RLS por org; enforcement server-side. Segredos server-only.
- Reusa: `getCurrentOrg`, `createClient` (server), `createServiceClient` (`@/lib/supabase/service`), `createGateway` (`@/lib/wa/factory`), gateways.
- TDD para renderer e scheduler. Worker/actions verificados por build. Nenhum envio real em teste.

---

### Task 1: Migration 0006 — campaigns + campaign_messages + RLS

**Files:** `supabase/migrations/0006_campaigns.sql` (aplicar via MCP, project_id `zolkdsjjrmpsslftfbjw`, name `campaigns`).

- [ ] **Step 1: SQL**
```sql
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
```
- [ ] **Step 2:** aplicar via MCP; **Step 3:** verificar `list_tables` (rls) + `get_advisors` (sem novo ERROR); **Step 4:** commit `feat(db): campaigns + campaign_messages + RLS (Fase 3)`.

---

### Task 2: Renderer spintax + variáveis (TDD puro)

**Files:** `src/lib/campaigns/render.ts` + `render.test.ts`.

**Produces:** `renderMessage(template: string, vars: Record<string,string>, rng?: () => number): string` — resolve `{a|b|c}` (escolhe uma opção; múltiplos grupos; sorteio via rng) e `{{chave}}` (substitui por `vars[chave]` ou ''). rng default `Math.random`.

- [ ] **Step 1: Teste**
```ts
import { describe, it, expect } from 'vitest'
import { renderMessage } from './render'

describe('renderMessage', () => {
  it('substitui variáveis', () => {
    expect(renderMessage('Oi {{nome}}!', { nome: 'Ana' })).toBe('Oi Ana!')
  })
  it('variável ausente vira vazio', () => {
    expect(renderMessage('Oi {{nome}}!', {})).toBe('Oi !')
  })
  it('spintax escolhe uma opção (rng=0 → primeira)', () => {
    expect(renderMessage('{oi|olá|e aí} {{nome}}', { nome: 'Ana' }, () => 0)).toBe('oi Ana')
  })
  it('spintax rng→última opção', () => {
    expect(renderMessage('{oi|olá|e aí}', {}, () => 0.99)).toBe('e aí')
  })
  it('múltiplos grupos spintax', () => {
    expect(renderMessage('{a|b} {c|d}', {}, () => 0)).toBe('a c')
  })
})
```
- [ ] **Step 2:** rodar → FAIL. **Step 3: Implementar**
```ts
export function renderMessage(
  template: string, vars: Record<string, string>, rng: () => number = Math.random,
): string {
  // spintax: {a|b|c} → escolhe uma
  const spun = template.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, group: string) => {
    const opts = group.split('|')
    return opts[Math.min(opts.length - 1, Math.floor(rng() * opts.length))]
  })
  // variáveis: {{chave}}
  return spun.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '')
}
```
- [ ] **Step 4:** rodar → PASS. **Step 5:** commit `feat(campaigns): renderer spintax + variáveis (TDD)`.

---

### Task 3: Scheduler anti-ban (send_at + rotação, TDD puro)

**Files:** `src/lib/campaigns/schedule.ts` + `schedule.test.ts`.

**Produces:**
```ts
type SchedInstance = { id: string; hourlyLimit: number }
type Sched = { instanceId: string; sendAt: number } // epoch ms
scheduleMessages(opts: {
  count: number; instances: SchedInstance[];
  minDelaySeconds: number; maxDelaySeconds: number;
  startAtMs: number; rng?: () => number;
}): Sched[]
```
Rotação round-robin entre instâncias; cada instância acumula seu próprio cursor de tempo com delay aleatório em [min,max]; respeita `hourlyLimit` por instância (se atingir o teto na janela de 1h, empurra o próximo envio para depois da janela). Determinístico com rng fixo.

- [ ] **Step 1: Teste**
```ts
import { describe, it, expect } from 'vitest'
import { scheduleMessages } from './schedule'

const T0 = 1_700_000_000_000 // epoch ms fixo

describe('scheduleMessages', () => {
  it('rotaciona round-robin entre instâncias', () => {
    const r = scheduleMessages({ count: 4, instances: [{ id: 'a', hourlyLimit: 100 }, { id: 'b', hourlyLimit: 100 }], minDelaySeconds: 10, maxDelaySeconds: 10, startAtMs: T0, rng: () => 0 })
    expect(r.map((x) => x.instanceId)).toEqual(['a', 'b', 'a', 'b'])
  })
  it('acumula delay por instância (rng=0 → min)', () => {
    const r = scheduleMessages({ count: 2, instances: [{ id: 'a', hourlyLimit: 100 }], minDelaySeconds: 10, maxDelaySeconds: 10, startAtMs: T0, rng: () => 0 })
    expect(r[0].sendAt).toBe(T0 + 10_000)
    expect(r[1].sendAt).toBe(T0 + 20_000)
  })
  it('respeita hourlyLimit empurrando p/ próxima janela', () => {
    const r = scheduleMessages({ count: 3, instances: [{ id: 'a', hourlyLimit: 2 }], minDelaySeconds: 10, maxDelaySeconds: 10, startAtMs: T0, rng: () => 0 })
    // 3ª msg da instância 'a' ultrapassa o teto de 2/h → vai p/ depois de 1h do 1º envio
    expect(r[2].sendAt).toBeGreaterThanOrEqual(r[0].sendAt + 3_600_000)
  })
})
```
- [ ] **Step 2:** FAIL. **Step 3: Implementar**
```ts
export type SchedInstance = { id: string; hourlyLimit: number }
export type Sched = { instanceId: string; sendAt: number }

export function scheduleMessages(opts: {
  count: number; instances: SchedInstance[]
  minDelaySeconds: number; maxDelaySeconds: number
  startAtMs: number; rng?: () => number
}): Sched[] {
  const { count, instances, minDelaySeconds, maxDelaySeconds, startAtMs } = opts
  const rng = opts.rng ?? Math.random
  if (instances.length === 0) return []
  const min = Math.min(minDelaySeconds, maxDelaySeconds)
  const max = Math.max(minDelaySeconds, maxDelaySeconds)
  // estado por instância: cursor de tempo + timestamps da janela de 1h
  const state = instances.map((i) => ({ inst: i, cursor: startAtMs, window: [] as number[] }))
  const out: Sched[] = []
  for (let n = 0; n < count; n++) {
    const st = state[n % state.length]
    const delayMs = Math.round((min + rng() * (max - min)) * 1000)
    let sendAt = st.cursor + delayMs
    // limpa janela: mantém só envios na última 1h relativa a sendAt
    st.window = st.window.filter((t) => t > sendAt - 3_600_000)
    if (st.window.length >= st.inst.hourlyLimit) {
      // empurra p/ 1h após o envio mais antigo da janela + 1ms
      sendAt = st.window[0] + 3_600_000 + 1
      st.window = st.window.filter((t) => t > sendAt - 3_600_000)
    }
    st.window.push(sendAt)
    st.cursor = sendAt
    out.push({ instanceId: st.inst.id, sendAt })
  }
  return out
}
```
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(campaigns): scheduler anti-ban send_at + rotação (TDD)`.

---

### Task 4: Server actions — CRUD de campanha + iniciar (expansão) + controles

**Files:** `src/lib/campaigns/queries.ts` + `src/lib/campaigns/actions.ts`.

**Produces:**
- `listCampaigns()`, `getCampaign(id)` (+ contagem de status), `listConnectedInstances()` (id/name/provider/status/hourly), `listListsForSelect()`.
- Actions: `createCampaign(formData)` (draft), `startCampaign(id)` (expande → running), `pauseCampaign(id)`, `resumeCampaign(id)`, `cancelCampaign(id)`, `deleteCampaign(id)`.

**Expansão (`startCampaign`):** valida via user client que a campanha é da org (RLS); lê membros da lista + contatos; usa `createServiceClient` p/ inserir `campaign_messages` em lote com `renderMessage` + `scheduleMessages` (instâncias = as escolhidas, hourlyLimit vindo de `whatsapp_instances`); seta `campaigns.status='running'`.

- [ ] **Step 1: queries.ts**
```ts
import { createClient } from '@/lib/supabase/server'

export type CampaignRow = { id: string; name: string; status: string; created_at: string; list_id: string | null }
export async function listCampaigns(): Promise<CampaignRow[]> {
  const s = await createClient()
  const { data } = await s.from('campaigns').select('id,name,status,created_at,list_id').order('created_at', { ascending: false })
  return (data ?? []) as CampaignRow[]
}
export async function getCampaign(id: string) {
  const s = await createClient()
  const { data: c } = await s.from('campaigns').select('*').eq('id', id).maybeSingle()
  if (!c) return null
  const { data: msgs } = await s.from('campaign_messages').select('status').eq('campaign_id', id)
  const counts: Record<string, number> = {}
  for (const m of msgs ?? []) counts[(m as { status: string }).status] = (counts[(m as { status: string }).status] ?? 0) + 1
  return { campaign: c, counts, total: (msgs ?? []).length }
}
export async function listConnectedInstances() {
  const s = await createClient()
  const { data } = await s.from('whatsapp_instances').select('id,name,provider,status,hourly_limit').order('created_at')
  return data ?? []
}
export async function listListsForSelect() {
  const s = await createClient()
  const { data } = await s.from('contact_lists').select('id,name').order('created_at', { ascending: false })
  return data ?? []
}
```
- [ ] **Step 2: actions.ts**
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentOrg } from '@/lib/org/current'
import { renderMessage } from './render'
import { scheduleMessages, type SchedInstance } from './schedule'

type R = { ok: true; id?: string; count?: number } | { ok: false; error: string }
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function createCampaign(formData: FormData): Promise<R> {
  try {
    const org = await getCurrentOrg(); if (!org) return { ok: false, error: 'sem organização' }
    const name = String(formData.get('name') ?? '').trim() || 'Campanha'
    const message_template = String(formData.get('message_template') ?? '')
    const list_id = String(formData.get('list_id') ?? '') || null
    const instance_ids = formData.getAll('instance_ids').map(String)
    const min = Number(formData.get('min_delay_seconds') ?? 30)
    const max = Number(formData.get('max_delay_seconds') ?? 90)
    const s = await createClient()
    const { data, error } = await s.from('campaigns').insert({
      organization_id: org.id, name, message_template, list_id,
      instance_ids, min_delay_seconds: min, max_delay_seconds: max, status: 'draft',
    }).select('id').single()
    if (error) return { ok: false, error: error.message }
    revalidatePath('/app/campanhas')
    return { ok: true, id: data.id }
  } catch (e) { return { ok: false, error: msg(e) } }
}

export async function startCampaign(id: string): Promise<R> {
  try {
    const org = await getCurrentOrg(); if (!org) return { ok: false, error: 'sem organização' }
    const s = await createClient()
    const { data: c } = await s.from('campaigns').select('*').eq('id', id).maybeSingle()
    if (!c) return { ok: false, error: 'campanha não encontrada' }
    if (!c.list_id) return { ok: false, error: 'selecione uma lista' }
    if (!c.instance_ids?.length) return { ok: false, error: 'selecione ao menos uma instância' }

    // membros da lista + contatos
    const { data: members } = await s.from('contact_list_members')
      .select('contact:contacts(id,phone,name,custom_fields)').eq('list_id', c.list_id)
    const contacts = (members ?? []).map((m: { contact: unknown }) => m.contact as { id: string; phone: string; name: string | null; custom_fields: Record<string, string> }).filter(Boolean)
    if (contacts.length === 0) return { ok: false, error: 'lista vazia' }

    // limites por instância
    const { data: insts } = await s.from('whatsapp_instances')
      .select('id,hourly_limit').in('id', c.instance_ids)
    const schedInsts: SchedInstance[] = (insts ?? []).map((i: { id: string; hourly_limit: number }) => ({ id: i.id, hourlyLimit: i.hourly_limit }))
    if (schedInsts.length === 0) return { ok: false, error: 'instâncias inválidas' }

    const sched = scheduleMessages({
      count: contacts.length, instances: schedInsts,
      minDelaySeconds: c.min_delay_seconds, maxDelaySeconds: c.max_delay_seconds,
      startAtMs: Date.now(),
    })
    const rows = contacts.map((ct, i) => ({
      organization_id: org.id, campaign_id: id, contact_id: ct.id,
      instance_id: sched[i].instanceId, phone: ct.phone,
      rendered_text: renderMessage(c.message_template, { nome: ct.name ?? '', ...(ct.custom_fields ?? {}) }),
      send_at: new Date(sched[i].sendAt).toISOString(), status: 'pending' as const,
    }))
    // escrita pesada via service-role
    const svc = createServiceClient()
    // insere em lotes de 500
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await svc.from('campaign_messages').insert(rows.slice(i, i + 500))
      if (error) return { ok: false, error: error.message }
    }
    await s.from('campaigns').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', id)
    revalidatePath('/app/campanhas')
    return { ok: true, count: rows.length }
  } catch (e) { return { ok: false, error: msg(e) } }
}

async function setStatus(id: string, status: string): Promise<R> {
  const s = await createClient()
  const { error } = await s.from('campaigns').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/campanhas'); return { ok: true }
}
export const pauseCampaign = (id: string) => setStatus(id, 'paused')
export const resumeCampaign = (id: string) => setStatus(id, 'running')
export async function cancelCampaign(id: string): Promise<R> {
  const svc = createServiceClient()
  await svc.from('campaign_messages').update({ status: 'failed', error: 'cancelada' }).eq('campaign_id', id).eq('status', 'pending')
  return setStatus(id, 'canceled')
}
export async function deleteCampaign(id: string): Promise<R> {
  const s = await createClient()
  const { error } = await s.from('campaigns').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/campanhas'); return { ok: true }
}
```
- [ ] **Step 3:** `npm run build`. **Step 4:** commit `feat(campaigns): queries + actions (criar/iniciar/pausar/retomar/cancelar)`.

---

### Task 5: Worker in-process (envio das mensagens vencidas)

**Files:** `src/lib/campaigns/worker.ts` + `src/instrumentation.ts`.

**Produces:** `runDispatchTick(): Promise<{ sent: number; failed: number }>` — usa service-role; seleciona campanhas `running`; para cada mensagem vencida (`status=pending`, `send_at<=now`) até um limite por tick, faz **claim atômico** (update status `sending` returning), monta gateway via `createGateway`, envia (`sendText`), grava `sent`+`provider_message_id` ou `failed`+`error`. Marca campanha `completed` quando não há mais `pending`. `instrumentation.ts` chama `register()` que, no runtime Node, roda `runDispatchTick` a cada 30s (guard singleton).

- [ ] **Step 1: worker.ts**
```ts
import { createServiceClient } from '@/lib/supabase/service'
import { createGateway } from '@/lib/wa/factory'
import type { InstanceRow } from '@/lib/wa/types'

const INST_COLS = 'id,organization_id,provider,name,status,phone_number,evolution_instance_name,meta_phone_number_id,meta_waba_id,hourly_limit,daily_limit,warmup_level'
const TICK_LIMIT = 50

export async function runDispatchTick(): Promise<{ sent: number; failed: number }> {
  const svc = createServiceClient()
  const nowIso = new Date().toISOString()
  // campanhas em execução
  const { data: running } = await svc.from('campaigns').select('id').eq('status', 'running')
  const ids = (running ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return { sent: 0, failed: 0 }

  // seleciona vencidas
  const { data: due } = await svc.from('campaign_messages')
    .select('id,instance_id,phone,rendered_text')
    .in('campaign_id', ids).eq('status', 'pending').lte('send_at', nowIso)
    .order('send_at', { ascending: true }).limit(TICK_LIMIT)
  if (!due || due.length === 0) { await markCompleted(svc, ids); return { sent: 0, failed: 0 } }

  let sent = 0, failed = 0
  const gwCache = new Map<string, Awaited<ReturnType<typeof createGateway>>>()
  for (const m of due as { id: string; instance_id: string; phone: string; rendered_text: string }[]) {
    // claim atômico: só processa se ainda estava pending
    const { data: claimed } = await svc.from('campaign_messages')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', m.id).eq('status', 'pending').select('id')
    if (!claimed || claimed.length === 0) continue
    try {
      let gw = gwCache.get(m.instance_id)
      if (!gw) {
        const { data: inst } = await svc.from('whatsapp_instances').select(INST_COLS).eq('id', m.instance_id).maybeSingle()
        if (!inst) throw new Error('instância não encontrada')
        gw = await createGateway(inst as unknown as InstanceRow)
        gwCache.set(m.instance_id, gw)
      }
      const res = await gw.sendText(m.phone, m.rendered_text)
      await svc.from('campaign_messages').update({
        status: 'sent', provider_message_id: res.providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', m.id)
      sent++
    } catch (e) {
      await svc.from('campaign_messages').update({
        status: 'failed', error: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString(),
      }).eq('id', m.id)
      failed++
    }
  }
  await markCompleted(svc, ids)
  return { sent, failed }
}

async function markCompleted(svc: ReturnType<typeof createServiceClient>, ids: string[]) {
  for (const id of ids) {
    const { count } = await svc.from('campaign_messages')
      .select('id', { count: 'exact', head: true }).eq('campaign_id', id).in('status', ['pending', 'sending'])
    if ((count ?? 0) === 0) await svc.from('campaigns').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', id)
  }
}
```
- [ ] **Step 2: instrumentation.ts** (raiz `src/`)
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Evita múltiplos intervalos em HMR/dev.
  const g = globalThis as unknown as { __superEnvioWorker?: boolean }
  if (g.__superEnvioWorker) return
  g.__superEnvioWorker = true
  const { runDispatchTick } = await import('@/lib/campaigns/worker')
  const tick = async () => {
    try { await runDispatchTick() } catch (e) { console.error('[worker] tick erro:', e) }
  }
  setInterval(tick, 30_000)
  console.log('[worker] disparo in-process ativo (30s)')
}
```
- [ ] **Step 3:** `npm run build` (confirma que instrumentation compila).
- [ ] **Step 4:** commit `feat(campaigns): worker in-process de disparo (claim atômico)`.

---

### Task 6: UI `/app/campanhas` (builder + monitor) + nav

**Files:** `src/app/app/campanhas/page.tsx` (lista + form nova), `src/app/app/campanhas/[id]/page.tsx` (monitor), `src/app/app/campanhas/campaigns-client.tsx`, `src/app/app/campanhas/[id]/monitor-client.tsx`; modify `layout.tsx` (nav "Campanhas").

Builder: nome, textarea de mensagem (dica spintax `{oi|olá}` e `{{nome}}`), select de lista, checkboxes de instâncias conectadas, min/max delay → `createCampaign` → redirect ao monitor. Monitor: contadores por status, botões iniciar/pausar/retomar/cancelar, e amostra das últimas mensagens.

- [ ] **Step 1:** implementar `campaigns-client.tsx` (form nova campanha + lista com link p/ monitor).
- [ ] **Step 2:** implementar `page.tsx` (server: `listCampaigns`, `listConnectedInstances`, `listListsForSelect`) passando p/ o client.
- [ ] **Step 3:** implementar `[id]/page.tsx` (server: `getCampaign`) + `monitor-client.tsx` (contadores + controles chamando start/pause/resume/cancel; botão "Atualizar" recarrega).
- [ ] **Step 4:** nav "Campanhas" no layout.
- [ ] **Step 5:** `npm run build` + `npm test` verdes.
- [ ] **Step 6:** commit `feat(ui): campanhas (builder + monitor)`.

> A UI detalhada segue o padrão das telas anteriores (client component com useTransition chamando as server actions; contadores a partir de `getCampaign().counts`). Manter simples e funcional; o polimento visual vem na fase de redesign.

---

## Self-Review
- Spec §5 (expandir→agendar→enviar→controlar) → Tasks 1,4,5,6. §6 anti-ban (delays/rate/rotação/spintax) → Tasks 2,3 (warmup ativo fica p/ depois; campos já persistidos). Monitor → Task 6. ✔
- Puro/testável: renderer + scheduler (Tasks 2,3). ✔
- Worker adaptado a container persistente (in-process) com claim atômico anti-duplicidade. ✔
- Escrita de campaign_messages via service-role; leitura por RLS. ✔
