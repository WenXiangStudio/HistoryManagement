import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const FOLLOWING_VERSION = '0.8.4'
const execute = promisify(execFile)

// Deployment happens at APP startup, outside the user's collection critical path.
export async function deployFollowingConnection(sourceRoot: string, userData: string): Promise<string> {
  const extensionDirectory = join(userData, 'following-extension')
  const source = join(sourceRoot, 'following-extension')
  await mkdir(extensionDirectory, { recursive: true })
  for (const name of await readdir(source)) {
    const bytes = await readFile(join(source, name))
    let prior: Buffer | undefined
    try { prior = await readFile(join(extensionDirectory, name)) } catch { /* first installation */ }
    if (!prior?.equals(bytes)) await writeFile(join(extensionDirectory, name), bytes)
  }
  if (process.platform === 'win32') {
    const hostDirectory = join(userData, 'following-native', FOLLOWING_VERSION)
    await mkdir(hostDirectory, { recursive: true })
    const hostPath = join(hostDirectory, 'SignalDesk.FollowingHost.exe')
    const hostBytes=await readFile(join(sourceRoot, 'native-host', 'bin', 'SignalDesk.FollowingHost.exe'))
    let installedHost:Buffer|undefined
    try{installedHost=await readFile(hostPath)}catch{ /* first installation */ }
    if(!installedHost?.equals(hostBytes))await cp(join(sourceRoot, 'native-host', 'bin', 'SignalDesk.FollowingHost.exe'), hostPath)
    await writeFile(join(hostDirectory, 'discovery-path.json'), JSON.stringify({ path: join(userData, 'following-bridge.json') }))
    // Chrome hashes the canonical Windows unpacked extension path as UTF-16LE.
    const canonical = resolve(extensionDirectory).replace(/^[a-z]:/, value => value.toUpperCase())
    const extensionId = createHash('sha256').update(canonical, 'utf16le').digest('hex').slice(0, 32)
      .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)))
    const manifestPath = join(hostDirectory, 'com.signaldesk.following.json')
    await writeFile(manifestPath, JSON.stringify({ name: 'com.signaldesk.following',
      description: 'Signal Desk following APP discovery', path: hostPath, type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2))
    await execute('reg.exe', ['add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.signaldesk.following',
      '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { windowsHide: true })
  }
  return extensionDirectory
}
