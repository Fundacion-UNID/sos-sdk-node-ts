// Flow contract: a verified passkey releases only the exact server-bound profile unlock secret through a one-time grant; browser responses never receive it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ServerPasskeyProfileService, createSimpleWebAuthnCeremonyAdapter } from '../dist/index.js';

class MemoryStore {
  credentials = new Map();
  ceremonies = new Map();
  access = new Map();
  async listCredentials(loginIdentifier, profileId) {
    return [...this.credentials.values()].filter(value => value.loginIdentifier === loginIdentifier && (!profileId || value.profileId === profileId));
  }
  async getCredential(key) { return this.credentials.get(key); }
  async getCeremony(id) { return this.ceremonies.get(id); }
  async putCeremony(id, value) { this.ceremonies.set(id, value); }
  async completeRegistration(ceremonyId, credentialKey, value) {
    assert.equal(this.credentials.has(credentialKey), false);
    this.credentials.set(credentialKey, value);
    this.ceremonies.delete(ceremonyId);
  }
  async completeAuthentication(ceremonyId, credentialKey, counter, accessKey, value) {
    this.credentials.set(credentialKey, { ...this.credentials.get(credentialKey), counter });
    this.access.set(accessKey, value);
    this.ceremonies.delete(ceremonyId);
  }
  async consumeAccess(key) { const value = this.access.get(key); this.access.delete(key); return value; }
}

test('registers a user-verifying passkey and consumes its exact profile grant once', async () => {
  const store = new MemoryStore();
  const verifiedPins = [];
  const service = new ServerPasskeyProfileService({
    store,
    sealer: {
      async seal(value, aad) { return `${aad}:${Buffer.from(value).toString('base64url')}`; },
      async unseal(value, aad) { assert.ok(value.startsWith(`${aad}:`)); return Buffer.from(value.slice(aad.length + 1), 'base64url').toString(); },
    },
    profiles: {
      async assertBinding(input) { assert.equal(input.ownerId, 'owner-1'); assert.equal(input.loginIdentifier, 'person@example.org'); },
      async verifyAndGetUnlockSecret(input) { verifiedPins.push(input.pin); return input.pin; },
    },
    ceremonies: {
      credentialId(response) { return response.id; },
      async registrationOptions() { return { challenge: 'registration-challenge', options: { challenge: 'registration-challenge' } }; },
      async verifyRegistration() { return { credentialId: 'credential-1', publicKey: 'public-key', counter: 0, transports: ['internal'], deviceType: 'singleDevice', backedUp: false }; },
      async authenticationOptions() { return { challenge: 'authentication-challenge', options: { challenge: 'authentication-challenge' } }; },
      async verifyAuthentication() { return { newCounter: 1 }; },
    },
    issueLoginToken: async loginIdentifier => `login:${loginIdentifier}`,
    now: () => new Date('2026-10-21T10:00:00.000Z'),
    randomId: () => 'ceremony-1',
    randomToken: () => 'profile-access-token',
  });

  const registration = await service.beginRegistration({ ownerId: 'owner-1', loginIdentifier: 'Person@Example.org', profileId: 'profile-1' });
  assert.equal(registration.ceremonyId, 'ceremony-1');
  await service.completeRegistration({ ceremonyId: registration.ceremonyId, ownerId: 'owner-1', loginIdentifier: 'person@example.org', pin: '123456', response: {} });
  assert.deepEqual(verifiedPins, ['123456']);

  const authentication = await service.beginAuthentication({ loginIdentifier: 'person@example.org', profileId: 'profile-1' });
  const verified = await service.completeAuthentication({ ceremonyId: authentication.ceremonyId, response: { id: 'credential-1' } });
  assert.equal(verified.loginToken, 'login:person@example.org');
  assert.equal(verified.profileAccessToken, 'profile-access-token');
  assert.equal('unlockSecret' in verified, false);

  const grant = await service.consumeProfileAccess({ accessToken: verified.profileAccessToken, ownerId: 'owner-1', profileId: 'profile-1', loginIdentifier: 'person@example.org' });
  assert.equal(grant.unlockSecret, '123456');
  await assert.rejects(
    service.consumeProfileAccess({ accessToken: verified.profileAccessToken, ownerId: 'owner-1', profileId: 'profile-1', loginIdentifier: 'person@example.org' }),
    /passkey_profile_access_invalid/,
  );
});

test('builds platform-bound WebAuthn options with mandatory user verification', async () => {
  const adapter = createSimpleWebAuthnCeremonyAdapter({
    rpName: 'personal.example', rpId: 'personal.example', origins: ['https://personal.example'],
  });
  const generated = await adapter.registrationOptions({
    ownerId: 'owner-1', loginIdentifier: '+16045550123', profileId: 'profile-1', existing: [],
  });
  assert.equal(generated.options.rp.id, 'personal.example');
  assert.equal(generated.options.authenticatorSelection.userVerification, 'required');
  assert.equal(generated.options.authenticatorSelection.residentKey, 'required');
});
