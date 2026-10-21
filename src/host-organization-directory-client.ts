import { randomUUID } from 'node:crypto'

import { buildGatewayApplicationHeaders } from 'sos-data-utils-ts/gateway-application-identity'

const CLAIM_LEGAL_NAME = 'org.schema.Organization.legalName'
const CLAIM_NAME = 'org.schema.Organization.name'
const CLAIM_IDENTIFIER_TYPE = 'org.schema.Organization.identifier.additionalType'
const CLAIM_IDENTIFIER_VALUE = 'org.schema.Organization.identifier.value'
const CLAIM_JURISDICTION = 'org.schema.Organization.address.addressCountry'
const CLAIM_SECTOR = 'org.schema.Service.category'
const CLAIM_STATUS = 'org.schema.Action.tenantAuthorization.status'

export type HostOrganizationDirectoryRoute = Readonly<{
  jurisdiction: string
  network: 'test' | 'local-network' | 'test-network' | 'network'
}>

export type HostOrganizationDirectoryFilters = Readonly<{
  jurisdiction?: string
  sector?: string
  status?: 'active' | 'suspended' | 'revoked'
  identifierType?: string
  identifierValue?: string
  legalName?: string
  name?: string
}>

export type HostOrganizationDirectoryEntry = Readonly<{
  id: string
  legalName: string
  name: string
  identifierType: string
  identifierValue: string
  jurisdiction: string
  sector: string
  status: 'active' | 'suspended' | 'revoked'
  claims: Readonly<Record<string, unknown>>
}>

export type HostOrganizationDirectoryPage = Readonly<{
  total: number
  pageSize: number
  returned: number
  hasNext: boolean
  nextCursor?: string
  organizations: readonly HostOrganizationDirectoryEntry[]
}>

export type HostOrganizationDirectorySearch = Readonly<{
  filters?: HostOrganizationDirectoryFilters
  pageSize?: number
  cursor?: string
  requestThid?: string
  pollOptions?: Readonly<{ timeoutMs?: number; intervalMs?: number }>
}>

export type SosGatewayHostOrganizationDirectoryClientOptions = Readonly<{
  baseUrl: string
  bearerToken?: string
  appId?: string
  appVersion?: string
  defaultHeaders?: Readonly<Record<string, string>>
  requestTimeoutMs?: number
  fetchImpl?: typeof fetch
}>

type GatewayResponse = Readonly<{ status: number; body: unknown }>

/** Trusted-BFF transport for the host-only Organization registry directory. */
export class SosGatewayHostOrganizationDirectoryClient {
  private readonly baseUrl: string
  private readonly headers: Readonly<Record<string, string>>
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  public constructor(options: SosGatewayHostOrganizationDirectoryClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? 15_000, 'request_timeout_invalid')
    this.fetchImpl = options.fetchImpl ?? fetch
    const bearerToken = optional(options.bearerToken)
    const appId = optional(options.appId)
    this.headers = Object.freeze({
      'Content-Type': 'application/didcomm-plain+json',
      Accept: 'application/didcomm-plain+json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      ...(appId ? buildGatewayApplicationHeaders({ appId, appVersion: options.appVersion }) : {}),
      ...(options.defaultHeaders ?? {}),
    })
  }

  public async search(
    route: HostOrganizationDirectoryRoute,
    input: HostOrganizationDirectorySearch = {},
  ): Promise<HostOrganizationDirectoryPage> {
    const context = normalizeRoute(route)
    const thid = optional(input.requestThid) || `host-organization-directory-${randomUUID()}`
    const claims = filterClaims(input.filters)
    const body = {
      resourceType: 'Bundle',
      type: 'searchset',
      data: [{
        type: 'Organization-search-v1.0',
        request: { method: 'GET', url: 'Organization/_search' },
        resource: { resourceType: 'Organization', meta: { claims } },
      }],
      meta: { pagination: {
        ...(input.pageSize === undefined ? {} : { pageSize: positiveInteger(input.pageSize, 'page_size_invalid') }),
        ...(optional(input.cursor) ? { cursor: optional(input.cursor) } : {}),
      } },
    }
    const prefix = `/host/cds-${encodeURIComponent(context.jurisdiction)}/v1/${encodeURIComponent(context.network)}/registry/org.schema/Organization`
    const response = await this.submitAndPoll(
      `${prefix}/_search`,
      `${prefix}/_search-response`,
      { thid, body },
      input.pollOptions,
    )
    return readPage(response.body)
  }

  private async submitAndPoll(
    submitPath: string,
    pollPath: string,
    payload: Readonly<{ thid: string; body: unknown }>,
    options?: Readonly<{ timeoutMs?: number; intervalMs?: number }>,
  ): Promise<GatewayResponse> {
    const submit = await this.post(submitPath, payload)
    requireSuccessfulResponse(submit, 'gateway_submit_failed')
    const timeoutMs = positiveInteger(options?.timeoutMs ?? 30_000, 'poll_timeout_invalid')
    const intervalMs = positiveInteger(options?.intervalMs ?? 250, 'poll_interval_invalid')
    const started = Date.now()
    for (;;) {
      const poll = await this.post(pollPath, { thid: payload.thid })
      if (poll.status !== 202) {
        requireSuccessfulResponse(poll, 'gateway_poll_failed')
        return poll
      }
      if (Date.now() - started >= timeoutMs) throw new Error('gateway_poll_timeout')
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }

  private async post(path: string, payload: unknown): Promise<GatewayResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST', headers: this.headers, body: JSON.stringify(payload), signal: controller.signal,
      })
      const raw = await response.text()
      let body: unknown = {}
      if (raw) {
        try { body = JSON.parse(raw) } catch { body = raw }
      }
      return { status: response.status, body }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function normalizeRoute(value: HostOrganizationDirectoryRoute): HostOrganizationDirectoryRoute {
  const keys = Object.keys(value as Record<string, unknown>)
  if (keys.some(key => key !== 'jurisdiction' && key !== 'network')) throw new Error('route_context_invalid')
  const jurisdiction = segment(value.jurisdiction)
  const network = segment(value.network)
  if (!['test', 'local-network', 'test-network', 'network'].includes(network)) throw new Error('route_context_invalid')
  return Object.freeze({ jurisdiction, network: network as HostOrganizationDirectoryRoute['network'] })
}

