# Super Envio — Fase 1: Instâncias + `WhatsAppGateway` — Design

**Data:** 2026-07-01
**Status:** Aprovado para planejamento
**Depende de:** Fase 0 (fundação — auth, `organizations`/`memberships`/`profiles` + RLS, layout protegido)
**Spec-mãe:** `docs/superpowers/specs/2026-06-30-super-envio-disparo-design.md` (§3, §4, §6, §8)

---

## 1. Objetivo e escopo

Entregar a camada de **conexões de WhatsApp** do Super Envio: a abstração
`WhatsAppGateway` e a gestão de **instâncias** (uma instância = uma conexão de número),
sobre a qual o motor de disparo (Fase 3) será construído.

**Escopo desta fase — os três provedores, construídos e validados de verdade:**
1. **Evolution API — BYO**: cliente informa `baseUrl + apiKey + instanceName`.
2. **Evolution API — gerenciada**: nós provisionamos a instância num host Evolution nosso
   (global admin key); cliente só escaneia o QR.
3. **Meta WhatsApp Cloud API**: `phoneNumberId + wabaId + accessToken` (WABA).

Estruturado internamente em três fatias sequenciais (1a BYO → 1b Managed → 1c Meta) sobre a
mesma abstração, entregues juntas na Fase 1.

**Credenciais dos provedores são cifradas no Supabase Vault** e nunca retornam ao cliente (spec §8).

**Foco = ciclo de vida da conexão.** O envio de mensagens em massa é a Fase 3; aqui incluímos
`sendText`/`sendTemplate` na interface e um botão **"enviar mensagem de teste"** para provar a
cadeia gateway→provedor ponta-a-ponta.

### Fora de escopo (fases seguintes)
- Motor de disparo / campanhas / expansão / worker pg_cron (Fase 3).
- Anti-ban completo: cálculo de `send_at`, rotação ponderada, warmup ativo (Fase 4). Aqui só
  **persistimos** os campos (`hourly_limit`, `daily_limit`, `warmup_level`) com defaults.
- Webhooks de status de entrega (Fase 5).
- Billing Mercado Pago e o mapeamento plano→limite (Fase 6). Aqui há uma **ponte** de enforcement.

---

## 2. Abstração `WhatsAppGateway`

Interface única implementada pelos 3 provedores. É a fronteira que isola o resto do sistema dos
detalhes de cada API.

```ts
type Provider = 'evolution_byo' | 'evolution_managed' | 'meta_cloud'

type ConnState = {
  status: 'connecting' | 'connected' | 'disconnected'
  qr?: string          // base64/data-url do QR (Evolution, quando connecting)
  phoneNumber?: string // E.164, quando conhecido
}

interface WhatsAppGateway {
  readonly provider: Provider
  // Ciclo de vida da conexão
  ensureConnection(): Promise<ConnState>   // BYO: valida creds · managed: cria se preciso + QR · meta: verifica token
  getConnectionState(): Promise<ConnState> // status atual (+ QR se connecting)
  disconnect(): Promise<void>              // logout/delete conforme provedor
  // Mensageria (uso pleno na Fase 3; "mensagem de teste" nesta fase)
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>
  sendTemplate(to: string, name: string, vars: string[]): Promise<{ providerMessageId: string }>
}
```

### Implementações

- **`EvolutionByoGateway`** — recebe `{ baseUrl, apiKey, instanceName }`.
  Endpoints Evolution API (header `apikey`):
  - `GET  /instance/connectionState/{instance}` → status.
  - `GET  /instance/connect/{instance}` → QR (`base64`) quando desconectado.
  - `POST /message/sendText/{instance}` → `{ number, text }`.
  - `DELETE /instance/logout/{instance}` → desconecta.
  - `sendTemplate` → não suportado (Evolution usa texto livre); chamada lança erro claro.

- **`EvolutionManagedGateway`** — usa **global admin key + host nosso** (env
  `EVOLUTION_MANAGED_URL`, `EVOLUTION_MANAGED_GLOBAL_KEY`), não credenciais do cliente.
  - `POST /instance/create` `{ instanceName, qrcode: true, integration }` → provisiona e devolve
    o **apikey per-instância** (guardado no Vault) + QR inicial.
  - Depois de criada, delega a `EvolutionByoGateway` (mesmos endpoints connect/status/send).
  - `DELETE /instance/delete/{instance}` no descarte da instância.

