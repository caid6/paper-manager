import { createBrowserClient } from '@supabase/ssr'
import { Database } from '@/types/database'
import { requireSupabaseEnv } from '@/lib/supabase/env'

export function createClient() {
  const env = requireSupabaseEnv()

  return createBrowserClient<Database>(
    env.url,
    env.anonKey
  )
}
