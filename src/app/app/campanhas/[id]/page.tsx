import { getCampaign } from '@/lib/campaigns/queries'
import { MonitorClient } from './monitor-client'

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getCampaign(id)
  if (!data) {
    return (
      <div>
        <h1 className="page-title">Campanha não encontrada</h1>
        <a href="/app/campanhas" className="muted mt-1 inline-block underline">Voltar</a>
      </div>
    )
  }
  return <MonitorClient data={data} />
}