- **`MetaCloudGateway`** — recebe `{ phoneNumberId, wabaId, accessToken }`.
  - "Conexão": não há QR. `GET /{phoneNumberId}?fields=verified_name,display_phone_number` valida
    token/número → `connected` (ou `disconnected` se falhar).
  - `sendText` → Graph `POST /{phoneNumberId}/messages` `{ messaging_product, to, type:text, text }`
    (só válido dentro da janela de 24h).
  - `sendTemplate(name, vars)` → `type:template` com componentes de parâmetros posicionais
    (business-initiated fora da janela — restrição anti-ban §6). É o caminho primário do Meta.

### Factory

```ts
createGateway(instanceId): Promise<WhatsAppGateway>
```
Busca a linha de `whatsapp_instances` + credenciais **descriptografadas via RPC**
(`get_instance_credential`), instancia a classe do provedor. Roda **apenas server-side**.

---

## 3. Modelo de dados

### `whatsapp_instances`
Toda a tabela tem `organization_id` e RLS por membership (spec §8).

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid pk | |
| `organization_id` | uuid fk → organizations | RLS |
| `provider` | enum `wa_provider` | `evolution_byo`/`evolution_managed`/`meta_cloud` |
| `name` | text | rótulo amigável |
| `status` | enum `wa_conn_status` | `connecting`/`connected`/`disconnected` |
| `phone_number` | text null | E.164 quando conhecido |
| `evolution_instance_name` | text null | config **não-secreta** (Evolution) |
| `meta_phone_number_id` | text null | config **não-secreta** (Meta) |
| `meta_waba_id` | text null | config **não-secreta** (Meta) |
| `vault_secret_id` | uuid null | referência ao secret JSON no Vault |
| `hourly_limit` | int not null default 20 | usado na Fase 4 |
| `daily_limit` | int not null default 200 | usado na Fase 4 |
| `warmup_level` | int not null default 0 | usado na Fase 4 |
| `created_at`/`updated_at` | timestamptz | |

Enums: `create type wa_provider as enum (...)`, `create type wa_conn_status as enum (...)`.

### Credenciais no Vault
Um **único secret JSON por instância** (uniforme), referenciado por `vault_secret_id`:
- BYO: `{ "baseUrl": "...", "apiKey": "..." }`
- Managed: `{ "baseUrl": "...", "apiKey": "<apikey per-instância>" }`
- Meta: `{ "accessToken": "..." }`

Config não-secreta (instanceName, phoneNumberId, wabaId, baseUrl do managed) fica em colunas —
pode voltar ao cliente. **Segredos nunca voltam ao cliente.**

### Acesso a credenciais — RPCs `SECURITY DEFINER`
Evita embarcar a **service-role key** no app. As funções checam membership por `auth.uid()`:

- `create_instance_credential(org uuid, provider wa_provider, config jsonb, secret jsonb,
   name text) returns uuid`
  Valida membership → **enforce de limite** (§4) → `vault.create_secret(secret::text, ...)` →
  insere `whatsapp_instances` (status inicial `connecting`) → retorna `id`.
- `get_instance_credential(instance_id uuid) returns jsonb`
  Valida que `auth.uid()` é membro da org da instância → lê `vault.decrypted_secrets` →
  retorna o JSON. Somente server-side.
- (opcional) `set_instance_state(instance_id uuid, status wa_conn_status, phone text)` —
  atualiza status/telefone após `ensureConnection`/poll (respeitando membership).

---

## 4. Ponte de enforcement de plano

Billing é Fase 6. Ponte agora:
- Coluna `organizations.instance_limit int not null default 1` (plano Start = 1 instância).
- `create_instance_credential` conta instâncias **ativas** (status ≠ `disconnected`? — decisão:
  contar **todas** as linhas da org, pois cada linha ocupa um "slot" de número) da org; se
  `>= instance_limit`, `raise exception`. → **decisão:** contar todas as instâncias não-excluídas.
- Fase 6 passará a **atualizar** `instance_limit` conforme a assinatura (Start 1 / Pro 3 / Premium 5).

Enforce é **no servidor** (RPC), nunca só no frontend. A UI apenas espelha (desabilita botão).

---

## 5. Telas (`/app/instancias`, pt-BR)

