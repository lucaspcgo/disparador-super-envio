import { listContacts, listLists } from '@/lib/contacts/queries'
import { ContactsClient } from './contacts-client'

export default async function ContatosPage() {
  const [contacts, lists] = await Promise.all([listContacts(), listLists()])
  return (
    <div>
      <h1 className="text-2xl font-semibold">Contatos</h1>
      <p className="mb-6 text-sm text-gray-600">{contacts.length} contatos · {lists.length} listas</p>
      <ContactsClient contacts={contacts} lists={lists} />
    </div>
  )
}
