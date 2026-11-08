/**
 * SSH Manager — Client half.
 *
 * Adds one Settings page (`settings.section`) where the user manages saved SSH
 * servers. Reads and writes go through the authenticated Host route
 * (`api/ssh-manager`) registered by this package's Host half, so the Host store
 * stays the single source of truth and secrets are only ever sent from this
 * browser form, never through the chat log.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-ssh-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Document-relative form of the Host route (`/api/ssh-manager`). */
    const ROUTE = 'api/ssh-manager'
    /** Locale namespace owned by this plugin. */
    const NS = 'ssh-manager'

    const LOCALE_DICTS = {
      en: {
        nav: 'SSH servers',
        title: 'SSH servers',
        description: 'Save SSH connections once, then let the agent test, run commands, and transfer files on them. Passwords and key passphrases stay in the local credential store and are never written to the chat log.',
        add: 'Add server',
        addFirst: 'Add your first server',
        countUnit: 'servers saved',
        empty: 'No servers saved yet.',
        emptyHint: 'Add a host, user, and authentication method. You can verify it with Test.',
        retry: 'Retry',
        loading: 'Loading…',
        loadError: 'Could not load the saved servers',
        saveError: 'Could not save the server',
        saved: 'Saved.',
        removed: 'Server removed.',
        testOk: 'Connection OK.',
        editorNew: 'New server',
        editorEdit: 'Edit server',
        fieldName: 'Name',
        placeholderName: 'Production web server',
        fieldHost: 'Host',
        placeholderHost: '192.0.2.10 or example.com',
        fieldPort: 'Port',
        fieldUsername: 'User',
        fieldAuth: 'Authentication',
        authPassword: 'Password',
        authKey: 'Private key',
        authAgent: 'SSH agent',
        fieldKeyPath: 'Private key file',
        placeholderKeyPath: '~/.ssh/id_ed25519',
        keyPathHint: 'Optional. Empty uses the keys offered by your SSH agent or ~/.ssh/config.',
        fieldPassword: 'Password',
        placeholderPassword: 'Leave empty to keep the saved password',
        passwordStored: 'A password is saved. Leave the field empty to keep it.',
        passwordMissing: 'No password saved yet; Test will fail until you enter one.',
        passwordHint: 'Stored in the local credential store, not in the chat log.',
        fieldPassphrase: 'Key passphrase',
        placeholderPassphrase: 'Leave empty if the key has no passphrase',
        passphraseStored: 'A passphrase is saved. Leave the field empty to keep it.',
        passphraseMissing: 'No passphrase saved for this key.',
        passphraseHint: 'Stored in the local credential store.',
        clearSecret: 'Clear saved secret',
        undoClear: 'Keep saved secret',
        willClear: 'The saved secret will be deleted when you save.',
        fieldProxyJump: 'Proxy jump',
        placeholderProxyJump: 'user@bastion:2222',
        proxyJumpHint: 'Optional. Connect through a bastion host (ProxyJump).',
        fieldDescription: 'Note',
        placeholderDescription: 'What is this server for?',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        edit: 'Edit',
        delete: 'Delete',
        confirmDelete: 'Confirm delete',
        test: 'Test',
        testing: 'Testing…',
        formInvalid: 'Name, host, and user are required.',
        invalidPort: 'Port must be an integer between 1 and 65535.',
        duplicateName: 'A server with this name already exists. Edit it instead.',
        noPassword: 'no password',
        footnote: 'Saved in ~/.dsh/ssh-manager/servers.json; passwords and passphrases live in the local credential store. In the composer, type @ and pick a server to attach it; shell commands then run there through ssh_exec. Pick Local to detach.',
        'mention.section': 'SSH servers',
        'mention.local': 'Local (no SSH)',
        'mention.localHint': 'Detach and run commands on this machine',
        'mention.localChip': 'Local',
      },
      zh: {
        nav: 'SSH 服务器',
        title: 'SSH 服务器',
        description: '把 SSH 连接保存一次，之后让 AI 直接在这些服务器上测试连接、执行命令、上传下载文件。密码和私钥口令保存在本机凭据存储中，不会写入会话记录。',
        add: '添加服务器',
        addFirst: '添加第一台服务器',
        countUnit: '台服务器',
        empty: '还没有保存任何服务器。',
        emptyHint: '填写主机、用户名和认证方式，保存后可以用「测试」验证连接。',
        retry: '重试',
        loading: '正在加载…',
        loadError: '无法加载已保存的服务器',
        saveError: '保存服务器失败',
        saved: '已保存。',
        removed: '服务器已删除。',
        testOk: '连接正常。',
        editorNew: '新建服务器',
        editorEdit: '编辑服务器',
        fieldName: '名称',
        placeholderName: '生产 Web 服务器',
        fieldHost: '主机',
        placeholderHost: '192.0.2.10 或 example.com',
        fieldPort: '端口',
        fieldUsername: '用户名',
        fieldAuth: '认证方式',
        authPassword: '密码',
        authKey: '私钥',
        authAgent: 'SSH Agent',
        fieldKeyPath: '私钥文件',
        placeholderKeyPath: '~/.ssh/id_ed25519',
        keyPathHint: '可选。留空表示使用 SSH Agent 或 ~/.ssh/config 中的密钥。',
        fieldPassword: '密码',
        placeholderPassword: '留空表示不修改已保存的密码',
        passwordStored: '已保存密码，留空表示不修改。',
        passwordMissing: '尚未保存密码；填写后「测试」才能通过。',
        passwordHint: '保存在本机凭据存储中，不会写入会话记录。',
        fieldPassphrase: '私钥口令',
        placeholderPassphrase: '私钥没有口令可留空',
        passphraseStored: '已保存口令，留空表示不修改。',
        passphraseMissing: '这把私钥还没有保存口令。',
        passphraseHint: '保存在本机凭据存储中。',
        clearSecret: '清除已保存的密钥',
        undoClear: '保留已保存的密钥',
        willClear: '保存后将删除已保存的密钥。',
        fieldProxyJump: '跳板机',
        placeholderProxyJump: 'user@bastion:2222',
        proxyJumpHint: '可选。通过跳板机连接（ProxyJump）。',
        fieldDescription: '备注',
        placeholderDescription: '这台服务器用来做什么？',
        save: '保存',
        saving: '保存中…',
        cancel: '取消',
        edit: '编辑',
        delete: '删除',
        confirmDelete: '确认删除',
        test: '测试',
        testing: '测试中…',
        formInvalid: '名称、主机和用户名不能为空。',
        invalidPort: '端口必须是 1–65535 之间的整数。',
        duplicateName: '已存在同名服务器，请改为编辑它。',
        noPassword: '未设置密码',
        footnote: '配置保存在 ~/.dsh/ssh-manager/servers.json；密码和口令保存在本机凭据存储中。在输入框输入 @ 选择服务器即可绑定；之后命令都通过 ssh_exec 在该服务器上执行，选择「本机」可断开。',
        'mention.section': 'SSH 服务器',
        'mention.local': '本机（不使用 SSH）',
        'mention.localHint': '断开 SSH，在本机执行命令',
        'mention.localChip': '本机',
      },
    }

    /** Scoped styles; every color is a host theme token, mounted with the page. */
    const CSS = `
      .dsh-ssh2 { display: flex; flex-direction: column; gap: 16px; padding: 24px 32px; max-width: 860px; box-sizing: border-box; }
      .dsh-ssh2-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
      .dsh-ssh2-description { margin: 0; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
      .dsh-ssh2-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .dsh-ssh2-count { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .dsh-ssh2-button { box-sizing: border-box; height: 30px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
      .dsh-ssh2-button:not(:disabled):hover { background: var(--dsw-alias-bg-layer-2); }
      .dsh-ssh2-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dsh-ssh2-button:disabled { opacity: 0.5; cursor: default; }
      .dsh-ssh2-button.is-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
      .dsh-ssh2-button.is-danger { border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-state-error-primary); }
      .dsh-ssh2-button.is-small { height: 26px; padding: 0 10px; font-size: 12px; }
      .dsh-ssh2-link { padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
      .dsh-ssh2-form { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
      .dsh-ssh2-form-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dsh-ssh2-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .dsh-ssh2-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .dsh-ssh2-field.is-wide { grid-column: 1 / -1; }
      .dsh-ssh2-label { font-size: 12px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary); }
      .dsh-ssh2-input, .dsh-ssh2-select, .dsh-ssh2-textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
      .dsh-ssh2-input, .dsh-ssh2-select { height: 32px; padding: 0 10px; }
      .dsh-ssh2-select { padding-right: 6px; }
      .dsh-ssh2-textarea { min-height: 58px; padding: 8px 10px; line-height: 1.55; resize: vertical; }
      .dsh-ssh2-input::placeholder, .dsh-ssh2-textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.75; }
      .dsh-ssh2-input:focus, .dsh-ssh2-select:focus, .dsh-ssh2-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
      .dsh-ssh2-input:disabled { opacity: 0.6; }
      .dsh-ssh2-hint { font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
      .dsh-ssh2-hint.is-warn { color: var(--dsw-alias-state-warn-primary); }
      .dsh-ssh2-form-error { font-size: 12px; line-height: 1.55; color: var(--dsw-alias-state-error-primary); }
      .dsh-ssh2-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dsh-ssh2-card { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); flex-wrap: wrap; }
      .dsh-ssh2-card-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 320px; }
      .dsh-ssh2-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dsh-ssh2-name { font-size: 14px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
      .dsh-ssh2-badge { padding: 2px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .dsh-ssh2-badge.is-warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
      .dsh-ssh2-meta { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); word-break: break-all; }
      .dsh-ssh2-desc { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dsh-ssh2-test { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); word-break: break-word; }
      .dsh-ssh2-test.is-ok { color: var(--dsw-alias-state-success-primary); }
      .dsh-ssh2-test.is-error { color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; }
      .dsh-ssh2-card-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dsh-ssh2-empty { display: flex; flex-direction: column; gap: 6px; padding: 24px 20px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 12px; text-align: center; }
      .dsh-ssh2-empty-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dsh-ssh2-empty-hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dsh-ssh2-notice { font-size: 12px; line-height: 1.6; }
      .dsh-ssh2-notice.is-ok { color: var(--dsw-alias-state-success-primary); }
      .dsh-ssh2-notice.is-error { color: var(--dsw-alias-state-error-primary); }
      .dsh-ssh2-error-box { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 10px; font-size: 13px; color: var(--dsw-alias-label-primary); }
      .dsh-ssh2-error-box span { flex: 1; }
      .dsh-ssh2-footnote { margin: 0; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
      .dsh-ssh2-muted { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
      @media (max-width: 640px) {
        .dsh-ssh2 { padding: 16px; }
        .dsh-ssh2-grid { grid-template-columns: minmax(0, 1fr); }
      }
    `

    /** Parse one route response into its payload or a thrown Error. */
    function parseResponse(response) {
      return response.json().catch(() => null).then((payload) => {
        if (!response.ok || payload === null || payload.ok !== true) {
          const message = payload !== null && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
          throw new Error(message)
        }
        return payload
      })
    }

    /**
     * Servers already fetched for the `@` menu. The menu re-queries on every
     * keystroke, so a short cache keeps that cheap; a Settings save or delete
     * invalidates it.
     */
    let mentionCache = { at: 0, servers: [] }

    /** Server id to display name, for serializing a chip without another request. */
    const mentionNames = new Map()

    /** Forget the menu cache after the saved-server list changes. */
    function invalidateMentionCache() {
      mentionCache = { at: 0, servers: [] }
      mentionNames.clear()
    }

    /** `GET` the saved servers through the authenticated Host route. */
    function readServers(signal) {
      return fetch(ROUTE, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      }).then(parseResponse).then((payload) => {
        const servers = Array.isArray(payload.servers) ? payload.servers : []
        mentionCache = { at: Date.now(), servers }
        for (const server of servers) mentionNames.set(server.id, server.name)
        return payload
      })
    }

    /** Load the `@` menu's server list, reusing the short cache. */
    async function readMentionServers(signal) {
      if (mentionCache.at !== 0 && Date.now() - mentionCache.at < 5000) return mentionCache.servers
      const payload = await readServers(signal)
      return Array.isArray(payload.servers) ? payload.servers : []
    }

    /** Send one operation to the authenticated Host route. */
    function postOperation(operation) {
      return fetch(ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(operation),
      }).then(parseResponse)
    }

    /** Canonical mention text shared with the Host parser. */
    function mentionText(name, id) {
      const label = String(name ?? '').replace(/[\]\r\n]/gu, ' ').trim() || id
      return `@[${label}](dsh-ssh:${id})`
    }

    /** Extract the source-owned id from a chip reference. */
    function mentionIdOf(ref) {
      return typeof ref === 'string' && ref.startsWith('dsh-ssh:') ? ref.slice('dsh-ssh:'.length) : ''
    }

    /** Small server rack glyph for the `@` rows and the inline chip. */
    function ServerGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2.5, y: 2.5, width: 11, height: 4.4, rx: 1.1, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('rect', { x: 2.5, y: 9.1, width: 11, height: 4.4, rx: 1.1, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 5, cy: 4.7, r: 0.8, fill: 'currentColor' }),
        h('circle', { cx: 5, cy: 11.3, r: 0.8, fill: 'currentColor' }),
      )
    }

    /** Monitor glyph for the Local (detach) row. */
    function LocalGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2, y: 2.5, width: 12, height: 8.5, rx: 1.2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M5.5 13.75h5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    /** Inline chip for a sent `@server` mention (the UserText node renderer). */
    function SshMentionChip({ node, raw }) {
      const data = node !== null && typeof node === 'object' && node.data !== null && typeof node.data === 'object' ? node.data : {}
      const local = data.serverId === 'local'
      const label = typeof data.name === 'string' && data.name.length > 0 ? data.name : (typeof raw === 'string' ? raw : '')
      return h('span', {
        className: 'dsh-ssh2-inline-ref',
        title: typeof raw === 'string' ? raw : label,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          margin: '0 1px',
          padding: '0 6px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: '6px',
          background: 'var(--dsw-alias-bg-layer-2)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: '0.92em',
          lineHeight: '1.6',
          verticalAlign: 'baseline',
          whiteSpace: 'nowrap',
        },
      }, h(local ? LocalGlyph : ServerGlyph, { size: 12 }), h('span', null, label))
    }

    /** UserText rule that reserves the canonical mention before the file rule sees it. */
    const SSH_MENTION_RULE = {
      id: 'ssh',
      order: 10,
      match(text, from) {
        const pattern = /@\[([^\]\n]*)\]\(dsh-ssh:([a-z][a-z0-9-]*)\)/gu
        pattern.lastIndex = from
        const match = pattern.exec(text)
        if (match === null) return undefined
        return {
          id: 'ssh',
          start: match.index,
          end: match.index + match[0].length,
          data: {
            serverId: match[2],
            name: match[1].length > 0 ? match[1] : match[2],
          },
        }
      },
    }

    /**
     * The `@` source. Its rows live under their own section heading and pick
     * into an atomic reference chip whose codec serializes the canonical
     * `@[name](dsh-ssh:id)` mention the Host parses.
     */
    function createSshSource(t) {
      return {
        trigger: '@',
        name: 'ssh',
        order: 20,
        showGroupTitle: false,
        async candidates(_session, request) {
          if (request.quoted === true) return []
          let servers
          try {
            servers = await readMentionServers(request.signal)
          } catch {
            return []
          }
          if (request.signal?.aborted === true) return []
          const query = typeof request.query === 'string' ? request.query.trim().toLowerCase() : ''
          const rows = []
          for (const server of servers) {
            const haystack = `${server.name} ${server.username} ${server.host}`.toLowerCase()
            if (query !== '' && !haystack.includes(query)) continue
            rows.push({
              name: server.name,
              description: `${server.username}@${server.host}:${server.port}`,
              icon: ServerGlyph,
              section: t('mention.section'),
              value: JSON.stringify({ kind: 'server', id: server.id, name: server.name }),
            })
          }
          if (servers.length > 0 && (query === '' || t('mention.local').toLowerCase().includes(query))) {
            rows.push({
              name: t('mention.local'),
              description: t('mention.localHint'),
              icon: LocalGlyph,
              section: t('mention.section'),
              value: JSON.stringify({ kind: 'local' }),
            })
          }
          return rows
        },
        onPick({ candidate }) {
          let value
          try {
            value = JSON.parse(candidate?.value)
          } catch {
            return undefined
          }
          if (value?.kind === 'local') {
            return {
              insert: {
                source: 'ssh',
                ref: 'dsh-ssh:local',
                label: t('mention.localChip'),
                appearance: 'session',
                clipboardText: mentionText(t('mention.localChip'), 'local'),
              },
            }
          }
          if (value?.kind !== 'server' || typeof value.id !== 'string') return undefined
          const label = typeof value.name === 'string' && value.name.length > 0 ? value.name : value.id
          return {
            insert: {
              source: 'ssh',
              ref: `dsh-ssh:${value.id}`,
              label,
              appearance: 'session',
              clipboardText: mentionText(label, value.id),
            },
          }
        },
        codec: {
          clipboardText(ref) {
            const id = mentionIdOf(ref)
            if (id === 'local') return mentionText(t('mention.localChip'), 'local')
            return mentionText(mentionNames.get(id) ?? id, id)
          },
          async serialize(ref) {
            const id = mentionIdOf(ref)
            if (id === 'local') return mentionText(t('mention.localChip'), 'local')
            let name = mentionNames.get(id)
            if (name === undefined) {
              try {
                const servers = await readMentionServers()
                for (const server of servers) mentionNames.set(server.id, server.name)
                name = mentionNames.get(id)
              } catch {
                /* fall back to the id */
              }
            }
            return mentionText(name ?? id, id)
          },
        },
      }
    }

    /** Build the page component around the services it needs. */
    function createPage(ctx) {
      const t = ctx.locale.bind(NS)

      return function SshManagerPage() {
        React.useSyncExternalStore(
          React.useCallback((listener) => ctx.locale.subscribe(listener), []),
          React.useCallback(() => ctx.locale.getSnapshot(), []),
        )
        const [servers, setServers] = React.useState([])
        const [phase, setPhase] = React.useState('loading')
        const [notice, setNotice] = React.useState(null)
        const [form, setForm] = React.useState(null)
        const [formError, setFormError] = React.useState('')
        const [saving, setSaving] = React.useState(false)
        const [testingId, setTestingId] = React.useState(null)
        const [testResults, setTestResults] = React.useState({})
        const [confirmId, setConfirmId] = React.useState(null)
        const noticeTimer = React.useRef(null)

        const flash = React.useCallback((kind, text) => {
          setNotice({ kind, text })
          if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
          noticeTimer.current = setTimeout(() => {
            noticeTimer.current = null
            setNotice(null)
          }, 5000)
        }, [])

        const load = React.useCallback(() => {
          setPhase('loading')
          readServers().then((payload) => {
            setServers(Array.isArray(payload.servers) ? payload.servers : [])
            setPhase('ready')
          }).catch((error) => {
            setPhase('error')
            setNotice({ kind: 'error', text: `${t('loadError')}: ${String(error.message ?? error)}` })
          })
        }, [t])

        React.useEffect(() => {
          load()
          return () => {
            if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
          }
        }, [load])

        const blankForm = () => ({
          mode: 'create',
          id: '',
          name: '',
          host: '',
          port: '22',
          username: 'root',
          auth: 'password',
          keyPath: '',
          proxyJump: '',
          description: '',
          password: '',
          passphrase: '',
          clearPassword: false,
          clearPassphrase: false,
          hasPassword: false,
          hasPassphrase: false,
        })

        const editFormOf = (server) => ({
          mode: 'edit',
          id: server.id,
          name: server.name,
          host: server.host,
          port: String(server.port),
          username: server.username,
          auth: server.auth,
          keyPath: server.keyPath ?? '',
          proxyJump: server.proxyJump ?? '',
          description: server.description ?? '',
          password: '',
          passphrase: '',
          clearPassword: false,
          clearPassphrase: false,
          hasPassword: server.hasPassword === true,
          hasPassphrase: server.hasPassphrase === true,
        })

        const update = (field, value) => {
          setForm((current) => current === null ? current : { ...current, [field]: value })
        }

        const openCreate = () => {
          setFormError('')
          setConfirmId(null)
          setForm(blankForm())
        }

        const openEdit = (server) => {
          setFormError('')
          setConfirmId(null)
          setForm(editFormOf(server))
        }

        const submitForm = () => {
          if (form === null) return
          const name = form.name.trim()
          const host = form.host.trim()
          const username = form.username.trim()
          if (name === '' || host === '' || username === '') {
            setFormError(t('formInvalid'))
            return
          }
          const port = Number(form.port)
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            setFormError(t('invalidPort'))
            return
          }
          if (form.mode === 'create' && servers.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
            setFormError(t('duplicateName'))
            return
          }
          const server = {
            name,
            host,
            port,
            username,
            auth: form.auth,
            keyPath: form.keyPath.trim(),
            proxyJump: form.proxyJump.trim(),
            description: form.description.trim(),
          }
          if (form.mode === 'edit') server.id = form.id
          if (form.auth === 'password') {
            if (form.clearPassword) server.password = ''
            else if (form.password.length > 0) server.password = form.password
          }
          if (form.auth === 'key') {
            if (form.clearPassphrase) server.passphrase = ''
            else if (form.passphrase.length > 0) server.passphrase = form.passphrase
          }
          setSaving(true)
          setFormError('')
          postOperation({ op: 'save', server }).then((payload) => {
            const saved = payload.server
            setServers((previous) => {
              const index = previous.findIndex((entry) => entry.id === saved.id)
              if (index === -1) return [...previous, saved]
              const next = previous.slice()
              next[index] = saved
              return next
            })
            invalidateMentionCache()
            setForm(null)
            setPhase('ready')
            flash('ok', t('saved'))
          }).catch((error) => {
            setFormError(String(error.message ?? error))
          }).finally(() => setSaving(false))
        }

        const removeServer = (server) => {
          postOperation({ op: 'delete', id: server.id }).then(() => {
            setServers((previous) => previous.filter((entry) => entry.id !== server.id))
            invalidateMentionCache()
            setConfirmId(null)
            flash('ok', t('removed'))
          }).catch((error) => {
            flash('error', `${t('saveError')}: ${String(error.message ?? error)}`)
          })
        }

        const testServer = (server) => {
          setTestingId(server.id)
          setConfirmId(null)
          postOperation({ op: 'test', id: server.id }).then((payload) => {
            setTestResults((previous) => ({
              ...previous,
              [server.id]: {
                kind: 'ok',
                text: [
                  payload.hostname,
                  payload.user,
                  payload.system,
                  `${payload.latencyMs} ms`,
                ].filter((part) => typeof part === 'string' && part.length > 0).join(' · '),
              },
            }))
            flash('ok', t('testOk'))
          }).catch((error) => {
            setTestResults((previous) => ({
              ...previous,
              [server.id]: { kind: 'error', text: String(error.message ?? error) },
            }))
          }).finally(() => setTestingId(null))
        }

        const authLabel = (auth) => {
          if (auth === 'key') return t('authKey')
          if (auth === 'agent') return t('authAgent')
          return t('authPassword')
        }

        const renderForm = () => {
          if (form === null) return null
          const wide = (key, label, input, hint) => h('div', { key, className: 'dsh-ssh2-field is-wide' },
            h('label', { className: 'dsh-ssh2-label', htmlFor: `dsh-ssh2-${key}` }, label),
            input,
            hint === undefined || hint === null || hint === '' ? null : h('span', { className: 'dsh-ssh2-hint' }, hint),
          )
          const field = (key, label, input, hint) => h('div', { key, className: 'dsh-ssh2-field' },
            h('label', { className: 'dsh-ssh2-label', htmlFor: `dsh-ssh2-${key}` }, label),
            input,
            hint === undefined || hint === null || hint === '' ? null : h('span', { className: 'dsh-ssh2-hint' }, hint),
          )
          const input = (key, value, placeholder, options) => h('input', {
            id: `dsh-ssh2-${key}`,
            className: 'dsh-ssh2-input',
            value,
            placeholder,
            spellCheck: false,
            autoComplete: 'off',
            onChange: (event) => update(key, event.target.value),
            ...(options ?? {}),
          })
          const children = [
            h('h3', { key: 'title', className: 'dsh-ssh2-form-title' }, form.mode === 'edit' ? t('editorEdit') : t('editorNew')),
            h('div', { key: 'grid', className: 'dsh-ssh2-grid' },
              field('name', t('fieldName'), input('name', form.name, t('placeholderName'))),
              field('host', t('fieldHost'), input('host', form.host, t('placeholderHost'))),
              field('port', t('fieldPort'), input('port', form.port, '22', { type: 'number', min: 1, max: 65535 })),
              field('username', t('fieldUsername'), input('username', form.username, 'root')),
              field('auth', t('fieldAuth'), h('select', {
                id: 'dsh-ssh2-auth',
                className: 'dsh-ssh2-select',
                value: form.auth,
                onChange: (event) => update('auth', event.target.value),
              },
                h('option', { value: 'password' }, t('authPassword')),
                h('option', { value: 'key' }, t('authKey')),
                h('option', { value: 'agent' }, t('authAgent')),
              )),
              form.auth === 'key'
                ? field('keyPath', t('fieldKeyPath'), input('keyPath', form.keyPath, t('placeholderKeyPath')), t('keyPathHint'))
                : null,
              form.auth === 'password'
                ? wide('password', t('fieldPassword'),
                    h('input', {
                      id: 'dsh-ssh2-password',
                      className: 'dsh-ssh2-input',
                      type: 'password',
                      value: form.password,
                      placeholder: form.mode === 'edit' ? t('placeholderPassword') : '',
                      autoComplete: 'new-password',
                      spellCheck: false,
                      disabled: form.clearPassword,
                      onChange: (event) => update('password', event.target.value),
                    }),
                    h('span', { className: form.hasPassword ? 'dsh-ssh2-hint' : 'dsh-ssh2-hint is-warn' },
                      form.hasPassword ? t('passwordStored') : t('passwordMissing'),
                      ' ',
                      t('passwordHint'),
                    ),
                  )
                : null,
              form.auth === 'password' && form.mode === 'edit' && form.hasPassword
                ? h('div', { key: 'clearPassword', className: 'dsh-ssh2-field is-wide' },
                    h('button', {
                      type: 'button',
                      className: 'dsh-ssh2-link',
                      onClick: () => update('clearPassword', !form.clearPassword),
                    }, form.clearPassword ? t('undoClear') : t('clearSecret')),
                    form.clearPassword ? h('span', { className: 'dsh-ssh2-hint is-warn' }, t('willClear')) : null,
                  )
                : null,
              form.auth === 'key'
                ? wide('passphrase', t('fieldPassphrase'),
                    h('input', {
                      id: 'dsh-ssh2-passphrase',
                      className: 'dsh-ssh2-input',
                      type: 'password',
                      value: form.passphrase,
                      placeholder: form.mode === 'edit' ? t('placeholderPassphrase') : t('placeholderPassphrase'),
                      autoComplete: 'new-password',
                      spellCheck: false,
                      disabled: form.clearPassphrase,
                      onChange: (event) => update('passphrase', event.target.value),
                    }),
                    h('span', { className: form.hasPassphrase ? 'dsh-ssh2-hint' : 'dsh-ssh2-hint' },
                      form.hasPassphrase ? t('passphraseStored') : t('passphraseMissing'),
                      ' ',
                      t('passphraseHint'),
                    ),
                  )
                : null,
              form.auth === 'key' && form.mode === 'edit' && form.hasPassphrase
                ? h('div', { key: 'clearPassphrase', className: 'dsh-ssh2-field is-wide' },
                    h('button', {
                      type: 'button',
                      className: 'dsh-ssh2-link',
                      onClick: () => update('clearPassphrase', !form.clearPassphrase),
                    }, form.clearPassphrase ? t('undoClear') : t('clearSecret')),
                    form.clearPassphrase ? h('span', { className: 'dsh-ssh2-hint is-warn' }, t('willClear')) : null,
                  )
                : null,
              wide('proxyJump', t('fieldProxyJump'), input('proxyJump', form.proxyJump, t('placeholderProxyJump')), t('proxyJumpHint')),
              wide('description', t('fieldDescription'),
                h('textarea', {
                  id: 'dsh-ssh2-description',
                  className: 'dsh-ssh2-textarea',
                  value: form.description,
                  placeholder: t('placeholderDescription'),
                  onChange: (event) => update('description', event.target.value),
                })),
            ),
            formError === '' ? null : h('div', { key: 'error', className: 'dsh-ssh2-form-error', role: 'alert' }, formError),
            h('div', { key: 'actions', className: 'dsh-ssh2-actions' },
              h('button', {
                type: 'button',
                className: 'dsh-ssh2-button is-primary',
                disabled: saving,
                onClick: submitForm,
              }, saving ? t('saving') : t('save')),
              h('button', {
                type: 'button',
                className: 'dsh-ssh2-button',
                disabled: saving,
                onClick: () => {
                  setForm(null)
                  setFormError('')
                },
              }, t('cancel')),
            ),
          ]
          return h('div', { className: 'dsh-ssh2-form' }, ...children)
        }

        const renderServer = (server) => {
          const test = testResults[server.id]
          const isTesting = testingId === server.id
          const confirm = confirmId === server.id
          const tests = [
            test === undefined
              ? null
              : h('div', {
                  key: 'test',
                  className: test.kind === 'error' ? 'dsh-ssh2-test is-error' : 'dsh-ssh2-test is-ok',
                  role: 'status',
                }, test.text),
          ]
          return h('div', { key: server.id, className: 'dsh-ssh2-card' },
            h('div', { className: 'dsh-ssh2-card-main' },
              h('div', { className: 'dsh-ssh2-card-head' },
                h('span', { className: 'dsh-ssh2-name' }, server.name),
                h('span', { className: 'dsh-ssh2-badge' }, authLabel(server.auth)),
                server.auth === 'password' && server.hasPassword !== true
                  ? h('span', { className: 'dsh-ssh2-badge is-warn' }, t('noPassword'))
                  : null,
              ),
              h('div', { className: 'dsh-ssh2-meta' }, `${server.username}@${server.host}:${server.port}${server.proxyJump.length > 0 ? ` · ${t('fieldProxyJump')} ${server.proxyJump}` : ''}`),
              server.description.length > 0 ? h('p', { className: 'dsh-ssh2-desc' }, server.description) : null,
              ...tests,
            ),
            h('div', { className: 'dsh-ssh2-card-actions' },
              h('button', {
                type: 'button',
                className: 'dsh-ssh2-button is-small',
                disabled: isTesting,
                onClick: () => testServer(server),
              }, isTesting ? t('testing') : t('test')),
              h('button', {
                type: 'button',
                className: 'dsh-ssh2-button is-small',
                onClick: () => openEdit(server),
              }, t('edit')),
              confirm
                ? h('button', {
                    type: 'button',
                    className: 'dsh-ssh2-button is-small is-danger',
                    onClick: () => removeServer(server),
                  }, t('confirmDelete'))
                : h('button', {
                    type: 'button',
                    className: 'dsh-ssh2-button is-small is-danger',
                    onClick: () => setConfirmId(server.id),
                  }, t('delete')),
              confirm
                ? h('button', {
                    type: 'button',
                    className: 'dsh-ssh2-button is-small',
                    onClick: () => setConfirmId(null),
                  }, t('cancel'))
                : null,
            ),
          )
        }

        const children = [
          h('style', { key: 'style' }, CSS),
          h('h2', { key: 'title', className: 'dsh-ssh2-title' }, t('title')),
          h('p', { key: 'description', className: 'dsh-ssh2-description' }, t('description')),
          h('div', { key: 'toolbar', className: 'dsh-ssh2-toolbar' },
            h('button', {
              type: 'button',
              className: 'dsh-ssh2-button is-primary',
              disabled: form !== null,
              onClick: openCreate,
            }, servers.length === 0 ? t('addFirst') : t('add')),
            phase === 'ready' ? h('span', { className: 'dsh-ssh2-count' }, `${servers.length} ${t('countUnit')}`) : null,
          ),
        ]

        if (phase === 'error') {
          children.push(h('div', { key: 'error', className: 'dsh-ssh2-error-box' },
            h('span', null, notice !== null ? notice.text : t('loadError')),
            h('button', { type: 'button', className: 'dsh-ssh2-button', onClick: load }, t('retry')),
          ))
        }

        const formNode = renderForm()
        if (formNode !== null) children.push(h('div', { key: 'form-wrap' }, formNode))

        if (phase === 'loading') {
          children.push(h('p', { key: 'loading', className: 'dsh-ssh2-muted' }, t('loading')))
        } else if (phase === 'ready' && servers.length === 0) {
          children.push(h('div', { key: 'empty', className: 'dsh-ssh2-empty' },
            h('p', { className: 'dsh-ssh2-empty-title' }, t('empty')),
            h('p', { className: 'dsh-ssh2-empty-hint' }, t('emptyHint')),
          ))
        } else if (phase === 'ready') {
          children.push(h('div', { key: 'servers', className: 'dsh-ssh2-list' }, ...servers.map(renderServer)))
        }

        children.push(h('p', { key: 'footnote', className: 'dsh-ssh2-footnote' }, t('footnote')))

        if (notice !== null && notice.kind === 'ok') {
          children.push(h('div', {
            key: 'notice',
            className: 'dsh-ssh2-notice is-ok',
            role: 'status',
          }, notice.text))
        } else if (notice !== null && notice.kind === 'error' && phase === 'ready') {
          children.push(h('div', {
            key: 'notice',
            className: 'dsh-ssh2-notice is-error',
            role: 'status',
          }, notice.text))
        }

        return h('div', { className: 'dsh-ssh2' }, ...children)
      }
    }

    return {
      inject: ['slots', 'locale', 'inputTriggers', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, 'en', LOCALE_DICTS.en),
            ctx.locale.register(NS, 'zh', LOCALE_DICTS.zh),
          ]
          return () => {
            for (const dispose of disposers) dispose()
          }
        }, 'ssh-manager: locale dictionaries')

        const t = ctx.locale.bind(NS)

        // The `@` menu source: its rows appear under their own section in the
        // shared completion menu, and a pick inserts an atomic SSH chip.
        ctx.effect(() => {
          const inputTriggers = ctx.get('inputTriggers')
          if (inputTriggers === undefined) return undefined
          return inputTriggers.registerSource(createSshSource(t))
        }, 'ssh-manager: @ source')

        // Sent mentions render as an SSH chip instead of falling through to
        // the generic file-reference rule.
        ctx.uiConversation.userText.register(SSH_MENTION_RULE)
        ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
          name: 'conversation.user.text.node',
          key: 'ssh',
          priority: 100,
          locale: NS,
        }, SshMentionChip))

        const Page = createPage(ctx)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'ssh-manager',
          order: 30,
          label: () => t('nav'),
        }, Page))
      },
    }
  },
})