function filterClaims(filters: HostOrganizationDirectoryFilters = {}): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries([
    [CLAIM_JURISDICTION, filters.jurisdiction],
    [CLAIM_SECTOR, filters.sector],
    [CLAIM_STATUS, filters.status],
    [CLAIM_IDENTIFIER_TYPE, filters.identifierType],
    [CLAIM_IDENTIFIER_VALUE, filters.identifierValue],
    [CLAIM_LEGAL_NAME, filters.legalName],
    [CLAIM_NAME, filters.name],
  ].flatMap(([key, value]) => optional(value) ? [[key, optional(value)!]] : [])))
}

function readPage(value: unknown): HostOrganizationDirectoryPage {
  const root = record(value)
  const bundle = record(root.body || root)
  if (bundle.resourceType !== 'Bundle' || bundle.type !== 'searchset') throw new Error('host_directory_bundle_invalid')
  const data = Array.isArray(bundle.data) ? bundle.data : []
  const outcome = data.flatMap((entry: unknown) => {
    const response = record(record(entry).response)
    const result = record(response.outcome)
    return result.resourceType === 'OperationOutcome' && Array.isArray(result.issue) ? result.issue : []
  }).map(record).find(issue => ['fatal', 'error'].includes(String(issue.severity || '').toLowerCase()))
  if (outcome) throw new Error(`host_directory_failed:${String(outcome.diagnostics || outcome.code || 'operation_outcome')}`)
  const organizations = data.flatMap((entry: unknown) => {
    const row = record(entry)
    const response = record(row.response)
    const resource = record(row.resource)
    const claims = Object.freeze({ ...record(record(resource.meta).claims) })
    if (resource.resourceType !== 'Organization' || !String(response.status || '').startsWith('2')) return []
    const status = String(claims[CLAIM_STATUS] || '')
    if (!['active', 'suspended', 'revoked'].includes(status)) throw new Error('host_directory_status_invalid')
    return [Object.freeze({
      id: String(resource.id || row.id || ''),
      legalName: String(claims[CLAIM_LEGAL_NAME] || ''),
      name: String(claims[CLAIM_NAME] || claims[CLAIM_LEGAL_NAME] || ''),
      identifierType: String(claims[CLAIM_IDENTIFIER_TYPE] || ''),
      identifierValue: String(claims[CLAIM_IDENTIFIER_VALUE] || ''),
      jurisdiction: String(claims[CLAIM_JURISDICTION] || ''),
      sector: String(claims[CLAIM_SECTOR] || ''),
      status: status as HostOrganizationDirectoryEntry['status'],
      claims,
    })]
  })
  const pagination = record(record(bundle.meta).pagination)
  return Object.freeze({
    total: nonNegativeInteger(bundle.total, 'host_directory_total_invalid'),
    pageSize: positiveInteger(pagination.pageSize, 'host_directory_page_size_invalid'),
    returned: nonNegativeInteger(pagination.returned, 'host_directory_returned_invalid'),
    hasNext: pagination.hasNext === true,
    ...(optional(pagination.nextCursor) ? { nextCursor: optional(pagination.nextCursor) } : {}),
    organizations: Object.freeze(organizations),
  })
}

function requireSuccessfulResponse(response: GatewayResponse, code: string): void {
  if (response.status >= 200 && response.status < 300) return
  throw new Error(`${code}:${response.status}`)
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('gateway_base_url_insecure')
  return url.href.replace(/\/$/u, '')
}

function segment(value: unknown): string {
  const result = String(value ?? '').trim()
  if (!result || result.includes('/') || result === '.' || result === '..') throw new Error('route_context_invalid')
  return result
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function optional(value: unknown): string | undefined {
  const result = String(value ?? '').trim()
  return result || undefined
}

function positiveInteger(value: unknown, code: string): number {
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1) throw new Error(code)
  return result
}

function nonNegativeInteger(value: unknown, code: string): number {
  const result = Number(value)
  if (!Number.isInteger(result) || result < 0) throw new Error(code)
  return result
}
