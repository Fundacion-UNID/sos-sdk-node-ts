import { randomBytes } from 'node:crypto';

import {
  MultiRecipientSecureMessageCrypto,
  type SecureRandomSource,
} from 'sos-sdk-core-ts/secure-message-crypto';

const NODE_RANDOM_BYTES_MAX_LENGTH = 2 ** 31 - 1;

/** Node.js CSPRNG adapter. All ML-KEM, KDF and AES operations remain in shared core. */
export class NodeSecureRandomSource implements SecureRandomSource {
  public async getRandomBytes(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length <= 0 || length > NODE_RANDOM_BYTES_MAX_LENGTH) {
      throw new Error('secure_random_length_invalid');
    }
    return new Uint8Array(randomBytes(length));
  }
}

/** Create runtime-neutral secure-message crypto with the Node.js CSPRNG boundary. */
export const createNodeSecureMessageCrypto = (): MultiRecipientSecureMessageCrypto => (
  new MultiRecipientSecureMessageCrypto(new NodeSecureRandomSource())
);
