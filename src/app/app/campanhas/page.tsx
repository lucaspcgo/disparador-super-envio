import { listCampaigns, listConnectedInstances, listListsForSelect } from '@/lib/campaigns/queries'
import { CampaignsClient } from './campaigns-client'

export default async function CampanhasPage() {
  const [campaigns, instances, lists] = await Promise.all([
    listCampaigns(),
    listConnectedInstances(),
    listListsForSelect(),
  ])
  return (
    <div>
      <h1 className="text-2xl font-semibold">Campanhas</h1>
      <p className="mb-6 text-sm text-gray-600">{campaigns.length} campanhas</p>
      <CampaignsClient campaigns={campaigns} instances={instances} lists={lists} />
    </div>
  )
}
