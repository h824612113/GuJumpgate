(function attachMixedMailboxRuntime(root, factory) {
  const utils = typeof module !== 'undefined' && module.exports
    ? require('./mixed-mailbox-utils')
    : root?.MixedMailboxUtils;
  const api = factory(utils);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.MixedMailboxRuntime = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createMixedMailboxRuntime(utils) {
  const MIXED_POOL_GENERATOR = 'mixed-pool';

  function normalizeEntries(entries = []) {
    return utils?.normalizeMixedMailboxQueueEntries?.(entries) || [];
  }

  function buildMixedMailboxStateDefaults() {
    return {
      persisted: { mixedMailboxQueueEntries: [] },
      runtime: { activeMixedMailboxEntryId: null },
    };
  }

  function buildMixedMailboxImportRuntimeResetPatch() {
    return {
      activeMixedMailboxEntryId: null,
      currentHotmailAccountId: null,
    };
  }

  function getActiveMixedMailboxEntry(state = {}) {
    const entries = normalizeEntries(state?.mixedMailboxQueueEntries);
    const activeId = String(state?.activeMixedMailboxEntryId || '').trim();
    if (activeId) {
      const active = entries.find((entry) => entry.id === activeId);
      if (active) return active;
    }
    return utils?.getNextMixedMailboxQueueEntry?.(entries) || null;
  }

  function prepareMixedMailboxRun(state = {}) {
    if (String(state?.emailGenerator || '').trim().toLowerCase() !== MIXED_POOL_GENERATOR) {
      return null;
    }
    const entry = getActiveMixedMailboxEntry(state);
    if (!entry) {
      throw new Error('统一邮箱队列没有可用条目。');
    }
    const provider = utils?.resolveMixedMailboxProvider?.(entry) || '';
    if (!provider) {
      throw new Error(`无法识别 ${entry.email} 的邮箱类型。`);
    }
    if (provider === 'hotmail-api' && !entry.hotmailAccountId) {
      throw new Error(`Outlook 队列条目 ${entry.email} 缺少账号引用。`);
    }
    return {
      entry,
      provider,
      statePatch: {
        activeMixedMailboxEntryId: entry.id,
        email: entry.email,
        currentHotmailAccountId: provider === 'hotmail-api' ? entry.hotmailAccountId : null,
      },
    };
  }

  function sanitizeMixedMailboxError(error) {
    const message = String(error?.message || error || '未知错误').trim() || '未知错误';
    return message
      .replace(/https:\/\/[^\s)\]}]+/gi, '[已隐藏URL]')
      .replace(/----[^\s)\]}]+/g, '----[已隐藏]');
  }

  function markMixedMailboxEntryUsed(entries = [], entryId = '', timestamp = Date.now()) {
    const normalizedId = String(entryId || '').trim();
    return normalizeEntries(entries).map((entry) => (
      entry.id === normalizedId
        ? {
            ...entry,
            used: true,
            lastError: '',
            lastUsedAt: Number(timestamp) || Date.now(),
          }
        : entry
    ));
  }

  function markMixedMailboxEntryError(entries = [], entryId = '', error = null) {
    const normalizedId = String(entryId || '').trim();
    const lastError = sanitizeMixedMailboxError(error);
    return normalizeEntries(entries).map((entry) => (
      entry.id === normalizedId
        ? { ...entry, used: false, lastError }
        : entry
    ));
  }

  return {
    MIXED_POOL_GENERATOR,
    buildMixedMailboxImportRuntimeResetPatch,
    buildMixedMailboxStateDefaults,
    getActiveMixedMailboxEntry,
    markMixedMailboxEntryError,
    markMixedMailboxEntryUsed,
    prepareMixedMailboxRun,
    sanitizeMixedMailboxError,
  };
});
