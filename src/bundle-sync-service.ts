// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import {
  BundleSyncStates,
  confirmBundleSyncDraft,
  markBundleSyncRetryable,
  reconcileBundleSyncSubmission,
  submitBundleSyncDraft,
  type BundleSyncDraft,
  type BundleSyncPayload,
  type BundleSyncState,
} from 'sos-sdk-core-ts/bundle-sync-draft'

export type ProtectedBundleSyncRecord = Readonly<{
  id: string
  kind: BundleSyncDraft['kind']
  subjectReference: string
  state: BundleSyncState
  protectedPayload: string
  createdAt: string
  updatedAt: string
}>

export interface BundleSyncRepository {
  put(record: ProtectedBundleSyncRecord): Promise<void>
  get(id: string): Promise<ProtectedBundleSyncRecord | undefined>
  list(): Promise<readonly ProtectedBundleSyncRecord[]>
}

export interface BundleSyncProtection {
  protect(draft: BundleSyncDraft): Promise<string>
  unprotect(protectedPayload: string): Promise<BundleSyncDraft>
}

export interface BundleSyncExecutor {
  submit(draft: BundleSyncDraft): Promise<BundleSyncPayload>
  readback(draft: BundleSyncDraft): Promise<BundleSyncPayload>
}

export type BundleSyncDraftServiceOptions = Readonly<{
  repository: BundleSyncRepository
  protection: BundleSyncProtection
  executor: BundleSyncExecutor
  now?: () => Date
}>

/** Deterministic test adapter. Production runtimes inject durable storage. */
export class BundleSyncRepositoryMemory implements BundleSyncRepository {
  readonly #records = new Map<string, ProtectedBundleSyncRecord>()

  async put(record: ProtectedBundleSyncRecord): Promise<void> {
    this.#records.set(record.id, structuredClone(record))
  }

  async get(id: string): Promise<ProtectedBundleSyncRecord | undefined> {
    const record = this.#records.get(id)
    return record ? structuredClone(record) : undefined
  }

  async list(): Promise<readonly ProtectedBundleSyncRecord[]> {
    return [...this.#records.values()].map((record) => structuredClone(record))
  }
}

/** Protected outbox shared by clinical, Consent, contact and Encounter Bundles. */
export class BundleSyncDraftService {
  public constructor(private readonly options: BundleSyncDraftServiceOptions) {}

  public async enqueue(draft: BundleSyncDraft): Promise<BundleSyncDraft> {
    const current = await this.options.repository.get(draft.id)
    if (current) {
      const restored = await this.options.protection.unprotect(current.protectedPayload)
      if (JSON.stringify(restored.changesBundle) !== JSON.stringify(draft.changesBundle)) {
        throw new Error('bundle_sync_idempotency_conflict')
      }
      return restored
    }
    await this.persist(draft)
    return draft
  }

  public async read(id: string): Promise<BundleSyncDraft | undefined> {
    const record = await this.options.repository.get(id)
    return record ? this.options.protection.unprotect(record.protectedPayload) : undefined
  }

  public async process(id: string): Promise<BundleSyncDraft> {
    const draft = await this.read(id)
    if (!draft) throw new Error('bundle_sync_draft_not_found')
    if (draft.state === BundleSyncStates.Confirmed || draft.state === BundleSyncStates.Rejected) return draft
    const submitting = submitBundleSyncDraft(draft, this.now())
    await this.persist(submitting)
    try {
      const response = await this.options.executor.submit(submitting)
      const reconciled = reconcileBundleSyncSubmission(submitting, response, this.now())
      await this.persist(reconciled)
      if (reconciled.state !== BundleSyncStates.Reconciling) return reconciled
      const authoritativeBundle = await this.options.executor.readback(reconciled)
      const confirmed = confirmBundleSyncDraft(reconciled, authoritativeBundle, this.now())
      await this.persist(confirmed)
      return confirmed
    } catch (reason) {
      const retryable = markBundleSyncRetryable(submitting, [classify(reason)], this.now())
      await this.persist(retryable)
      return retryable
    }
  }

  private async persist(draft: BundleSyncDraft): Promise<void> {
    await this.options.repository.put({
      id: draft.id,
      kind: draft.kind,
      subjectReference: draft.subjectReference,
      state: draft.state,
      protectedPayload: await this.options.protection.protect(draft),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    })
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString()
  }
}

function classify(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason || 'bundle_sync_failed')
  return message.slice(0, 300)
}
