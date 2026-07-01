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

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button disabled={atLimit} onClick={() => { setQr(undefined); setError(undefined); setOpen('evolution_byo') }}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-40">Conectar instância</button>
        {atLimit && <span className="self-center text-sm text-amber-600">Limite do plano atingido — faça upgrade.</span>}
      </div>

      {open && (
        <div className="rounded-xl border p-4">
          <div className="mb-3 flex gap-2">
            {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
              <button key={p} onClick={() => { setQr(undefined); setError(undefined); setOpen(p) }}
                className={`rounded border px-3 py-1 text-sm ${open === p ? 'bg-gray-900 text-white' : ''}`}>
                {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>

          {open === 'evolution_byo' && (
            <form action={(fd) => handle(() => connectByo(fd))} className="grid gap-2 max-w-md">
              <input name="name" placeholder="Nome (rótulo)" className="rounded border px-3 py-2" />
              <input name="baseUrl" required placeholder="URL da Evolution (https://...)" className="rounded border px-3 py-2" />
              <input name="apiKey" required placeholder="API key" className="rounded border px-3 py-2" />
              <input name="instanceName" required placeholder="Nome da instância na Evolution" className="rounded border px-3 py-2" />
              <button disabled={pending} className="rounded bg-black py-2 text-white">Validar e conectar</button>
            </form>
          )}
          {open === 'evolution_managed' && (
            <form action={(fd) => handle(() => connectManaged(fd))} className="grid gap-2 max-w-md">
              <input name="name" placeholder="Nome (rótulo)" className="rounded border px-3 py-2" />
              <button disabled={pending} className="rounded bg-black py-2 text-white">Provisionar e gerar QR</button>
            </form>
          )}
          {open === 'meta_cloud' && (
            <form action={(fd) => handle(() => connectMeta(fd))} className="grid gap-2 max-w-md">
              <input name="name" placeholder="Nome (rótulo)" className="rounded border px-3 py-2" />
              <input name="phoneNumberId" required placeholder="Phone Number ID" className="rounded border px-3 py-2" />
              <input name="wabaId" required placeholder="WABA ID" className="rounded border px-3 py-2" />
              <input name="accessToken" required placeholder="Access token" className="rounded border px-3 py-2" />
              <button disabled={pending} className="rounded bg-black py-2 text-white">Verificar e conectar</button>
            </form>
          )}

          {qr && (
            <div className="mt-4">
              <p className="text-sm text-gray-600">Escaneie no WhatsApp (Aparelhos conectados):</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="QR" src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} className="mt-2 h-56 w-56" />
              <button onClick={() => setOpen(null)} className="mt-2 rounded border px-3 py-1 text-sm">Fechar</button>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      )}

      <ul className="divide-y rounded-xl border">
        {instances.length === 0 && <li className="p-6 text-gray-500">Nenhuma instância. Conecte a primeira acima.</li>}
        {instances.map((i) => (
          <li key={i.id} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium">{i.name}</div>
              <div className="text-sm text-gray-600">
                {PROVIDER_LABEL[i.provider]} · {STATUS_LABEL[i.status] ?? i.status}
                {i.phone_number ? ` · ${i.phone_number}` : ''}
              </div>
            </div>
            <div className="flex gap-2 text-sm">
              <button onClick={() => handle(() => refreshState(i.id))} className="rounded border px-2 py-1">Atualizar</button>
              <button onClick={() => handle(() => disconnectInstance(i.id))} className="rounded border px-2 py-1">Desconectar</button>
              <button onClick={() => {
                const to = prompt('Número (E.164, ex: 5511999998888):'); if (!to) return
                if (i.provider === 'meta_cloud') {
                  const tpl = prompt('Nome do template aprovado:'); if (!tpl) return
                  handle(() => sendTest(i.id, to, '', tpl, []))
                } else {
                  const txt = prompt('Texto da mensagem de teste:') ?? 'Teste Super Envio'
                  handle(() => sendTest(i.id, to, txt))
                }
              }} className="rounded border px-2 py-1">Testar</button>
              <button onClick={() => { if (confirm('Excluir instância?')) handle(() => deleteInstanceAction(i.id)) }}
                className="rounded border border-red-300 px-2 py-1 text-red-600">Excluir</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
