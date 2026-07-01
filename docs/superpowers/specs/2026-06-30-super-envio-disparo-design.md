# Super Envio — Design do MVP (Motor de Disparo WhatsApp)

**Data:** 2026-06-30
**Status:** Aprovado para planejamento
**Substitui:** a extensão Chrome "Manager Pro" (client-only sobre Evolution API)

---

## 1. Visão geral

**Super Envio** é um SaaS multi-tenant de **disparo de mensagens em massa no WhatsApp**, com
motor de envio **server-side** (funciona com o navegador fechado), anti-ban integrado e
relatórios de entrega reais. Sucede a extensão "Manager Pro", que rodava 100% no navegador e
falava direto com a Evolution API — modelo frágil para disparo (browser precisa ficar aberto,
credenciais expostas, sem fila/rate-limit, sem agendamento confiável).

**Núcleo do MVP:** o motor de disparo. Tudo o mais existe para servir campanhas confiáveis e
seguras contra banimento.

### Provedores suportados (camada de abstração `WhatsAppGateway`)
1. **Evolution API — BYO**: o cliente informa URL + API key da própria instância.
2. **Evolution API — gerenciada**: nós provisionamos a instância; o cliente só escaneia o QR.
3. **Meta WhatsApp Cloud API (oficial)**: conexão via número WABA + token.

> Uma "instância" = uma conexão de número. O limite de instâncias por plano vale para qualquer
> provedor.

---

## 2. Planos e limites

Cobrança **mensal recorrente** via **Mercado Pago** (Pix, boleto, cartão). Pagamento completo
já na v1: checkout → webhook confirma → plano aplicado automaticamente.

| Plano   | Preço/mês | Instâncias | Teto de envio/mês              |
|---------|-----------|------------|--------------------------------|
| Start   | R$ 97     | 1          | 5.000 mensagens                |
| Pro     | R$ 297    | 3          | 20.000 mensagens               |
| Premium | R$ 397    | 5          | Ilimitado (só rate anti-ban)   |

Regras de enforcement:
- **Instâncias:** ao criar/conectar, bloquear se o total ativo do tenant já atingiu o limite do plano.
- **Teto mensal:** contador de mensagens enviadas no ciclo de faturamento; ao atingir, novas
  mensagens de campanha ficam bloqueadas até o próximo ciclo ou upgrade. Premium = sem teto
  (limitado apenas pelo rate por instância).
- Tenant sem assinatura ativa: acesso somente-leitura / não pode disparar.

---

## 3. Stack & arquitetura

- **Next.js 15 (App Router)** — frontend + rotas de API (serverless na Vercel).
- **Supabase**:
  - **Postgres** + **RLS** (isolamento multi-tenant por `tenant_id`).
  - **Auth** (e-mail/senha + magic link).
  - **Storage** (mídia das campanhas).
  - **pgmq** (fila para jobs pesados, ex.: expandir campanha) + **pg_cron** (dispara o worker periódico).
  - **Vault / pgsodium** (criptografia de API keys e tokens dos provedores).
- **Evolution API** e **Meta Cloud API** atrás de `WhatsAppGateway`.

### Decisão-chave: agendamento por `send_at` (não fila pura)

O anti-ban exige **timing preciso por mensagem** e **janelas de cota por instância**. Portanto:

- Cada `campaign_message` recebe um `send_at` (timestamp) calculado com delays aleatórios
  acumulados, respeitando os tetos horário/diário da instância.
- Um **pg_cron a cada ~30–60s** invoca um **worker (Supabase Edge Function)** que seleciona
  apenas as mensagens vencidas (`send_at <= now()`, status `pending`) dentro da cota restante da
  instância, envia via gateway e atualiza o status.

**Alternativas descartadas:**
- *Fila pura (pgmq isolado):* não oferece controle fino de timing anti-ban.
- *Worker Node dedicado + Redis/BullMQ:* mais robusto em escala, mas adiciona infra que o
  Supabase já cobre no MVP. Fica como caminho de evolução se o volume exigir.

---

## 4. Modelo de dados

Todas as tabelas de domínio têm `tenant_id` e política **RLS**.

- **`tenants`** — workspace/organização; guarda plano atual, status da assinatura, ciclo de faturamento.
- **`profiles`** — usuário (↔ `auth.users`), pertence a um tenant, `role` (owner/member).
- **`subscriptions`** — histórico de assinaturas Mercado Pago (plano, status, `mp_subscription_id`, período).
- **`whatsapp_instances`** — `provider` (evolution_byo | evolution_managed | meta_cloud),
  credenciais criptografadas, `status` (connecting/connected/disconnected), `phone_number`,
  `hourly_limit`, `daily_limit`, `warmup_level`.
- **`contacts`** — `phone` (E.164), `name`, `custom_fields` (jsonb), `tags` (array).
- **`contact_lists`** e **`contact_list_members`** — segmentação.
- **`campaigns`** — `status` (draft→scheduled→running→paused→completed), `message_template`
  (spintax + variáveis), refs de mídia, `throttle_config`, `instance_ids` (rotação),
  `scheduled_at`.
- **`campaign_messages`** — 1 por destinatário: `instance_id` atribuída, `rendered_text`,
  `send_at`, `status` (pending→sending→sent→delivered→read→failed), `provider_message_id`,
  `error`, timestamps.
