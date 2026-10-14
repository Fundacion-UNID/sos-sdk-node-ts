// Flow contract: the public SOS Node SDK identifies the 2026 Canadian development owner without adding a distributor notice or changing the Apache-2.0 license.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('publishes the SDK ownership notice without a distributor statement', () => {
  const notice = readFileSync('NOTICE', 'utf8')
  const readme = readFileSync('README.md', 'utf8')
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

  assert.match(notice, /Copyright 2026 Connecting Solution & Applications Ltd\./)
  assert.doesNotMatch(notice, /Distributed by/i)
  assert.match(readme, /Connecting Solution & Applications Ltd\./)
  assert.doesNotMatch(readme, /Distributed by/i)
  assert.ok(packageJson.files.includes('NOTICE'))
})
