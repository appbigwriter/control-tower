// Resolution hooks mapping the `@/*` alias onto src/* (see alias-loader.mjs)
// and fixing extensionless `next/server` imports for direct node execution.
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcRoot = new URL('../src/', import.meta.url)

function existingFile(candidate) {
  const path = fileURLToPath(candidate)
  return existsSync(path) && statSync(path).isFile() ? candidate : null
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2)
    const resolved =
      existingFile(new URL(rel, srcRoot)) ||
      existingFile(new URL(`${rel}.ts`, srcRoot)) ||
      existingFile(new URL(`${rel}.tsx`, srcRoot)) ||
      existingFile(new URL(`${rel}/index.ts`, srcRoot))
    if (resolved) return next(resolved.href, context)
    return next(specifier, context)
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentUrl = context.parentURL
    if (parentUrl && parentUrl.startsWith('file:') && parentUrl.includes('/src/')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        try {
          return await next(specifier + suffix, context)
        } catch {
          // try next suffix
        }
      }
    }
  }
  const bareNextModules = new Set(['next/server', 'next/headers'])
  if (bareNextModules.has(specifier)) {
    return next(
      `file:///F:/Projetos/_FBR/GestaoDB/node_modules/${specifier}.js`,
      context,
    )
  }
  return next(specifier, context)
}
