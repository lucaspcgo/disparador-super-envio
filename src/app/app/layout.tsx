import { redirect } from 'next/navigation'
import { getCurrentOrg } from '@/lib/org/current'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await getCurrentOrg()
  if (!org) redirect('/login')

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="font-semibold">Super Envio</div>
          <nav className="flex gap-4 text-sm text-gray-600">
            <a href="/app">Painel</a>
            <a href="/app/instancias">Instâncias</a>
            <a href="/app/contatos">Contatos</a>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-600">{org.name} · {org.role}</span>
          <form action="/auth/signout" method="post">
            <button className="rounded border px-3 py-1">Sair</button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
