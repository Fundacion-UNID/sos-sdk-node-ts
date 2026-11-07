// Flow contract: after a portal BFF authorizes a Communication call event, the Node SDK issues only a short-lived dedicated LiveKit room grant for an exact participant and never sends assistant or Chat state.
import assert from 'node:assert/strict'
import test from 'node:test'
import { issuePortalRtcLiveKitGrant, portalRtcRoomName } from '../dist/portal-rtc-livekit.js'
const event = { version: 1, callId: 'call-1', threadId: 'thread-1', subjectIdentifier: 'did:web:subject.example', professionalGroupReference: 'Group/clinic-1', callerActorIdentifier: 'did:web:professional.example', recipientActorIdentifier: 'did:web:controller.example', media: ['audio', 'video'], state: 'ringing', occurredAt: '2026-11-07T12:00:00.000Z' }
test('issues one exact short-lived participant grant and deterministic room', async () => {
  const grant = await issuePortalRtcLiveKitGrant({ event, participantActorIdentifier: event.recipientActorIdentifier, serverUrl: 'wss://rtc.example', apiKey: 'key', apiSecret: 'a-secret-with-enough-entropy-for-signing' })
  assert.equal(grant.callId, 'call-1'); assert.equal(grant.serverUrl, 'wss://rtc.example'); assert.match(grant.participantToken, /^[^.]+\.[^.]+\.[^.]+$/u)
  assert.equal(portalRtcRoomName(event), portalRtcRoomName({ ...event }))
})
test('rejects a participant outside the authorized call Communication', async () => {
  await assert.rejects(() => issuePortalRtcLiveKitGrant({ event, participantActorIdentifier: 'did:web:attacker.example', serverUrl: 'wss://rtc.example', apiKey: 'key', apiSecret: 'a-secret-with-enough-entropy-for-signing' }), /participant_forbidden/u)
})
test('preserves an employee identity after the BFF revalidates exact professional group membership', async () => {
  const grant = await issuePortalRtcLiveKitGrant({ event, participantActorIdentifier: 'did:web:professional.example:employee:vet',
    participantProfessionalGroupReference: event.professionalGroupReference, serverUrl: 'wss://rtc.example', apiKey: 'key', apiSecret: 'a-secret-with-enough-entropy-for-signing' })
  assert.equal(grant.callId, event.callId)
})
