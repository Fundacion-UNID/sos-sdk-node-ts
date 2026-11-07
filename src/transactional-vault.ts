import { VaultMemRepository, type IVaultRepository, type VaultQuery } from 'gdc-common-utils-ts/storage'

/** Atomic capability added without changing the frozen base vault interface. */
export interface TransactionalVaultRepository extends IVaultRepository {
  initialize(): Promise<void>
  /** Use only the supplied port inside the callback; read before writing for durable adapters. */
  runTransaction<T>(operation: (vault: IVaultRepository) => Promise<T>): Promise<T>
}

/** Process-owned memory adapter with isolated commit/rollback and serialized access. */
export class TransactionalMemoryVaultRepository implements TransactionalVaultRepository {
  private delegate = new VaultMemRepository()
  private collections = new Set<string>()
  private pending: Promise<void> = Promise.resolve()
  async initialize(): Promise<void> {}
  put<T extends { id: string }>(collection: string, values: T | T[]): Promise<boolean> {
    return this.exclusive(async () => {
      this.collections.add(collection)
      return this.delegate.put(collection, structuredClone(values))
    })
  }
  get<T extends { id: string }>(collection: string, id: string): Promise<T | undefined> {
    return this.exclusive(async () => structuredClone(await this.delegate.get<T>(collection, id)))
  }
  query<T extends { id: string }>(collection: string, query: VaultQuery): Promise<T[]> {
    return this.exclusive(async () => structuredClone(await this.delegate.query<T>(collection, query)))
  }
  delete(collection: string, id: string): Promise<boolean> {
    return this.exclusive(() => this.delegate.delete(collection, id))
  }
  runTransaction<T>(operation: (vault: IVaultRepository) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const draft = new VaultMemRepository()
      const collections = new Set(this.collections)
      for (const collection of collections) {
        await draft.put(collection, structuredClone(await this.delegate.query(collection, {})))
      }
      const transaction: IVaultRepository = {
        async put(collection, values) {
          collections.add(collection)
          return draft.put(collection, structuredClone(values))
        },
        async get<T extends { id: string }>(collection: string, id: string) { return structuredClone(await draft.get<T>(collection, id)) },
        async query<T extends { id: string }>(collection: string, query: VaultQuery) { return structuredClone(await draft.query<T>(collection, query)) },
        delete: (collection, id) => draft.delete(collection, id),
      }
      const result = await operation(transaction)
      this.delegate = draft
      this.collections = collections
      return result
    })
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
}
