(function attachBackgroundSub2ApiErrorRefreshHistory(root, factory) {
  root.MultiPageBackgroundSub2ApiErrorRefreshHistory = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSub2ApiErrorRefreshHistoryModule() {
  function createSub2ApiErrorRefreshHistoryHelpers(deps = {}) {
    const {
      SUB2API_ERROR_REFRESH_HISTORY_STORAGE_KEY = 'sub2apiErrorRefreshHistory',
      addLog = async () => {},
      buildLocalHelperEndpoint = null,
      chrome,
      getErrorMessage = (error) => error?.message || String(error || ''),
      getState = async () => ({}),
      normalizeAccountRunHistoryHelperBaseUrl = (value) => String(value || '').trim(),
    } = deps;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function normalizeTimestamp(value) {
      const numeric = Date.parse(String(value || ''));
      return Number.isFinite(numeric) ? numeric : 0;
    }

    function normalizePositiveInteger(value, fallback = 0) {
      const numeric = Math.floor(Number(value) || 0);
      return numeric >= 0 ? numeric : fallback;
    }

    function normalizeDetailEntry(entry = {}) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const email = normalizeString(entry.email).toLowerCase();
      if (!email) {
        return null;
      }
      return {
        email,
        remoteAccountId: normalizePositiveInteger(entry.remoteAccountId),
        localAccountId: normalizeString(entry.localAccountId),
        category: normalizeString(entry.category),
        status: normalizeString(entry.status),
        statusLabel: normalizeString(entry.statusLabel),
        reason: normalizeString(entry.reason),
        planType: normalizeString(entry.planType),
        processedAt: normalizeString(entry.processedAt) || new Date().toISOString(),
      };
    }

    function normalizeAllEntry(entry = {}) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const email = normalizeString(entry.email).toLowerCase();
      if (!email) {
        return null;
      }
      return {
        email,
        remoteAccountId: normalizePositiveInteger(entry.remoteAccountId),
        localAccountId: normalizeString(entry.localAccountId),
        category: normalizeString(entry.category),
        status: normalizeString(entry.status),
        statusLabel: normalizeString(entry.statusLabel),
        reason: normalizeString(entry.reason),
        planType: normalizeString(entry.planType),
        processedAt: normalizeString(entry.processedAt),
      };
    }

    function normalizeAllEntries(list = []) {
      return (Array.isArray(list) ? list : [])
        .map((entry) => normalizeAllEntry(entry))
        .filter(Boolean)
        .sort((left, right) => {
          const leftProcessed = normalizeTimestamp(left.processedAt);
          const rightProcessed = normalizeTimestamp(right.processedAt);
          if (leftProcessed !== rightProcessed) {
            return rightProcessed - leftProcessed;
          }
          return left.remoteAccountId - right.remoteAccountId;
        });
    }

    function buildAllEntryKey(entry = {}) {
      const remoteAccountId = normalizePositiveInteger(entry.remoteAccountId);
      if (remoteAccountId > 0) {
        return `id:${remoteAccountId}`;
      }
      const email = normalizeString(entry.email).toLowerCase();
      return email ? `email:${email}` : '';
    }

    function buildAllEntryFromDetail(detail = {}) {
      const normalized = normalizeDetailEntry(detail);
      if (!normalized) {
        return null;
      }
      let status = normalized.status;
      let statusLabel = normalized.statusLabel;
      if (!status) {
        if (normalized.category === 'synced_success') {
          status = 'revived_success';
          statusLabel = statusLabel || '已复活';
        } else if (normalized.category === 'not_found_locally') {
          status = 'not_found_locally';
          statusLabel = statusLabel || '本地未找到';
        } else if (normalized.category === 'deleted_non_plus') {
          status = 'dead_non_plus';
          statusLabel = statusLabel || '已判死';
        } else if (normalized.category === 'deleted_after_reauth_failed') {
          status = 'dead_reauth_failed';
          statusLabel = statusLabel || '已判死';
        } else {
          status = 'pending';
          statusLabel = statusLabel || '待刷新';
        }
      }
      return {
        ...normalized,
        status,
        statusLabel: statusLabel || '待刷新',
      };
    }

    function mergeAllEntriesWithDetails(allEntries = [], details = []) {
      const explicitEntries = normalizeAllEntries(allEntries);
      const derivedEntries = normalizeAllEntries(details.map((detail) => buildAllEntryFromDetail(detail)));
      if (!explicitEntries.length) {
        return derivedEntries;
      }
      if (!derivedEntries.length) {
        return explicitEntries;
      }

      const mergedByKey = new Map();
      derivedEntries.forEach((entry) => {
        const key = buildAllEntryKey(entry);
        if (key) {
          mergedByKey.set(key, entry);
        }
      });

      explicitEntries.forEach((entry) => {
        const key = buildAllEntryKey(entry);
        if (!key) {
          return;
        }
        const derived = mergedByKey.get(key) || null;
        mergedByKey.set(key, {
          ...(derived || {}),
          ...entry,
          category: entry.category || derived?.category || '',
          status: entry.status || derived?.status || '',
          statusLabel: entry.statusLabel || derived?.statusLabel || '',
          reason: entry.reason || derived?.reason || '',
          planType: entry.planType || derived?.planType || '',
          processedAt: entry.processedAt || derived?.processedAt || '',
          localAccountId: entry.localAccountId || derived?.localAccountId || '',
        });
      });

      return normalizeAllEntries(Array.from(mergedByKey.values()));
    }

    function normalizeDetailList(list = []) {
      return (Array.isArray(list) ? list : [])
        .map((entry) => normalizeDetailEntry(entry))
        .filter(Boolean)
        .sort((left, right) => normalizeTimestamp(right.processedAt) - normalizeTimestamp(left.processedAt));
    }

    function buildSummaryFromDetails(details = []) {
      return normalizeDetailList(details).reduce((summary, entry) => {
        summary.processedCount += 1;
        if (entry.category === 'synced_success') {
          summary.revivedSuccessCount += 1;
        } else if (entry.category === 'not_found_locally') {
          summary.notFoundLocallyCount += 1;
        } else if (entry.category === 'deleted_after_reauth_failed' || entry.category === 'deleted_non_plus') {
          summary.deletedAfterReauthFailedCount += 1;
        }
        return summary;
      }, {
        processedCount: 0,
        revivedSuccessCount: 0,
        deletedAfterReauthFailedCount: 0,
        notFoundLocallyCount: 0,
      });
    }

    function buildCategorizedListsFromDetails(details = []) {
      const normalized = normalizeDetailList(details);
      const pickBaseEntry = (entry) => ({
        email: entry.email,
        remoteAccountId: entry.remoteAccountId,
        localAccountId: entry.localAccountId,
        reason: entry.reason,
        planType: entry.planType,
        processedAt: entry.processedAt,
      });
      return {
        revivedEntries: normalized
          .filter((entry) => entry.category === 'synced_success')
          .map((entry) => pickBaseEntry(entry)),
        deletedEntries: normalized
          .filter((entry) => entry.category === 'deleted_after_reauth_failed' || entry.category === 'deleted_non_plus')
          .map((entry) => pickBaseEntry(entry)),
        notFoundEntries: normalized
          .filter((entry) => entry.category === 'not_found_locally')
          .map((entry) => pickBaseEntry(entry)),
      };
    }

    function normalizeHistoryRunRecord(record = {}) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return null;
      }
      const runId = normalizeString(record.runId);
      if (!runId) {
        return null;
      }
      const details = normalizeDetailList(record.details);
      const detailSummary = buildSummaryFromDetails(details);
      const categorizedLists = buildCategorizedListsFromDetails(details);
      const allEntries = mergeAllEntriesWithDetails(record.allEntries, details);
      const startedAt = normalizeString(record.startedAt) || new Date().toISOString();
      const finishedAt = normalizeString(record.finishedAt);
      return {
        runId,
        startedAt,
        finishedAt,
        totalRemoteErrors: normalizePositiveInteger(record.totalRemoteErrors),
        processedCount: normalizePositiveInteger(record.processedCount, detailSummary.processedCount) || detailSummary.processedCount,
        revivedSuccessCount: normalizePositiveInteger(record.revivedSuccessCount, detailSummary.revivedSuccessCount) || detailSummary.revivedSuccessCount,
        deletedAfterReauthFailedCount: normalizePositiveInteger(record.deletedAfterReauthFailedCount, detailSummary.deletedAfterReauthFailedCount) || detailSummary.deletedAfterReauthFailedCount,
        notFoundLocallyCount: normalizePositiveInteger(record.notFoundLocallyCount, detailSummary.notFoundLocallyCount) || detailSummary.notFoundLocallyCount,
        details,
        allEntries,
        revivedEntries: categorizedLists.revivedEntries,
        deletedEntries: categorizedLists.deletedEntries,
        notFoundEntries: categorizedLists.notFoundEntries,
      };
    }

    function normalizeHistoryRuns(records = []) {
      return (Array.isArray(records) ? records : [])
        .map((record) => normalizeHistoryRunRecord(record))
        .filter(Boolean)
        .sort((left, right) => normalizeTimestamp(right.startedAt) - normalizeTimestamp(left.startedAt));
    }

    async function getPersistedSub2ApiErrorRefreshHistory() {
      try {
        const stored = await chrome.storage.local.get(SUB2API_ERROR_REFRESH_HISTORY_STORAGE_KEY);
        return normalizeHistoryRuns(stored[SUB2API_ERROR_REFRESH_HISTORY_STORAGE_KEY]);
      } catch (error) {
        console.warn('[MultiPage:sub2api-error-refresh-history] Failed to read history:', error?.message || error);
        return [];
      }
    }

    async function setPersistedSub2ApiErrorRefreshHistory(records = []) {
      const normalized = normalizeHistoryRuns(records);
      await chrome.storage.local.set({
        [SUB2API_ERROR_REFRESH_HISTORY_STORAGE_KEY]: normalized,
      });
      return normalized;
    }

    function buildSub2ApiErrorRefreshHistorySnapshotPayload(records = []) {
      const normalized = normalizeHistoryRuns(records);
      return {
        generatedAt: new Date().toISOString(),
        runs: normalized,
      };
    }

    function shouldSyncSub2ApiErrorRefreshHistory(state = {}) {
      const helperBaseUrl = normalizeAccountRunHistoryHelperBaseUrl(state.accountRunHistoryHelperBaseUrl);
      return Boolean(helperBaseUrl && typeof buildLocalHelperEndpoint === 'function');
    }

    async function syncSub2ApiErrorRefreshHistorySnapshot(records = [], stateOverride = null) {
      const state = stateOverride || await getState();
      if (!shouldSyncSub2ApiErrorRefreshHistory(state)) {
        return '';
      }

      const helperBaseUrl = normalizeAccountRunHistoryHelperBaseUrl(state.accountRunHistoryHelperBaseUrl);
      let response;
      try {
        response = await fetch(buildLocalHelperEndpoint(helperBaseUrl, '/sync-sub2api-error-refresh-records'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(buildSub2ApiErrorRefreshHistorySnapshotPayload(records)),
        });
      } catch {
        return '';
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(`SUB2API 老号刷新记录同步失败：本地 helper 返回了无法解析的响应（${getErrorMessage(error)}）`);
      }

      if (!response.ok || payload?.ok === false) {
        throw new Error(`SUB2API 老号刷新记录同步失败：${payload?.error || `HTTP ${response.status}`}`);
      }
      return normalizeString(payload?.filePath);
    }

    async function appendSub2ApiErrorRefreshHistoryRun(record = {}, stateOverride = null) {
      const history = await getPersistedSub2ApiErrorRefreshHistory();
      const normalizedRecord = normalizeHistoryRunRecord(record);
      if (!normalizedRecord) {
        return null;
      }
      const nextHistory = await setPersistedSub2ApiErrorRefreshHistory([
        normalizedRecord,
        ...history.filter((item) => item.runId !== normalizedRecord.runId),
      ]);
      let filePath = '';
      try {
        filePath = await syncSub2ApiErrorRefreshHistorySnapshot(nextHistory, stateOverride);
        if (filePath) {
          await addLog(`SUB2API 老号刷新记录已同步到本地：${filePath}`, 'info');
        }
      } catch (error) {
        await addLog(getErrorMessage(error), 'warn');
      }
      return {
        ...normalizedRecord,
        filePath,
      };
    }

    return {
      appendSub2ApiErrorRefreshHistoryRun,
      buildSub2ApiErrorRefreshHistorySnapshotPayload,
      getPersistedSub2ApiErrorRefreshHistory,
      normalizeHistoryRunRecord,
      normalizeHistoryRuns,
      setPersistedSub2ApiErrorRefreshHistory,
      shouldSyncSub2ApiErrorRefreshHistory,
      syncSub2ApiErrorRefreshHistorySnapshot,
    };
  }

  return {
    createSub2ApiErrorRefreshHistoryHelpers,
  };
});
