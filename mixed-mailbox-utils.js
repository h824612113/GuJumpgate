(function attachMixedMailboxUtils(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.MixedMailboxUtils = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createMixedMailboxUtils() {
  const OUTLOOK_TYPE = 'outlook';
  const ICLOUD_URL_TYPE = 'icloud-url';
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ICLOUD_URL_RULES = [
    { protocol: 'https:', hostname: 'icloud-api.top', pathPrefix: 'show' },
    { protocol: 'http:', hostname: 'yangyang.website', pathPrefix: 'messages' },
  ];

  function normalizeEmail(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function validateIcloudUrl(rawUrl, email) {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || '').trim());
    } catch {
      return { ok: false, error: 'iCloud URL 格式无效。' };
    }

    if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
      return { ok: false, error: 'iCloud URL 不能包含登录信息、端口、查询参数或片段。' };
    }

    const rule = ICLOUD_URL_RULES.find((candidate) => (
      parsed.protocol === candidate.protocol
      && parsed.hostname.toLowerCase() === candidate.hostname
    ));
    if (!rule) {
      return { ok: false, error: 'iCloud URL 不在允许的协议和主机白名单中。' };
    }
    const pathSegments = parsed.pathname.split('/').slice(1);
    if (
      pathSegments.length !== 3
      || pathSegments[0] !== rule.pathPrefix
      || !pathSegments[1]
      || !pathSegments[2]
    ) {
      return { ok: false, error: 'iCloud URL 缺少有效取信令牌。' };
    }
    let pathEmail = '';
    try {
      pathEmail = normalizeEmail(decodeURIComponent(pathSegments[2]));
    } catch {
      return { ok: false, error: 'iCloud URL 尾部邮箱格式无效。' };
    }
    if (pathEmail !== email) {
      return { ok: false, error: 'iCloud URL 尾部邮箱与导入邮箱不一致。' };
    }

    return { ok: true, url: parsed.toString() };
  }

  function isYangyangContinuationStart(line) {
    const raw = String(line || '').trim();
    const separatorIndex = raw.indexOf('----');
    if (separatorIndex < 0) return false;
    const credentialPart = raw.slice(separatorIndex + 4).trim();
    try {
      const parsed = new URL(credentialPart);
      return parsed.protocol === 'http:'
        && parsed.hostname.toLowerCase() === 'yangyang.website'
        && !parsed.username
        && !parsed.password
        && !parsed.port
        && !parsed.search
        && !parsed.hash
        && parsed.pathname === '/messages/';
    } catch {
      return false;
    }
  }

  function isValidYangyangContinuation(value) {
    const continuation = String(value || '').trim();
    if (!continuation || continuation.includes('----') || /^https?:\/\//i.test(continuation)) {
      return false;
    }
    const segments = continuation.split('/');
    return segments.length === 2 && segments.every(Boolean);
  }

  function parseMixedMailboxLine(line, lineNumber) {
    const raw = String(line || '').trim();
    const separatorIndex = raw.indexOf('----');
    if (separatorIndex < 0) {
      return { error: { lineNumber, message: '无法识别邮箱格式。' } };
    }

    const email = normalizeEmail(raw.slice(0, separatorIndex));
    const credentialPart = raw.slice(separatorIndex + 4).trim();
    if (!EMAIL_PATTERN.test(email)) {
      return { error: { lineNumber, message: '邮箱地址格式无效。' } };
    }

    if (/^https?:\/\//i.test(credentialPart)) {
      const validation = validateIcloudUrl(credentialPart, email);
      if (!validation.ok) {
        return { error: { lineNumber, message: validation.error } };
      }
      return {
        record: {
          type: ICLOUD_URL_TYPE,
          email,
          credential: `${email}----${validation.url}`,
          url: validation.url,
        },
      };
    }

    const parts = raw.split('----').map((part) => part.trim());
    if (parts.length !== 4 || parts.some((part) => !part)) {
      return { error: { lineNumber, message: 'Outlook 格式必须为邮箱----密码----客户端ID----刷新令牌。' } };
    }

    return {
      record: {
        type: OUTLOOK_TYPE,
        email,
        password: parts[1],
        clientId: parts[2],
        refreshToken: parts[3],
      },
    };
  }

  function parseMixedMailboxImport(value = '') {
    const records = [];
    const errors = [];
    let ignoredCount = 0;
    const lines = String(value || '').split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = String(line || '').trim();
      if (!trimmed) {
        ignoredCount += 1;
        continue;
      }
      if (/^(?:账号|邮箱)----(?:密码|取信URL)/i.test(trimmed)) {
        ignoredCount += 1;
        continue;
      }

      if (isYangyangContinuationStart(trimmed)) {
        const startLineNumber = index + 1;
        let continuationIndex = index + 1;
        while (continuationIndex < lines.length && !String(lines[continuationIndex] || '').trim()) {
          ignoredCount += 1;
          continuationIndex += 1;
        }

        if (continuationIndex >= lines.length) {
          errors.push({ lineNumber: startLineNumber, message: 'iCloud URL 缺少下一行取信令牌和邮箱。' });
          continue;
        }

        const continuation = String(lines[continuationIndex] || '').trim();
        index = continuationIndex;
        if (!isValidYangyangContinuation(continuation)) {
          errors.push({ lineNumber: startLineNumber, message: 'iCloud URL 续行必须为令牌/邮箱。' });
          continue;
        }

        const result = parseMixedMailboxLine(`${trimmed}${continuation}`, startLineNumber);
        if (result.record) records.push(result.record);
        if (result.error) errors.push(result.error);
        continue;
      }

      const result = parseMixedMailboxLine(trimmed, index + 1);
      if (result.record) records.push(result.record);
      if (result.error) errors.push(result.error);
    }

    return { records, errors, ignoredCount };
  }

  function createQueueEntryId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `mixed-mailbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeMixedMailboxQueueEntry(rawEntry = {}) {
    const type = String(rawEntry?.type || '').trim().toLowerCase();
    const email = normalizeEmail(rawEntry?.email);
    if (![OUTLOOK_TYPE, ICLOUD_URL_TYPE].includes(type) || !EMAIL_PATTERN.test(email)) {
      return null;
    }

    const entry = {
      id: String(rawEntry?.id || createQueueEntryId()),
      type,
      email,
      enabled: rawEntry?.enabled !== undefined ? Boolean(rawEntry.enabled) : true,
      used: Boolean(rawEntry?.used),
      lastError: String(rawEntry?.lastError || '').trim(),
      lastUsedAt: Number.isFinite(Number(rawEntry?.lastUsedAt)) ? Number(rawEntry.lastUsedAt) : 0,
    };

    if (type === OUTLOOK_TYPE) {
      entry.hotmailAccountId = String(rawEntry?.hotmailAccountId || '').trim();
    } else {
      const credential = String(rawEntry?.credential || '').trim();
      const parsedCredential = parseMixedMailboxLine(credential, 0);
      if (!parsedCredential.record || parsedCredential.record.type !== ICLOUD_URL_TYPE) {
        return null;
      }
      entry.credential = parsedCredential.record.credential;
      entry.url = parsedCredential.record.url;
    }

    return entry;
  }

  function normalizeMixedMailboxQueueEntries(value = []) {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set();
    const entries = [];
    for (const rawEntry of source) {
      const entry = normalizeMixedMailboxQueueEntry(rawEntry);
      if (!entry) continue;
      const key = `${entry.type}:${entry.email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
    return entries;
  }

  function mergeMixedMailboxQueueEntries(existingEntries = [], importedRecords = []) {
    const entries = normalizeMixedMailboxQueueEntries(existingEntries);
    const entryIndexByKey = new Map(
      entries.map((entry, index) => [`${entry.type}:${entry.email}`, index])
    );
    let addedCount = 0;
    let updatedCount = 0;

    for (const rawRecord of (Array.isArray(importedRecords) ? importedRecords : [])) {
      const record = normalizeMixedMailboxQueueEntry(rawRecord);
      if (!record) continue;
      const key = `${record.type}:${record.email}`;
      const existingIndex = entryIndexByKey.get(key);
      if (existingIndex === undefined) {
        entries.push(record);
        entryIndexByKey.set(key, entries.length - 1);
        addedCount += 1;
        continue;
      }

      const existing = entries[existingIndex];
      entries[existingIndex] = {
        ...existing,
        ...(record.type === OUTLOOK_TYPE
          ? { hotmailAccountId: record.hotmailAccountId || existing.hotmailAccountId || '' }
          : { credential: record.credential, url: record.url }),
        lastError: '',
      };
      updatedCount += 1;
    }

    return { entries, addedCount, updatedCount };
  }

  function getNextMixedMailboxQueueEntry(entries = []) {
    return normalizeMixedMailboxQueueEntries(entries)
      .find((entry) => entry.enabled && !entry.used) || null;
  }

  function redactMixedMailboxSecret(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const separatorIndex = raw.indexOf('----');
    const urlValue = separatorIndex >= 0 ? raw.slice(separatorIndex + 4) : raw;
    try {
      const parsed = new URL(urlValue);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const emailSegment = segments.pop() || '';
      parsed.pathname = `/${segments[0] || 'show'}/***/${emailSegment}`;
      parsed.search = '';
      parsed.hash = '';
      const prefix = separatorIndex >= 0 ? `${normalizeEmail(raw.slice(0, separatorIndex))}----` : '';
      return `${prefix}${parsed.toString()}`;
    } catch {
      return '[已隐藏]';
    }
  }

  function sanitizeMixedMailboxStateForLog(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const sanitized = { ...value };
    if (Array.isArray(value.hotmailAccounts)) {
      sanitized.hotmailAccounts = value.hotmailAccounts.map((account = {}) => {
        const {
          password: _password,
          clientId: _clientId,
          refreshToken: _refreshToken,
          ...safeAccount
        } = account;
        return safeAccount;
      });
    }
    if (Array.isArray(value.mixedMailboxQueueEntries)) {
      sanitized.mixedMailboxQueueEntries = value.mixedMailboxQueueEntries.map((entry = {}) => {
        const {
          credential: _credential,
          url: _url,
          ...safeEntry
        } = entry;
        return safeEntry;
      });
    }
    return sanitized;
  }

  function resolveMixedMailboxProvider(entry = {}) {
    const type = String(entry?.type || '').trim().toLowerCase();
    if (type === OUTLOOK_TYPE) return 'hotmail-api';
    if (type === ICLOUD_URL_TYPE) return ICLOUD_URL_TYPE;
    return '';
  }

  return {
    ICLOUD_URL_TYPE,
    OUTLOOK_TYPE,
    getNextMixedMailboxQueueEntry,
    mergeMixedMailboxQueueEntries,
    normalizeMixedMailboxQueueEntries,
    parseMixedMailboxImport,
    redactMixedMailboxSecret,
    resolveMixedMailboxProvider,
    sanitizeMixedMailboxStateForLog,
  };
});
