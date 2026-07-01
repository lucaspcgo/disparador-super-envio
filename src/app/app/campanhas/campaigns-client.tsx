'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCampaign } from '@/lib/campaigns/actions'
import type { CampaignRow } from '@/lib/campaigns/queries'

type InstanceOption = { id: string; name: string; provider: string; status: string; hourly_limit: number }
type ListOption = { id: string; name: string }

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', scheduled: 'Agendada', running: 'Em andamento', paused: 'Pausada', canceled: 'Cancelada', completed: 'Concluída',
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-muted',
  scheduled: 'badge-brand',
  running: 'badge-ok',
  paused: 'badge-warn',
  completed: 'badge-brand',
  canceled: 'badge-danger',
}

export function CampaignsClient({
  campaigns, instances, lists,
}: { campaigns: CampaignRow[]; instances: InstanceOption[]; lists: ListOption[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | undefined>()
  const [pending, start] = useTransition()

  function onSubmit(fd: FormData) {
    setError(undefined)
    start(async () => {
      const r = await createCampaign(fd)
      if (!r.ok) { setError(r.error); return }
      if (r.id) router.push(`/app/campanhas/${r.id}`)
    })
  }

  return (
    <div className="space-y-8">
      <section className="card p-5">
        <h2 className="mb-4 text-lg font-semibold">Nova campanha</h2>
        <form action={onSubmit} className="grid max-w-lg gap-4">
          <div>
            <label className="label" htmlFor="campaign-name">Nome</label>
            <input id="campaign-name" name="name" placeholder="Nome da campanha" className="input" />
          </div>

          <div>
            <label className="label" htmlFor="campaign-message">Mensagem</label>
            <textarea id="campaign-message" name="message_template" required rows={4} placeholder="Mensagem"
              className="input" />
            <p className="mt-1.5 text-xs muted">
              {'Use {oi|olá} para variações e {{nome}} para o nome do contato'}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="campaign-list">Lista</label>
            <select id="campaign-list" name="list_id" required className="input">
              <option value="">Selecione uma lista</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="label mb-2">Instâncias</p>
            {instances.length === 0 && <p className="text-sm muted">Nenhuma instância conectada.</p>}
            <div className="flex flex-wrap gap-2">
              {instances.map((i) => (
                <label
                  key={i.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm transition has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[rgba(14,165,163,0.08)]"
                >
                  <input type="checkbox" name="instance_ids" value={i.id} className="accent-[var(--color-brand)]" />
                  <span>{i.name} · {i.provider} · {i.status}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label" htmlFor="min-delay">Delay mín. (s)</label>
              <input id="min-delay" name="min_delay_seconds" type="number" defaultValue={30} className="input" />
            </div>
            <div className="flex-1">
              <label className="label" htmlFor="max-delay">Delay máx. (s)</label>
              <input id="max-delay" name="max_delay_seconds" type="number" defaultValue={90} className="input" />
            </div>
          </div>

          <button disabled={pending} className="btn btn-primary">
            Criar campanha
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Campanhas</h2>
        <div className="card divide-y divide-[var(--color-line)]">
          {campaigns.length === 0 && <p className="p-4 text-sm muted">Nenhuma campanha ainda.</p>}
          {campaigns.map((c) => (
            <a key={c.id} href={`/app/campanhas/${c.id}`} className="flex items-center justify-between gap-3 p-4 text-sm transition hover:bg-[#f8fafb]">
              <span className="font-medium">{c.name}</span>
              <span className="flex items-center gap-3">
                <span className={`badge ${STATUS_BADGE[c.status] ?? 'badge-muted'}`}>
                  <span className="dot" style={{ background: 'currentColor' }} />
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
                <span className="muted">{new Date(c.created_at).toLocaleDateString('pt-BR')}</span>
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
