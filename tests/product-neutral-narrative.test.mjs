// Flow contract: the public SOS Node SDK narrative documents only its owned adapters and contains no downstream product ownership claims.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const downstreamProductLanguage = /VetChain|GW VET|\bUHC\b|SOS\/Vet\/UHC|\bVet\b/iu

test('keeps maintained SDK narratives independent of downstream products', () => {
  const files = execFileSync('git', ['ls-files', 'README.md', 'docs/*.md'], {
    encoding: 'utf8',
  }).trim().split('\n').filter((file) => file && existsSync(file))

  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), downstreamProductLanguage, file)
  }
})
