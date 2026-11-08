/**
 * SSH Manager — Host half.
 *
 * Owns one durable list of SSH server profiles in
 * `$DSH_HOME/ssh-manager/servers.json` (mode 0600). Passwords and private-key
 * passphrases never enter that file: they are stored as credential records
 * under the `ssh-manager/<id>-<kind>` keys, through `ctx.credentials`.
 *
 * The same operations back two callers:
 * - the seven `ssh_*` agent tools, which receive non-secret fields only, and
 * - the authenticated `/api/ssh-manager` route used by the Settings page,
 *   which is the only path that accepts a password or passphrase, so secrets
 *   the user types never enter the session log.
 *
 * Every remote operation is a fresh OpenSSH invocation (`/usr/bin/ssh`,
 * `/usr/bin/scp`) with the saved profile's target and authentication options.
 * Password and passphrase prompts are answered by a per-call `SSH_ASKPASS`
 * helper fed from the environment, so no secret touches the disk.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** Loader row identity of this plugin. */
export const name = 'ssh-manager'

/** Services this plugin cannot work without. */
export const inject = ['tools', 'systemPrompt', 'credentials']

/** Version of the on-disk profile document. */
const STORE_VERSION = 1
/** Authenticated Fetch route the Settings page talks to. */
const ROUTE_PATH = '/api/ssh-manager'
/** Credential-record scope; every key is `ssh-manager/<id>-<kind>`. */
const CREDENTIAL_SCOPE = 'ssh-manager'
/** Supported authentication modes. */
const AUTH_TYPES = ['password', 'key', 'agent']
/** Default TCP port. */
const DEFAULT_PORT = 22
/** Default execution timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 120_000
/** Upper bound for one execution timeout, in milliseconds. */
const MAX_TIMEOUT_MS = 3_600_000
/** Timeout applied to connectivity checks. */
const TEST_TIMEOUT_MS = 45_000
/** Timeout applied to one file transfer. */
const TRANSFER_TIMEOUT_MS = 600_000
/** Bytes retained per captured stream before it is truncated. */
const MAX_CAPTURE_BYTES = 120 * 1024
/** Longest accepted command, in characters. */
const MAX_COMMAND_LENGTH = 100_000
/** Hostname grammar; deliberately narrow so argv flags can never be injected. */
const HOST_PATTERN = /^[A-Za-z0-9._:%-]+$/
/** Remote login-name grammar. */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/
/** ProxyJump grammar: `[user@]host[:port]`, hosts may be bracketed IPv6. */
const PROXY_JUMP_PATTERN = /^[A-Za-z0-9._@:[\]-]+$/
/** Path grammar of generated profile ids and their credential key segment. */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Credential service, bound in `apply`. */
let credentialsService

/** Resolve the harness home the same way other Harness services do. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.length > 0) return configured
  return join(homedir(), '.dsh')
}

/** Absolute path of the durable profile document. */
function storeFile() {
  return join(dshHome(), 'ssh-manager', 'servers.json')
}

/** Human-readable message of an arbitrary thrown value. */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

/** An empty in-memory profile document. */
function emptyStore() {
  return { version: STORE_VERSION, servers: [] }
}

/** Normalize one stored profile row; malformed rows are dropped. */
function normalizeStoredServer(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (!ID_PATTERN.test(id)) return undefined
  if (typeof entry.name !== 'string' || typeof entry.host !== 'string' || typeof entry.username !== 'string') return undefined
  const port = Number(entry.port)
  return {
    id,
    name: entry.name.slice(0, 80),
    host: entry.host,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT,
    username: entry.username,
    auth: AUTH_TYPES.includes(entry.auth) ? entry.auth : 'agent',
    ...(typeof entry.keyPath === 'string' && entry.keyPath.length > 0 ? { keyPath: entry.keyPath } : {}),
    ...(typeof entry.proxyJump === 'string' && entry.proxyJump.length > 0 ? { proxyJump: entry.proxyJump } : {}),
    ...(typeof entry.description === 'string' && entry.description.length > 0 ? { description: entry.description } : {}),
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
  }
}

/**
 * Read the profile document.
 *
 * A missing document is an empty store; an unreadable or malformed one throws,
 * so the UI can report the real problem instead of silently looking empty.
 */
