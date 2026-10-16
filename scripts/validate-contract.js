'use strict'

// Validates mdk-contract.json with the validator that ships in the pinned MDK
// (mdk-skill validate-contract.mjs) against the runtime's own schema. The
// validator expects the schema next to it, which only an MDK build generates,
// so this script stages both in a temporary directory.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const MDK = path.dirname(require.resolve('@tetherto/mdk/package.json'))
const VALIDATOR = path.join(MDK, 'packages/mdk-skill/src/skills/mdk-worker-plugin/scripts/validate-contract.mjs')
const SCHEMA = path.join(MDK, 'backend/core/mdk-worker/mdk-contract.schema.json')

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mdk-validate-'))
try {
  fs.mkdirSync(path.join(stage, 'scripts'))
  fs.mkdirSync(path.join(stage, 'references'))
  fs.copyFileSync(VALIDATOR, path.join(stage, 'scripts/validate-contract.mjs'))
  fs.copyFileSync(SCHEMA, path.join(stage, 'references/mdk-contract.schema.json'))
  const result = spawnSync(process.execPath, [path.join(stage, 'scripts/validate-contract.mjs'), 'mdk-contract.json'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit'
  })
  process.exitCode = result.status ?? 1
} finally {
  fs.rmSync(stage, { recursive: true, force: true })
}
