import { listCampaigns, listConnectedInstances, listListsForSelect } from '@/lib/campaigns/queries'
import { CampaignsClient } from './campaigns-client'

export default async function CampanhasPage() {
  const [campaigns, instances, lists] = await Promise.all([
    listCampaigns(),
    listConnectedInstances(),
    listListsForSelect(),
  ])
  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Campanhas</h1>
        <p className="muted mt-1">{campaigns.length} campanha{campaigns.length === 1 ? '' : 's'}</p>
      </div>
      <CampaignsClient campaigns={campaigns} instances={instances} lists={lists} />
    </div>
  )
}