function readStore() {
  const file = storeFile()
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return emptyStore()
    throw new Error(`无法读取 SSH 配置文件 ${file}：${errorMessage(error)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`SSH 配置文件不是合法 JSON：${file}`)
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.version !== STORE_VERSION || !Array.isArray(parsed.servers)) {
    throw new Error(`SSH 配置文件格式不受支持：${file}`)
  }
  const servers = []
  for (const entry of parsed.servers) {
    const server = normalizeStoredServer(entry)
    if (server !== undefined) servers.push(server)
  }
  return { version: STORE_VERSION, servers }
}

/** Atomically replace the profile document, owner-readable only. */
function writeStore(store) {
  const file = storeFile()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(temporary, 0o600)
  } catch {
    /* Windows expresses protection through ACLs; the create mode already applied. */
  }
  renameSync(temporary, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    /* see above */
  }
}

/** Bind and return the credential service, failing loud when unavailable. */
function credentials() {
  if (credentialsService === undefined) throw new Error('凭据服务尚未就绪，无法读写 SSH 密码')
  return credentialsService
}

/** Build the credential key of one secret kind for one profile id. */
function credentialKey(id, kind) {
  return `${CREDENTIAL_SCOPE}/${id}-${kind}`
}

/** Read one stored secret, or undefined when unset. */
async function readSecret(id, kind) {
  const record = await credentials().readRecord(credentialKey(id, kind))
  if (record === undefined || record.kind !== 'api-key') return undefined
  return typeof record.key === 'string' && record.key.length > 0 ? record.key : undefined
}

/** Whether a secret record is configured, without reading its value. */
async function hasSecret(id, kind) {
  try {
    const info = await credentials().describeRecord(credentialKey(id, kind))
    return info.configured === true
  } catch {
    return false
  }
}

/** Create or replace one secret record. */
async function writeSecret(id, kind, value) {
  await credentials().modifyRecord(credentialKey(id, kind), async () => ({ kind: 'api-key', key: value }))
}

/** Remove one secret record; removing an absent record is a no-op. */
async function deleteSecret(id, kind) {
  await credentials().deleteRecord(credentialKey(id, kind))
}

/** Trimmed string with a length bound. */
function requireText(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  const text = value.trim()
  if (text.length === 0) throw new Error(`${label}不能为空`)
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return text
}

/** Optional trimmed string with a length bound; empty input becomes undefined. */
function optionalText(value, label, maxLength) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  const text = value.trim()
  if (text.length === 0) return undefined
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return text
}

/** Validate a hostname / address. */
function validateHost(value) {
  const host = requireText(value, '主机地址', 255)
  if (host.startsWith('-') || !HOST_PATTERN.test(host)) {
    throw new Error('主机地址只能包含字母、数字、点、下划线、连字符、冒号和 %')
  }
  return host
}

/** Validate a remote login name. */
function validateUsername(value) {
  const username = requireText(value, '用户名', 64)
  if (!USERNAME_PATTERN.test(username)) throw new Error('用户名只能包含字母、数字、点、下划线和连字符')
  return username
}

/** Validate a TCP port. */
function validatePort(value) {
  const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 之间的整数')
  return port
}

/** Validate an authentication mode. */
function validateAuth(value) {
  if (!AUTH_TYPES.includes(value)) throw new Error('认证方式只能是 password、key 或 agent')
  return value
}

/** Expand a leading `~` and require an absolute, existing key file. */
function validateKeyPath(value) {
  const text = optionalText(value, '私钥路径', 1024)
  if (text === undefined) return undefined
  const expanded = expandHomePath(text)
  if (!isAbsolute(expanded)) throw new Error('私钥路径必须是绝对路径（可以使用 ~/ 开头）')
  if (!existsSync(expanded)) throw new Error(`私钥文件不存在：${expanded}`)
  if (!statSync(expanded).isFile()) throw new Error(`私钥路径不是文件：${expanded}`)
  return expanded
}

/** Expand a leading `~` for local paths. */
function expandHomePath(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return value
}

/** Validate a ProxyJump hop. */
function validateProxyJump(value) {
  const text = optionalText(value, '代理跳板', 255)
  if (text === undefined) return undefined
  if (text.startsWith('-') || !PROXY_JUMP_PATTERN.test(text)) throw new Error('代理跳板格式应为 [user@]host[:port]')
  return text
}

/** Validate a description. */
function validateDescription(value) {
  const text = optionalText(value, '描述', 500)
  return text
}

/** Validate one secret value; the empty string means "clear". */
function validateSecret(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (value.length === 0) return undefined
  if (value.length > 4096) throw new Error(`${label}不能超过 4096 个字符`)
  if (/[\r\n\0]/.test(value)) throw new Error(`${label}不能包含换行或空字符`)
  return value
}

/** Next unused profile id. */
function newServerId(store) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `srv-${randomBytes(4).toString('hex')}`
    if (!store.servers.some((server) => server.id === id)) return id
  }
  throw new Error('无法生成服务器 id，请重试')
}

/** Resolve a selector (id, exact name, case-insensitive name, or user@host). */
function resolveServer(store, selector) {
  if (typeof selector !== 'string' || selector.trim().length === 0) throw new Error('需要指定服务器 id 或名称')
  const needle = selector.trim()
  const found = store.servers.find((server) => server.id === needle)
    ?? store.servers.find((server) => server.name === needle)
    ?? store.servers.find((server) => server.name.toLowerCase() === needle.toLowerCase())
    ?? store.servers.find((server) => `${server.username}@${server.host}` === needle)
  if (found === undefined) {
    const names = store.servers.map((server) => server.name).join('、') || '（暂无）'
    throw new Error(`未找到服务器「${needle}」；已保存的服务器：${names}`)
  }
  return found
}

/** Model/UI-safe projection of one profile; secrets are reduced to presence flags. */
async function toView(server) {
  const [password, passphrase] = await Promise.all([
    hasSecret(server.id, 'password'),
    hasSecret(server.id, 'passphrase'),
  ])
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth: server.auth,
    keyPath: server.keyPath ?? '',
    proxyJump: server.proxyJump ?? '',
    description: server.description ?? '',
    hasPassword: password,
    hasPassphrase: passphrase,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  }
}

/** All saved profiles, in document order. */
async function listServers() {
  const store = readStore()
  return Promise.all(store.servers.map(toView))
}

/**
 * Create or update one profile.
 *
 * The operation is shared by the Settings route and `ssh_save_server`; the
 * tool caller never supplies `password` / `passphrase`.
 */
async function saveServer(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('服务器参数必须是对象')
  const store = readStore()
  const requestedId = typeof input.id === 'string' && input.id.trim().length > 0 ? input.id.trim() : undefined
  const existing = requestedId !== undefined
    ? store.servers.find((server) => server.id === requestedId)
    : store.servers.find((server) => server.name.toLowerCase() === String(input.name ?? '').trim().toLowerCase())
  if (requestedId !== undefined && existing === undefined) throw new Error(`服务器 id「${requestedId}」不存在`)
  const id = existing?.id ?? newServerId(store)
  const name = requireText(input.name ?? existing?.name, '服务器名称', 80)
  if (store.servers.some((server) => server.id !== id && server.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`已存在同名服务器「${name}」`)
  }
  const host = validateHost(input.host ?? existing?.host)
  const username = validateUsername(input.username ?? existing?.username)
  const port = validatePort(input.port ?? existing?.port ?? DEFAULT_PORT)
  const auth = validateAuth(input.auth ?? existing?.auth ?? 'password')
  const keyPath = auth === 'key'
    ? validateKeyPath(input.keyPath !== undefined ? input.keyPath : existing?.keyPath)
    : undefined
  const proxyJump = validateProxyJump(input.proxyJump !== undefined ? input.proxyJump : existing?.proxyJump)
  const description = validateDescription(input.description !== undefined ? input.description : existing?.description)

  const passwordProvided = Object.hasOwn(input, 'password')
  const passphraseProvided = Object.hasOwn(input, 'passphrase')
  if (passwordProvided && auth !== 'password') throw new Error('只有“密码”认证才能保存密码')
  if (passphraseProvided && auth !== 'key') throw new Error('只有“密钥”认证才能保存私钥口令')

  const profile = {
    id,
    name,
    host,
    port,
    username,
    auth,
    ...(keyPath === undefined ? {} : { keyPath }),
    ...(proxyJump === undefined ? {} : { proxyJump }),
    ...(description === undefined ? {} : { description }),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  if (passwordProvided) {
    const password = validateSecret(input.password, '密码')
    if (password === undefined) await deleteSecret(id, 'password')
    else await writeSecret(id, 'password', password)
  }
  if (auth !== 'password') await deleteSecret(id, 'password')

  if (passphraseProvided) {
    const passphrase = validateSecret(input.passphrase, '私钥口令')
    if (passphrase === undefined) await deleteSecret(id, 'passphrase')
    else await writeSecret(id, 'passphrase', passphrase)
  }
  if (auth !== 'key') await deleteSecret(id, 'passphrase')

  if (existing === undefined) store.servers.push(profile)
  else store.servers = store.servers.map((server) => server.id === id ? profile : server)
  writeStore(store)
  return toView(profile)
}

/** Delete one profile together with its stored secrets. */
async function deleteServer(selector) {
  const store = readStore()
  const server = resolveServer(store, selector)
  await Promise.all([deleteSecret(server.id, 'password'), deleteSecret(server.id, 'passphrase')])
  store.servers = store.servers.filter((entry) => entry.id !== server.id)
  writeStore(store)
  return { id: server.id, name: server.name }
}

/** The fixed command behind a connectivity check; its marker detects login shells that print banners. */
const TEST_COMMAND = "printf 'dsh-ssh-ok\\n'; hostname; id -un; uname -srm"

/** Verify connectivity, authentication, and basic remote identity. */
async function testServer(selector) {
  const store = readStore()
  const server = resolveServer(store, selector)
  const startedAt = Date.now()
  const result = await runSsh(server, TEST_COMMAND, { timeoutMs: TEST_TIMEOUT_MS })
  if (result.aborted) throw new Error('连接测试已取消')
  if (result.timedOut) throw new Error(`连接 ${server.name} 超时（${Math.round(TEST_TIMEOUT_MS / 1000)} 秒）`)
  if (result.exitCode !== 0) throw new Error(formatConnectionFailure(server, result))
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim())
  if (lines[0] !== 'dsh-ssh-ok') {
    throw new Error(`连接 ${server.name} 返回了无法识别的结果：${result.stdout.slice(0, 400) || '(empty)'}`)
  }
  return {
    id: server.id,
    name: server.name,
    latencyMs: Date.now() - startedAt,
    hostname: lines[1] ?? '',
    user: lines[2] ?? '',
    system: lines[3] ?? '',
  }
}

/** Execute one remote shell command through a fresh SSH connection. */
async function execOnServer(selector, command, timeoutSeconds, signal) {
  if (typeof command !== 'string' || command.trim().length === 0) throw new Error('命令不能为空')
  if (command.length > MAX_COMMAND_LENGTH) throw new Error(`命令不能超过 ${MAX_COMMAND_LENGTH} 个字符`)
  const store = readStore()
  const server = resolveServer(store, selector)
  const timeoutMs = normalizeTimeout(timeoutSeconds)
  const result = await runSsh(server, command, { timeoutMs, signal })
  if (result.aborted) throw new Error('命令已取消')
  if (result.timedOut) throw new Error(`命令在 ${Math.round(timeoutMs / 1000)} 秒内没有完成，已终止。`)
  if (result.exitCode === 255) throw new Error(formatConnectionFailure(server, result))
  return { text: formatExecResult(server, result) }
}

/** Normalize a model-supplied timeout. */
function normalizeTimeout(timeoutSeconds) {
  if (timeoutSeconds === undefined || timeoutSeconds === null) return DEFAULT_TIMEOUT_MS
  const value = Number(timeoutSeconds)
  if (!Number.isFinite(value) || value <= 0) throw new Error('超时时间必须是正数（秒）')
  return Math.min(Math.round(value * 1000), MAX_TIMEOUT_MS)
}

/** Human-readable outcome of one remote command. */
function formatExecResult(server, result) {
  const parts = [
    `server: ${server.name} (${server.username}@${server.host}:${server.port})`,
    `exitCode: ${result.exitCode === null ? 'null' : String(result.exitCode)}${result.signal === null ? '' : ` (signal ${result.signal})`}`,
    `duration: ${(result.durationMs / 1000).toFixed(2)}s`,
  ]
  if (result.stdout.length > 0) parts.push('', 'stdout:', result.stdout.replace(/\s+$/, ''))
  if (result.stderr.length > 0) parts.push('', 'stderr:', result.stderr.replace(/\s+$/, ''))
  if (result.truncated) parts.push('', `[输出已截断：每个流最多保留 ${MAX_CAPTURE_BYTES} 字节]`)
  if (result.stdout.length === 0 && result.stderr.length === 0) parts.push('', '(no output)')
  return parts.join('\n')
}

/** Actionable explanation of an SSH transport failure. */
function formatConnectionFailure(server, result) {
  const target = `${server.username}@${server.host}:${server.port}`
  const stderr = result.stderr.trim()
  const lines = [`无法连接到 ${server.name}（${target}），ssh 退出码 ${result.exitCode === null ? 'null' : String(result.exitCode)}。`]
  if (stderr.length > 0) lines.push(stderr)
  if (/Permission denied/i.test(stderr)) {
    lines.push('认证失败：请检查用户名、密码或私钥，以及服务器是否允许该认证方式。')
  }
  if (/Host key verification failed/i.test(stderr)) {
    lines.push('主机密钥校验失败：请检查 ~/.ssh/known_hosts 中该主机的记录。')
  }
  if (/Connection refused|timed out|No route to host|Network is unreachable/i.test(stderr)) {
    lines.push('请检查主机地址、端口和网络连通性。')
  }
  if (server.auth === 'password' && /Permission denied/i.test(stderr)) {
    lines.push('若密码已修改，请在 设置 → SSH 服务器 中重新填写密码。')
  }
  return lines.join('\n')
}

/** Resolve the secrets one connection needs. */
async function resolveSecrets(server) {
  const password = server.auth === 'password' ? await readSecret(server.id, 'password') : undefined
  const passphrase = server.auth === 'key' ? await readSecret(server.id, 'passphrase') : undefined
  if (server.auth === 'password' && password === undefined) {
    throw new Error(`服务器「${server.name}」还没有保存密码，请在 设置 → SSH 服务器 中填写后再试。`)
  }
  return { password, passphrase }
}

/** Create the transient askpass helper that answers ssh prompts from the environment. */
function createAskpass(password, passphrase) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-ssh-manager-'))
  chmodSync(directory, 0o700)
  const file = join(directory, 'askpass.sh')
  const script = `#!/bin/sh
case "$1" in
  *[Pp]assphrase*) printf '%s\\n' "\${DSH_SSH_PASSPHRASE:-}" ;;
  *) printf '%s\\n' "\${DSH_SSH_PASSWORD:-}" ;;
