import { getCurrentOrg } from '@/lib/org/current'
import { createClient } from '@/lib/supabase/server'
import { listInstances } from '@/lib/instances/queries'
import { InstancesClient } from './instances-client'

export default async function InstancesPage() {
  const org = await getCurrentOrg()
  const instances = await listInstances()
  const supabase = await createClient()
  const { data: orgRow } = await supabase
    .from('organizations').select('instance_limit').eq('id', org!.id).maybeSingle()
  const limit = orgRow?.instance_limit ?? 1
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Instâncias</h1>
          <p className="text-sm text-gray-600">{instances.length} de {limit} conexões usadas</p>
        </div>
      </div>
      <InstancesClient instances={instances} limit={limit} />
    </div>
  )
}
