import { redirect } from 'next/navigation'
import { getCurrentOrg } from '@/lib/org/current'
import { Sidebar } from './_components/sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await getCurrentOrg()
  if (!org) redirect('/login')

  return (
    <div className="min-h-screen md:flex">
      <Sidebar orgName={org.name} role={org.role} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  )
}
