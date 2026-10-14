// Flow contract: SOSChain Node dispatch authorizes transport configuration, preserves idempotency and fails closed without exposing secrets.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SosEmergencyDispatchClient } from '../dist/emergency-dispatch.js';

test('dispatches one authorized SOS request with its stable idempotency key', async () => {
  const calls = [];
  const client = new SosEmergencyDispatchClient({
    endpoint: 'https://dispatch.sos.example/emergency',
    bearerToken: 'private-token',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        acknowledgedAt: '2026-09-19T12:00:00.000Z',
        receiverId: 'regional-dispatch-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const acknowledgement = await client.dispatch({
    requestId: 'request-1',
    callerId: 'caller-1',
    memberSubjectIds: ['subject-1'],
    authorizationEvidenceIds: ['evidence-1'],
    deliveryTarget: {
      tenantId: 'tenant-1',
      jurisdiction: 'CA-BC',
      endpointId: 'dispatch-1',
    },
    payload: { resourceType: 'ServiceRequest' },
  });

  assert.equal(acknowledgement.receiverId, 'regional-dispatch-1');
  assert.equal(calls[0].init.headers['idempotency-key'], 'request-1');
  assert.equal(calls[0].init.headers.authorization, 'Bearer private-token');
});

test('rejects insecure remote endpoints and invalid acknowledgements', async () => {
  assert.throws(() => new SosEmergencyDispatchClient({
    endpoint: 'http://dispatch.example/emergency',
    bearerToken: 'private-token',
  }), /HTTPS/);

  const client = new SosEmergencyDispatchClient({
    endpoint: 'http://localhost:3000/emergency',
    bearerToken: 'private-token',
    fetch: async () => new Response('{}', { status: 200 }),
  });
  await assert.rejects(() => client.dispatch({
    requestId: 'request-1',
    callerId: 'caller-1',
    memberSubjectIds: ['subject-1'],
    authorizationEvidenceIds: ['evidence-1'],
    deliveryTarget: { tenantId: 'tenant-1', jurisdiction: 'CA-BC', endpointId: 'dispatch-1' },
    payload: {},
  }), /acknowledgement_invalid/);
});
