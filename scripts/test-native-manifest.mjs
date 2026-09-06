import { spawnSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const connectorRoot = resolve('browser-connector')
const extensionSource = join(connectorRoot, 'extension')
const extensionManifest = JSON.parse(readFileSync(join(extensionSource, 'manifest.json'), 'utf8'))
const identity = JSON.parse(readFileSync(join(connectorRoot, 'connector-identity.json'), 'utf8'))
const installScript = join(connectorRoot, 'install.ps1')
const hostExe = join(connectorRoot, 'native-host', 'bin', 'SignalDesk.NativeHost.exe')
const testRoot = mkdtempSync(join(tmpdir(), 'signal-desk-native-manifest-'))
const deploymentRoot = join(testRoot, 'BrowserConnector')
const manifestRoot = join(testRoot, 'NativeMessagingHosts')

function deriveExtensionId(key) {
  const publicKey = createPublicKey({
    key: Buffer.from(key, 'base64'),
    format: 'der',
    type: 'spki'
  })
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return [...createHash('sha256').update(der).digest().subarray(0, 16)]
    .map((byte) => 'abcdefghijklmnop'[byte >> 4] + 'abcdefghijklmnop'[byte & 15])
    .join('')
}

function listRelativeFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(current, entry.name)
    if (entry.isDirectory()) return listRelativeFiles(root, fullPath)
    return [fullPath.slice(root.length + 1)]
  }).sort()
}

try {
  if (!existsSync(hostExe)) throw new Error(`Native Host was not built: ${hostExe}`)
  const derivedExtensionId = deriveExtensionId(extensionManifest.key)
  if (derivedExtensionId !== identity.extensionId) {
    throw new Error(`Fixed extension key derives ${derivedExtensionId}, expected ${identity.extensionId}`)
  }
  if (extensionManifest.version !== identity.connectorVersion) {
    throw new Error('Extension manifest version and connector identity version differ')
  }
  if (identity.stableDirectory !== '%LOCALAPPDATA%\\Signal Desk\\BrowserConnector') {
    throw new Error(`Unexpected stable connector directory: ${identity.stableDirectory}`)
  }

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', installScript,
    '-ExtensionId', identity.extensionId,
    '-Browser', 'Chrome',
    '-HostExe', hostExe,
    '-DeploymentDirectory', deploymentRoot,
    '-ManifestDirectory', manifestRoot,
    '-ManifestOnly'
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`Stable connector deployment failed (${result.status}).\n${result.stdout}\n${result.stderr}`)
  }

  const deployedExtension = join(deploymentRoot, 'extension')
  const deployedHost = join(
    deploymentRoot,
    'native-host',
    identity.connectorVersion,
    'SignalDesk.NativeHost.exe'
  )
  const nativeManifestPath = join(manifestRoot, 'com.signaldesk.bridge.json')
  const nativeManifest = JSON.parse(readFileSync(nativeManifestPath, 'utf8'))
  const deploymentState = JSON.parse(readFileSync(join(deploymentRoot, 'deployment-state.json'), 'utf8'))
  const expectedOrigin = `chrome-extension://${identity.extensionId}/`
  if (nativeManifest.name !== 'com.signaldesk.bridge'
    || nativeManifest.path !== deployedHost
    || JSON.stringify(nativeManifest.allowed_origins) !== JSON.stringify([expectedOrigin])) {
    throw new Error(`Generated Native Messaging manifest is unsafe or incorrect: ${JSON.stringify(nativeManifest)}`)
  }
  if (!existsSync(deployedHost)
    || deploymentState.contract !== 'signal-desk-browser-connector-deployment/v1'
    || deploymentState.connectorVersion !== identity.connectorVersion
    || deploymentState.extensionId !== identity.extensionId
    || deploymentState.extensionPath !== deployedExtension
    || deploymentState.nativeHostPath !== deployedHost) {
    throw new Error(`Stable connector deployment state is incomplete: ${JSON.stringify(deploymentState)}`)
  }

  const sourceFiles = listRelativeFiles(extensionSource)
  const deployedFiles = listRelativeFiles(deployedExtension)
  if (JSON.stringify(sourceFiles) !== JSON.stringify(deployedFiles)) {
    throw new Error(`Stable extension copy differs from source: ${JSON.stringify({ sourceFiles, deployedFiles })}`)
  }
  for (const relativePath of sourceFiles) {
    const sourceHash = createHash('sha256').update(readFileSync(join(extensionSource, relativePath))).digest('hex')
    const deployedHash = createHash('sha256').update(readFileSync(join(deployedExtension, relativePath))).digest('hex')
    if (sourceHash !== deployedHash) throw new Error(`Stable extension file differs: ${relativePath}`)
  }

  const mismatch = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', installScript,
    '-ExtensionId', 'knpefdpoedgfgndggjdkjgnfgomnllng',
    '-HostExe', hostExe,
    '-DeploymentDirectory', join(testRoot, 'mismatch-deployment'),
    '-ManifestDirectory', join(testRoot, 'mismatch-manifest'),
    '-ManifestOnly'
  ], { encoding: 'utf8', windowsHide: true })
  if (mismatch.status === 0 || !`${mismatch.stdout}\n${mismatch.stderr}`.includes('does not match the fixed Signal Desk extension ID')) {
    throw new Error('install.ps1 accepted an extension ID that does not match the fixed identity key')
  }

  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const connectorResources = packageJson.build?.extraResources?.find((entry) => entry.from === 'browser-connector')
  if (!connectorResources?.filter?.includes('!native-host/bin/com.signaldesk.bridge.json')) {
    throw new Error('electron-builder does not exclude the user-specific Native Messaging manifest')
  }
  if (packageJson.build?.nsis?.include !== 'build/installer.nsh') {
    throw new Error('NSIS does not include the stable browser connector deployment hook')
  }
  const installerInclude = readFileSync(resolve('build', 'installer.nsh'), 'utf8')
  if (!installerInclude.includes('browser-connector\\install.ps1')
    || !installerInclude.includes('-Browser Chrome')) {
    throw new Error('NSIS stable connector deployment hook is incomplete')
  }

  console.log(`Stable connector deployment, fixed extension ID ${identity.extensionId}, Native Messaging manifest and package hook OK`)
} finally {
  rmSync(testRoot, { recursive: true, force: true })
}
