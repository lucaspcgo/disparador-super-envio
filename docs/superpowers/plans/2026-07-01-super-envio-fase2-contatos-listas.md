# Super Envio — Fase 2: Contatos & Listas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Gestão de contatos e listas por organização, com import de CSV (normalização E.164, dedupe por telefone) — base de destinatários para o motor de disparo (Fase 3).

**Architecture:** Tabelas `contacts`, `contact_lists`, `contact_list_members` com RLS por `is_org_member`. Import de CSV parseado no server (Server Action), telefones normalizados para E.164 (helper puro, TDD), dedupe via upsert em `unique(organization_id, phone)`. UI em `/app/contatos`.

**Tech Stack:** Next 16, Supabase (Postgres/RLS), Vitest. Migration nº **0005** (via MCP `apply_migration` no projeto `<SEU_PROJETO_REF>` = o projeto novo em uso).

## Global Constraints
- App na RAIZ do repo. UI pt-BR. Toda tabela tem `organization_id` + RLS; enforcement server-side.
- Reusar `getCurrentOrg()` (`@/lib/org/current`), `createClient()` server (`@/lib/supabase/server`), `is_org_member`.
- TDD para lógica pura (normalização E.164, parse CSV). Testes nunca dependem de rede.
- Migrations aplicadas via MCP `apply_migration`; salvar cópia em `supabase/migrations/`.

---

### Task 1: Migration 0005 — contacts / contact_lists / contact_list_members + RLS

**Files:** Create `supabase/migrations/0005_contacts.sql`; aplicar via MCP.

**Produces:**
- `public.contacts(id, organization_id, phone text, name text, custom_fields jsonb default '{}', tags text[] default '{}', created_at, updated_at, unique(organization_id, phone))`
- `public.contact_lists(id, organization_id, name, created_at)`
- `public.contact_list_members(list_id, contact_id, added_at, primary key(list_id, contact_id))`
- RLS em todas por `is_org_member(organization_id)` (para `contact_list_members`, via join na lista).

- [ ] **Step 1: SQL** — `supabase/migrations/0005_contacts.sql`
```sql
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
```
- [ ] **Step 2:** aplicar via MCP `apply_migration` (name `contacts`).
- [ ] **Step 3:** verificar via `list_tables` (rls_enabled) + `get_advisors` (security, sem novos ERROR).
- [ ] **Step 4:** commit `feat(db): contacts + contact_lists + members + RLS (Fase 2)`.

---

### Task 2: Normalização de telefone E.164 (TDD, puro)

**Files:** Create `src/lib/contacts/phone.ts` + `src/lib/contacts/phone.test.ts`.

**Produces:** `normalizePhoneBR(raw: string): string | null` — retorna E.164 (`+55...`) ou `null` se inválido. Default país Brasil (55); aceita número já internacional com `+`.

- [ ] **Step 1: Teste** — `phone.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { normalizePhoneBR } from './phone'

describe('normalizePhoneBR', () => {
  it('celular com DDD (11 dígitos) → +55', () => {
    expect(normalizePhoneBR('11999998888')).toBe('+5511999998888')
  })
  it('formatado com máscara', () => {
    expect(normalizePhoneBR('(11) 99999-8888')).toBe('+5511999998888')
  })
  it('já com 55', () => {
    expect(normalizePhoneBR('5511999998888')).toBe('+5511999998888')
  })
  it('já com +55', () => {
    expect(normalizePhoneBR('+55 11 99999-8888')).toBe('+5511999998888')
  })
  it('remove zero de operadora à esquerda', () => {
    expect(normalizePhoneBR('011999998888')).toBe('+5511999998888')
  })
  it('fixo com DDD (10 dígitos)', () => {
    expect(normalizePhoneBR('1133334444')).toBe('+551133334444')
  })
  it('internacional preservado', () => {
    expect(normalizePhoneBR('+14155552671')).toBe('+14155552671')
  })
  it('inválido → null', () => {
    expect(normalizePhoneBR('123')).toBeNull()
    expect(normalizePhoneBR('')).toBeNull()
    expect(normalizePhoneBR('abc')).toBeNull()
  })
})
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** — `phone.ts`
```ts
// Normaliza telefone para E.164. Foco Brasil (default 55); aceita internacional com '+'.
export function normalizePhoneBR(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const hadPlus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (hadPlus) {
    // Já internacional: valida faixa de tamanho E.164 (8–15 dígitos).
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }

  // Remove zero de operadora à esquerda (ex.: 011...).
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')

  // Já tem código do país 55 + (10 ou 11) dígitos nacionais.
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`
  }
  // Número nacional: DDD (2) + 8 ou 9 dígitos = 10 ou 11.
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`
  }
  return null
}
```
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(contacts): normalização E.164 (TDD)`.

