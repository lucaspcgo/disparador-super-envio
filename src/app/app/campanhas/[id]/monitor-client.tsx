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
  draft: 'Rascunho', running: 'Em andamento', paused: 'Pausada', canceled: 'Cancelada', completed: 'Concluída',
}
const COUNTER_LABEL: Record<string, string> = {
  pending: 'Pendentes', sending: 'Enviando', sent: 'Enviadas', delivered: 'Entregues', read: 'Lidas', failed: 'Falhas',
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <span className="rounded border px-2 py-0.5 text-xs">{STATUS_LABEL[campaign.status] ?? campaign.status}</span>
        </div>
        <button disabled={pending} onClick={() => router.refresh()} className="rounded border px-3 py-1 text-sm disabled:opacity-40">
          Atualizar
        </button>
      </div>

      <section className="rounded-xl border p-4">
        <h2 className="mb-3 font-medium">Progresso ({data.total} mensagens)</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {Object.keys(COUNTER_LABEL).map((k) => (
            <div key={k} className="rounded border px-3 py-2">
              <div className="text-xs text-gray-500">{COUNTER_LABEL[k]}</div>
              <div className="text-lg font-semibold">{data.counts[k] ?? 0}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {campaign.status === 'draft' && (
          <button disabled={pending} onClick={() => handle(() => startCampaign(campaign.id))}
            className="rounded bg-black px-3 py-2 text-white disabled:opacity-40">Iniciar</button>
        )}
        {campaign.status === 'running' && (
          <>
            <button disabled={pending} onClick={() => handle(() => pauseCampaign(campaign.id))}
              className="rounded border px-3 py-2 disabled:opacity-40">Pausar</button>
            <button disabled={pending} onClick={() => { if (confirm('Cancelar campanha?')) handle(() => cancelCampaign(campaign.id)) }}
              className="rounded border border-red-300 px-3 py-2 text-red-600 disabled:opacity-40">Cancelar</button>
          </>
        )}
        {campaign.status === 'paused' && (
          <>
            <button disabled={pending} onClick={() => handle(() => resumeCampaign(campaign.id))}
              className="rounded bg-black px-3 py-2 text-white disabled:opacity-40">Retomar</button>
            <button disabled={pending} onClick={() => { if (confirm('Cancelar campanha?')) handle(() => cancelCampaign(campaign.id)) }}
              className="rounded border border-red-300 px-3 py-2 text-red-600 disabled:opacity-40">Cancelar</button>
          </>
        )}
        <button disabled={pending} onClick={() => {
          if (!confirm('Excluir campanha?')) return
          handle(() => deleteCampaign(campaign.id), () => router.push('/app/campanhas'))
        }} className="rounded border border-red-300 px-3 py-2 text-red-600 disabled:opacity-40">Excluir</button>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
