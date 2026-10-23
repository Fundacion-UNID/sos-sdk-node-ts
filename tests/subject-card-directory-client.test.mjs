// Flow contract: 1) a trusted BFF supplies one verified contact; 2) the shared Node client submits and polls the canonical SOS GW Organization and License routes; 3) a comma-separated sameAs claim is matched through one independently indexed alias; 4) canonical animal-card DIDs are returned, while a checksum-valid historical alias is migrated only for read compatibility using its explicit taxonomy claim. Authorization invariant: discovery metadata never grants an action. Persistence invariant: the client performs no registration, DCR, relationship mutation or local storage.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { SosGatewaySubjectDirectoryClient } from '../dist/subject-card-directory-client.js'

const CARD_DID = 'did:web:example.invalid:card:vetchain:0009615:724090961510852611262'
const ROUTE_CONTEXT = Object.freeze({
  tenantId: 'connecthealth-ca',
  jurisdiction: 'CA-BC',
  sector: 'animal-care',
})

const polled = (data) => ({ status: 200, body: { body: { data } } })

test('drives the real asynchronous SOS GW directory protocol over HTTP and matches one indexed sameAs alias', async () => {
  const requests = []
  const responses = [
    { status: 202, body: {} },
    polled([{ resource: { resourceType: 'Bundle', entry: [] } }]),
    { status: 202, body: {} },
    polled([{ resource: { data: [{ meta: {
      authorizedSubjectDid: CARD_DID,
      identifier: 'grant-1',
      claims: { 'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN' },
    } }] } }]),
    { status: 202, body: {} },
    polled([{ resource: { id: 'animal-1', meta: { claims: {
      'org.schema.Organization.sameAs': `${CARD_DID}, urn:cid:identity-evidence`,
      'org.schema.Organization.additionalType': 'animal',
      'org.schema.Organization.member.additionalType': 'http://purl.obolibrary.org/obo/NCBITaxon_9615',
    } } } }]),
  ]
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      appId: request.headers.appid,
      contentType: request.headers['content-type'],
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    })
    const next = responses.shift()
    response.writeHead(next.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(next.body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  try {
    const client = new SosGatewaySubjectDirectoryClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      bearerToken: 'verified-openid-token',
      appId: 'https://sos.example.ca',
      appVersion: 'v0.1.2',
    })
    const subjects = await client.listAuthorizedIndividualSubjects(ROUTE_CONTEXT, {
      verifiedContact: { email: 'Controller@Example.CA' },
      pollOptions: { intervalMs: 1, timeoutMs: 100 },
    })

    assert.deepEqual(subjects, [{
      subjectDid: CARD_DID,
      organizationId: 'animal-1',
      role: 'RESPRSN',
      grantClaims: { 'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN' },
      authorizationEvidenceId: 'grant-1',
      subjectClaims: {
        'org.schema.Organization.sameAs': `${CARD_DID}, urn:cid:identity-evidence`,
        'org.schema.Organization.additionalType': 'animal',
        'org.schema.Organization.member.additionalType': 'http://purl.obolibrary.org/obo/NCBITaxon_9615',
      },
    }])
    assert.equal(requests.length, 6)
    assert.deepEqual(requests.map(({ url }) => url), [
      '/connecthealth-ca/cds-CA-BC/v1/animal-care/individual/org.schema/Organization/_search',
      '/connecthealth-ca/cds-CA-BC/v1/animal-care/individual/org.schema/Organization/_search-response',
      '/connecthealth-ca/cds-CA-BC/v1/animal-care/individual/org.schema/License/_search',
      '/connecthealth-ca/cds-CA-BC/v1/animal-care/individual/org.schema/License/_search-response',
      '/connecthealth-ca/cds-CA-BC/v1/animal-care/individual/org.schema/Organization/_search',
      '/connecthealth-ca/cds-CA-BC/v1/animal-care/individual/org.schema/Organization/_search-response',
    ])
    assert.ok(requests.every(({ authorization }) => authorization === 'Bearer verified-openid-token'))
    assert.ok(requests.every(({ appId }) => appId === 'ca.example.sos'))
    assert.ok(requests.every(({ contentType }) => contentType === 'application/didcomm-plain+json'))
    assert.equal(
      requests[0].body.body.data[0].resource.meta.claims['org.schema.Organization.owner.email'],
      'controller@example.ca',
    )
    assert.equal(requests[0].body.body.data[0].meta?.claims, undefined)
    assert.equal(requests[4].body.body.data[0].resource.meta.claims['org.schema.Organization.sameAs'], CARD_DID)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('rejects a checksum-invalid historical split animal DID returned by the gateway', async () => {
  const deprecatedDid = 'did:web:example.invalid:card:vetchain:72409:0961510852611262'
  const responses = [
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { resourceType: 'Bundle', entry: [] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { data: [{ meta: { authorizedSubjectDid: deprecatedDid, claims: {} } }] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { meta: { claims: {
      'org.schema.Organization.sameAs': deprecatedDid,
      'org.schema.Organization.additionalType': 'animal',
      'org.schema.Organization.member.additionalType': 'http://purl.obolibrary.org/obo/NCBITaxon_9615',
    } } } }] } }),
  ]
  const client = new SosGatewaySubjectDirectoryClient({
    baseUrl: 'https://gw.example.invalid',
    fetchImpl: async () => responses.shift(),
  })

  await assert.rejects(
    client.listAuthorizedIndividualSubjects(ROUTE_CONTEXT, {
      verifiedContact: { email: 'controller@example.ca' },
      pollOptions: { intervalMs: 1, timeoutMs: 100 },
    }),
    /animal_card_did_invalid/,
  )
})

