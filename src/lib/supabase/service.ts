import 'server-only'
import { createClient } from '@supabase/supabase-js'

// SERVER-ONLY. Usa a service_role key (bypassa RLS). Nunca importar em Client Components.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
