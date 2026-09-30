import assert from 'node:assert/strict'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { backup, DatabaseSync } from 'node:sqlite'

const source = resolve(process.argv[2] || '')
const destination = resolve(process.argv[3] || '')
const runId = basename(source)
assert.match(runId, /^r8-homepage-client-\d{14}-[a-f0-9]{8}$/)
assert.ok(source !== destination)
await mkdir(destination, { recursive: true })
const sourceDb = new DatabaseSync(join(source, 'isolated-sync.sqlite'), { readOnly: true })
try { await backup(sourceDb, join(destination, 'isolated-sync.sqlite')) }
finally { sourceDb.close() }
for (const name of ['pilot-report.json', 'manifest.json']) {
  await copyFile(join(source, name), join(destination, name))
}
const hashes = {}
for (const name of ['pilot-report.json', 'manifest.json', 'isolated-sync.sqlite']) {
  hashes[name] = createHash('sha256').update(await readFile(join(destination, name))).digest('hex')
}
await writeFile(join(destination, 'checksums.json'), JSON.stringify({ runId, hashes }, null, 2) + '\n')
console.log(JSON.stringify({ runId, destination, hashes }, null, 2))
