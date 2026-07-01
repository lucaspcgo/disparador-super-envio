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
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 font-medium">Importar CSV</h2>
        <form onSubmit={onImport} className="grid max-w-md gap-2">
          <input name="csv" type="file" accept=".csv,text/csv" className="text-sm" />
          <input name="list_name" placeholder="Nome da lista (opcional)" className="rounded border px-3 py-2" />
          <button disabled={pending} className="rounded bg-black py-2 text-white disabled:opacity-40">Importar</button>
        </form>
        <p className="mt-2 text-xs text-gray-500">Colunas: <code>telefone</code> (obrigatória), <code>nome</code>, e quaisquer outras viram campos personalizados.</p>
        {msg && <p className="mt-2 text-sm text-gray-700">{msg}</p>}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Listas</h2>
          <form action={(fd) => start(async () => { await createList(fd) })} className="flex gap-2">
            <input name="name" placeholder="Nova lista" className="rounded border px-2 py-1 text-sm" />
            <button className="rounded border px-2 py-1 text-sm">Criar</button>
          </form>
        </div>
        <ul className="divide-y rounded-xl border">
          {lists.length === 0 && <li className="p-4 text-sm text-gray-500">Nenhuma lista.</li>}
          {lists.map((l) => (
            <li key={l.id} className="flex items-center justify-between p-3 text-sm">
              <span>{l.name}</span>
              <button onClick={() => start(async () => { await deleteList(l.id) })} className="text-red-600">Excluir</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Contatos ({contacts.length})</h2>
        <ul className="divide-y rounded-xl border">
          {contacts.length === 0 && <li className="p-4 text-sm text-gray-500">Nenhum contato ainda. Importe um CSV.</li>}
          {contacts.slice(0, 200).map((c) => (
            <li key={c.id} className="flex items-center justify-between p-3 text-sm">
              <span>{c.name ?? '—'} · {c.phone}</span>
              <button onClick={() => start(async () => { await deleteContact(c.id) })} className="text-red-600">Excluir</button>
            </li>
          ))}
        </ul>
        {contacts.length > 200 && <p className="mt-2 text-xs text-gray-500">Mostrando 200 de {contacts.length}.</p>}
      </section>
    </div>
  )
}
