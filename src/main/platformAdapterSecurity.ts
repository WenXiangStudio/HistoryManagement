import { createHash } from 'node:crypto'
import {
  adapterEndpointKindSchema,
  collectionScopeSchema,
  persistedRequestParameterSchema,
  persistedRequestParameterNameSchema,
  routeTraceSchema,
  structuredReadRequestSchema,
  type CollectionScope
} from '../shared/platformAdapter'
import type { z } from 'zod'

export const PAGE_CONTEXT_REQUEST_HEADER_ALLOWLIST = Object.freeze([
  'accept',
  'content-type'
] as const)

export const PERSISTED_RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  'cache-control',
  'content-length',
  'content-type',
  'date',
  'etag',
  'last-modified'
] as const)

type AdapterEndpointKind = z.infer<typeof adapterEndpointKindSchema>
type PersistedRequestParameterName = z.infer<typeof persistedRequestParameterNameSchema>
type PersistedRequestParameter = { name: PersistedRequestParameterName; value: string | number | boolean }

const SAFE_PARAMETERS_BY_ENDPOINT: Readonly<Record<AdapterEndpointKind, ReadonlySet<PersistedRequestParameterName>>> = {
  'following-list': new Set(['aid', 'channel', 'count', 'cursor', 'device_platform', 'max_cursor', 'min_cursor', 'sec_user_id']),
  'creator-work-list': new Set(['aid', 'channel', 'count', 'cursor', 'device_platform', 'max_cursor', 'min_cursor', 'sec_user_id']),
  'work-detail': new Set(['aid', 'aweme_id', 'channel', 'device_platform', 'item_id']),
  'comment-list': new Set(['aid', 'aweme_id', 'channel', 'count', 'cursor', 'device_platform']),
  'comment-reply-list': new Set(['aid', 'aweme_id', 'channel', 'comment_id', 'count', 'cursor', 'device_platform', 'item_id']),
  'media-resource': new Set(['aid', 'aweme_id', 'channel', 'device_platform', 'item_id'])
}

const SAFE_LOG_URL_PARAMETERS = new Set<string>(persistedRequestParameterNameSchema.options)

const EXPLICITLY_SAFE_CONTEXT_KEYS = new Set([
  'sessionused',
  'signatureprovider',
  'signatureready'
])

const SENSITIVE_KEY_PATTERN = /(?:authorization|bearer|cookie|password|passphrase|secret|apikey|accesstoken|refreshtoken|x[-_]?bogus|signature(?:value|input|header)?|session(?:id|token|key)|device(?:id|fingerprint)|browserprofile)/i

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isSensitiveKey(key: string): boolean {
  if (EXPLICITLY_SAFE_CONTEXT_KEYS.has(normalizedKey(key))) return false
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_KEY_PATTERN.test(normalizedKey(key))
}

function headerEntries(input: Headers | Record<string, string | string[] | undefined>): Array<[string, string]> {
  if (typeof Headers !== 'undefined' && input instanceof Headers) return [...input.entries()]
  return Object.entries(input).flatMap(([name, value]) => {
    if (value === undefined) return []
    return [[name, Array.isArray(value) ? value.join(', ') : value]]
  })
}

function filterHeaders(
  input: Headers | Record<string, string | string[] | undefined>,
  allowlist: readonly string[]
): Record<string, string> {
  const allowed = new Set(allowlist)
  return Object.fromEntries(
    headerEntries(input)
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .filter(([name, value]) => allowed.has(name) && value.length <= 2_000 && !/[\r\n]/.test(value))
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

export function filterPageContextRequestHeaders(
  input: Headers | Record<string, string | string[] | undefined>
): Record<string, string> {
  const filtered = filterHeaders(input, PAGE_CONTEXT_REQUEST_HEADER_ALLOWLIST)
  return Object.fromEntries(Object.entries(filtered).filter(([name, value]) => {
    if (name === 'accept') return value === 'application/json' || value === 'application/json, text/plain, */*'
    return /^application\/(?:json|x-www-form-urlencoded)(?:;\s*charset=utf-8)?$/i.test(value)
  }))
}

export function filterPersistedResponseHeaders(
  input: Headers | Record<string, string | string[] | undefined>
): Record<string, string> {
  return filterHeaders(input, PERSISTED_RESPONSE_HEADER_ALLOWLIST)
}

function parameterEntries(input: URLSearchParams | Record<string, unknown>): Array<[string, unknown]> {
  if (input instanceof URLSearchParams) return [...input.entries()]
  return Object.entries(input)
}

export function filterPersistedRequestParameters(
  endpointKind: AdapterEndpointKind,
  input: URLSearchParams | Record<string, unknown>
): PersistedRequestParameter[] {
  const allowed = SAFE_PARAMETERS_BY_ENDPOINT[endpointKind]
  const retained = new Map<PersistedRequestParameterName, string | number | boolean>()
  for (const [rawName, value] of parameterEntries(input)) {
    const parsedEntry = persistedRequestParameterSchema.safeParse({ name: rawName, value })
    if (!parsedEntry.success || !allowed.has(parsedEntry.data.name) || retained.has(parsedEntry.data.name)) continue
    retained.set(parsedEntry.data.name, parsedEntry.data.value)
  }
  return [...retained.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, value }))
}

