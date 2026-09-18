// Test loader: resolves the `@/*` path alias used by src/ so route handlers
// and libs can be imported directly by node --test without a bundler.
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'

register(new URL('./alias-hooks.mjs', import.meta.url))

export const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))

export function resolveAliasPath(specifier) {
  const base = new URL(specifier.slice(2), new URL('../src/', import.meta.url))
  const candidates = [
    base,
    new URL(`${specifier.slice(2)}.ts`, new URL('../src/', import.meta.url)),
    new URL(`${specifier.slice(2)}.tsx`, new URL('../src/', import.meta.url)),
    new URL(`${specifier.slice(2)}/index.ts`, new URL('../src/', import.meta.url)),
  ]
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate)
    if (existsSync(path) && statSync(path).isFile()) return path
  }
  return null
}
