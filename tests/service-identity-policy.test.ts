import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * GDB-REM-001 + GDB-REM-003 targeted regression tests (GDB-NEW-01, GDB-NEW-02).
 * Pure-policy tests: no network, no Supabase, no secrets.
 */
import {
  SERVICE_IDENTITY_SCOPE_CATALOG,
  WILDCARD_SCOPE,
  validateScopeGrant,
  sanitizeScopesForIdentityType,
  hasRequiredScope,
  parseDurationToSeconds,
  isValidSchemaName,
  isGovernanceSchema,
  deriveSchemaName,
  buildSqlAuditMetadata
} from '../src/lib/auth/service-identity-policy.ts'

// ---------------------------------------------------------------------------
// GDB-REM-001 — scope grant validation (GDB-NEW-01)
// ---------------------------------------------------------------------------

test('non-admin grantor cannot grant wildcard scope (GDB-NEW-01 aceite 1)', () => {
  const result = validateScopeGrant({
    requestedScopes: ['*'],
    grantorType: 'service',
    grantorScopes: ['identities:create', 'projects:read'],
    targetIdentityType: 'service'
  })
  assert.equal(result.ok, false)
})

test('non-admin grantor cannot create an admin identity (GDB-NEW-01 aceite 5)', () => {
  const result = validateScopeGrant({
    requestedScopes: ['projects:read'],
    grantorType: 'service',
    grantorScopes: ['identities:create', 'projects:read'],
    targetIdentityType: 'admin'
  })
  assert.equal(result.ok, false)
})

test('non-catalogued scope is rejected for anyone but stays catalogued for admin', () => {
  const nonAdmin = validateScopeGrant({
    requestedScopes: ['super:powers'],
    grantorType: 'service',
    grantorScopes: ['identities:create'],
    targetIdentityType: 'service'
  })
  assert.equal(nonAdmin.ok, false)

  const admin = validateScopeGrant({
    requestedScopes: ['super:powers'],
    grantorType: 'admin',
    grantorScopes: ['*'],
    targetIdentityType: 'service'
  })
  assert.equal(admin.ok, false) // not even an admin grants non-catalogued scopes
})

test('non-admin grantor can only grant scopes it already holds (containment)', () => {
  const escalation = validateScopeGrant({
    requestedScopes: ['ct:sql:execute'], // catalogued, but grantor does not hold it
    grantorType: 'service',
    grantorScopes: ['identities:create', 'projects:read'],
    targetIdentityType: 'service'
  })
  assert.equal(escalation.ok, false)

  const contained = validateScopeGrant({
    requestedScopes: ['projects:read'],
    grantorType: 'service',
    grantorScopes: ['identities:create', 'projects:read'],
    targetIdentityType: 'service'
  })
  assert.ok(contained.ok)
  assert.deepEqual(contained.scopes, ['projects:read'])
})

test('admin grantor can grant catalogued scopes and wildcard only to admin identity', () => {
  const catalogued = validateScopeGrant({
    requestedScopes: ['ct:sql:execute'],
    grantorType: 'admin',
    grantorScopes: ['*'],
    targetIdentityType: 'agent'
  })
  assert.ok(catalogued.ok)

  const wildcardToAdmin = validateScopeGrant({
    requestedScopes: ['*'],
    grantorType: 'admin',
    grantorScopes: ['*'],
    targetIdentityType: 'admin'
  })
  assert.ok(wildcardToAdmin.ok)
  assert.deepEqual(wildcardToAdmin.scopes, ['*'])

  const wildcardToService = validateScopeGrant({
    requestedScopes: ['*'],
    grantorType: 'admin',
    grantorScopes: ['*'],
    targetIdentityType: 'service'
  })
  assert.equal(wildcardToService.ok, false)
})

test('scopes payload must be an array of strings; duplicates are trimmed', () => {
  const notArray = validateScopeGrant({
    requestedScopes: 'projects:read',
    grantorType: 'admin',
    grantorScopes: ['*'],
    targetIdentityType: 'service'
  })
  assert.equal(notArray.ok, false)

  const mixed = validateScopeGrant({
    requestedScopes: ['projects:read', 42],
    grantorType: 'admin',
    grantorScopes: ['*'],
    targetIdentityType: 'service'
  })
  assert.equal(mixed.ok, false)

  const deduped = validateScopeGrant({
    requestedScopes: ['projects:read', ' projects:read '],
    grantorType: 'admin',
    grantorScopes: ['*'],
    targetIdentityType: 'service'
  })
  assert.ok(deduped.ok)
  assert.deepEqual(deduped.scopes, ['projects:read'])
})

test('undefined/null scopes default to empty grant', () => {
  for (const empty of [undefined, null]) {
    const result = validateScopeGrant({
      requestedScopes: empty,
      grantorType: 'service',
      grantorScopes: ['identities:create'],
      targetIdentityType: 'service'
    })
    assert.ok(result.ok)
    assert.deepEqual(result.scopes, [])
  }
})

// ---------------------------------------------------------------------------
// GDB-REM-001 — wildcard never authorizes non-admin principals
// ---------------------------------------------------------------------------

test('wildcard scopes never authorize a non-admin principal (GDB-NEW-01 aceite 4)', () => {
  const poisonedPrincipal = {
    type: 'service' as const,
    scopes: ['*']
  }
  assert.equal(hasRequiredScope(poisonedPrincipal, 'ct:sql:execute'), false)
  assert.equal(hasRequiredScope(poisonedPrincipal, 'identities:create'), false)
  assert.equal(hasRequiredScope(poisonedPrincipal, 'projects:read'), false)
})

