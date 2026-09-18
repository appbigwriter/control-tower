import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * GDB-REM-001 + GDB-REM-003 source-level contract tests.
 * Static assertions over route handlers, auth lib and migration files —
 * no network, no Supabase, no secrets. They lock in the wiring that the pure
 * policy tests cannot see (route-level authorization, server-side actor
 * derivation, RPC hardening, audit calls).
 */
const root = new URL('../', import.meta.url)
const text = (relative: string) => readFile(new URL(relative, root), 'utf8')

// ---------------------------------------------------------------------------
// GDB-REM-001 — identities route hardening
// ---------------------------------------------------------------------------

test('identities POST enforces scope catalog and server-side actor (GDB-NEW-01)', async () => {
  const source = await text('src/app/api/control-tower/identities/route.ts')

  // server-side scope grant validation is wired into the route
  assert.match(source, /validateScopeGrant\(/)

  // created_by is derived from the authenticated principal, never from body
  assert.match(source, /const actorRef = principal\.identityId/)
  assert.doesNotMatch(source, /created_by\s*[:=]\s*created_by/)
  assert.doesNotMatch(source, /created_by = principal\.name/)

  // expires_in handled only through generateIdentityJwt (which validates it)
  assert.match(source, /generateIdentityJwt\(identity, expires_in\)/)
  assert.doesNotMatch(source, /setExpirationTime\(/)

  // sanitized audit trail exists for identity creation
  assert.match(source, /'identity\.created'/)

  // identity_type admin still gated by principal type inside policy; route
  // keeps 401/403 responses without leaking internals
  assert.match(source, /status: 401/)
  assert.match(source, /status: 403/)
})

test('identities PATCH validates scope grants against the catalog too', async () => {
  const source = await text('src/app/api/control-tower/identities/[id]/route.ts')
  assert.match(source, /validateScopeGrant\(/)
  assert.match(source, /'identity\.updated'|'identity\.revoked'/)
  // scopes are no longer blindly assigned from the body
  assert.doesNotMatch(source, /updateData\.scopes = scopes\b/)
})

test('auth lib never treats wildcard as universal authorization', async () => {
  const source = await text('src/lib/auth/control-tower.ts')
  // delegation to the policy module
  assert.match(source, /hasRequiredScope as policyHasRequiredScope/)
  // the vulnerable implementation is gone
  assert.doesNotMatch(source, /principal\.scopes\.includes\('\*'\)/)
  // JWT generation validates expires_in and sanitizes scopes
  assert.match(source, /parseDurationToSeconds/)
  assert.match(source, /sanitizeScopesForIdentityType/)
  // DB record is authoritative over JWT claims
  assert.match(source, /scopes: sanitizeScopesForIdentityType\(identity\.identity_type, identity\.scopes\)/)
})

// ---------------------------------------------------------------------------
// GDB-REM-003 — SQL editor route + RPC hardening (GDB-NEW-02)
// ---------------------------------------------------------------------------

test('SQL route performs its own authentication and ct:sql:execute authorization', async () => {
  const source = await text('src/app/api/control-tower/projects/[slug]/sql/route.ts')

  assert.match(source, /authenticateToken\(/)
  assert.match(source, /const SQL_SCOPE = 'ct:sql:execute'/)
  assert.match(source, /hasRequiredScope\(principal, SQL_SCOPE\)/)
  assert.match(source, /status: 401/)
  assert.match(source, /status: 403/)

  // schema must match the canonical derivation for the project
  assert.match(source, /deriveSchemaName\(project\.business_type, project\.slug\)/)
  assert.match(source, /isGovernanceSchema\(project\.schema_name\)/)

  // actor context is passed to the RPC
  assert.match(source, /p_actor: actor/)
  assert.match(source, /p_project_slug: project\.slug/)

  // audit events (denied + executed) are recorded through the sanitized builder
  assert.match(source, /'project\.sql\.denied'/)
  assert.match(source, /'project\.sql\.executed'/)
  assert.match(source, /buildSqlAuditMetadata\(/)

  // the route never echoes raw SQL inside an audit payload (only via the
  // sanitized builder, which takes length/hash — never the statement itself)
  assert.doesNotMatch(source, /buildSqlAuditMetadata\(\{[^}]*sql:/s)
})

test('hardened RPC migration enforces ownership, governance and audit (GDB-NEW-02)', async () => {
  const migration = await text('supabase/migrations/012_sql_rpc_scope_guard.sql')

  // new signature with actor + project context
  assert.match(migration, /p_actor text default null/)
  assert.match(migration, /p_project_slug text default null/)

  // schema must belong to the requesting project
  assert.match(migration, /schema_name is distinct from p_schema_name|does not belong to project/)

  // governance schemas rejected inside the RPC too (defense in depth)
  assert.match(migration, /governance schema/)

  // canonical derivation check
  assert.match(migration, /canonical derivation/)

  // forbidden statement deny-list
  assert.match(migration, /forbidden statement detected/)

  // audit rows for denied + executed without SQL text (only length/hash)
  assert.match(migration, /'project\.sql\.denied'/)
  assert.match(migration, /'project\.sql\.executed'/)
  assert.match(migration, /sql_length/)
  assert.doesNotMatch(migration, /jsonb_build_object\([^)]*'sql',\s*p_sql/s)

  // dedicated drop RPC replaces the public-schema DROP vector
  assert.match(migration, /create or replace function public\.drop_project_schema/)
  assert.match(migration, /refusing to drop governance schema/)

  // GDB-REM-001 DB trigger: non-admin identities can never persist '*'
  assert.match(migration, /service_identities_scope_guard/)
  assert.match(migration, /is not catalogued for service identity/)
})

test('DELETE project flow no longer routes DROP SCHEMA through the SQL editor RPC', async () => {
  const actions = await text('src/lib/control-tower/actions.ts')
  assert.doesNotMatch(actions, /p_schema_name: 'public'/)
  assert.match(actions, /drop_project_schema/)

  const projectRoute = await text('src/app/api/control-tower/projects/[slug]/route.ts')
  assert.doesNotMatch(projectRoute, /execute_project_schema_sql/)
})

test('009 legacy RPC is superseded — migration 012 replaces the same function', async () => {
  const legacy = await text('supabase/migrations/009_control_tower_project_sql_exec.sql')
  const hardened = await text('supabase/migrations/012_sql_rpc_scope_guard.sql')

  assert.match(legacy, /create or replace function public\.execute_project_schema_sql/)
  assert.match(hardened, /create or replace function public\.execute_project_schema_sql/)
  // the hardened version is the one carrying the guard clauses
  assert.match(hardened, /p_project_slug is null/)
})

test('middleware remains gate-only; business authorization lives in routes', async () => {
  const middleware = await text('src/middleware.ts')
  assert.match(middleware, /isValidAgentApiKey|isValidSessionToken/)
  // middleware never grants scopes by itself
  assert.doesNotMatch(middleware, /scopes/)
})
