import type { EmergencyDeliveryTarget } from 'sos-sdk-core-ts/emergency-authorization';

export type SosEmergencyDispatchInput = Readonly<{
  requestId: string;
  callerId: string;
  memberSubjectIds: readonly string[];
  authorizationEvidenceIds: readonly string[];
  deliveryTarget: EmergencyDeliveryTarget;
  payload: unknown;
}>;

export type SosEmergencyDispatchAcknowledgement = Readonly<{
  acknowledgedAt: string;
  receiverId: string;
}>;

export type SosEmergencyDispatchClientOptions = Readonly<{
  endpoint: string;
  bearerToken: string;
  fetch?: typeof globalThis.fetch;
}>;

/**
 * Sends an already-authorized SOSChain request from a trusted Node runtime.
 *
 * Authorization remains in `sos-sdk-core-ts`; this adapter owns only HTTPS
 * transport, service credentials, idempotency and acknowledgement validation.
 */
export class SosEmergencyDispatchClient {
  readonly #endpoint: URL;
  readonly #bearerToken: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: SosEmergencyDispatchClientOptions) {
    this.#endpoint = secureEndpoint(options.endpoint);
    this.#bearerToken = required(options.bearerToken, 'bearerToken');
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async dispatch(input: SosEmergencyDispatchInput): Promise<SosEmergencyDispatchAcknowledgement> {
    const requestId = required(input.requestId, 'requestId');
    const callerId = required(input.callerId, 'callerId');
    const memberSubjectIds = identifiers(input.memberSubjectIds, 'memberSubjectIds');
    const authorizationEvidenceIds = identifiers(
      input.authorizationEvidenceIds,
      'authorizationEvidenceIds',
    );
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.#bearerToken}`,
        'idempotency-key': requestId,
      },
      body: JSON.stringify({
        ...input,
        requestId,
        callerId,
        memberSubjectIds,
        authorizationEvidenceIds,
      }),
    });
    if (!response.ok) throw new Error(`emergency_dispatch_http_${response.status}`);
    const body = await response.json().catch(() => undefined) as
      | { acknowledgedAt?: unknown; receiverId?: unknown }
      | undefined;
    const acknowledgedAt = String(body?.acknowledgedAt ?? '').trim();
    const receiverId = String(body?.receiverId ?? '').trim();
    if (!receiverId || !Number.isFinite(Date.parse(acknowledgedAt))) {
      throw new Error('emergency_dispatch_acknowledgement_invalid');
    }
    return Object.freeze({ acknowledgedAt, receiverId });
  }
}

function secureEndpoint(value: string): URL {
  const endpoint = new URL(required(value, 'endpoint'));
  const local = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
  if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) {
    throw new TypeError('Emergency dispatch endpoint must use HTTPS outside local development.');
  }
  return endpoint;
}

function identifiers(values: readonly string[], field: string): readonly string[] {
  const normalized = [...new Set((values ?? []).map((value) => required(value, field)))];
  if (normalized.length === 0) throw new TypeError(`${field} must not be empty.`);
  return normalized;
}

function required(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}
