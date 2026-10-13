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

  // Easypanel ingress redirects HTTP to HTTPS, stripping Authorization across
  // origins. Connect directly over HTTPS even when configured as "internal".
  // Docker service URLs such as http://kong:8000 keep their original protocol.
  const endpoint = new URL(supabaseUrl)
  if (endpoint.protocol === 'http:' && (
    endpoint.hostname.endsWith('.easypanel.host') ||
    endpoint.hostname === 'supabase-control-tower-api.fbr.news'
  )) {
    endpoint.protocol = 'https:'
    supabaseUrl = endpoint.toString()
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
          'https://supabase-supabase-gestaodb.pojxaz.easypanel.host',
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
