'use client'
import { useState, useTransition } from 'react'
import {
  connectByo, connectManaged, connectMeta,
  refreshState, disconnectInstance, deleteInstanceAction, sendTest,
} from '@/lib/instances/actions'
import type { InstanceRow } from '@/lib/wa/types'

type Provider = 'evolution_byo' | 'evolution_managed' | 'meta_cloud'
const PROVIDER_LABEL: Record<Provider, string> = {
  evolution_byo: 'Evolution (própria)',
  evolution_managed: 'Evolution (gerenciada)',
  meta_cloud: 'Meta Cloud API',
}
const STATUS_LABEL: Record<string, string> = {
  connecting: 'Conectando', connected: 'Conectado', disconnected: 'Desconectado',
}

export function InstancesClient({ instances, limit }: { instances: InstanceRow[]; limit: number }) {
  const [open, setOpen] = useState<Provider | null>(null)
  const [qr, setQr] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [pending, start] = useTransition()
  const atLimit = instances.length >= limit

  function handle(action: () => Promise<{ ok: boolean; error?: string; state?: { qr?: string } }>) {
    setError(undefined)
    start(async () => {
      const r = await action()
      if (!r.ok) setError(r.error)
      else { setQr(r.state?.qr); if (!r.state?.qr) setOpen(null) }
    })
  }

  function statusBadge(status: string) {
    const label = STATUS_LABEL[status] ?? status
    if (status === 'connected') {
      return (
        <span className="badge badge-ok">
          <span className="pulse text-[var(--color-ok)]"><span className="dot" style={{ background: 'currentColor' }} /></span>
          {label}
        </span>
      )
    }
    if (status === 'connecting') {
      return <span className="badge badge-warn"><span className="dot" style={{ background: 'currentColor' }} />{label}</span>
    }
    return <span className="badge badge-muted"><span className="dot" style={{ background: 'currentColor' }} />{label}</span>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={atLimit} onClick={() => { setQr(undefined); setError(undefined); setOpen('evolution_byo') }}
          className="btn btn-primary">Conectar instância</button>
        {atLimit && <span className="muted text-sm text-[var(--color-warn)]">Limite do plano atingido — faça upgrade.</span>}
      </div>

      {open && (
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
              <button key={p} onClick={() => { setQr(undefined); setError(undefined); setOpen(p) }}
                className={`btn btn-sm ${open === p ? 'btn-primary' : 'btn-ghost'}`}>
                {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>

          {open === 'evolution_byo' && (
            <form action={(fd) => handle(() => connectByo(fd))} className="grid max-w-md gap-3">
              <div>
                <label className="label">Nome (rótulo)</label>
                <input name="name" placeholder="Nome (rótulo)" className="input" />
              </div>
              <div>
                <label className="label">URL da Evolution</label>
                <input name="baseUrl" required placeholder="https://..." className="input" />
              </div>
              <div>
                <label className="label">API key</label>
                <input name="apiKey" required placeholder="API key" className="input" />
              </div>
              <div>
                <label className="label">Nome da instância na Evolution</label>
                <input name="instanceName" required placeholder="Nome da instância" className="input" />
              </div>
              <button disabled={pending} className="btn btn-primary">Validar e conectar</button>
            </form>
          )}
          {open === 'evolution_managed' && (
            <form action={(fd) => handle(() => connectManaged(fd))} className="grid max-w-md gap-3">
              <div>
                <label className="label">Nome (rótulo)</label>
                <input name="name" placeholder="Nome (rótulo)" className="input" />
              </div>
              <button disabled={pending} className="btn btn-primary">Provisionar e gerar QR</button>
            </form>
          )}
          {open === 'meta_cloud' && (
            <form action={(fd) => handle(() => connectMeta(fd))} className="grid max-w-md gap-3">
              <div>
                <label className="label">Nome (rótulo)</label>
                <input name="name" placeholder="Nome (rótulo)" className="input" />
              </div>
              <div>
                <label className="label">Phone Number ID</label>
                <input name="phoneNumberId" required placeholder="Phone Number ID" className="input" />
              </div>
              <div>
                <label className="label">WABA ID</label>
                <input name="wabaId" required placeholder="WABA ID" className="input" />
              </div>
              <div>
                <label className="label">Access token</label>
                <input name="accessToken" required placeholder="Access token" className="input" />
              </div>
              <button disabled={pending} className="btn btn-primary">Verificar e conectar</button>
            </form>
          )}

          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

          {qr && (
            <div className="rounded-xl bg-[var(--color-canvas)] p-4">
              <p className="muted text-sm">Escaneie no WhatsApp (Aparelhos conectados):</p>
              <div className="mt-3 inline-flex rounded-lg border border-[var(--color-line)] bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="QR" src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} className="h-56 w-56" />
              </div>
              <div>
                <button onClick={() => { setOpen(null); setQr(undefined) }} className="btn btn-ghost btn-sm mt-3">Fechar</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card divide-y divide-[var(--color-line)]">
        {instances.length === 0 && <div className="p-6 muted">Nenhuma instância. Conecte a primeira acima.</div>}
        {instances.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{i.name}</div>
              <div className="muted mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span>{PROVIDER_LABEL[i.provider]}</span>
                <span>·</span>
                {statusBadge(i.status)}
                {i.phone_number && <span>· {i.phone_number}</span>}
                <span>· {i.hourly_limit}/h · {i.daily_limit}/dia</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={pending} onClick={() => handle(() => refreshState(i.id))} className="btn btn-ghost btn-sm">Atualizar</button>
              <button disabled={pending} onClick={() => handle(() => disconnectInstance(i.id))} className="btn btn-ghost btn-sm">Desconectar</button>
              <button disabled={pending} onClick={() => {
                const to = prompt('Número (E.164, ex: 5511999998888):'); if (!to) return
                if (i.provider === 'meta_cloud') {
                  const tpl = prompt('Nome do template aprovado:'); if (!tpl) return
                  handle(() => sendTest(i.id, to, '', tpl, []))
                } else {
                  const txt = prompt('Texto da mensagem de teste:') ?? 'Teste Super Envio'
                  handle(() => sendTest(i.id, to, txt))
                }
              }} className="btn btn-ghost btn-sm">Testar</button>
              <button disabled={pending} onClick={() => { if (confirm('Excluir instância?')) handle(() => deleteInstanceAction(i.id)) }}
                className="btn btn-danger btn-sm">Excluir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
