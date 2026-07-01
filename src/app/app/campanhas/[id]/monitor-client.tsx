'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, deleteCampaign } from '@/lib/campaigns/actions'

type CampaignData = {
  campaign: {
    id: string
    name: string
    status: string
    message_template: string
    list_id: string | null
    instance_ids: string[]
    min_delay_seconds: number
    max_delay_seconds: number
  }
  counts: Record<string, number>
  total: number
}

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
const COUNTER_LABEL: Record<string, string> = {
  pending: 'Pendentes', sending: 'Enviando', sent: 'Enviadas', delivered: 'Entregues', read: 'Lidas', failed: 'Falhas',
}
const COUNTER_COLOR: Record<string, string> = {
  pending: 'muted',
  sending: 'text-[var(--color-warn)]',
  sent: 'text-[var(--color-brand-strong)]',
  delivered: 'text-[var(--color-brand-strong)]',
  read: 'text-[var(--color-ok)]',
  failed: 'text-[var(--color-danger)]',
}

export function MonitorClient({ data }: { data: CampaignData }) {
  const router = useRouter()
  const { campaign } = data
  const [error, setError] = useState<string | undefined>()
  const [pending, start] = useTransition()

  function handle(action: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(undefined)
    start(async () => {
      const r = await action()
      if (!r.ok) { setError(r.error); return }
      if (onOk) onOk()
      else router.refresh()
    })
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{campaign.name}</h1>
          <span className={`badge mt-2 ${STATUS_BADGE[campaign.status] ?? 'badge-muted'}`}>
            <span className="dot" style={{ background: 'currentColor' }} />
            {STATUS_LABEL[campaign.status] ?? campaign.status}
          </span>
        </div>
        <button disabled={pending} onClick={() => router.refresh()} className="btn btn-ghost btn-sm">
          Atualizar
        </button>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Progresso ({data.total} mensagens)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <div className="card p-4">
            <div className="text-sm muted">Total</div>
            <div className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">{data.total}</div>
          </div>
          {Object.keys(COUNTER_LABEL).map((k) => (
            <div key={k} className="card p-4">
              <div className="text-sm muted">{COUNTER_LABEL[k]}</div>
              <div className={`mt-1 font-[family-name:var(--font-display)] text-2xl font-bold ${COUNTER_COLOR[k] ?? ''}`}>
                {data.counts[k] ?? 0}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        {campaign.status === 'draft' && (
          <button disabled={pending} onClick={() => handle(() => startCampaign(campaign.id))}
            className="btn btn-primary">Iniciar</button>
        )}
        {campaign.status === 'running' && (
          <>
            <button disabled={pending} onClick={() => handle(() => pauseCampaign(campaign.id))}
              className="btn btn-ghost">Pausar</button>
            <button disabled={pending} onClick={() => { if (confirm('Cancelar campanha?')) handle(() => cancelCampaign(campaign.id)) }}
              className="btn btn-danger">Cancelar</button>
          </>
        )}
        {campaign.status === 'paused' && (
          <>
            <button disabled={pending} onClick={() => handle(() => resumeCampaign(campaign.id))}
              className="btn btn-primary">Retomar</button>
            <button disabled={pending} onClick={() => { if (confirm('Cancelar campanha?')) handle(() => cancelCampaign(campaign.id)) }}
              className="btn btn-danger">Cancelar</button>
          </>
        )}
        <button disabled={pending} onClick={() => {
          if (!confirm('Excluir campanha?')) return
          handle(() => deleteCampaign(campaign.id), () => router.push('/app/campanhas'))
        }} className="btn btn-danger">Excluir</button>
      </section>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}
