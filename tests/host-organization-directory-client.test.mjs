// Flow contract: a trusted host-controller BFF submits and polls the canonical host org.schema Organization/_search route, receives one DIDComm-wrapped paginated Bundle, preserves the opaque cursor, and rejects OperationOutcome failures without exposing browser-selected host authority.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { SosGatewayHostOrganizationDirectoryClient } from '../dist/host-organization-directory-client.js'

test('searches the protected host directory and reads one paginated DIDComm Bundle', async () => {
  const requests = []
  const responses = [
    { status: 202, body: {} },
    { status: 200, body: { body: {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 2,
      meta: { pagination: { pageSize: 1, returned: 1, hasNext: true, nextCursor: 'opaque-next' } },
      data: [{
        id: 'tenant-1',
        type: 'Organization-search-response-v1.0',
        resource: { resourceType: 'Organization', id: 'tenant-1', meta: { claims: {
          'org.schema.Organization.legalName': 'Clinic One',
          'org.schema.Organization.identifier.additionalType': 'TAX',
          'org.schema.Organization.identifier.value': 'B12345678',
          'org.schema.Organization.address.addressCountry': 'ES',
          'org.schema.Service.category': 'health-care',
          'org.schema.Action.tenantAuthorization.status': 'active',
        } } },
        response: { status: '200' },
      }],
    } } },
  ]
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({
      url: request.url,
      contentType: request.headers['content-type'],
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    })
    const next = responses.shift()
    response.writeHead(next.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(next.body))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  try {
    const client = new SosGatewayHostOrganizationDirectoryClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      bearerToken: 'verified-host-token',
      appId: 'https://controller.example.org',
      appVersion: '1.0.0',
    })
    const page = await client.search({ jurisdiction: 'ES', network: 'test-network' }, {
      pageSize: 1,
      filters: { sector: 'health-care', status: 'active' },
      pollOptions: { intervalMs: 1, timeoutMs: 100 },
    })

    assert.equal(page.total, 2)
    assert.equal(page.organizations[0].legalName, 'Clinic One')
    assert.equal(page.organizations[0].identifierValue, 'B12345678')
    assert.equal(page.nextCursor, 'opaque-next')
    assert.deepEqual(requests.map(request => request.url), [
      '/host/cds-ES/v1/test-network/registry/org.schema/Organization/_search',
      '/host/cds-ES/v1/test-network/registry/org.schema/Organization/_search-response',
    ])
    assert.ok(requests.every(request => request.contentType === 'application/didcomm-plain+json'))
    assert.ok(requests.every(request => request.authorization === 'Bearer verified-host-token'))
    assert.equal(requests[0].body.body.meta.pagination.pageSize, 1)
    assert.equal(requests[0].body.body.data[0].resource.meta.claims['org.schema.Service.category'], 'health-care')
    assert.equal(requests[0].body.body.data[0].resource.meta.claims['org.schema.Action.tenantAuthorization.status'], 'active')
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('surfaces a Bundle OperationOutcome and rejects browser-shaped host selection', async () => {
  const operationOutcome = { body: { resourceType: 'Bundle', type: 'batch-response', data: [{
    type: 'Organization-search-v1.0',
    response: { status: '403', outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'Host operator required.' }] } },
  }] } }
  const client = new SosGatewayHostOrganizationDirectoryClient({
    baseUrl: 'https://gw.example.invalid',
    fetchImpl: async (_url, init) => String(init?.body).includes('"thid"') && !String(_url).endsWith('-response')
      ? new Response(null, { status: 202 })
      : Response.json(operationOutcome),
  })

  await assert.rejects(client.search({ jurisdiction: 'ES', network: 'test' }, {
    pollOptions: { intervalMs: 1, timeoutMs: 100 },
  }), /Host operator required/)
  await assert.rejects(client.search({ jurisdiction: 'ES', network: 'test', tenantId: 'attacker' }, {}), /route_context_invalid/)
})