esac
`
  writeFileSync(file, script, { encoding: 'utf8', mode: 0o700 })
  chmodSync(file, 0o700)
  return {
    env: {
      SSH_ASKPASS: file,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: typeof process.env.DISPLAY === 'string' && process.env.DISPLAY.length > 0 ? process.env.DISPLAY : ':0',
      DSH_SSH_PASSWORD: password ?? '',
      DSH_SSH_PASSPHRASE: passphrase ?? '',
    },
    cleanup() {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

/** OpenSSH options shared by `ssh` and `scp` invocations. */
function sshCommonOptions(server, secrets) {
  const options = [
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
  ]
  if (server.proxyJump !== undefined) options.push('-J', server.proxyJump)
  if (server.auth === 'password') {
    options.push('-o', 'PreferredAuthentications=password,keyboard-interactive', '-o', 'PubkeyAuthentication=no')
  } else if (server.auth === 'key') {
    if (server.keyPath !== undefined) options.push('-i', server.keyPath, '-o', 'IdentitiesOnly=yes')
    if (secrets.passphrase === undefined) options.push('-o', 'BatchMode=yes')
  } else {
    options.push('-o', 'BatchMode=yes')
  }
  return options
}

/** Run one SSH command with the profile's target and authentication. */
async function runSsh(server, command, options) {
  const secrets = await resolveSecrets(server)
  const askpass = secrets.password !== undefined || secrets.passphrase !== undefined
    ? createAskpass(secrets.password, secrets.passphrase)
    : undefined
  const env = { ...process.env, ...(askpass?.env ?? {}) }
  const args = [
    ...sshCommonOptions(server, secrets),
    '-l', server.username,
    '-p', String(server.port),
    server.host,
    command,
  ]
  try {
    return await runProcess('/usr/bin/ssh', args, { env, timeoutMs: options.timeoutMs, signal: options.signal })
  } finally {
    askpass?.cleanup()
  }
}

/**
 * Spawn one local process and collect bounded stdout/stderr.
 *
 * @returns exit facts plus captured output; a spawn failure rejects.
 */
function runProcess(bin, args, options) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const stdout = { chunks: [], size: 0, truncated: false }
    const stderr = { chunks: [], size: 0, truncated: false }
    let settled = false
    let child
    try {
      child = spawn(bin, args, { env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    const collect = (state) => (chunk) => {
      if (state.size >= MAX_CAPTURE_BYTES) {
        state.truncated = true
        return
      }
      const room = MAX_CAPTURE_BYTES - state.size
      state.chunks.push(chunk.subarray(0, Math.min(chunk.length, room)))
      state.size += Math.min(chunk.length, room)
      if (chunk.length > room) state.truncated = true
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    let timedOut = false
    const kill = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
    }
    const timer = options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          kill()
        }, options.timeoutMs)
      : undefined
    const onAbort = () => kill()
    if (options.signal !== undefined) {
      if (options.signal.aborted) kill()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
    const finish = (exitCode, exitSignal, spawnError) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (spawnError !== undefined && spawnError !== null) {
        reject(spawnError)
        return
      }
      resolve({
        exitCode,
        signal: exitSignal,
        timedOut,
        aborted: options.signal?.aborted === true,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdout.chunks).toString('utf8'),
        stderr: Buffer.concat(stderr.chunks).toString('utf8'),
        truncated: stdout.truncated || stderr.truncated,
      })
    }
    child.on('error', (error) => finish(null, null, error))
    child.on('close', (code, signal) => finish(code, signal, undefined))
  })
}

/** Validate a local transfer path. */
function normalizeLocalPath(value, mustExist) {
  const text = requireText(value, '本地路径', 4096)
  const expanded = expandHomePath(text)
  if (!isAbsolute(expanded)) throw new Error('本地路径必须是绝对路径（可以使用 ~/ 开头）')
  if (mustExist) {
    if (!existsSync(expanded)) throw new Error(`本地路径不存在：${expanded}`)
  } else {
    const parent = dirname(expanded)
    if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error(`本地目录不存在：${parent}`)
  }
  return expanded
}

/** Validate a remote transfer path. */
function normalizeRemotePath(value) {
  const text = requireText(value, '远端路径', 4096)
  if (/[\r\n\0]/.test(text)) throw new Error('远端路径不能包含换行或空字符')
  return text
}

/** Copy one file or directory in either direction with scp. */
async function transferPath(request) {
  const direction = request.direction
  const store = readStore()
  const server = resolveServer(store, request.server)
  const localPath = normalizeLocalPath(request.localPath, direction === 'upload')
  const remotePath = normalizeRemotePath(request.remotePath)
  let recursive = request.recursive === true
  let uploadedBytes
  if (direction === 'upload') {
    const stats = statSync(localPath)
    if (stats.isDirectory()) {
      if (!recursive) throw new Error('本地路径是目录，请设置 recursive=true 进行递归上传')
      recursive = true
    } else {
      uploadedBytes = stats.size
    }
  }
  const secrets = await resolveSecrets(server)
  const askpass = secrets.password !== undefined || secrets.passphrase !== undefined
    ? createAskpass(secrets.password, secrets.passphrase)
    : undefined
  const env = { ...process.env, ...(askpass?.env ?? {}) }
  const targetHost = server.host.includes(':') ? `[${server.host}]` : server.host
  const remoteSpec = `${server.username}@${targetHost}:${remotePath}`
  const sources = direction === 'upload' ? [localPath, remoteSpec] : [remoteSpec, localPath]
  const args = [
    ...sshCommonOptions(server, secrets),
    '-P', String(server.port),
    ...(recursive ? ['-r'] : []),
    ...sources,
  ]
  try {
    const result = await runProcess('/usr/bin/scp', args, { env, timeoutMs: TRANSFER_TIMEOUT_MS, signal: request.signal })
    if (result.aborted) throw new Error('文件传输已取消')
    if (result.timedOut) throw new Error(`文件传输超时（${Math.round(TRANSFER_TIMEOUT_MS / 1000)} 秒）`)
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || '未知错误'
      throw new Error(`scp ${direction === 'upload' ? '上传' : '下载'}失败（退出码 ${result.exitCode}）：${detail}`)
    }
    return { direction, server: server.name, localPath, remotePath, recursive, uploadedBytes }
  } finally {
    askpass?.cleanup()
  }
}

/** Model-facing one-line-per-server listing. */
function formatServerList(servers) {
  if (servers.length === 0) {
    return 'No SSH servers are saved yet. Add one with ssh_save_server (host and login fields only), then enter any password or key passphrase in Settings → SSH servers.'
  }
  return servers.map((server) => {
    const details = [
      `${server.username}@${server.host}:${server.port}`,
      `auth=${server.auth}`,
      server.auth === 'password' ? (server.hasPassword ? 'password saved' : 'password missing') : '',
      server.auth === 'key' ? (server.keyPath.length > 0 ? `key=${server.keyPath}` : 'key from agent/config') : '',
      server.auth === 'key' && server.hasPassphrase ? 'key passphrase saved' : '',
      server.proxyJump.length > 0 ? `jump=${server.proxyJump}` : '',
    ].filter((part) => part.length > 0).join(', ')
    const description = server.description.length > 0 ? ` — ${server.description}` : ''
    return `- ${server.name} [${server.id}] (${details})${description}`
  }).join('\n')
}

/** Canonical mention syntax emitted by the composer's SSH reference chip. */
const MENTION_PATTERN = /@\[[^\]\n]*\]\(dsh-ssh:([a-z][a-z0-9-]*)\)/gu

/** Concatenate the text blocks of one message content array. */
function textOfMessageContent(content) {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text
}

/** The last saved-server mention id in one message, including the `local` detach id. */
function lastMentionId(text) {
  if (typeof text !== 'string' || !text.includes('dsh-ssh:')) return undefined
  let id
  for (const match of text.matchAll(MENTION_PATTERN)) id = match[1]
  return id
}

/** Resolve the live Session carried by an Agent or a system-prompt scope. */
function sessionOfScope(scope) {
  if (scope === null || typeof scope !== 'object') return undefined
  const session = scope.session
  if (session !== null && typeof session === 'object' && typeof session.snapshotEvents === 'function') return session
  return undefined
}

/** Per-Session cache of the last resolved @ mention, keyed by the log sequence. */
const targetCache = new WeakMap()

/**
 * Resolve the SSH target the conversation last attached with @.
 *
 * The selection lives in the session log as the canonical mention text the
 * composer chip serializes, so a later turn, a resume, or a replay derives the
 * same answer without plugin memory. `{ kind: 'local' }` means the user
 * explicitly detached with the Local row.
 */
function activeTarget(agent) {
  const session = sessionOfScope(agent)
  if (session === undefined) return undefined
  const cached = targetCache.get(session)
  if (cached !== undefined && cached.seq === session.seq) return cached.target
  let target
  try {
    const events = session.snapshotEvents()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event.type !== 'user/message') continue
      if (event.data?.source?.kind !== 'user') continue
      const id = lastMentionId(textOfMessageContent(event.data.content))
      if (id === undefined) continue
      target = id === 'local' ? { kind: 'local' } : { kind: 'server', id }
      break
    }
  } catch {
    target = undefined
  }
  targetCache.set(session, { seq: session.seq, target })
  return target
}

/** The saved server currently attached to this conversation, if it still exists. */
function activeServer(agent) {
  const target = activeTarget(agent)
  if (target === undefined || target.kind !== 'server') return undefined
  try {
    return findServerById(readStore(), target.id)
  } catch {
    return undefined
  }
}

/** Resolve one server by its generated id. */
function findServerById(store, id) {
  return store.servers.find((server) => server.id === id)
}

/** Resolve the server a tool call targets, defaulting to the @-attached one. */
function toolServer(agent, selector) {
  if (typeof selector === 'string' && selector.trim().length > 0) return selector.trim()
  const server = activeServer(agent)
  if (server !== undefined) return server.id
  if (activeTarget(agent)?.kind === 'local') {
    throw new Error('当前会话已通过 @ 切换到本机，没有活动的 SSH 服务器。')
  }
  throw new Error('未指定服务器；请通过 @ 选择一个 SSH 服务器，或显式传入 server。')
}

/** Format one connectivity check for the model. */
function formatTestResult(result) {
  return [
    `server: ${result.name} (${result.id})`,
    'status: ok',
    `hostname: ${result.hostname || '(unknown)'}`,
    `remote user: ${result.user || '(unknown)'}`,
    `system: ${result.system || '(unknown)'}`,
    `latency: ${result.latencyMs} ms`,
  ].join('\n')
}

/** Format one save/update outcome for the model. */
function formatSavedServer(server) {
  const details = [
    `${server.username}@${server.host}:${server.port}`,
    `auth=${server.auth}`,
  ]
  if (server.keyPath.length > 0) details.push(`key=${server.keyPath}`)
  if (server.proxyJump.length > 0) details.push(`jump=${server.proxyJump}`)
  const hint = server.auth === 'password' && !server.hasPassword
    ? '\nNo password is stored yet. Ask the user to enter it in Settings → SSH servers before connecting.'
    : ''
  return `Saved server "${server.name}" [${server.id}] (${details.join(', ')}).${hint}`
}

/** Format one transfer outcome for the model. */
function formatTransfer(result) {
  const bytes = result.uploadedBytes === undefined ? '' : `\nbytes: ${result.uploadedBytes}`
  return [
    `${result.direction === 'upload' ? 'Uploaded' : 'Downloaded'} via ${result.server}`,
    `from: ${result.direction === 'upload' ? result.localPath : result.remotePath}`,
    `to: ${result.direction === 'upload' ? result.remotePath : result.localPath}`,
    ...(result.recursive ? ['recursive: yes'] : []),
    ...(bytes.length > 0 ? [bytes] : []),
  ].join('\n')
}

/** JSON response with no caching, so every Settings visit reads fresh state. */
function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Serve the Settings page's read/write operations. */
async function handleRoute(request) {
  try {
    if (request.method === 'GET') {
      return jsonResponse(200, { ok: true, servers: await listServers() })
    }
    if (request.method !== 'POST') {
      return jsonResponse(405, { ok: false, error: 'method not allowed' })
    }
    let body
    try {
      body = await request.json()
    } catch {
      return jsonResponse(400, { ok: false, error: 'expected a JSON body' })
    }
    const operation = body?.op
    if (operation === 'save') {
      return jsonResponse(200, { ok: true, server: await saveServer(body.server) })
    }
    if (operation === 'delete') {
      return jsonResponse(200, { ok: true, ...(await deleteServer(body.id ?? body.server)) })
    }
    if (operation === 'test') {
      return jsonResponse(200, { ok: true, ...(await testServer(body.id ?? body.server)) })
    }
    return jsonResponse(400, { ok: false, error: 'unknown op' })
  } catch (error) {
    return jsonResponse(400, { ok: false, error: errorMessage(error) })
  }
}

/** Build one registry-ready tool definition. */
function makeTool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      },
    },
    execute: spec.execute,
  }
}

/** Tool schemas and bodies; every body calls the same operation the Settings route uses. */
function toolDefinitions() {
  const serverProperty = {
    type: 'string',
    description: 'Saved server id or name. Omit to use the server attached with @ in this conversation.',
  }
  const localPathProperty = {
    type: 'string',
    description: 'Absolute local path. A leading ~/ is expanded.',
  }
  const remotePathProperty = {
    type: 'string',
    description: 'Remote path, for example /var/www/app or ~/logs.',
  }
  return [
    makeTool({
      name: 'ssh_list_servers',
      description: 'List the SSH servers saved in SSH Manager: name, id, user@host:port, authentication mode, and whether a password/passphrase is stored. Use it before ssh_exec when you do not know the server name.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        return formatServerList(await listServers())
      },
    }),
    makeTool({
      name: 'ssh_save_server',
      description: 'Create or update a saved SSH server. This tool accepts non-secret fields only; passwords and key passphrases must be entered by the user under Settings → SSH servers, so they never enter the chat log. Pass `id` to update an existing server, otherwise `name` selects an existing profile or creates a new one.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Existing server id to update. Omit to match by name or create.' },
          name: { type: 'string', description: 'Display name, unique among saved servers.' },
          host: { type: 'string', description: 'Hostname or IP address.' },
          username: { type: 'string', description: 'Remote login name.' },
          port: { type: 'integer', description: 'TCP port; defaults to 22.' },
          auth: { type: 'string', enum: ['password', 'key', 'agent'], description: 'Authentication mode. Defaults to password.' },
          key_path: { type: 'string', description: 'Private key file for auth=key, absolute or ~/ relative.' },
          proxy_jump: { type: 'string', description: 'Optional ProxyJump hop, such as user@bastion:2222.' },
          description: { type: 'string', description: 'Optional note shown in Settings.' },
        },
        required: ['name', 'host', 'username'],
        additionalProperties: false,
      },
      async execute(args) {
        const server = await saveServer({
          id: args?.id,
          name: args?.name,
          host: args?.host,
          username: args?.username,
          port: args?.port,
          auth: args?.auth,
          keyPath: args?.key_path,
          proxyJump: args?.proxy_jump,
          description: args?.description,
        })
        return formatSavedServer(server)
      },
    }),
    makeTool({
      name: 'ssh_remove_server',
      description: 'Delete one saved SSH server together with its stored password or key passphrase.',
      parameters: {
        type: 'object',
        properties: { server: serverProperty },
        required: ['server'],
        additionalProperties: false,
      },
      async execute(args) {
        const removed = await deleteServer(args?.server)
        return `Removed server "${removed.name}" [${removed.id}] and its stored secrets.`
      },
    }),
    makeTool({
      name: 'ssh_test',
      description: 'Check connectivity and authentication for a saved SSH server. Omit server to test the server attached with @ in this conversation. Returns the remote hostname, login user, kernel string, and round-trip latency.',
      parameters: {
        type: 'object',
        properties: { server: serverProperty },
        additionalProperties: false,
      },
      async execute(args, exec) {
        return formatTestResult(await testServer(toolServer(exec?.agent, args?.server)))
      },
    }),
    makeTool({
      name: 'ssh_exec',
      description: 'Run a shell command on a saved SSH server and return its exit code, stdout, and stderr. Omit server to use the SSH server attached with @ in this conversation; that server is also the target the whole conversation should use for shell work. Each call opens a fresh connection with a fresh shell, so combine steps with && or use absolute paths. Use timeout_seconds for long-running commands.',
      parameters: {
        type: 'object',
        properties: {
          server: serverProperty,
          command: { type: 'string', description: 'Command executed by the remote login shell.' },
          timeout_seconds: { type: 'integer', description: 'Abort after this many seconds; defaults to 120, maximum 3600.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const server = toolServer(exec?.agent, args?.server)
        const outcome = await execOnServer(server, args?.command, args?.timeout_seconds, exec?.signal)
        if (exec?.signal?.aborted === true) throw new Error('命令已取消')
        return outcome.text
      },
    }),
    makeTool({
      name: 'ssh_upload',
      description: 'Upload a local file, or a directory with recursive=true, to a saved SSH server over SCP. The local path must be absolute. The remote directory must already exist. Omit server to use the server attached with @ in this conversation.',
      parameters: {
        type: 'object',
        properties: {
          server: serverProperty,
          local_path: localPathProperty,
          remote_path: remotePathProperty,
          recursive: { type: 'boolean', description: 'Copy directories recursively. Required when local_path is a directory.' },
        },
        required: ['local_path', 'remote_path'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        return formatTransfer(await transferPath({
          direction: 'upload',
          server: toolServer(exec?.agent, args?.server),
          localPath: args?.local_path,
          remotePath: args?.remote_path,
          recursive: args?.recursive,
          signal: exec?.signal,
        }))
      },
    }),
    makeTool({
      name: 'ssh_download',
      description: 'Download a remote file, or a directory with recursive=true, from a saved SSH server over SCP. The local path must be absolute and its parent directory must already exist. Omit server to use the server attached with @ in this conversation.',
      parameters: {
        type: 'object',
        properties: {
          server: serverProperty,
          remote_path: remotePathProperty,
          local_path: localPathProperty,
          recursive: { type: 'boolean', description: 'Copy directories recursively.' },
        },
        required: ['remote_path', 'local_path'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        return formatTransfer(await transferPath({
          direction: 'download',
          server: toolServer(exec?.agent, args?.server),
          localPath: args?.local_path,
          remotePath: args?.remote_path,
          recursive: args?.recursive,
          signal: exec?.signal,
        }))
      },
    }),
  ]
}

/**
 * Register the system-prompt overview, the agent tools, and the Settings route.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  credentialsService = ctx.credentials
  const tools = toolDefinitions()

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'ssh-manager:servers',
    order: 800,
    interpolate: false,
    text: () => {
      try {
        const servers = readStore().servers
        if (servers.length === 0) return ''
        const lines = servers.map((server) => {
          return `- ${server.name} (${server.username}@${server.host}:${server.port}; auth=${server.auth})`
        })
        return [
          '## Saved SSH servers',
          'Use the ssh_* tools to operate these hosts. Each call opens a fresh connection. Passwords and key passphrases live outside the chat: if a connection reports a missing credential, tell the user to enter it in Settings → SSH servers instead of asking for the secret in chat.',
          ...lines,
        ].join('\n')
      } catch {
        return ''
      }
    },
  }), 'ssh-manager: system prompt section')

  // Per-request instruction for the target the user attached with @. The
  // selection is derived from the session log, so it survives resume/replay.
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'ssh-manager:active-target',
    order: 790,
    interpolate: false,
    text: (context) => {
      try {
        const server = activeServer(context?.scope)
        if (server === undefined) return ''
        return [
          `## Active SSH server: ${server.name}`,
          `The user attached this SSH server with @: ${server.username}@${server.host}:${server.port} (id ${server.id}).`,
          'Run every shell command for this conversation on it with the ssh_exec tool; the server argument may be omitted because ssh_exec defaults to this server. Do not use the local bash tool for commands while this server is attached. Local file tools remain available for preparing uploads and saving downloads.',
        ].join('\n')
      } catch {
        return ''
      }
    },
  }), 'ssh-manager: active target section')

  ctx.effect(() => {
    const disposers = tools.map((definition) => ctx.tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ssh-manager: tools')

  // While a conversation is attached to a server, local shell work must go
  // through ssh_exec instead. Guarding (rather than hiding bash) keeps the
  // denial explainable to the model.
  ctx.effect(() => ctx.tools.guard((exec) => {
    if (exec?.name !== 'bash') return undefined
    const server = activeServer(exec.agent)
    if (server === undefined) return undefined
    return `This conversation is attached to SSH server "${server.name}". Run the command on that server with ssh_exec instead of the local bash tool (the server argument may be omitted).`
  }), 'ssh-manager: local bash guard')

  // Optional Web carrier: a headless composition keeps the tools but has no
  // Settings page and therefore no route.
  ctx.inject(['connection'], (child) => {
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: handleRoute,
    }), 'ssh-manager: settings route')
  })
}
