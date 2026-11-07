import { createHash } from 'node:crypto'
import { AccessToken } from 'livekit-server-sdk'
import { normalizePortalRtcCallEvent, type PortalRtcCallEvent } from 'sos-data-utils-ts/portal-rtc-call'

export type PortalRtcLiveKitGrant = Readonly<{ callId: string; serverUrl: string; participantToken: string }>

/** Issues only a short-lived RTC grant; call state remains a Communication. */
export async function issuePortalRtcLiveKitGrant(input: Readonly<{
  event: PortalRtcCallEvent; participantActorIdentifier: string; serverUrl: string
  apiKey: string; apiSecret: string; ttlSeconds?: number
  /** Exact group membership already revalidated by the calling BFF. */
  participantProfessionalGroupReference?: string
}>): Promise<PortalRtcLiveKitGrant> {
  const event = normalizePortalRtcCallEvent(input.event)
  const participant = required(input.participantActorIdentifier, 'portal_rtc_participant_required')
  const permitted = new Set([event.callerActorIdentifier, event.recipientActorIdentifier, event.professionalGroupReference])
  const groupAuthorized = input.participantProfessionalGroupReference !== undefined
    && required(input.participantProfessionalGroupReference, 'portal_rtc_participant_group_required') === event.professionalGroupReference
  if (!permitted.has(participant) && !groupAuthorized) throw new Error('portal_rtc_participant_forbidden')
  const parsed = new URL(required(input.serverUrl, 'portal_rtc_server_url_required'))
  if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error('portal_rtc_server_url_invalid')
  const token = new AccessToken(required(input.apiKey, 'portal_rtc_api_key_required'), required(input.apiSecret, 'portal_rtc_api_secret_required'), {
    identity: participant, ttl: input.ttlSeconds ?? 300,
    metadata: JSON.stringify({ callId: event.callId, threadId: event.threadId }),
  })
  token.addGrant({ roomJoin: true, room: roomName(event), canPublish: true, canSubscribe: true })
  return Object.freeze({ callId: event.callId, serverUrl: parsed.href.replace(/\/$/u, ''), participantToken: await token.toJwt() })
}
export function portalRtcRoomName(event: PortalRtcCallEvent): string { return roomName(normalizePortalRtcCallEvent(event)) }
function roomName(event: PortalRtcCallEvent) { return `rtc-${createHash('sha256').update(`${event.callId}\0${event.threadId}`).digest('hex').slice(0, 32)}` }
function required(value: unknown, error: string) { const normalized = String(value || '').trim(); if (!normalized) throw new Error(error); return normalized }