---

### Task 3: Parser de CSV (TDD, puro)

**Files:** Create `src/lib/contacts/csv.ts` + `src/lib/contacts/csv.test.ts`.

**Produces:** `parseContactsCsv(text: string): { rows: ParsedContact[]; errors: string[] }` onde `ParsedContact = { phone: string; name?: string; custom: Record<string,string> }`. Detecta cabeçalho; coluna de telefone = `phone`/`telefone`/`celular`/`whatsapp` (case-insensitive); coluna `name`/`nome`; demais colunas viram `custom`. Normaliza telefone via `normalizePhoneBR`; linhas com telefone inválido vão para `errors`. Dedupe por telefone dentro do arquivo (mantém a primeira).

- [ ] **Step 1: Teste** — `csv.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { parseContactsCsv } from './csv'

describe('parseContactsCsv', () => {
  it('parseia cabeçalho, normaliza telefone e mapeia custom', () => {
    const csv = 'nome,telefone,cidade\nAna,(11) 99999-8888,SP\nBruno,11888887777,RJ'
    const { rows, errors } = parseContactsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { phone: '+5511999998888', name: 'Ana', custom: { cidade: 'SP' } },
      { phone: '+5511888887777', name: 'Bruno', custom: { cidade: 'RJ' } },
    ])
  })
  it('linha com telefone inválido vai para errors', () => {
    const csv = 'telefone,nome\n123,X\n11999998888,Y'
    const { rows, errors } = parseContactsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Y')
    expect(errors).toHaveLength(1)
  })
  it('dedupe por telefone no arquivo (mantém primeiro)', () => {
    const csv = 'telefone,nome\n11999998888,Ana\n(11)99999-8888,Ana2'
    const { rows } = parseContactsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Ana')
  })
  it('sem coluna de telefone → erro geral', () => {
    const { rows, errors } = parseContactsCsv('nome,cidade\nAna,SP')
    expect(rows).toHaveLength(0)
    expect(errors.length).toBeGreaterThan(0)
  })
})
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** — `csv.ts`
```ts
import { normalizePhoneBR } from './phone'

export type ParsedContact = { phone: string; name?: string; custom: Record<string, string> }

const PHONE_KEYS = ['phone', 'telefone', 'celular', 'whatsapp', 'fone', 'numero', 'número']
const NAME_KEYS = ['name', 'nome', 'contato']

function splitLine(line: string): string[] {
  // CSV simples: vírgula ou ponto-e-vírgula; trim de aspas e espaços.
  const sep = line.includes(';') && !line.includes(',') ? ';' : ','
  return line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''))
}

export function parseContactsCsv(text: string): { rows: ParsedContact[]; errors: string[] } {
  const errors: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { rows: [], errors: ['Arquivo vazio'] }

  const header = splitLine(lines[0]).map((h) => h.toLowerCase())
  const phoneIdx = header.findIndex((h) => PHONE_KEYS.includes(h))
  const nameIdx = header.findIndex((h) => NAME_KEYS.includes(h))
  if (phoneIdx === -1) {
    return { rows: [], errors: ['Nenhuma coluna de telefone encontrada (use "telefone" ou "phone")'] }
  }

  const seen = new Set<string>()
  const rows: ParsedContact[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i])
    const phone = normalizePhoneBR(cols[phoneIdx] ?? '')
    if (!phone) {
      errors.push(`Linha ${i + 1}: telefone inválido ("${cols[phoneIdx] ?? ''}")`)
      continue
    }
    if (seen.has(phone)) continue
    seen.add(phone)
    const custom: Record<string, string> = {}
    header.forEach((h, idx) => {
      if (idx === phoneIdx || idx === nameIdx) return
      const v = cols[idx]
      if (v) custom[h] = v
    })
    rows.push({ phone, name: nameIdx >= 0 ? cols[nameIdx] || undefined : undefined, custom })
  }
  return { rows, errors }
}
```
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(contacts): parser de CSV com dedupe (TDD)`.

