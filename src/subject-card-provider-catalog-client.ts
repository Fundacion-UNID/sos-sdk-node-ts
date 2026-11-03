import type { SubjectCardProviderDescriptor } from 'sos-data-utils-ts/subject-card-directory'
import {
  discoverSubjectCardProviders,
  type SubjectCardProviderDiscoveryFilter,
} from 'sos-sdk-core-ts/subject-card-provider-discovery'
import {
  SosGatewaySubjectDirectoryClient,
  type AuthorizedIndividualSubject,
  type AuthorizedSubjectVerifiedContact,
} from './subject-card-directory-client.js'

export type SosSubjectCardProviderCatalogClientOptions = Readonly<{
  catalogUrl: string
  bearerToken?: string
  fetchImpl?: typeof fetch
}>

/** Reads public provider advertisements from a data-space JSON:API catalog. */
export class SosSubjectCardProviderCatalogClient {
  private readonly catalogUrl: URL
  private readonly bearerToken?: string
  private readonly fetchImpl: typeof fetch

  public constructor(options: SosSubjectCardProviderCatalogClientOptions) {
    this.catalogUrl = secureUrl(options.catalogUrl)
    this.bearerToken = optional(options.bearerToken)
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  public async discover(
    filter: SubjectCardProviderDiscoveryFilter,
  ): Promise<readonly SubjectCardProviderDescriptor[]> {
    const url = new URL(this.catalogUrl)
    url.searchParams.set('subjectKind', filter.subjectKind)
    url.searchParams.set('operation', filter.operation)
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.api+json',
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
      },
    })
    if (!response.ok) throw new Error(`provider_catalog_failed:${response.status}`)
    const body = await response.json() as { data?: unknown }
    if (!Array.isArray(body.data)) throw new Error('provider_catalog_response_invalid')
    const catalog = body.data.map(entry => {
      const row = record(entry)
      if (row.type !== 'subject-card-provider') throw new Error('provider_catalog_entry_invalid')
      return record(row.attributes) as SubjectCardProviderDescriptor
    })
    return discoverSubjectCardProviders(catalog, filter)
  }
}

export type FederatedProviderSubject = Readonly<{
  providerId: string
  subject: AuthorizedIndividualSubject
}>

export type FederatedProviderSubjectResult = Readonly<{
  subjects: readonly FederatedProviderSubject[]
  unavailableProviderIds: readonly string[]
}>

/** Queries every advertised directory independently and keeps partial success. */
export async function readFederatedProviderSubjects(input: Readonly<{
  providers: readonly SubjectCardProviderDescriptor[]
  subjectKind?: 'human' | 'animal'
  verifiedContact: AuthorizedSubjectVerifiedContact
  bearerToken?: string
  readProvider?: (
    provider: SubjectCardProviderDescriptor,
    verifiedContact: AuthorizedSubjectVerifiedContact,
  ) => Promise<readonly AuthorizedIndividualSubject[]>
}>): Promise<FederatedProviderSubjectResult> {
  const providers = discoverSubjectCardProviders(input.providers, {
    subjectKind: input.subjectKind ?? commonSubjectKind(input.providers),
    operation: 'directory',
  })
  const readProvider = input.readProvider ?? (async provider => {
    const route = parseDirectoryRoute(provider.directoryRoute)
    const client = new SosGatewaySubjectDirectoryClient({
      baseUrl: route.baseUrl,
      bearerToken: input.bearerToken,
    })
    return client.listAuthorizedIndividualSubjects(route.context, {
      verifiedContact: input.verifiedContact,
    })
  })
  const settled = await Promise.allSettled(providers.map(provider =>
    readProvider(provider, input.verifiedContact)))
  const subjects: FederatedProviderSubject[] = []
  const unavailableProviderIds: string[] = []
  for (const [index, result] of settled.entries()) {
    const provider = providers[index]
    if (result.status === 'rejected') {
      unavailableProviderIds.push(provider.providerId)
      continue
    }
    for (const subject of result.value) subjects.push(Object.freeze({ providerId: provider.providerId, subject }))
  }
  return Object.freeze({
    subjects: Object.freeze(subjects),
    unavailableProviderIds: Object.freeze(unavailableProviderIds),
  })
}

function commonSubjectKind(providers: readonly SubjectCardProviderDescriptor[]): 'human' | 'animal' {
  const kinds = new Set(providers.flatMap(provider => provider.subjectKinds))
  if (kinds.size !== 1) throw new Error('provider_subject_kind_filter_required')
  return [...kinds][0]!
}

function parseDirectoryRoute(value: string): Readonly<{
  baseUrl: string
  context: Readonly<{ tenantId: string; jurisdiction: string; sector: string }>
}> {
  const url = secureUrl(value)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 4 || !segments[1]?.startsWith('cds-') || segments[2] !== 'v1') {
    throw new Error('provider_directory_route_invalid')
  }
  return Object.freeze({
    baseUrl: url.origin,
    context: Object.freeze({ tenantId: segments[0], jurisdiction: segments[1].slice(4), sector: segments[3] }),
  })
}

function secureUrl(value: string): URL {
  const url = new URL(value)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('provider_url_insecure')
  return url
}

function optional(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}
