import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('U09 delivery gate is lockfile-backed, pinned, and has no real-broker validation path', () => {
  assert.equal(fs.existsSync(path.join(root, 'package-lock.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'my-remix-app', 'package-lock.json')), true)

  const workflowPath = path.join(root, '.github', 'workflows', 'portfolio-quality.yml')
  const workflow = fs.readFileSync(workflowPath, 'utf8')
  const actionUses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((match) => match[1] ?? '')
  assert.ok(actionUses.length >= 2)
  assert.ok(actionUses.every((value) => /@[a-f0-9]{40}$/u.test(value)), actionUses.join(','))
  assert.match(workflow, /npm\.cmd ci/u)
  assert.match(workflow, /verify:portfolio:u09/u)
  assert.match(workflow, /npm\.cmd audit/u)
  assert.match(workflow, /sbom/u)

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const verification = packageJson.scripts['verify:portfolio:u09'] ?? ''
  assert.doesNotMatch(verification, /ticker_proxy|dev:proxy|proxy|start|kite|sharekhan|zerodha/iu)
  assert.match(verification, /test:portfolio:u09/u)
  assert.match(verification, /bench:portfolio:u09/u)

  const u09Files = [
    path.join(root, 'tests', 'portfolio', 'u09', 'integrated-acceptance.test.ts'),
    path.join(root, 'tests', 'portfolio', 'u09', 'restore-drill.test.ts'),
    path.join(root, 'benchmark', 'portfolio-integrated.ts'),
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(u09Files, /kiteconnect|sharekhan-api|placeOrder|submitLive|LIVE_BROKER/iu)
})