test('returns a canonical animal DID while retaining a validated historical provider lookup alias', async () => {
  const historicalDid = 'did:web:example.invalid:card:vetchain:72409:0961510852611267'
  const responses = [
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { resourceType: 'Bundle', entry: [] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { data: [{ meta: {
      authorizedSubjectDid: historicalDid,
      identifier: 'historical-grant-1',
      claims: { 'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN' },
    } }] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { id: 'historical-animal-1', meta: { claims: {
      'org.schema.Organization.sameAs': historicalDid,
      'org.schema.Organization.additionalType': 'animal',
      'org.schema.Organization.alternateName': 'Historical animal',
      'org.schema.Organization.member.additionalType': 'http://purl.obolibrary.org/obo/NCBITaxon_9615',
    } } } }] } }),
  ]
  const client = new SosGatewaySubjectDirectoryClient({
    baseUrl: 'https://gw.example.invalid',
    fetchImpl: async () => responses.shift(),
  })

  const subjects = await client.listAuthorizedIndividualSubjects(ROUTE_CONTEXT, {
    verifiedContact: { email: 'controller@example.ca' },
    pollOptions: { intervalMs: 1, timeoutMs: 100 },
  })

  assert.deepEqual(subjects, [{
    subjectDid: CARD_DID,
    sourceSubjectDid: historicalDid,
    organizationId: 'historical-animal-1',
    role: 'RESPRSN',
    grantClaims: { 'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN' },
    authorizationEvidenceId: 'historical-grant-1',
    subjectClaims: {
      'org.schema.Organization.sameAs': historicalDid,
      'org.schema.Organization.additionalType': 'animal',
      'org.schema.Organization.alternateName': 'Historical animal',
      'org.schema.Organization.member.additionalType': 'http://purl.obolibrary.org/obo/NCBITaxon_9615',
    },
  }])
})

