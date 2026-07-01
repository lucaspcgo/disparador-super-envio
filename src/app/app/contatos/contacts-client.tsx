'use client'
import { useState, useTransition } from 'react'
import { importContacts, createList, deleteContact, deleteList } from '@/lib/contacts/actions'
import type { ContactRow, ListRow } from '@/lib/contacts/queries'

export function ContactsClient({ contacts, lists }: { contacts: ContactRow[]; lists: ListRow[] }) {
  const [msg, setMsg] = useState<string | undefined>()
  const [pending, start] = useTransition()

  async function onImport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fileInput = form.elements.namedItem('csv') as HTMLInputElement
    const listName = (form.elements.namedItem('list_name') as HTMLInputElement).value
    const file = fileInput.files?.[0]
    if (!file) { setMsg('Selecione um arquivo CSV'); return }
    const text = await file.text()
    const fd = new FormData(); fd.set('file', text); fd.set('list_name', listName)
    start(async () => {
      const r = await importContacts(fd)
      setMsg(r.ok ? `Importados ${r.imported} (ignorados ${r.skipped ?? 0})` : r.error)
      if (r.ok) form.reset()
    })
  }

  return (
    <div className="space-y-8">
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Importar CSV</h2>
        <form onSubmit={onImport} className="grid max-w-md gap-3">
          <div>
            <label className="label">Arquivo CSV</label>
            <input name="csv" type="file" accept=".csv,text/csv" className="input pt-2 text-sm" />
          </div>
          <div>
            <label className="label">Nome da lista (opcional)</label>
            <input name="list_name" placeholder="Nome da lista (opcional)" className="input" />
          </div>
          <button disabled={pending} className="btn btn-primary">Importar</button>
        </form>
        <p className="muted mt-3 text-xs">Colunas: <code>telefone</code> (obrigatória), <code>nome</code>, e quaisquer outras viram campos personalizados.</p>
        {msg && <p className="mt-2 text-sm">{msg}</p>}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Listas</h2>
          <form action={(fd) => start(async () => { await createList(fd) })} className="flex gap-2">
            <input name="name" placeholder="Nova lista" className="input h-9 w-40 text-sm" />
            <button className="btn btn-ghost btn-sm">Criar</button>
          </form>
        </div>
        <div className="card divide-y divide-[var(--color-line)]">
          {lists.length === 0 && <div className="p-4 text-sm muted">Nenhuma lista.</div>}
          {lists.map((l) => (
            <div key={l.id} className="flex items-center justify-between p-3 text-sm">
              <span>{l.name}</span>
              <button onClick={() => start(async () => { await deleteList(l.id) })} className="btn btn-danger btn-sm">Excluir</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Contatos ({contacts.length})</h2>
        <div className="card divide-y divide-[var(--color-line)]">
          {contacts.length === 0 && <div className="p-4 text-sm muted">Nenhum contato ainda. Importe um CSV.</div>}
          {contacts.slice(0, 200).map((c) => (
            <div key={c.id} className="flex items-center justify-between p-3 text-sm">
              <span>{c.name ?? '—'} · {c.phone}</span>
              <button onClick={() => start(async () => { await deleteContact(c.id) })} className="btn btn-danger btn-sm">Excluir</button>
            </div>
          ))}
        </div>
        {contacts.length > 200 && <p className="muted mt-2 text-xs">Mostrando 200 de {contacts.length}.</p>}
      </section>
    </div>
  )
}
