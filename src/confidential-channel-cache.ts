import { createHash } from 'node:crypto'

const COLLECTION = 'channel_communication_cache'

export type ConfidentialChannelSourceMessage<TEnvelope = unknown> = Readonly<{
  id: string
  channelId: string
  sender: string
  recipients: readonly string[]
  sent?: string
  envelope: TEnvelope
}>

export type ConfidentialChannelMessage = Readonly<{
  id: string
  channelId: string
  sender: string
  recipients: readonly string[]
  sent?: string
  messageKind: 'clinical-document' | 'text' | 'audio'
  text?: string
  bundle?: unknown
  audioBase64?: string
  audioContentType?: string
}>

export type ConfidentialChannelDocument = Readonly<{
  version: 1
  cursor?: string
  messages: readonly ConfidentialChannelMessage[]
}>

export type ConfidentialChannelVault = Readonly<{
  get(collection: string, id: string): Promise<unknown>
  put(collection: string, record: Readonly<Record<string, unknown> & { id: string }>): Promise<unknown>
  query(collection: string, where: readonly Readonly<{ attribute: string; equals: string }>[]): Promise<readonly unknown[]>
}>

export type ConfidentialChannelStorageAdapter = Readonly<{
  protect(document: Readonly<{ id?: string; content: unknown }>): Promise<unknown>
  unprotect(document: Readonly<{ id?: string; jwe: unknown }>): Promise<unknown>
}>

type StoredChannel = Readonly<{
  id: string
  profileHash: string
  subjectHash: string
  updatedAt: string
  jwe: unknown
}>

/** Rebuildable encrypted materialization; canonical messages remain in their governed source. */
export class ConfidentialChannelCache {
  public constructor(private readonly vault: ConfidentialChannelVault) {}

  public async synchronize<TEnvelope>(input: Readonly<{
    profileId: string
    subjectId: string
    channelId: string
    adapter: ConfidentialChannelStorageAdapter
    messages: readonly ConfidentialChannelSourceMessage<TEnvelope>[]
    open(envelope: TEnvelope): Promise<Readonly<{ contentType: string; plaintext: Uint8Array }>>
  }>): Promise<ConfidentialChannelDocument> {
    const identity = cacheIdentity(input)
    const current = await this.read(input) ?? emptyChannel()
    const knownIds = new Set(current.messages.map(message => message.id))
    const additions: ConfidentialChannelMessage[] = []
    for (const source of input.messages) {
      if (source.channelId !== input.channelId || knownIds.has(source.id)) continue
      additions.push(materialize(source, await input.open(source.envelope)))
    }
    const messages = [...current.messages, ...additions].sort(compareMessages)
    const cursor = messages.reduce<string | undefined>((latest, message) => {
      if (!message.sent) return latest
      return !latest || message.sent > latest ? message.sent : latest
    }, current.cursor)
    const content: ConfidentialChannelDocument = { version: 1, cursor, messages }
    const protectedDocument = protectedResult(await input.adapter.protect({ id: identity.id, content }))
    await this.vault.put(COLLECTION, {
      id: identity.id,
      profileHash: identity.profileHash,
      subjectHash: identity.subjectHash,
      updatedAt: new Date().toISOString(),
      jwe: protectedDocument.jwe,
    })
    return content
  }

  public async read(input: Readonly<{
    profileId: string
    subjectId: string
    channelId: string
    adapter: ConfidentialChannelStorageAdapter
  }>): Promise<ConfidentialChannelDocument | undefined> {
    const identity = cacheIdentity(input)
    const stored = this.stored(await this.vault.get(COLLECTION, identity.id))
    if (!stored || stored.profileHash !== identity.profileHash || stored.subjectHash !== identity.subjectHash) return undefined
    return channelContent(openedResult(await input.adapter.unprotect({ id: identity.id, jwe: stored.jwe })).content)
  }

  public async listSubject(input: Readonly<{
    profileId: string
    subjectId: string
    adapter: ConfidentialChannelStorageAdapter
  }>): Promise<ConfidentialChannelDocument[]> {
    const profileHash = digest(required(input.profileId, 'channel_cache_profile_required'))
    const subjectHash = digest(required(input.subjectId, 'channel_cache_subject_required'))
    const rows = await this.vault.query(COLLECTION, [
      { attribute: 'profileHash', equals: profileHash },
      { attribute: 'subjectHash', equals: subjectHash },
    ])
    return Promise.all(rows.map(async row => {
      const stored = this.stored(row)
      if (!stored) throw new Error('channel_cache_record_invalid')
      return channelContent(openedResult(await input.adapter.unprotect({ id: stored.id, jwe: stored.jwe })).content)
    }))
  }

  private stored(value: unknown): StoredChannel | undefined {
    if (!value || typeof value !== 'object' || !('id' in value) || !('jwe' in value)) return undefined
    return value as StoredChannel
  }
}

function materialize<TEnvelope>(
  source: ConfidentialChannelSourceMessage<TEnvelope>,
  opened: Readonly<{ contentType: string; plaintext: Uint8Array }>,
): ConfidentialChannelMessage {
  const contentType = String(opened.contentType || '').trim().toLowerCase()
  const common = {
    id: source.id, channelId: source.channelId, sender: source.sender,
    recipients: [...source.recipients], sent: source.sent,
  }
  if (contentType.startsWith('text/plain')) {
    return { ...common, messageKind: 'text', text: Buffer.from(opened.plaintext).toString('utf8') }
  }
  if (contentType.startsWith('audio/')) {
    return { ...common, messageKind: 'audio', audioBase64: Buffer.from(opened.plaintext).toString('base64'), audioContentType: contentType }
  }
  if (contentType === 'application/fhir+json') {
    const bundle = JSON.parse(Buffer.from(opened.plaintext).toString('utf8')) as { resourceType?: unknown }
    if (bundle?.resourceType !== 'Bundle') throw new Error('channel_cache_bundle_required')
    return { ...common, messageKind: 'clinical-document', bundle }
  }
  throw new Error('channel_cache_content_type_unsupported')
}

function cacheIdentity(input: Readonly<{ profileId: string; subjectId: string; channelId: string }>) {
  const profileHash = digest(required(input.profileId, 'channel_cache_profile_required'))
  const subjectHash = digest(required(input.subjectId, 'channel_cache_subject_required'))
  const channelHash = digest(required(input.channelId, 'channel_cache_channel_required'))
  return { id: digest(`${profileHash}\u0000${subjectHash}\u0000${channelHash}`), profileHash, subjectHash }
}
function digest(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex') }
function required(value: unknown, error: string) { const normalized = String(value || '').trim(); if (!normalized) throw new Error(error); return normalized }
function emptyChannel(): ConfidentialChannelDocument { return { version: 1, messages: [] } }
function compareMessages(left: ConfidentialChannelMessage, right: ConfidentialChannelMessage) { return String(left.sent || left.id).localeCompare(String(right.sent || right.id)) }
function protectedResult(value: unknown): { jwe: unknown } {
  if (!value || typeof value !== 'object' || !('jwe' in value)) throw new Error('channel_cache_protection_failed')
  return value as { jwe: unknown }
}
function openedResult(value: unknown): { content: unknown } {
  if (!value || typeof value !== 'object' || !('content' in value)) throw new Error('channel_cache_open_failed')
  return value as { content: unknown }
}
function channelContent(value: unknown): ConfidentialChannelDocument {
  const candidate = value as Partial<ConfidentialChannelDocument>
  if (candidate?.version !== 1 || !Array.isArray(candidate.messages)) throw new Error('channel_cache_document_invalid')
  return candidate as ConfidentialChannelDocument
}