- **`warmup_runs`** — execuções de aquecimento (par de instâncias, agenda, volume).
- **`webhook_events`** — eventos de status recebidos dos provedores (auditoria + dedupe).

---

## 5. Motor de disparo (fluxo)

1. **Iniciar campanha** → enfileira job `expand_campaign` (pgmq).
2. **Expandir** (worker do job): para cada membro da lista:
   - Atribui uma instância por **rotação ponderada** (peso = cota restante × maturidade de warmup).
   - Renderiza **spintax + variáveis do contato** (ver §6).
   - Calcula `send_at` acumulando delays aleatórios e respeitando os tetos horário/diário de cada
     instância (a campanha "esparrama" no tempo conforme o volume e o número de instâncias).
   - Insere `campaign_messages` em lote.
3. **Enviar** (worker pg_cron, a cada ~30–60s): seleciona mensagens vencidas dentro da cota,
   marca `sending`, envia via `WhatsAppGateway`, grava `provider_message_id` e status.
4. **Confirmar entrega**: webhooks dos provedores → endpoint Next.js (valida token/assinatura) →
   atualiza `sent/delivered/read/failed` em `campaign_messages` → alimenta os relatórios.
5. **Controle**: campanha pode ser **pausada/retomada** (worker ignora mensagens de campanhas
   pausadas) e cancelada.

---

## 6. Anti-ban

1. **Delays aleatórios + rate limit** — intervalo aleatório entre mensagens (min/max
   configuráveis) e tetos **horário** e **diário** por instância, aplicados no cálculo de `send_at`
   e reforçados no momento do envio.
2. **Spintax + variáveis** — sintaxe `{oi|olá|e aí}` sorteada por mensagem, mais variáveis do
   contato `{{nome}}`, `{{campo_custom}}`. Renderer determinístico e testável.
   - **Restrição Meta Cloud API:** mensagens business-initiated fora da janela de 24h exigem
     **template aprovado (HSM)** com variáveis posicionais — não aceitam spintax livre no corpo.
     O gateway trata isso: provider Evolution = texto livre + spintax; provider Meta = template
     aprovado + variáveis (spintax do corpo é ignorado, variáveis mapeadas para parâmetros do
     template).
3. **Rotação de múltiplos números** — distribui os destinatários entre as instâncias selecionadas,
   ponderada por cota restante e nível de warmup.
4. **Warmup (v1 enxuto)** — instâncias do próprio tenant trocam mensagens entre si em ritmo lento e
   crescente; `warmup_level` sobe com o tempo e eleva o **limite diário efetivo** da instância.
   Sem warmup, uma instância nova entra com limite conservador.

---

## 7. Frontend (telas)

- **Auth** (Supabase Auth) + onboarding.
- **Assinatura/planos** — escolher plano, checkout Mercado Pago, status da assinatura.
- **Instâncias** — conectar (QR gerenciado / creds Evolution BYO / número WABA Meta), status,
  limites, warmup. Bloqueia criação acima do limite do plano.
- **Contatos & Listas** — importar CSV (normalização E.164, dedupe por telefone), tags, criar listas.
- **Builder de campanha** — selecionar lista + compor mensagem (spintax/variáveis/mídia, ou template
  Meta) + escolher instâncias da rotação + throttle + agendamento.
- **Monitor ao vivo** — progresso (pending/sent/delivered/read/failed), pausar/retomar/cancelar, log
  por mensagem.
- **Dashboard** — métricas de entregabilidade e consumo da cota do plano.

---

## 8. Segurança & multi-tenancy

- **RLS** por `tenant_id` em todas as tabelas de domínio.
- Credenciais dos provedores (Evolution key, Meta token) **criptografadas no Vault**; nunca
  retornadas ao cliente.
- Endpoint de webhook **público mas validado** (token por instância / assinatura do provedor) e com
  **dedupe** por id de evento.
- Enforcement de plano no servidor (instâncias e teto de envio), nunca só no frontend.

---

## 9. Testes

- **Unit:** renderer de spintax/variáveis; normalização de telefone (E.164); cálculo de `send_at`
  com delays + rate limit; rotação ponderada; enforcement de cota do plano.
- **Integração:** expansão de campanha (lista → `campaign_messages`); ciclo do worker (seleção por
  cota + atualização de status); handler de webhook (atualiza status + dedupe).
- **Gateway mockado** — nenhum envio real de WhatsApp nos testes.

---

## 10. Fora de escopo da v1 (preparado no schema, não construído)

- Inbox multiatendimento / chat ao vivo por atendente.
- Chatbot / construtor de fluxos; integrações Typebot, Chatwoot, RabbitMQ.
- Analytics avançado (coortes, A/B de mensagens).
- App/extensão de navegador (foco é web app).

---

## 11. Fases de implementação (a detalhar no plano)

- **Fase 0** — Fundação: projeto Next.js + Supabase, auth, tenants, RLS, layout base.
- **Fase 1** — Instâncias + `WhatsAppGateway` (Evolution BYO primeiro; managed e Meta em seguida).
- **Fase 2** — Contatos & listas (import CSV, E.164, dedupe).
- **Fase 3** — Motor de disparo (schema de campanhas, expansão via pgmq, worker pg_cron, envio).
- **Fase 4** — Anti-ban (delays/rate, spintax, rotação, warmup).
- **Fase 5** — Webhooks + monitor ao vivo + relatórios de entrega.
- **Fase 6** — Billing Mercado Pago (planos, checkout, webhook, enforcement de limites).