---

### Task 4: Queries + Server Actions de contatos/listas

**Files:** Create `src/lib/contacts/queries.ts` + `src/lib/contacts/actions.ts`.

**Produces:**
- `listContacts(): Promise<ContactRow[]>`, `listLists(): Promise<ListRow[]>`.
- Actions: `importContacts(formData)` (lê CSV do campo `file` (texto) + `list_name` opcional; parseia, upsert em `contacts` por (org, phone), cria/append lista), `createList(formData)`, `deleteContact(id)`, `deleteList(id)`.

- [ ] **Step 1: queries.ts**
```ts
import { createClient } from '@/lib/supabase/server'

export type ContactRow = { id: string; phone: string; name: string | null; tags: string[]; created_at: string }
export type ListRow = { id: string; name: string; created_at: string }

export async function listContacts(): Promise<ContactRow[]> {
  const s = await createClient()
  const { data } = await s.from('contacts')
    .select('id,phone,name,tags,created_at').order('created_at', { ascending: false }).limit(1000)
  return (data ?? []) as ContactRow[]
}
export async function listLists(): Promise<ListRow[]> {
  const s = await createClient()
  const { data } = await s.from('contact_lists')
    .select('id,name,created_at').order('created_at', { ascending: false })
  return (data ?? []) as ListRow[]
}
```
- [ ] **Step 2: actions.ts**
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrg } from '@/lib/org/current'
import { parseContactsCsv } from './csv'

type Result = { ok: true; imported?: number; skipped?: number } | { ok: false; error: string }