export function sanitizeUrlForLogging(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.hash = ''
    const sanitized = new URLSearchParams()
    for (const [name, parameterValue] of url.searchParams.entries()) {
      const parsedEntry = persistedRequestParameterSchema.safeParse({ name, value: parameterValue })
      const retainedValue = SAFE_LOG_URL_PARAMETERS.has(name) && parsedEntry.success
        ? parameterValue
        : '[REDACTED]'
      sanitized.append(name, retainedValue)
    }
    sanitized.sort()
    url.search = sanitized.toString()
    return url.toString()
  } catch {
    return redactSensitiveText(value)
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:set-cookie|cookie|authorization)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/((?:x[-_]?bogus|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\s*[:=]\s*)[^&\s,;]+/gi, '$1[REDACTED]')
}

export function redactForLog(value: unknown): unknown {
  const seen = new WeakSet<object>()

  const visit = (current: unknown, parentKey = ''): unknown => {
    if (typeof current === 'string') {
      if (/url$/i.test(parentKey) || /^https?:\/\//i.test(current)) return sanitizeUrlForLogging(current)
      return redactSensitiveText(current)
    }
    if (current === null || typeof current !== 'object') return current
    if (current instanceof Date) return current.toISOString()
    if (seen.has(current)) return '[CIRCULAR]'
    seen.add(current)
    if (Array.isArray(current)) return current.map((entry) => visit(entry, parentKey))

    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? '[REDACTED]' : visit(entry, key)
    }
    return result
  }

  return visit(value)
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON does not support non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalJsonValue(entry === undefined ? null : entry))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)])
    )
  }
  throw new Error(`canonical JSON does not support ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value))
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function schemaType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

export function canonicalSchemaPaths(value: unknown): string[] {
  const paths = new Set<string>()
  const visit = (current: unknown, path: string): void => {
    const type = schemaType(current)
    paths.add(`${path}:${type}`)
    if (Array.isArray(current)) {
      for (const entry of current) visit(entry, `${path}[]`)
      return
    }
    if (current !== null && typeof current === 'object') {
      for (const [key, entry] of Object.entries(current as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
        visit(entry, `${path}.${key}`)
      }
    }
  }
  visit(value, '$')
  return [...paths].sort()
}

export function createSchemaFingerprint(value: unknown): string {
  return sha256CanonicalJson(canonicalSchemaPaths(value))
}

export function createResponseProjectionSha256(whitelistProjection: unknown): string {
  return sha256CanonicalJson(whitelistProjection)
}

export function validateSafeReadOnlyRequest(input: {
  method: string
  endpointKind: AdapterEndpointKind
  path: string
  parameters?: URLSearchParams | Record<string, unknown>
  headers?: Headers | Record<string, string | string[] | undefined>
}): z.infer<typeof structuredReadRequestSchema> & { headers: Record<string, string> } {
  if (input.method !== 'GET') throw new Error('UNSAFE_REQUEST:only GET is permitted')
  if (!/^\/(?!\/)[^?#\r\n]*$/.test(input.path) || input.path.includes('://')) {
    throw new Error('UNSAFE_REQUEST:only a query-free relative pathname may be retained')
  }

  const parameters = input.parameters ?? {}
  const rawParameterEntries = parameterEntries(parameters)
  const seen = new Set<string>()
  const allowed = SAFE_PARAMETERS_BY_ENDPOINT[input.endpointKind]
  for (const [name, value] of rawParameterEntries) {
    if (isSensitiveKey(name)) throw new Error(`UNSAFE_REQUEST:sensitive parameter ${name} is forbidden`)
    const parsed = persistedRequestParameterSchema.safeParse({ name, value })
    if (!parsed.success || !allowed.has(parsed.data.name)) {
      throw new Error(`UNSAFE_REQUEST:unknown or invalid parameter ${name}`)
    }
    if (seen.has(parsed.data.name)) throw new Error(`UNSAFE_REQUEST:duplicate parameter ${name}`)
    seen.add(parsed.data.name)
  }
  const requestParameters = filterPersistedRequestParameters(input.endpointKind, parameters)

  const rawHeaders = headerEntries(input.headers ?? {})
  for (const [name] of rawHeaders) {
    if (isSensitiveKey(name) || !PAGE_CONTEXT_REQUEST_HEADER_ALLOWLIST.includes(name.toLowerCase() as typeof PAGE_CONTEXT_REQUEST_HEADER_ALLOWLIST[number])) {
      throw new Error(`UNSAFE_REQUEST:header ${name} is not explicitly permitted`)
    }
  }
  const headers = filterPageContextRequestHeaders(input.headers ?? {})
  if (Object.keys(headers).length !== rawHeaders.length) {
    throw new Error('UNSAFE_REQUEST:one or more header values failed the strict allowlist')
  }

  return {
    ...structuredReadRequestSchema.parse({
      contract: 'structured-read-request/v1',
      method: input.method,
      endpointKind: input.endpointKind,
      path: input.path,
      requestParameters
    }),
    headers
  }
}

const FORBIDDEN_PERSISTED_KEY = /^(?:rawResponse|responseBody|requestBody|requestUrl|responseUrl|url|headers?|cookies?)$/i

export function assertSafePersistedRouteTrace(input: unknown): z.infer<typeof routeTraceSchema> {
  const scan = (value: unknown): void => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      throw new Error('UNSAFE_REQUEST:complete URLs are forbidden in route trace persistence')
    }
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(scan)
      return
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key) || FORBIDDEN_PERSISTED_KEY.test(key)) {
        throw new Error(`UNSAFE_REQUEST:forbidden persisted field ${key}`)
      }
      scan(entry)
    }
  }
  scan(input)
  return routeTraceSchema.parse(input)
}

export function createCollectionScopeFingerprint(input: CollectionScope): string {
  const scope = collectionScopeSchema.parse(input)
  return `scope-v1:${sha256CanonicalJson(scope)}`
}
