import { Buffer } from 'node:buffer';

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeBase64UrlJson(value) {
  return bytesToBase64Url(Buffer.from(JSON.stringify(value), 'utf8'));
}

export function parseJwtPayload(token) {
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

export function normalizeTimestamp(value) {
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

function getExpiresIn(expiresAt, now = new Date()) {
  if (!expiresAt) {
    return undefined;
  }

  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) {
    return undefined;
  }

  return Math.max(0, Math.floor((expiresMs - now.getTime()) / 1000));
}

export function stripUnavailable(value) {
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

export function toEmailKey(email) {
  if (typeof email !== 'string') {
    return undefined;
  }

  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function sanitizeFileToken(value, fallback = 'chatgpt-session') {
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

export function getTimestampToken(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

export function collectSessionLikeObjects(value, sourceName = 'pasted-json') {
  const found = [];
  const visited = new WeakSet();

  function visit(item, path) {
    if (!isPlainObject(item) && !Array.isArray(item)) {
      return;
    }

    if (isPlainObject(item)) {
      if (visited.has(item)) {
        return;
      }
      visited.add(item);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        item.token?.accessToken,
        item.token?.access_token,
        item.credentials?.accessToken,
        item.credentials?.access_token,
        item.authSession?.accessToken,
        item.authSession?.access_token,
      );
      const hasIdentity = isPlainObject(item.user) || firstNonEmpty(
        item.email,
        item.name,
        item.providerSpecificData?.chatgptAccountId,
        item.providerSpecificData?.chatgpt_account_id,
        item.id,
        item.account_id,
        item.chatgpt_account_id,
        item.authSession?.user?.email,
        item.authSession?.email,
      );
      if (token && hasIdentity) {
        found.push({ value: item, sourceName, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === 'accessToken' || key === 'access_token' || key === 'sessionToken') {
          continue;
        }
        visit(child, `${path}.${key}`);
      }
      return;
    }

    item.forEach((child, index) => visit(child, `${path}[${index}]`));
  }

  visit(value, '$');
  return found;
}

export function convertSession(record, options = {}) {
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
    record.authSession?.access_token,
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
    record.authSession?.session_token,
  );
  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    record.token?.refreshToken,
    record.token?.refresh_token,
    record.credentials?.refresh_token,
    record.authSession?.refreshToken,
    record.authSession?.refresh_token,
  );
  const inputIdToken = firstNonEmpty(
    record.idToken,
    record.id_token,
    record.token?.idToken,
    record.token?.id_token,
    record.credentials?.id_token,
    record.authSession?.idToken,
    record.authSession?.id_token,
  );

  const payload = parseJwtPayload(accessToken);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = getOpenAIAuthSection(payload);
  const idAuth = getOpenAIAuthSection(idPayload);
  const profile = getOpenAIProfileSection(payload);
  const expiresAt = firstNonEmpty(
    payload ? timestampFromUnixSeconds(payload.exp) : undefined,
    normalizeTimestamp(record.expires),
    normalizeTimestamp(record.expiresAt),
    normalizeTimestamp(record.expired),
    normalizeTimestamp(record.expires_at),
    normalizeTimestamp(record.authSession?.expires),
    normalizeTimestamp(record.authSession?.expiresAt),
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
    payload?.email,
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
    record.provider === 'codex' ? record.id : undefined,
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
    idAuth.user_id,
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
    idAuth.chatgpt_plan_type,
  );
  const exportedAt = normalizeTimestamp(options.now || new Date());
  const expiresIn = getExpiresIn(expiresAt, options.now || new Date());
  const sourceName = firstNonEmpty(options.sourceName, 'pasted-json');
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

  const cockpit = stripUnavailable({
    type: 'codex',
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken || '',
    account_id: accountId,
    last_refresh: exportedAt,
    email,
    expired: expiresAt,
    account_note: firstNonEmpty(
      record.account_note,
      record.accountInfo,
      record.account_info,
      record.note,
      record.notes,
      record.remark,
    ),
  });

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
  });
  const priority = Number.isFinite(Number(record.priority)) ? Number(record.priority) : 9;
  const isActive = typeof record.isActive === 'boolean' ? record.isActive : !Boolean(record.disabled);
  const createdAt = normalizeTimestamp(record.createdAt) || exportedAt;
  const updatedAt = normalizeTimestamp(record.updatedAt) || exportedAt;
  const nineRouter = stripUnavailable({
    accessToken,
    refreshToken,
    expiresAt,
    testStatus: firstNonEmpty(record.testStatus, record.test_status, 'active'),
    expiresIn,
    providerSpecificData: {
      chatgptAccountId: accountId,
      chatgptPlanType: planType,
    },
    id: accountId,
    provider: 'codex',
    authType: 'oauth',
    name,
    email,
    priority,
    isActive,
    createdAt,
    updatedAt,
  });

  return {
    sourceName,
    sourcePath: options.sourcePath,
    email,
    name,
    expiresAt,
    cpa,
    cockpit,
    nineRouter,
    sub2apiAccount,
  };
}

export const EXPORT_TARGETS = Object.freeze(['cpa', 'sub2api', 'cockpit', '9router']);

export function buildSub2apiDocument(converted, now = new Date()) {
  return {
    exported_at: normalizeTimestamp(now),
    proxies: [],
    accounts: converted.map((item) => item.sub2apiAccount),
  };
}

export function buildTargetDocument(target, converted, now = new Date(), options = {}) {
  const singleObjectWhenOne = Boolean(options.singleObjectWhenOne);

  if (target === 'sub2api') {
    return buildSub2apiDocument(converted, now);
  }

  const rows = converted.map((item) => {
    if (target === 'cpa') {
      return item.cpa;
    }
    if (target === 'cockpit') {
      return item.cockpit;
    }
    if (target === '9router') {
      return item.nineRouter;
    }
    throw new Error(`Unsupported export target: ${target}`);
  });

  return singleObjectWhenOne && rows.length === 1 ? rows[0] : rows;
}

export function parseInputDocument(parsed, sourceName = 'pasted-json', now = new Date()) {
  const sources = collectSessionLikeObjects(parsed, sourceName);
  const converted = [];
  const skipped = [];

  for (const item of sources) {
    try {
      converted.push(convertSession(item.value, {
        now,
        sourceName: item.sourceName,
        sourcePath: item.path,
      }));
    } catch (error) {
      skipped.push({
        sourceName: item.sourceName,
        path: item.path,
        reason: error instanceof Error ? error.message : 'conversion failed',
      });
    }
  }

  if (!sources.length) {
    skipped.push({
      sourceName,
      path: '$',
      reason: 'no session-like object with accessToken and identity found',
    });
  }

  return { converted, skipped, sources };
}
