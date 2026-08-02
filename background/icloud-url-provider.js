(function attachIcloudUrlProvider(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.MultiPageIcloudUrlProvider = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createIcloudUrlProviderModule() {
  const DEFAULT_MAX_ATTEMPTS = 5;
  const DEFAULT_INTERVAL_MS = 3000;
  const DEFAULT_TIMEOUT_MS = 15000;

  function normalizeCode(value = '') {
    const code = String(value || '').trim();
    return /^\d{6}$/.test(code) ? code : '';
  }

  function findExplicitCode(node, depth = 0) {
    if (!node || depth > 6) return '';
    if (Array.isArray(node)) {
      for (const item of node) {
        const code = findExplicitCode(item, depth + 1);
        if (code) return code;
      }
      return '';
    }
    if (typeof node !== 'object') return '';

    for (const key of ['code', 'verificationCode', 'verification_code', 'otp']) {
      const code = normalizeCode(node[key]);
      if (code) return code;
    }
    for (const value of Object.values(node)) {
      const code = findExplicitCode(value, depth + 1);
      if (code) return code;
    }
    return '';
  }

  function collectSearchTexts(node, results = [], depth = 0) {
    if (node === null || node === undefined || depth > 7) return results;
    if (typeof node === 'string' || typeof node === 'number') {
      const text = String(node).trim();
      if (text) results.push(text);
      return results;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => collectSearchTexts(item, results, depth + 1));
      return results;
    }
    if (typeof node === 'object') {
      Object.values(node).forEach((value) => collectSearchTexts(value, results, depth + 1));
    }
    return results;
  }

  function extractCodeByRulePatterns(text, patterns = []) {
    for (const pattern of (Array.isArray(patterns) ? patterns : [])) {
      try {
        const source = String(pattern?.source || '').trim();
        if (!source) continue;
        const flags = String(pattern?.flags || '').replace(/[^dgimsuvy]/g, '');
        const match = String(text || '').match(new RegExp(source, flags));
        if (!match) continue;
        for (let index = 1; index < match.length; index += 1) {
          const candidate = normalizeCode(match[index]);
          if (candidate) return candidate;
        }
        const candidate = normalizeCode(match[0]);
        if (candidate) return candidate;
      } catch {
        // Ignore invalid runtime patterns and continue with other rules.
      }
    }
    return '';
  }

  function extractCodeFromText(text, codePatterns = []) {
    const source = String(text || '');
    const matchedByRule = extractCodeByRulePatterns(source, codePatterns);
    if (matchedByRule) return matchedByRule;

    const patterns = [
      /(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/i,
      /(?:log-?in\s+code|enter\s+this\s+code)[^0-9]{0,24}(\d{6})/i,
      /code(?:\s+is)?[\s：:]+(\d{6})/i,
      /\b(\d{6})\b/,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return match[1];
    }
    return '';
  }

  function extractVerificationCodeFromIcloudUrlPayload(payload, options = {}) {
    const excludedCodes = new Set(
      (Array.isArray(options.excludeCodes) ? options.excludeCodes : [])
        .map((code) => normalizeCode(code))
        .filter(Boolean)
    );

    const explicitCode = findExplicitCode(payload);
    if (explicitCode && !excludedCodes.has(explicitCode)) {
      return { code: explicitCode, mailId: '' };
    }

    const texts = collectSearchTexts(payload);
    for (const text of texts) {
      const code = extractCodeFromText(text, options.codePatterns);
      if (code && !excludedCodes.has(code)) {
        return { code, mailId: '' };
      }
    }
    return null;
  }

  function resolveActiveEntry(state = {}) {
    if (state?.activeMixedMailboxEntry?.type === 'icloud-url') {
      return state.activeMixedMailboxEntry;
    }
    const activeId = String(state?.activeMixedMailboxEntryId || '').trim();
    return (Array.isArray(state?.mixedMailboxQueueEntries) ? state.mixedMailboxQueueEntries : [])
      .find((entry) => entry?.type === 'icloud-url' && String(entry?.id || '') === activeId) || null;
  }

  function getCredentialUrl(entry = {}) {
    const explicitUrl = String(entry?.url || '').trim();
    if (explicitUrl) return explicitUrl;
    const credential = String(entry?.credential || '').trim();
    const separatorIndex = credential.indexOf('----');
    return separatorIndex >= 0 ? credential.slice(separatorIndex + 4).trim() : '';
  }

  async function parseResponsePayload(response) {
    const text = await response.text();
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('json') || /^[\s]*[\[{]/.test(text)) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  function createIcloudUrlProvider(deps = {}) {
    const fetchImpl = deps.fetchImpl || globalThis.fetch;
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const throwIfStopped = deps.throwIfStopped || (() => {});
    const addLog = deps.addLog || (async () => {});

    async function requestMailbox(url, timeoutMs) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS))
        : null;
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller?.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return await parseResponsePayload(response);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('iCloud URL 请求超时。');
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function pollVerificationCode(step, state, pollPayload = {}) {
      const entry = resolveActiveEntry(state);
      const url = getCredentialUrl(entry);
      if (!entry || !url) {
        throw new Error('当前 iCloud URL 邮箱缺少有效取信凭据。');
      }

      const maxAttempts = Math.max(1, Number(pollPayload.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
      const intervalMs = Math.max(0, Number(pollPayload.intervalMs) || DEFAULT_INTERVAL_MS);
      const timeoutMs = Math.max(1000, Number(pollPayload.requestTimeoutMs) || DEFAULT_TIMEOUT_MS);
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfStopped();
        try {
          await addLog(`步骤 ${step}：正在通过 iCloud URL 获取 ${entry.email} 的验证码（${attempt}/${maxAttempts}）...`, 'info');
          const payload = await requestMailbox(url, timeoutMs);
          const match = extractVerificationCodeFromIcloudUrlPayload(payload, {
            codePatterns: pollPayload.codePatterns || [],
            excludeCodes: pollPayload.excludeCodes || [],
            targetEmail: pollPayload.targetEmail || entry.email,
          });
          if (match?.code) {
            await addLog(`步骤 ${step}：已通过 iCloud URL 找到验证码。`, 'ok');
            return {
              ok: true,
              code: match.code,
              emailTimestamp: Date.now(),
              mailId: match.mailId || '',
            };
          }
          lastError = new Error(`步骤 ${step}：iCloud URL 暂未返回验证码（${attempt}/${maxAttempts}）。`);
        } catch (error) {
          lastError = error;
          await addLog(`步骤 ${step}：iCloud URL 查询失败：${String(error?.message || error)}`, 'warn');
        }

        if (attempt < maxAttempts) {
          await sleep(intervalMs);
        }
      }

      throw lastError || new Error(`步骤 ${step}：iCloud URL 未返回验证码。`);
    }

    return { pollVerificationCode };
  }

  return {
    createIcloudUrlProvider,
    extractVerificationCodeFromIcloudUrlPayload,
  };
});
