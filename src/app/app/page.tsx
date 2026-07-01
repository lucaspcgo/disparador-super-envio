import { createClient } from '@/lib/supabase/server'
import { getCurrentOrg } from '@/lib/org/current'

async function counts() {
  const s = await createClient()
  const [instTotal, instConn, contatos, campAtivas, enviadas] = await Promise.all([
    s.from('whatsapp_instances').select('id', { count: 'exact', head: true }),
    s.from('whatsapp_instances').select('id', { count: 'exact', head: true }).eq('status', 'connected'),
    s.from('contacts').select('id', { count: 'exact', head: true }),
    s.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    s.from('campaign_messages').select('id', { count: 'exact', head: true }).in('status', ['sent', 'delivered', 'read']),
  ])
  return {
    instTotal: instTotal.count ?? 0,
    instConn: instConn.count ?? 0,
    contatos: contatos.count ?? 0,
    campAtivas: campAtivas.count ?? 0,
    enviadas: enviadas.count ?? 0,
  }
}

function Stat({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: boolean }) {
  return (
    <div className="card p-5">
      <div className="text-sm muted">{label}</div>
      <div className={`mt-1 font-[family-name:var(--font-display)] text-3xl font-bold ${accent ? 'text-[var(--color-brand)]' : ''}`}>{value}</div>
      {hint && <div className="mt-1 text-xs muted">{hint}</div>}
    </div>
  )
}

function ShortcutCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a href={href} className="card group flex items-center justify-between p-5 transition hover:border-[var(--color-brand)]">
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm muted">{desc}</div>
      </div>
      <span className="text-[var(--color-brand)] transition group-hover:translate-x-0.5">→</span>
    </a>
  )
}

export default async function AppHome() {
  const [org, c] = await Promise.all([getCurrentOrg(), counts()])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Painel</h1>
          <p className="muted mt-1">Bem-vindo de volta{org ? `, ${org.name}` : ''}. Aqui está o resumo da sua operação.</p>
        </div>
        <a href="/app/campanhas" className="btn btn-primary">Nova campanha</a>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Instâncias conectadas" value={`${c.instConn}/${c.instTotal}`} hint="números de WhatsApp" accent />
        <Stat label="Contatos" value={c.contatos.toLocaleString('pt-BR')} hint="na sua base" />
        <Stat label="Campanhas ativas" value={c.campAtivas} hint="em execução" />
        <Stat label="Mensagens enviadas" value={c.enviadas.toLocaleString('pt-BR')} hint="acumulado" />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Comece por aqui</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <ShortcutCard href="/app/instancias" title="Conectar um número" desc="Evolution ou Meta Cloud API" />
          <ShortcutCard href="/app/contatos" title="Importar contatos" desc="CSV com normalização E.164" />
          <ShortcutCard href="/app/campanhas" title="Criar campanha" desc="Spintax, variáveis e anti-ban" />
        </div>
      </div>
    </div>
  )
}