test('sanitizeScopesForIdentityType strips wildcard and non-catalogued scopes from non-admin identities', () => {
  const sanitized = sanitizeScopesForIdentityType('service', ['*', 'projects:read', 'evil:scope', null])
  assert.deepEqual(sanitized, ['projects:read'])

  const adminKeeps = sanitizeScopesForIdentityType('admin', ['*', 'projects:read'])
  assert.deepEqual(adminKeeps, ['*', 'projects:read'])
})

test('admin principal is authorized by type regardless of scopes', () => {
  assert.equal(hasRequiredScope({ type: 'admin', scopes: [] }, 'ct:sql:execute'), true)
})

// ---------------------------------------------------------------------------
// GDB-REM-001 — expires_in validation
// ---------------------------------------------------------------------------

test('parseDurationToSeconds accepts valid durations within [60s, 365d]', () => {
  assert.equal(parseDurationToSeconds('60s'), 60)
  assert.equal(parseDurationToSeconds('30m'), 1800)
  assert.equal(parseDurationToSeconds('12h'), 43200)
  assert.equal(parseDurationToSeconds('90d'), 7776000)
  assert.equal(parseDurationToSeconds('52w'), 31449600)
  assert.equal(parseDurationToSeconds('365d'), 31536000)
})

test('parseDurationToSeconds rejects invalid, numeric, zero, and out-of-range durations', () => {
  assert.equal(parseDurationToSeconds('10s'), null) // below 60s minimum
  assert.equal(parseDurationToSeconds('0m'), null)
  assert.equal(parseDurationToSeconds('366d'), null) // above 365d cap
  assert.equal(parseDurationToSeconds('400d'), null)
  assert.equal(parseDurationToSeconds('365x'), null) // invalid unit
  assert.equal(parseDurationToSeconds(3600), null) // numbers rejected (epoch ambiguity)
  assert.equal(parseDurationToSeconds('abc'), null)
  assert.equal(parseDurationToSeconds(''), null)
  assert.equal(parseDurationToSeconds(null), null)
})

test('scope catalog itself contains no wildcard entry', () => {
  assert.equal(SERVICE_IDENTITY_SCOPE_CATALOG.includes(WILDCARD_SCOPE), false)
  assert.ok(SERVICE_IDENTITY_SCOPE_CATALOG.includes('ct:sql:execute'))
  assert.ok(SERVICE_IDENTITY_SCOPE_CATALOG.includes('identities:create'))
})

// ---------------------------------------------------------------------------
// GDB-REM-003 — schema governance (GDB-NEW-02)
// ---------------------------------------------------------------------------

test('governance schemas are identified by exact name and prefix', () => {
  for (const schema of ['public', 'auth', 'storage', 'pg_catalog', 'pg_temp', 'supabase_functions']) {
    assert.equal(isGovernanceSchema(schema), true, schema)
  }
  assert.equal(isGovernanceSchema('blog_facebrasilblog'), false)
  assert.equal(isGovernanceSchema('custom_demo'), false)
})

test('schema names are validated against a strict identifier pattern', () => {
  assert.equal(isValidSchemaName('custom_demo'), true)
  assert.equal(isValidSchemaName('Public'), false)
  assert.equal(isValidSchemaName('1schema'), false)
  assert.equal(isValidSchemaName('has-dash'), false)
  assert.equal(isValidSchemaName('has space'), false)
  assert.equal(isValidSchemaName('semi;colon'), false)
  assert.equal(isValidSchemaName(''), false)
})

test('deriveSchemaName maps business_type to canonical prefix and validates slug', () => {
  assert.equal(deriveSchemaName('blog', 'meublog'), 'blog_meublog')
  assert.equal(deriveSchemaName('store', 'lojateste'), 'store_lojateste')
  assert.equal(deriveSchemaName('saas', 'app'), 'saas_app')
  assert.equal(deriveSchemaName('custom', 'demo'), 'custom_demo')

  // schema of another project never validates for this project
  assert.notEqual(deriveSchemaName('custom', 'demo'), 'blog_meublog')

  assert.equal(deriveSchemaName('unknown', 'demo'), null)
  assert.equal(deriveSchemaName('custom', 'Bad-Slug'), null)
})

// ---------------------------------------------------------------------------
// GDB-REM-003 — sanitized audit metadata
// ---------------------------------------------------------------------------

test('buildSqlAuditMetadata never embeds SQL text or secrets', () => {
  const metadata = buildSqlAuditMetadata({
    actor: 'svc#123',
    projectSlug: 'demo',
    schemaName: 'custom_demo',
    reason: 'governance schema rejected',
    sqlLength: 57,
    sqlSha256Prefix: 'deadbeef'
  })

  const serialized = JSON.stringify(metadata)
  assert.ok(serialized.includes('actor'))
  assert.ok(serialized.includes('sql_length'))
  assert.equal(metadata.sql_length, 57)
  // no field ever carries raw SQL: only the fixed allowlist of keys
  assert.deepEqual(
    Object.keys(metadata).sort(),
    ['actor', 'project_slug', 'reason', 'schema_name', 'sql_length', 'sql_sha256_prefix']
  )
})
