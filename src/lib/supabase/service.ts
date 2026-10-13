import { createClient } from '@supabase/supabase-js'

export function createServiceRoleClient() {
  const internalUrl = process.env.INTERNAL_SUPABASE_URL || process.env.SUPABASE_INTERNAL_URL
  let supabaseUrl =
    internalUrl ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.API_EXTERNAL_URL ||
    'https://supabase-control-tower-api.fbr.news'

  // Correção de resiliência caso o hostname tenha sido injetado com o prefixo abreviado "sup-"
  if (supabaseUrl.includes('sup-control-tower.fbr.news')) {
    supabaseUrl = supabaseUrl.replace('sup-control-tower.fbr.news', 'supabase-control-tower-api.fbr.news')
  }

  // Garantir HTTPS apenas para domínios públicos externos que não sejam locais ou do Easypanel
  const isInternalHost =
    supabaseUrl.includes('.easypanel.host') ||
    supabaseUrl.includes('localhost') ||
    supabaseUrl.includes('127.0.0.1') ||
    supabaseUrl.includes('kong:')
  if (!isInternalHost && !internalUrl && supabaseUrl.includes('supabase-control-tower-api.fbr.news') && supabaseUrl.startsWith('http://')) {
    supabaseUrl = supabaseUrl.replace('http://', 'https://')
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'

  const resilientFetch: typeof fetch = async (input, init) => {
    try {
      return await fetch(input, init)
    } catch (primaryError) {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input && typeof input === 'object' && 'url' in input
              ? (input as { url: string }).url
              : ''

      // Se falhar a conexão direta na VPS por causa do loopback do Docker, tenta o fallback pelo host interno do Easypanel
      if (urlStr.includes('supabase-control-tower-api.fbr.news')) {
        const fallbackUrl = urlStr.replace(
          'https://supabase-control-tower-api.fbr.news',
          'http://supabase-supabase-gestaodb.pojxaz.easypanel.host',
        )
        try {
          if (typeof Request !== 'undefined' && input instanceof Request) {
            return await fetch(new Request(fallbackUrl, input))
          }
          return await fetch(fallbackUrl, init)
        } catch {
          // Se o fallback também falhar, lança o erro primário
        }
      }
      throw primaryError
    }
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: resilientFetch,
    },
  })
}
