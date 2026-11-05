// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  SosSubjectCardProviderCatalogClient,
  readFederatedProviderSubjects,
} from '../dist/subject-card-provider-catalog-client.js'
import { REPOSITORY_SAFE_EXAMPLES } from 'sos-data-utils-ts/repository-privacy'

const provider = (suffix, subjectKinds = ['animal']) => ({
  indexProviderDid: `${REPOSITORY_SAFE_EXAMPLES.didWeb}:${suffix}`,
  displayName: `${REPOSITORY_SAFE_EXAMPLES.organizationLegalName} ${suffix}`,
  directoryRoute: `${REPOSITORY_SAFE_EXAMPLES.httpsBaseUrl}/${REPOSITORY_SAFE_EXAMPLES.tenantId}-${suffix}/cds-CA/v1/${REPOSITORY_SAFE_EXAMPLES.sector}`,
  subjectKinds,
  areaServed: ['CA'],
  operations: ['directory', 'create'],
  providerCode9: REPOSITORY_SAFE_EXAMPLES.organizationBusinessNumber,
  cardDidHost: REPOSITORY_SAFE_EXAMPLES.domain,
})

test('discovers compatible providers from a data-space JSON API catalog', async () => {
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    response.writeHead(200, { 'content-type': 'application/vnd.api+json' })
    response.end(JSON.stringify({ data: [
      { type: 'subject-card-provider', id: 'one', attributes: provider('one') },
      { type: 'subject-card-provider', id: 'human', attributes: provider('human', ['human']) },
    ] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  try {
    const client = new SosSubjectCardProviderCatalogClient({
      catalogUrl: `http://127.0.0.1:${address.port}/providers`,
    })
    const result = await client.discover({ subjectKind: 'animal', operation: 'create', serviceCountry: 'CA' })
    assert.deepEqual(result.map(item => item.providerId), [`${REPOSITORY_SAFE_EXAMPLES.didWeb}:one`])
    assert.match(requests[0], /subjectKind=animal/)
    assert.match(requests[0], /operation=create/)
    assert.match(requests[0], /serviceCountry=CA/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('queries every compatible directory and preserves partial provider failure', async () => {
  const providers = [provider('one'), provider('two')]
  const result = await readFederatedProviderSubjects({
    providers,
    verifiedContact: { email: REPOSITORY_SAFE_EXAMPLES.individualEmail },
    readProvider: async current => {
      if (current.providerId.endsWith(':two')) throw new Error('provider_unavailable')
      return [{ subjectDid: 'urn:uuid:00000000-0000-4000-8000-000000000201' }]
    },
  })

  assert.equal(result.subjects.length, 1)
  assert.equal(result.subjects[0].providerId, providers[0].indexProviderDid)
  assert.deepEqual(result.unavailableProviderIds, [providers[1].indexProviderDid])
})
