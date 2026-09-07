import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const projectRoot = process.cwd()
const forbiddenFileName = 'WSL2 同 SHA 完整回归报告.md'
const forbiddenContentMarkers = [
  ['/home/winson', 'WSL_ProjectHistoryManagement'].join('/'),
  ['feat/api-temporal', 'case-bridge'].join('-')
]
const excludedDirectories = new Set([
  '.git',
  '.npm-cache',
  'cache',
  'coverage',
  'downloads',
  'models',
  'node_modules',
  'out',
  'release'
])
const textExtensions = new Set([
  '', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.py', '.ts', '.tsx', '.txt', '.yaml', '.yml'
])
const violations = []

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const projectPath = relative(projectRoot, path).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name) || entry.name.startsWith('release-')) continue
      walk(path)
      continue
    }
    if (entry.name === forbiddenFileName) violations.push(projectPath + ': forbidden foreign report filename')
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    if (!statSync(path).isFile()) continue
    if (!textExtensions.has(extname(entry.name).toLowerCase())) continue
    if (statSync(path).size > 2_000_000) continue
    const content = readFileSync(path, 'utf8')
    for (const marker of forbiddenContentMarkers) {
      if (content.includes(marker)) violations.push(projectPath + ': contains a forbidden foreign-repository marker')
    }
  }
}

if (!existsSync(join(projectRoot, 'package.json'))) {
  throw new Error('Project-boundary check must run from the Signal Desk repository root')
}

walk(projectRoot)

if (violations.length) {
  console.error('Signal Desk project-boundary check failed:')
  for (const violation of violations) console.error('- ' + violation)
  process.exitCode = 1
} else {
  console.log('Signal Desk project-boundary check passed')
}
