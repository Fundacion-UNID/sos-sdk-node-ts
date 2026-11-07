import type { TransactionalVaultRepository } from './transactional-vault.js'
import type { ServerPasskeyStore, ServerPasskeyCredential, ServerPasskeyCeremony, ServerPasskeyAccessGrant } from './server-passkey-profile.js'

/** The host supplies logical collection names; its vault alone selects persistence and namespace. */
export function createVaultServerPasskeyStore(vault: TransactionalVaultRepository, collections: Readonly<{
  credentials: string; ceremonies: string; access: string
}>): ServerPasskeyStore {
  return {
    async listCredentials(loginIdentifier, profileId) {
      const records = await vault.query<ServerPasskeyCredential & { id: string }>(collections.credentials, {
        where: [{ attribute: 'loginIdentifier', equals: loginIdentifier }],
      })
      return records.filter(credential => !profileId || credential.profileId === profileId).map(valueOnly)
    },
    async getCredential(key) {
      const record = await vault.get<ServerPasskeyCredential & { id: string }>(collections.credentials, key)
      return record ? valueOnly(record) : undefined
    },
    async getCeremony(id) {
      const record = await vault.get<ServerPasskeyCeremony & { id: string }>(collections.ceremonies, id)
      return record ? valueOnly(record) : undefined
    },
    async putCeremony(id, value) { await vault.put(collections.ceremonies, { ...value, id }) },
    async completeRegistration(ceremonyId, credentialKey, value) {
      await vault.runTransaction(async transaction => {
        const ceremony = await transaction.get(collections.ceremonies, ceremonyId)
        const credential = await transaction.get(collections.credentials, credentialKey)
        if (!ceremony) throw new Error('passkey_ceremony_unavailable')
        if (credential) throw new Error('passkey_credential_exists')
        await transaction.put(collections.credentials, { ...value, id: credentialKey })
        await transaction.delete(collections.ceremonies, ceremonyId)
      })
    },
    async completeAuthentication(ceremonyId, credentialKey, counter, accessKey, value) {
      await vault.runTransaction(async transaction => {
        const ceremony = await transaction.get(collections.ceremonies, ceremonyId)
        const credential = await transaction.get<ServerPasskeyCredential & { id: string }>(collections.credentials, credentialKey)
        const existingAccess = await transaction.get(collections.access, accessKey)
        if (!ceremony) throw new Error('passkey_ceremony_unavailable')
        if (!credential) throw new Error('passkey_credential_unavailable')
        if ((counter > 0 || credential.counter > 0) && counter <= credential.counter) throw new Error('passkey_counter_replayed')
        if (existingAccess) throw new Error('passkey_access_exists')
        await transaction.put(collections.credentials, { ...credential, counter, lastUsedAt: new Date().toISOString() })
        await transaction.put(collections.access, { ...value, id: accessKey })
        await transaction.delete(collections.ceremonies, ceremonyId)
      })
    },
    async consumeAccess(key) {
      return vault.runTransaction(async transaction => {
        const grant = await transaction.get<ServerPasskeyAccessGrant & { id: string }>(collections.access, key)
        if (!grant) return undefined
        await transaction.delete(collections.access, key)
        return valueOnly(grant)
      })
    },
  }
}

function valueOnly<T extends { id: string }>(record: T): Omit<T, 'id'> {
  const { id: _id, ...value } = record
  return value
}