export async function importContacts(formData: FormData): Promise<Result> {
  try {
    const org = await getCurrentOrg()
    if (!org) return { ok: false, error: 'sem organização' }
    const text = String(formData.get('file') ?? '')
    if (!text.trim()) return { ok: false, error: 'CSV vazio' }
    const listName = String(formData.get('list_name') ?? '').trim()
    const { rows, errors } = parseContactsCsv(text)
    if (rows.length === 0) return { ok: false, error: errors[0] ?? 'Nenhum contato válido' }

    const s = await createClient()
    // upsert dedupe por (organization_id, phone)
    const payload = rows.map((r) => ({
      organization_id: org.id, phone: r.phone, name: r.name ?? null, custom_fields: r.custom,
    }))
    const { data: upserted, error } = await s.from('contacts')
      .upsert(payload, { onConflict: 'organization_id,phone' }).select('id')
    if (error) return { ok: false, error: error.message }

    if (listName && upserted) {
      const { data: list } = await s.from('contact_lists')
        .insert({ organization_id: org.id, name: listName }).select('id').single()
      if (list) {
        await s.from('contact_list_members')
          .upsert(upserted.map((c) => ({ list_id: list.id, contact_id: c.id })), { onConflict: 'list_id,contact_id' })
      }
    }
    revalidatePath('/app/contatos')
    return { ok: true, imported: upserted?.length ?? 0, skipped: errors.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function createList(formData: FormData): Promise<Result> {
  try {
    const org = await getCurrentOrg()
    if (!org) return { ok: false, error: 'sem organização' }
    const name = String(formData.get('name') ?? '').trim()
    if (!name) return { ok: false, error: 'nome obrigatório' }
    const s = await createClient()
    const { error } = await s.from('contact_lists').insert({ organization_id: org.id, name })
    if (error) return { ok: false, error: error.message }
    revalidatePath('/app/contatos')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteContact(id: string): Promise<Result> {
  const s = await createClient()
  const { error } = await s.from('contacts').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/contatos')
  return { ok: true }
}
export async function deleteList(id: string): Promise<Result> {
  const s = await createClient()
  const { error } = await s.from('contact_lists').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/app/contatos')
  return { ok: true }
}
```
- [ ] **Step 3:** `npm run build` sem erros.
- [ ] **Step 4:** commit `feat(contacts): queries + server actions (import/list/delete)`.

---

### Task 5: UI `/app/contatos` + link no layout

**Files:** Create `src/app/app/contatos/page.tsx`, `src/app/app/contatos/contacts-client.tsx`; modify `src/app/app/layout.tsx` (add nav "Contatos").

- [ ] **Step 1: page.tsx (server)**
```tsx
import { listContacts, listLists } from '@/lib/contacts/queries'
import { ContactsClient } from './contacts-client'

export default async function ContatosPage() {
  const [contacts, lists] = await Promise.all([listContacts(), listLists()])
  return (
    <div>
      <h1 className="text-2xl font-semibold">Contatos</h1>
      <p className="mb-6 text-sm text-gray-600">{contacts.length} contatos · {lists.length} listas</p>
      <ContactsClient contacts={contacts} lists={lists} />
    </div>
  )
}
```
- [ ] **Step 2: contacts-client.tsx (client)** — importa CSV via `<input type=file>` lido com FileReader→texto, chama `importContacts`; cria lista; lista contatos com excluir.
```tsx
'use client'
import { useState, useTransition } from 'react'
import { importContacts, createList, deleteContact, deleteList } from '@/lib/contacts/actions'
import type { ContactRow, ListRow } from '@/lib/contacts/queries'

export function ContactsClient({ contacts, lists }: { contacts: ContactRow[]; lists: ListRow[] }) {
  const [msg, setMsg] = useState<string | undefined>()
  const [pending, start] = useTransition()

  async function onImport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fileInput = form.elements.namedItem('csv') as HTMLInputElement
    const listName = (form.elements.namedItem('list_name') as HTMLInputElement).value
    const file = fileInput.files?.[0]
    if (!file) { setMsg('Selecione um arquivo CSV'); return }
    const text = await file.text()
    const fd = new FormData(); fd.set('file', text); fd.set('list_name', listName)
    start(async () => {
      const r = await importContacts(fd)
      setMsg(r.ok ? `Importados ${r.imported} (ignorados ${r.skipped ?? 0})` : r.error)
      if (r.ok) form.reset()
    })
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 font-medium">Importar CSV</h2>
        <form onSubmit={onImport} className="grid max-w-md gap-2">
          <input name="csv" type="file" accept=".csv,text/csv" className="text-sm" />
          <input name="list_name" placeholder="Nome da lista (opcional)" className="rounded border px-3 py-2" />
          <button disabled={pending} className="rounded bg-black py-2 text-white disabled:opacity-40">Importar</button>
        </form>
        <p className="mt-2 text-xs text-gray-500">Colunas: <code>telefone</code> (obrigatória), <code>nome</code>, e quaisquer outras viram campos personalizados.</p>
        {msg && <p className="mt-2 text-sm text-gray-700">{msg}</p>}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Listas</h2>
          <form action={(fd) => start(async () => { await createList(fd) })} className="flex gap-2">
            <input name="name" placeholder="Nova lista" className="rounded border px-2 py-1 text-sm" />
            <button className="rounded border px-2 py-1 text-sm">Criar</button>
          </form>
        </div>
        <ul className="divide-y rounded-xl border">
          {lists.length === 0 && <li className="p-4 text-sm text-gray-500">Nenhuma lista.</li>}
          {lists.map((l) => (
            <li key={l.id} className="flex items-center justify-between p-3 text-sm">
              <span>{l.name}</span>
              <button onClick={() => start(async () => { await deleteList(l.id) })} className="text-red-600">Excluir</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Contatos ({contacts.length})</h2>
        <ul className="divide-y rounded-xl border">
          {contacts.length === 0 && <li className="p-4 text-sm text-gray-500">Nenhum contato ainda. Importe um CSV.</li>}
          {contacts.slice(0, 200).map((c) => (
            <li key={c.id} className="flex items-center justify-between p-3 text-sm">
              <span>{c.name ?? '—'} · {c.phone}</span>
              <button onClick={() => start(async () => { await deleteContact(c.id) })} className="text-red-600">Excluir</button>
            </li>
          ))}
        </ul>
        {contacts.length > 200 && <p className="mt-2 text-xs text-gray-500">Mostrando 200 de {contacts.length}.</p>}
      </section>
    </div>
  )
}
```
- [ ] **Step 3:** layout — adicionar `<a href="/app/contatos">Contatos</a>` na nav (após Instâncias).
- [ ] **Step 4:** `npm run build` + `npm test` verdes.
- [ ] **Step 5:** commit `feat(ui): tela de contatos & listas (import CSV)`.

---

## Self-Review
- Spec §4/§7 (contatos, listas, import CSV E.164 dedupe) → Tasks 1–5. ✔
- RLS por org em todas as tabelas (Task 1). ✔
- Lógica pura testada (E.164, CSV) Tasks 2–3. ✔
- Sem placeholders; código completo. ✔
