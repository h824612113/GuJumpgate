(function attachSessionExportConfigs(root, factory) {
  root.MultiPageSessionExportConfigs = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createSessionExportConfigsModule() {
  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function firstNonEmpty() {
    for (const value of arguments) {
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
    return undefined;
  }

  function decodeBase64Url(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded, 'base64').toString('utf8');
    }
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function bytesToBase64Url(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function encodeBase64UrlJson(value) {
    const json = JSON.stringify(value);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }
    return bytesToBase64Url(new TextEncoder().encode(json));
  }

  function parseJwtPayload(token) {
    if (typeof token !== 'string' || token.trim() === '') {
      return undefined;
    }

    const segments = token.split('.');
    if (segments.length < 2) {
      return undefined;
    }

    try {
      return JSON.parse(decodeBase64Url(segments[1]));
    } catch {
      return undefined;
    }
  }

  function getOpenAIAuthSection(payload) {
    if (!isPlainObject(payload)) {
      return {};
    }
    const auth = payload['https://api.openai.com/auth'];
    return isPlainObject(auth) ? auth : {};
  }

  function getOpenAIProfileSection(payload) {
    if (!isPlainObject(payload)) {
      return {};
    }
    const profile = payload['https://api.openai.com/profile'];
    return isPlainObject(profile) ? profile : {};
  }

  function normalizeTimestamp(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const milliseconds = value > 1e11 ? value : value * 1000;
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  function timestampFromUnixSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }
    const date = new Date(numeric * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  function epochSecondsFromValue(value) {
    if (value === undefined || value === null || value === '') {
      return 0;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
    }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
  }

  function buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt) {
    if (!accountId) {
      return undefined;
    }

    const now = Math.trunc(Date.now() / 1000);
    const authInfo = { chatgpt_account_id: accountId };
    const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;

    if (planType) {
      authInfo.chatgpt_plan_type = planType;
    }
    if (userId) {
      authInfo.chatgpt_user_id = userId;
      authInfo.user_id = userId;
    }

    const payload = {
      iat: now,
      exp: expires,
      'https://api.openai.com/auth': authInfo,
    };
    if (email) {
      payload.email = email;
    }

    return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT', cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.`;
  }

  function getExpiresIn(expiresAt, now) {
    if (!expiresAt) {
      return undefined;
    }
    const expiresMs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresMs)) {
      return undefined;
    }
    return Math.max(0, Math.floor((expiresMs - now.getTime()) / 1000));
  }

  function stripUnavailable(value) {
    if (Array.isArray(value)) {
      return value.map(stripUnavailable).filter((item) => item !== undefined);
    }

    if (isPlainObject(value)) {
      const entries = Object.entries(value)
        .map(([key, item]) => [key, stripUnavailable(item)])
        .filter(([, item]) => item !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }

    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return value;
  }

  function toEmailKey(email) {
    if (typeof email !== 'string') {
      return undefined;
    }

    return email
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function sanitizeFileToken(value, fallback) {
    const base = firstNonEmpty(value, fallback) || fallback;
    return base
      .replace(/\.[^.]+$/u, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80) || fallback;
  }

  function convertSession(record, options = {}) {
    if (!isPlainObject(record)) {
      throw new Error('session is not a JSON object');
    }

    const accessToken = firstNonEmpty(
      record.accessToken,
      record.access_token,
      record.token?.accessToken,
      record.token?.access_token,
      record.credentials?.accessToken,
      record.credentials?.access_token,
      record.authSession?.accessToken,
      record.authSession?.access_token
    );
    if (!accessToken) {
      throw new Error('missing accessToken');
    }

    const sessionToken = firstNonEmpty(
      record.sessionToken,
      record.session_token,
      record.token?.sessionToken,
      record.token?.session_token,
      record.credentials?.session_token,
      record.authSession?.sessionToken,
      record.authSession?.session_token
    );
    const refreshToken = firstNonEmpty(
      record.refreshToken,
      record.refresh_token,
      record.token?.refreshToken,
      record.token?.refresh_token,
      record.credentials?.refresh_token,
      record.authSession?.refreshToken,
      record.authSession?.refresh_token
    );
    const inputIdToken = firstNonEmpty(
      record.idToken,
      record.id_token,
      record.token?.idToken,
      record.token?.id_token,
      record.credentials?.id_token,
      record.authSession?.idToken,
      record.authSession?.id_token
    );

    const payload = parseJwtPayload(accessToken);
    const idPayload = parseJwtPayload(inputIdToken);
    const auth = getOpenAIAuthSection(payload);
    const idAuth = getOpenAIAuthSection(idPayload);
    const profile = getOpenAIProfileSection(payload);
    const now = options.now instanceof Date ? options.now : new Date();
    const expiresAt = firstNonEmpty(
      payload ? timestampFromUnixSeconds(payload.exp) : undefined,
      normalizeTimestamp(record.expires),
      normalizeTimestamp(record.expiresAt),
      normalizeTimestamp(record.expired),
      normalizeTimestamp(record.expires_at),
      normalizeTimestamp(record.authSession?.expires),
      normalizeTimestamp(record.authSession?.expiresAt)
    );
    const email = firstNonEmpty(
      record.user?.email,
      record.authSession?.user?.email,
      record.email,
      record.authSession?.email,
      record.credentials?.email,
      record.providerSpecificData?.email,
      profile.email,
      idPayload?.email,
      payload?.email
    );
    const accountId = firstNonEmpty(
      record.account?.id,
      record.authSession?.account?.id,
      record.account_id,
      record.chatgptAccountId,
      record.chatgpt_account_id,
      record.providerSpecificData?.chatgptAccountId,
      record.providerSpecificData?.chatgpt_account_id,
      record.credentials?.chatgpt_account_id,
      auth.chatgpt_account_id,
      idAuth.chatgpt_account_id,
      record.provider === 'codex' ? record.id : undefined
    );
    const userId = firstNonEmpty(
      record.user?.id,
      record.authSession?.user?.id,
      record.user_id,
      record.chatgptUserId,
      record.chatgpt_user_id,
      record.providerSpecificData?.chatgptUserId,
      record.providerSpecificData?.chatgpt_user_id,
      auth.chatgpt_user_id,
      auth.user_id,
      idAuth.chatgpt_user_id,
      idAuth.user_id
    );
    const planType = firstNonEmpty(
      record.account?.planType,
      record.account?.plan_type,
      record.authSession?.account?.planType,
      record.authSession?.account?.plan_type,
      record.planType,
      record.plan_type,
      record.providerSpecificData?.chatgptPlanType,
      record.providerSpecificData?.chatgpt_plan_type,
      record.credentials?.plan_type,
      auth.chatgpt_plan_type,
      idAuth.chatgpt_plan_type
    );
    const exportedAt = normalizeTimestamp(now);
    const expiresIn = getExpiresIn(expiresAt, now);
    const sourceName = firstNonEmpty(options.sourceName, 'platform-verify');
    const sourceType = record.provider === 'codex' && record.authType === 'oauth' ? '9router' : 'chatgpt_web_session';
    const name = firstNonEmpty(email, sourceName, 'ChatGPT Account');
    const syntheticIdToken = !inputIdToken
      ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt)
      : undefined;
    const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);

    const cpa = Object.fromEntries(Object.entries({
      type: 'codex',
      account_id: accountId,
      chatgpt_account_id: accountId,
      email,
      name,
      plan_type: planType,
      chatgpt_plan_type: planType,
      id_token: idToken,
      id_token_synthetic: Boolean(syntheticIdToken) || undefined,
      access_token: accessToken,
      refresh_token: refreshToken || '',
      session_token: sessionToken,
      last_refresh: exportedAt,
      expired: expiresAt,
      disabled: Boolean(record.disabled) || undefined,
    }).filter(([, value]) => value !== undefined && value !== null));

    const sub2apiAccount = stripUnavailable({
      name: firstNonEmpty(name, email, sourceName, 'ChatGPT Account'),
      platform: 'openai',
      type: 'oauth',
      concurrency: 10,
      priority: 1,
      credentials: {
        access_token: accessToken,
        chatgpt_account_id: accountId,
        chatgpt_user_id: userId,
        email,
        expires_at: expiresAt,
        expires_in: expiresIn,
        plan_type: planType,
      },
      extra: {
        email,
        email_key: toEmailKey(email),
        name,
        auth_provider: firstNonEmpty(record.authProvider, record.auth_provider, record.authSession?.authProvider, record.authSession?.auth_provider),
        source: sourceType,
        source_name: sourceName,
        source_path: options.sourcePath,
        last_refresh: exportedAt,
      },
      auto_pause_on_expired: true,
      update_existing: true,
    });

    const warnings = [];
    if (!inputIdToken && syntheticIdToken) {
      warnings.push('Missing real id_token; generated synthetic CPA-compatible id_token.');
    }
    if (!refreshToken) {
      warnings.push('Missing refresh_token; exported account cannot refresh automatically after access token expiry.');
    }

    return {
      email,
      accountId,
      name,
      cpa,
      sub2apiAccount,
      warnings,
    };
  }

  function buildDailyExportBundle(record, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const converted = convertSession(record, {
      ...options,
      now,
    });
    const accountKey = sanitizeFileToken(
      firstNonEmpty(converted.email, converted.accountId, converted.name, 'chatgpt-session'),
      'chatgpt-session'
    );

    return {
      accountKey,
      email: converted.email,
      cpaDocument: converted.cpa,
      sub2apiDocument: {
        exported_at: normalizeTimestamp(now),
        proxies: [],
        accounts: [converted.sub2apiAccount],
      },
      sessionDocument: record,
      warnings: Array.isArray(converted.warnings) ? converted.warnings.slice() : [],
    };
  }

  return {
    buildDailyExportBundle,
  };
});
