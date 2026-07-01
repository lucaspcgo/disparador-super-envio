# Super Envio — Fase 0: Fundação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação do SaaS Super Envio: app Next.js com autenticação Supabase, multi-tenant (organizations + memberships + profiles) com RLS, e layout protegido — base sobre a qual as fases seguintes (gateway, contatos, disparo, anti-ban, billing) serão construídas.

**Architecture:** Next.js 15 (App Router) no diretório `super-envio/`, falando com um projeto Supabase hospedado via `@supabase/ssr`. Multi-tenancy modelado como `organizations` (tenant) + `memberships` (usuário↔org com role) + `profiles` (1:1 com `auth.users`). RLS isola tudo por organização. Ao primeiro login, uma organização é provisionada automaticamente e o usuário vira `owner`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, `@supabase/supabase-js`, `@supabase/ssr`, Vitest (unit), Postgres (Supabase).

## Global Constraints

- Nome do produto: **Super Envio**. Idioma da UI: **pt-BR**.
- Projeto Supabase: ref `zolkdsjjrmpsslftfbjw`, URL `https://zolkdsjjrmpsslftfbjw.supabase.co`, região sa-east-1.
- Publishable key (client): `sb_publishable_uBbwE3woEXQHs7g3NYjXIg_2O68W6OZ`.
- Migrations aplicadas via ferramenta Supabase MCP `apply_migration` (Docker/CLI local indisponíveis).
- Todas as tabelas de domínio têm `organization_id` e política **RLS** habilitada. Nenhum enforcement só no cliente.
- Diretório do app: `super-envio/` dentro da raiz do repositório.
- TDD onde a lógica carrega valor (helpers puros, RLS). Commits frequentes.

---

### Task 1: Scaffold do app Next.js + Vitest

**Files:**
- Create: `super-envio/` (projeto Next.js completo via create-next-app)
- Create: `super-envio/vitest.config.ts`
- Create: `super-envio/src/lib/spintax.test.ts` (teste-canário só pra validar o runner)
- Modify: `super-envio/package.json` (script `test`)

**Interfaces:**
- Produces: projeto Next.js buildável com App Router, TypeScript, Tailwind, alias `@/*` → `src/*`; comando `npm test` rodando Vitest.

- [ ] **Step 1: Scaffold**

Run:
```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && npx create-next-app@latest super-envio \
  --typescript --tailwind --app --src-dir --import-alias "@/*" --eslint --use-npm --no-turbopack --yes
```
Expected: cria `super-envio/` com estrutura padrão e instala dependências.

- [ ] **Step 2: Instalar Vitest e deps de teste**

Run:
```bash
cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Criar `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

- [ ] **Step 4: Adicionar script de teste ao `package.json`**

No bloco `"scripts"`, adicionar: `"test": "vitest run"` e `"test:watch": "vitest"`.

- [ ] **Step 5: Teste-canário**

`src/lib/spintax.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('runner', () => {
  it('roda', () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 6: Rodar e verificar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm test`
Expected: PASS (1 teste).

- [ ] **Step 7: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add -A && git commit -m "feat: scaffold Next.js app + Vitest (Super Envio Fase 0)"
```

---

### Task 2: Env + clientes Supabase (browser/server SSR)

**Files:**
- Create: `super-envio/.env.local`
- Create: `super-envio/.env.example`
- Create: `super-envio/src/lib/supabase/client.ts`
- Create: `super-envio/src/lib/supabase/server.ts`
- Create: `super-envio/src/lib/supabase/middleware.ts`
- Create: `super-envio/middleware.ts`

**Interfaces:**
- Produces:
  - `createClient()` (browser) em `@/lib/supabase/client` → `SupabaseClient`
  - `createClient()` (server, async) em `@/lib/supabase/server` → `Promise<SupabaseClient>`
  - `updateSession(request: NextRequest): Promise<NextResponse>` em `@/lib/supabase/middleware`

- [ ] **Step 1: Instalar deps**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm i @supabase/supabase-js @supabase/ssr`

- [ ] **Step 2: `.env.local` e `.env.example`**

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://zolkdsjjrmpsslftfbjw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_uBbwE3woEXQHs7g3NYjXIg_2O68W6OZ
```
`.env.example` (mesmas chaves, valores vazios). Confirmar que `.env*` está no `.gitignore` da raiz.

- [ ] **Step 3: Client browser** — `src/lib/supabase/client.ts`

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 4: Client server** — `src/lib/supabase/server.ts`

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch { /* chamado de Server Component: ignorável */ }
        },
      },
    },
  )
}
```

