import { getCampaign } from '@/lib/campaigns/queries'
import { MonitorClient } from './monitor-client'

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getCampaign(id)
  if (!data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Campanha não encontrada</h1>
        <a href="/app/campanhas" className="text-sm text-gray-600 underline">Voltar</a>
      </div>
    )
  }
  return <MonitorClient data={data} />
}
