// Flow contract: the Node adapter supplies only cryptographically secure random bytes while shared core encrypts and decrypts the same text or audio envelope for every authorized ML-KEM recipient.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NodeSecureRandomSource,
  createNodeSecureMessageCrypto,
} from '../dist/secure-message-crypto.js';

test('supplies fresh Node CSPRNG bytes with the requested length', async () => {
  const randomSource = new NodeSecureRandomSource();

  const first = await randomSource.getRandomBytes(32);
  const second = await randomSource.getRandomBytes(32);

  assert.equal(first.length, 32);
  assert.equal(second.length, 32);
  assert.notDeepEqual(first, second);
  await assert.rejects(() => randomSource.getRandomBytes(0), /secure_random_length_invalid/);
  await assert.rejects(() => randomSource.getRandomBytes(1.5), /secure_random_length_invalid/);
});

test('creates shared core crypto that protects both text and binary audio', async () => {
  const secureMessages = createNodeSecureMessageCrypto();
  const webRecipient = await secureMessages.generateRecipientKeyPair('urn:example:key:web');
  const telephoneRecipient = await secureMessages.generateRecipientKeyPair('urn:example:key:telephone');

  for (const message of [
    { contentType: 'text/plain;charset=utf-8', plaintext: new TextEncoder().encode('Private inbox message') },
    { contentType: 'audio/ogg', plaintext: Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0xff]) },
  ]) {
    const envelope = await secureMessages.seal({
      ...message,
      recipients: [webRecipient, telephoneRecipient],
    });

    assert.equal((await secureMessages.open({ envelope, recipient: webRecipient })).contentType, message.contentType);
    assert.deepEqual(
      (await secureMessages.open({ envelope, recipient: telephoneRecipient })).plaintext,
      message.plaintext,
    );
  }
});