- [ ] **Step 5: Middleware de sessão** — `src/lib/supabase/middleware.ts`

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options))
        },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isAuthPage = path.startsWith('/login') || path.startsWith('/signup')
  const isPublic = isAuthPage || path.startsWith('/auth')
  if (!user && !isPublic) {
    const url = request.nextUrl.clone(); url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  if (user && isAuthPage) {
    const url = request.nextUrl.clone(); url.pathname = '/app'
    return NextResponse.redirect(url)
  }
  return response
}
```

- [ ] **Step 6: `middleware.ts` na raiz do app**

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 7: Verificar build**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm run build`
Expected: build sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add -A && git commit -m "feat: clientes Supabase SSR + middleware de sessão"
```

---

### Task 3: Schema multi-tenant + RLS (migration)

**Files:**
- Aplicado via `apply_migration` (MCP) no projeto `zolkdsjjrmpsslftfbjw`
- Create: `super-envio/supabase/migrations/0001_foundation.sql` (cópia versionada do SQL aplicado)

**Interfaces:**
- Produces (tabelas):
  - `public.organizations(id uuid pk, slug text unique, name text, created_by uuid, created_at, updated_at)`
  - `public.profiles(id uuid pk = auth.users.id, full_name text, avatar_url text, created_at, updated_at)`
  - `public.memberships(id uuid pk, organization_id uuid fk, user_id uuid fk, role member_role, created_at, unique(organization_id,user_id))`
  - enum `public.member_role` = ('owner','admin','member')
  - função `public.is_org_member(org uuid) returns boolean` (SECURITY DEFINER) para uso nas policies
  - trigger `on_auth_user_created` → cria `profiles` row

- [ ] **Step 1: Escrever o SQL da migration**

Conteúdo (também salvar em `super-envio/supabase/migrations/0001_foundation.sql`):
```sql
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

-- profiles: dono lê/edita o próprio
create policy "profiles_self_select" on public.profiles for select using (id = auth.uid());
create policy "profiles_self_update" on public.profiles for update using (id = auth.uid());

-- organizations: membros leem; qualquer autenticado cria (vira owner via app)
create policy "orgs_member_select" on public.organizations for select using (public.is_org_member(id));
create policy "orgs_insert_auth" on public.organizations for insert with check (auth.uid() = created_by);
create policy "orgs_owner_update" on public.organizations for update using (
  exists (select 1 from public.memberships m
          where m.organization_id = id and m.user_id = auth.uid() and m.role in ('owner','admin'))
);

-- memberships: membros da org leem; usuário insere a própria linha (bootstrap do owner)
create policy "memberships_member_select" on public.memberships for select using (public.is_org_member(organization_id));
create policy "memberships_self_insert" on public.memberships for insert with check (user_id = auth.uid());
```

- [ ] **Step 2: Aplicar a migration**

Via ferramenta MCP `apply_migration` (project_id `zolkdsjjrmpsslftfbjw`, name `foundation`, query = SQL acima).

- [ ] **Step 3: Verificar**

Via MCP `list_tables` (schema public) → confirmar `organizations`, `profiles`, `memberships` com `rls_enabled: true`.
Via MCP `get_advisors` (type security) → sem erros críticos de RLS.

- [ ] **Step 4: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add -A && git commit -m "feat(db): schema multi-tenant (organizations/memberships/profiles) + RLS"
```

---

### Task 4: Helper de provisionamento de organização (TDD)

**Files:**
- Create: `super-envio/src/lib/org/slug.ts`
- Create: `super-envio/src/lib/org/slug.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `slugify(name: string): string` em `@/lib/org/slug` — normaliza para slug URL-safe (minúsculas, sem acentos, hífens).

- [ ] **Step 1: Teste que falha** — `src/lib/org/slug.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('normaliza nome com acentos e espaços', () => {
    expect(slugify('Minha Organização')).toBe('minha-organizacao')
  })
  it('remove símbolos e colapsa hífens', () => {
    expect(slugify('  A&B  Envios!! ')).toBe('a-b-envios')
  })
  it('vazio vira string vazia', () => {
    expect(slugify('')).toBe('')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/org/slug.test.ts`
Expected: FAIL ("slug" não existe).

- [ ] **Step 3: Implementar** — `src/lib/org/slug.ts`

```ts
export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npx vitest run src/lib/org/slug.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add -A && git commit -m "feat: helper slugify para provisionamento de organização"
```

---

### Task 5: Páginas de autenticação (signup/login/logout) + server actions

**Files:**
- Create: `super-envio/src/app/(auth)/login/page.tsx`
- Create: `super-envio/src/app/(auth)/signup/page.tsx`
- Create: `super-envio/src/app/(auth)/actions.ts`
- Create: `super-envio/src/app/auth/signout/route.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server`; `slugify` de `@/lib/org/slug`.
- Produces: server actions `login(formData)`, `signup(formData)`; rota POST `/auth/signout`.

- [ ] **Step 1: Server actions** — `src/app/(auth)/actions.ts`

```ts
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
  const orgName = String(formData.get('org_name') ?? 'Minha Empresa')
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: fullName } },
  })
  if (error || !data.user) redirect('/signup?error=' + encodeURIComponent(error?.message ?? 'Falha no cadastro'))

  // Provisiona organização + membership owner (RLS: created_by/user_id = auth.uid())
  const slug = (slugify(orgName) || 'org') + '-' + data.user.id.slice(0, 8)
  const { data: org, error: orgErr } = await supabase
    .from('organizations').insert({ name: orgName, slug, created_by: data.user.id })
    .select('id').single()
  if (orgErr || !org) redirect('/signup?error=' + encodeURIComponent(orgErr?.message ?? 'Falha ao criar organização'))
  await supabase.from('memberships').insert({ organization_id: org.id, user_id: data.user.id, role: 'owner' })

  revalidatePath('/', 'layout')
  redirect('/app')
}
```

> Nota: requer que "Confirm email" esteja desativado no Supabase Auth para login imediato pós-signup (configurar no dashboard, ou tratar tela de "confirme seu e-mail"). Para a Fase 0, desativar confirmação de e-mail.

- [ ] **Step 2: Página de login** — `src/app/(auth)/login/page.tsx`

```tsx
import { login } from '../actions'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Entrar no Super Envio</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input name="email" type="email" required placeholder="E-mail" className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" required placeholder="Senha" className="w-full rounded border px-3 py-2" />
        <button className="w-full rounded bg-black py-2 text-white">Entrar</button>
        <a href="/signup" className="block text-center text-sm text-gray-600">Criar conta</a>
      </form>
    </main>
  )
}
```

- [ ] **Step 3: Página de signup** — `src/app/(auth)/signup/page.tsx`

```tsx
import { signup } from '../actions'

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={signup} className="w-full max-w-sm space-y-4 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Criar conta</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input name="full_name" placeholder="Seu nome" className="w-full rounded border px-3 py-2" />
        <input name="org_name" placeholder="Nome da empresa" className="w-full rounded border px-3 py-2" />
        <input name="email" type="email" required placeholder="E-mail" className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" required minLength={6} placeholder="Senha" className="w-full rounded border px-3 py-2" />
        <button className="w-full rounded bg-black py-2 text-white">Cadastrar</button>
        <a href="/login" className="block text-center text-sm text-gray-600">Já tenho conta</a>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Signout** — `src/app/auth/signout/route.ts`

```ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
```

- [ ] **Step 5: Verificar build**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm run build`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add -A && git commit -m "feat: auth (login/signup/logout) + provisionamento de organização"
```

---

### Task 6: Layout protegido do app + contexto da organização

**Files:**
- Create: `super-envio/src/lib/org/current.ts`
- Create: `super-envio/src/app/app/layout.tsx`
- Create: `super-envio/src/app/app/page.tsx`
- Modify: `super-envio/src/app/page.tsx` (redirect raiz → `/app`)

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server`.
- Produces: `getCurrentOrg(): Promise<{ id: string; name: string; role: string } | null>` em `@/lib/org/current`.

- [ ] **Step 1: Helper de org atual** — `src/lib/org/current.ts`

```ts
import { createClient } from '@/lib/supabase/server'

export async function getCurrentOrg() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('memberships')
    .select('role, organization:organizations(id, name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data?.organization) return null
  const org = data.organization as unknown as { id: string; name: string }
  return { id: org.id, name: org.name, role: data.role as string }
}
```

- [ ] **Step 2: Layout do app** — `src/app/app/layout.tsx`

```tsx
import { redirect } from 'next/navigation'
import { getCurrentOrg } from '@/lib/org/current'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await getCurrentOrg()
  if (!org) redirect('/login')
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="font-semibold">Super Envio</div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-600">{org.name} · {org.role}</span>
          <form action="/auth/signout" method="post">
            <button className="rounded border px-3 py-1">Sair</button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Home do app** — `src/app/app/page.tsx`

```tsx
export default function AppHome() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Painel</h1>
      <p className="mt-2 text-gray-600">
        Fundação pronta. Próximas fases: instâncias/gateway, contatos, motor de disparo.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Redirect da raiz** — `src/app/page.tsx`

```tsx
import { redirect } from 'next/navigation'
export default function Home() { redirect('/app') }
```

- [ ] **Step 5: Verificar build + testes**

Run: `cd "/Users/lucaspereira/CRM DISPARADOR/super-envio" && npm run build && npm test`
Expected: build sem erros; testes PASS.

- [ ] **Step 6: Commit**

```bash
cd "/Users/lucaspereira/CRM DISPARADOR" && git add -A && git commit -m "feat: layout protegido do app + contexto de organização"
```

---

## Self-Review

**Spec coverage (Fase 0):** multi-tenant (organizations/memberships/profiles + RLS) → Task 3; auth → Task 5; layout protegido → Task 6; base de testes → Task 1/4. Gateway, contatos, campanhas, anti-ban, billing = fases seguintes (planos próprios). ✔
**Placeholders:** nenhum "TODO/TBD"; todo passo tem código/comando real. ✔
**Type consistency:** `createClient` (server async) usado consistentemente; `getCurrentOrg`, `slugify`, `is_org_member`, `handle_new_user` batem entre tasks. ✔

## Notas para execução

- Antes da Task 5 funcionar de ponta a ponta, desativar "Confirm email" no Supabase Auth (dashboard → Authentication → Providers → Email) para o login pós-signup ser imediato na Fase 0.
- As migrations são aplicadas via MCP `apply_migration` (não há Docker/CLI local).