- **Lista de instâncias**: nome, provedor, badge de status (connecting/connected/disconnected),
  telefone, limites (hora/dia). Vazio → CTA "Conectar sua primeira instância".
- **Conectar instância** (escolhe provedor):
  - **BYO**: `baseUrl`, `apiKey`, `instanceName` → `ensureConnection` valida → salva.
  - **Managed**: `name` → provisiona no host → exibe **QR** → **poll** `getConnectionState`
    até `connected`, atualizando status/telefone.
  - **Meta**: `name`, `phoneNumberId`, `wabaId`, `accessToken` → verifica token → salva.
- **Ações por instância**: reconectar (novo QR/revalidar), desconectar, excluir (managed →
  `instance/delete`; todas → remove secret do Vault + linha), **enviar mensagem de teste**
  (número + texto; Meta usa template de teste) — valida a cadeia ponta-a-ponta.
- Botão "Conectar" **desabilitado** quando ativos `>= instance_limit` (com dica de upgrade).

Server actions em `src/lib/instances/*` (create/connect/poll-state/disconnect/delete/test-send)
+ query de listagem. UI em `src/app/app/instancias/`.

---

## 6. Estrutura de código (unidades isoladas)

```
src/lib/wa/
  types.ts        # Provider, ConnState, WhatsAppGateway, tipos de credencial
  evolution.ts    # cliente HTTP Evolution + EvolutionByoGateway/EvolutionManagedGateway
  meta.ts         # MetaCloudGateway
  factory.ts      # createGateway(instanceId) → resolve creds via RPC
src/lib/instances/
  actions.ts      # server actions (create/connect/disconnect/delete/test-send)
  queries.ts      # listagem de instâncias da org
src/app/app/instancias/
  page.tsx, + componentes (lista, wizard de conexão, QR, ações)
super-envio/supabase/migrations/0002_instances.sql
```

Cada unidade: propósito único, interface bem definida, testável isolada. O gateway não conhece
Next/Supabase; as server actions orquestram gateway + RPCs.

> **Next 16:** respeitar breaking changes (AGENTS.md). `cookies()` async; middleware é `proxy`.
> Server actions/route handlers usam o client SSR já existente da Fase 0.

---

## 7. Testes

TDD onde a lógica carrega valor. **Nenhum envio real de WhatsApp no CI** (spec §9/§11).

- **Unit (fetch mockado):**
  - Cada gateway: endpoints/headers/payloads corretos e mapeamento de resposta
    (`connectionState` → `ConnState`; `connect` → QR; `sendText` → `providerMessageId`).
  - `MetaCloudGateway.sendTemplate` monta componentes de parâmetros corretamente; `sendText`
    monta payload de texto; `EvolutionByoGateway.sendTemplate` lança erro.
  - `factory` seleciona a classe certa por `provider`.
  - Serialização/parse do secret JSON por provedor.
- **Integração (SQL/RLS):**
  - `create_instance_credential` cria secret no Vault + linha; `get_instance_credential`
    respeita membership (nega para não-membro).
  - Enforce de limite: bloqueia ao atingir `instance_limit`.
- **Verificação manual (fora do CI):** conectar uma instância BYO real, provisionar uma managed
  (QR real), verificar um número Meta de teste, e "enviar mensagem de teste" em cada um.

---

## 8. Env / segredos novos (server-only, nunca `NEXT_PUBLIC_`)

- `EVOLUTION_MANAGED_URL` — base URL do host Evolution que administramos.
- `EVOLUTION_MANAGED_GLOBAL_KEY` — global admin apikey para criar/deletar instâncias.

(Credenciais BYO e Meta são por-instância → Vault, não env.)

---

## 9. Riscos / decisões

- **Vault + RLS:** leitura de `vault.decrypted_secrets` exige role elevada → encapsulada em RPC
  `SECURITY DEFINER` que valida `auth.uid()`; app não recebe service-role key.
- **Poll de QR:** managed/BYO conectam de forma assíncrona → UI faz polling do estado; sem
  webhooks nesta fase (isso é Fase 5).
- **Meta janela 24h:** `sendText` só dentro da janela; caminho primário é `sendTemplate` (HSM).
- **Contagem de limite:** conta todas as instâncias não-excluídas da org (cada número = 1 slot).
