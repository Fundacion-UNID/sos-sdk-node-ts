# Secure messages in Node.js

Use `createNodeSecureMessageCrypto()` from
`sos-sdk-node-ts/secure-message-crypto`. The factory composes the shared
runtime-neutral implementation with a Node CSPRNG adapter.

```ts
import { createNodeSecureMessageCrypto } from 'sos-sdk-node-ts/secure-message-crypto';

const secureMessages = createNodeSecureMessageCrypto();
const recipient = await secureMessages.generateRecipientKeyPair(deviceKeyId);

const envelope = await secureMessages.seal({
  plaintext: recordedAudioBytes,
  contentType: 'audio/ogg',
  recipients: [recipient],
});
```

Written messages use the same call after UTF-8 encoding, for example with
`contentType: 'text/plain;charset=utf-8'`. Decrypt the returned bytes only in
an authorized recipient runtime; decode text or play audio after decryption.

`NodeSecureRandomSource` validates the requested size and returns a fresh copy
of `node:crypto.randomBytes(...)`. It does not own keys or perform any other
cryptographic operation. Never replace it with `Math.random`, timestamps,
identifiers or deterministic application data.

Recipient lifecycle and authorization remain separate. A service may rewrap a
CEK to current device/channel keys and remove its temporary recipient entry,
but only after the product has authorized that change. The storage service
persists the opaque envelope and does not need plaintext access.
