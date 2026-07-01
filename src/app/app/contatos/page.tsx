import { listContacts, listLists } from '@/lib/contacts/queries'
import { ContactsClient } from './contacts-client'

export default async function ContatosPage() {
  const [contacts, lists] = await Promise.all([listContacts(), listLists()])
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Contatos</h1>
          <p className="muted mt-1">{contacts.length} contatos · {lists.length} listas</p>
        </div>
      </div>
      <ContactsClient contacts={contacts} lists={lists} />
    </div>
  )
}