test('recovers an owner-indexed historical animal card without requiring a License row', async () => {
  const historicalDid = 'did:web:example.invalid:card:vetchain:72409:0961510852611267'
  const responses = [
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { resourceType: 'Bundle', entry: [{ resource: {
      id: 'historical-owned-animal',
      meta: { claims: {
        'org.schema.Organization.sameAs': historicalDid,
        'org.schema.Organization.additionalType': 'animal',
        'org.schema.Organization.alternateName': 'Historical owned animal',
        'org.schema.Organization.owner.email': 'controller@example.ca',
        'org.schema.Organization.owner.identifier.value': 'related-person-1',
        'org.schema.Organization.member.additionalType': 'http://purl.obolibrary.org/obo/NCBITaxon_9615',
      } },
    } }] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { data: [] } }] } }),
  ]
  const client = new SosGatewaySubjectDirectoryClient({
    baseUrl: 'https://gw.example.invalid',
    fetchImpl: async () => responses.shift(),
  })

  const subjects = await client.listAuthorizedIndividualSubjects(ROUTE_CONTEXT, {
    verifiedContact: { email: 'controller@example.ca' },
    pollOptions: { intervalMs: 1, timeoutMs: 100 },
  })

  assert.equal(subjects.length, 1)
  assert.equal(subjects[0].subjectDid, CARD_DID)
  assert.equal(subjects[0].sourceSubjectDid, historicalDid)
  assert.equal(subjects[0].organizationId, 'historical-owned-animal')
  assert.equal(subjects[0].role, 'RESPRSN')
  assert.equal(subjects[0].relatedPersonId, 'related-person-1')
})

test('keeps an owned human card when the same identity also has a non-card profile license', async () => {
  const humanCardDid = 'did:web:unid.online:card:uhc:personal:724000000123456789017'
  const responses = [
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { resourceType: 'Bundle', entry: [{ resource: {
      id: 'human-1',
      meta: { claims: {
        'org.schema.Organization.sameAs': humanCardDid,
        'org.schema.Organization.alternateName': 'Human one',
        'org.schema.Organization.member.role': 'ONESELF',
        'org.schema.Organization.owner.telephone': '+34600000000',
      } },
    } }] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { data: [{ meta: {
      authorizedSubjectDid: 'did:web:gateway.example:individual:profile-1',
      claims: { 'org.schema.Person.telephone': '+34600000000' },
    } }] } }] } }),
  ]
  const client = new SosGatewaySubjectDirectoryClient({
    baseUrl: 'https://gw.example.invalid',
    fetchImpl: async () => responses.shift(),
  })

  const subjects = await client.listAuthorizedIndividualSubjects({
    tenantId: 'foundation-human', jurisdiction: 'ES', sector: 'onehealth-research',
  }, {
    verifiedContact: { telephone: '+34600000000' },
    pollOptions: { intervalMs: 1, timeoutMs: 100 },
  })

  assert.equal(subjects.length, 1)
  assert.equal(subjects[0].subjectDid, humanCardDid)
})

test('accepts the canonical animal DID from an animal-research tenant', async () => {
  const responses = [
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { resourceType: 'Bundle', entry: [] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { data: [{ meta: {
      authorizedSubjectDid: CARD_DID,
      claims: { 'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN' },
    } }] } }] } }),
    new Response(null, { status: 202 }),
    Response.json({ body: { data: [{ resource: { id: 'animal-1', meta: { claims: {
      'org.schema.Organization.sameAs': CARD_DID,
      'org.schema.Organization.additionalType': 'animal',
      'org.schema.Organization.member.additionalType': 'http://purl.obolibrary.org/obo/NCBITaxon_9615',
    } } } }] } }),
  ]
  const client = new SosGatewaySubjectDirectoryClient({
    baseUrl: 'https://gw.example.invalid',
    fetchImpl: async () => responses.shift(),
  })

  const subjects = await client.listAuthorizedIndividualSubjects({
    tenantId: 'foundation-animal', jurisdiction: 'ES', sector: 'animal-research',
  }, {
    verifiedContact: { email: 'controller@example.org' },
    pollOptions: { intervalMs: 1, timeoutMs: 100 },
  })

  assert.equal(subjects[0].subjectDid, CARD_DID)
})
