'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCampaign } from '@/lib/campaigns/actions'
import type { CampaignRow } from '@/lib/campaigns/queries'

type InstanceOption = { id: string; name: string; provider: string; status: string; hourly_limit: number }
type ListOption = { id: string; name: string }

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', running: 'Em andamento', paused: 'Pausada', canceled: 'Cancelada', completed: 'Concluída',
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
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 font-medium">Nova campanha</h2>
        <form action={onSubmit} className="grid max-w-lg gap-2">
          <input name="name" placeholder="Nome da campanha" className="rounded border px-3 py-2" />
          <textarea name="message_template" required rows={4} placeholder="Mensagem"
            className="rounded border px-3 py-2" />
          <p className="text-xs text-gray-500">
            {'Use {oi|olá} para variações e {{nome}} para o nome do contato'}
          </p>
          <select name="list_id" required className="rounded border px-3 py-2">
            <option value="">Selecione uma lista</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <div className="rounded border p-2">
            <p className="mb-1 text-sm font-medium">Instâncias</p>
            {instances.length === 0 && <p className="text-sm text-gray-500">Nenhuma instância conectada.</p>}
            <div className="space-y-1">
              {instances.map((i) => (
                <label key={i.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="instance_ids" value={i.id} />
                  {i.name} · {i.provider} · {i.status}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <label className="flex-1 text-sm">
              Delay mín. (s)
              <input name="min_delay_seconds" type="number" defaultValue={30} className="w-full rounded border px-3 py-2" />
            </label>
            <label className="flex-1 text-sm">
              Delay máx. (s)
              <input name="max_delay_seconds" type="number" defaultValue={90} className="w-full rounded border px-3 py-2" />
            </label>
          </div>

          <button disabled={pending} className="rounded bg-black py-2 text-white disabled:opacity-40">
            Criar campanha
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Campanhas</h2>
        <ul className="divide-y rounded-xl border">
          {campaigns.length === 0 && <li className="p-4 text-sm text-gray-500">Nenhuma campanha ainda.</li>}
          {campaigns.map((c) => (
            <li key={c.id} className="p-3 text-sm">
              <a href={`/app/campanhas/${c.id}`} className="flex items-center justify-between">
                <span>{c.name}</span>
                <span className="flex items-center gap-3 text-gray-600">
                  <span className="rounded border px-2 py-0.5 text-xs">{STATUS_LABEL[c.status] ?? c.status}</span>
                  <span>{new Date(c.created_at).toLocaleDateString('pt-BR')}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
