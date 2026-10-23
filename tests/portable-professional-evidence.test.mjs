// Flow contract: shared Node consumers verify an existing professional DID, authorization URN or signed SHC through trusted provider configuration; none is an invitation or device-registration grant.
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import test from 'node:test'
import {
  derivePortableProfessionalProviderCandidates,
  resolvePortableProfessionalEnrollment,
  resolveProfessionalShcEnrollment,
} from '../dist/portable-professional-evidence.js'

// These deliberately synthetic values exercise the exact governed wire shapes.
const authorizationUrn = 'urn:cds-ca-bc:v1:organization:bn:Example-123:member:zJJPb9sJCAcnFLu8tVHGF4c:2250'
const provider = Object.freeze({
  baseUrl: 'https://gateway.example',
  tenantId: 'Example-123',
  jurisdiction: 'CA-BC',
  sector: 'animal-care',
})
const providerDid = 'did:web:authority.example:Example-123:cds-CA-BC:v1:animal-care'

test('derives only a trusted-host provider candidate from portable routing evidence', () => {
  assert.deepEqual(derivePortableProfessionalProviderCandidates({
    professionalIdentifier: authorizationUrn,
    sectorHint: 'animal-care',
    trustedGatewayBaseUrls: ['https://gateway.example/path-that-must-not-be-authority'],
    allowedSectors: ['animal-care', 'health-care'],
  }), [{
    baseUrl: 'https://gateway.example',
    tenantId: 'Example-123',
    jurisdiction: 'CA-BC',
    sector: 'animal-care',
  }])

  assert.throws(() => derivePortableProfessionalProviderCandidates({
    professionalIdentifier: authorizationUrn,
    sectorHint: 'public-safety',
    trustedGatewayBaseUrls: ['https://gateway.example'],
    allowedSectors: ['animal-care'],
  }), /sector_not_allowed/)
})

test('resolves one existing authorization URN through the authoritative tenant DID', async () => {
  const requested = []
  const result = await resolvePortableProfessionalEnrollment({
    professionalIdentifier: authorizationUrn,
    sectorHint: provider.sector,
    verifiedEmail: 'licensed@example.test',
    providers: [provider],
    fetchImpl: async url => {
      requested.push(String(url))
      return Response.json({
        id: providerDid,
        service: [{ type: 'JsonWebKeyService2020', serviceEndpoint: 'https://authority.example/jwks.json' }],
      })
    },
  })

  assert.equal(requested[0], 'https://gateway.example/Example-123/cds-CA-BC/v1/animal-care/.well-known/did.json')
  assert.equal(result.employeeAuthorizationUrn, authorizationUrn)
  assert.equal(result.providerDid, providerDid)
  assert.equal(result.sector, 'animal-care')
  assert.equal(result.role, 'ISCO-08|2250')
})

test('resolves a professional DID only through its authoritative DID document', async () => {
  const professionalDid = `${providerDid}:employee:zLicensedEmailHash:ISCO-08|2250`
  const requested = []
  const result = await resolvePortableProfessionalEnrollment({
    professionalIdentifier: professionalDid,
    sectorHint: provider.sector,
    verifiedEmail: 'licensed@example.test',
    providers: [provider],
    fetchImpl: async url => {
      requested.push(String(url))
      return String(url).includes('/employee/')
        ? Response.json({ id: professionalDid, alsoKnownAs: [authorizationUrn] })
        : Response.json({
          id: providerDid,
          service: [{ type: 'JsonWebKeyService2020', serviceEndpoint: 'https://authority.example/jwks.json' }],
        })
    },
  })

  assert.match(requested[0], /\/employee\/zLicensedEmailHash\/ISCO-08%7C2250\/did\.json$/)
  assert.equal(result.employeeAuthorizationUrn, authorizationUrn)
})

test('verifies a signed professional SHC before extracting its existing authorization', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', zip: 'DEF', kid: 'professional-1' })).toString('base64url')
  const payload = Buffer.from(deflateRawSync(Buffer.from(JSON.stringify({
    iss: 'https://gateway.example/Example-123/cds-CA-BC/v1/animal-care',
    nbf: 1_700_000_000,
    vc: { credentialSubject: { fhirBundle: {
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Organization', identifier: [{ value: 'Example-123' }] } },
        { resource: { resourceType: 'Practitioner', identifier: [{ value: 'did:web:authority.example:employee:zHash:ISCO-08|2250' }] } },
        { resource: { resourceType: 'PractitionerRole', active: true, identifier: [{ value: authorizationUrn }], practitioner: { reference: 'resource:1' }, organization: { reference: 'resource:0' } } },
      ],
    } } },
  })))).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  const compact = `${header}.${payload}.${signature}`
  const qr = `shc:/${[...compact].map(character => String(character.charCodeAt(0) - 45).padStart(2, '0')).join('')}`
  const publicJwk = publicKey.export({ format: 'jwk' })

  const result = await resolveProfessionalShcEnrollment({
    credential: qr,
    providers: [provider],
    nowSeconds: 1_800_000_000,
    fetchImpl: async () => Response.json({ keys: [{ ...publicJwk, kid: 'professional-1' }] }),
  })

  assert.deepEqual(result, { professionalIdentifier: authorizationUrn, sectorHint: 'animal-care' })
})

test('rejects unknown provider routing and altered SHC evidence', async () => {
  await assert.rejects(resolvePortableProfessionalEnrollment({
    professionalIdentifier: authorizationUrn,
    sectorHint: provider.sector,
    verifiedEmail: 'licensed@example.test',
    providers: [],
  }), /provider/)

  await assert.rejects(resolveProfessionalShcEnrollment({
    credential: 'shc:/1234',
    providers: [provider],
  }), /professional_credential/)
})
