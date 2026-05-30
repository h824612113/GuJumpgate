(function attachBackgroundSub2ApiErrorRefreshRunner(root, factory) {
  root.MultiPageBackgroundSub2ApiErrorRefreshRunner = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSub2ApiErrorRefreshRunnerModule() {
  function createSub2ApiErrorRefreshRunner(deps = {}) {
    const {
      addLog = async () => {},
      appendSub2ApiErrorRefreshHistoryRun = async () => null,
      broadcastDataUpdate = () => {},
      deleteSub2ApiAccount = async () => null,
      doesNodeUseCompletionSignal = () => false,
      executeNode = async () => {},
      executeNodeViaCompletionSignal = async () => {},
      getErrorMessage = (error) => error?.message || String(error || ''),
      getNextNodeIdForState = () => '',
      getNodeIdsForState = () => [],
      getState = async () => ({}),
      inspectPlusActivationFromSession = (session = null) => ({ active: false, planType: '' }),
      listSub2ApiErrorOpenAiOauthAccounts = async () => [],
      loginSub2Api = async () => ({ origin: '', token: '' }),
      openSignupEntryTab = async () => {},
      patchHotmailAccount = async () => null,
      readCurrentChatGptSessionForExport = async () => ({ session: null, accessToken: '' }),
      setState = async () => {},
    } = deps;

    const RUNTIME_STATS_DEFAULT = Object.freeze({
      totalRemoteErrors: 0,
      processedCount: 0,
      revivedSuccessCount: 0,
      deletedAfterReauthFailedCount: 0,
      notFoundLocallyCount: 0,
      revivalRatioText: '0/0',
    });

    let activeRun = null;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function normalizeEmail(value = '') {
      return normalizeString(value).toLowerCase();
    }

    function normalizePositiveInteger(value, fallback = 0) {
      const numeric = Math.floor(Number(value) || 0);
      return numeric >= 0 ? numeric : fallback;
    }

    function isDoneStatus(status = '') {
      const normalized = normalizeString(status).toLowerCase();
      return normalized === 'completed' || normalized === 'manual_completed' || normalized === 'skipped';
    }

    function cloneNodeStatuses(nodeStatuses = {}) {
      return nodeStatuses && typeof nodeStatuses === 'object'
        ? { ...nodeStatuses }
        : {};
    }

    function buildStatsPatch(stats = {}) {
      const totalRemoteErrors = normalizePositiveInteger(stats.totalRemoteErrors);
      const revivedSuccessCount = normalizePositiveInteger(stats.revivedSuccessCount);
      return {
        totalRemoteErrors,
        processedCount: normalizePositiveInteger(stats.processedCount),
        revivedSuccessCount,
        deletedAfterReauthFailedCount: normalizePositiveInteger(stats.deletedAfterReauthFailedCount),
        notFoundLocallyCount: normalizePositiveInteger(stats.notFoundLocallyCount),
        revivalRatioText: `${revivedSuccessCount}/${totalRemoteErrors}`,
      };
    }

    function findLocalHotmailAccountByEmail(state = {}, email = '') {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        return null;
      }
      const accounts = Array.isArray(state?.hotmailAccounts) ? state.hotmailAccounts : [];
      return accounts.find((account) => normalizeEmail(account?.email) === normalizedEmail) || null;
    }

    async function updateRuntimeState(patch = {}) {
      await setState(patch);
      broadcastDataUpdate(patch);
    }

    function buildRunId() {
      return `sub2api-error-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function buildHistoryDetail(remoteAccount, localAccount, category, reason = '', extra = {}) {
      return {
        email: normalizeEmail(
          remoteAccount?.credentials?.email
          || remoteAccount?.extra?.email
          || remoteAccount?.name
          || localAccount?.email
        ),
        remoteAccountId: normalizePositiveInteger(remoteAccount?.id),
        localAccountId: normalizeString(localAccount?.id),
        category,
        status: normalizeString(extra.status),
        statusLabel: normalizeString(extra.statusLabel),
        reason: normalizeString(reason),
        planType: normalizeString(extra.planType),
        processedAt: new Date().toISOString(),
      };
    }

    function formatEmailListForLog(entries = []) {
      const emails = (Array.isArray(entries) ? entries : [])
        .map((entry) => normalizeEmail(entry?.email))
        .filter(Boolean);
      return emails.length ? emails.join('；') : '';
    }

    function buildExecutionStatePatch(baseState = {}, localAccount = null) {
      const nextState = {
        panelMode: 'sub2api',
        plusModeEnabled: true,
        plusAccountAccessStrategy: 'phone_bind_oauth',
        signupMethod: 'email',
        resolvedSignupMethod: 'email',
        accountIdentifierType: 'email',
        accountIdentifier: normalizeEmail(localAccount?.email),
        email: normalizeEmail(localAccount?.email),
        currentHotmailAccountId: normalizeString(localAccount?.id),
        password: null,
        oauthUrl: null,
        localhostUrl: null,
        loginVerificationRequestedAt: null,
        signupVerificationRequestedAt: null,
        oauthFlowDeadlineAt: null,
        oauthFlowDeadlineSourceUrl: null,
        sub2apiSessionId: null,
        sub2apiOAuthState: null,
        sub2apiGroupId: null,
        sub2apiGroupIds: [],
        sub2apiDraftName: null,
        sub2apiProxyId: null,
        step8VerificationTargetEmail: '',
        bindEmailSubmitted: false,
        plusCheckoutAlreadyPaid: false,
        plusCheckoutAlreadyPaidAt: 0,
        plusCheckoutAlreadyPaidDetail: '',
        plusAlreadyPaidNeedsPostLoginPhoneBind: false,
        signupPhoneNumber: '',
        signupPhoneActivation: null,
        signupPhoneCompletedActivation: null,
      };
      const previewState = {
        ...baseState,
        ...nextState,
      };
      const nodeIds = Array.isArray(getNodeIdsForState(previewState)) ? getNodeIdsForState(previewState) : [];
      nextState.nodeStatuses = Object.fromEntries(nodeIds.map((nodeId) => [nodeId, 'pending']));
      nextState.currentNodeId = '';
      return nextState;
    }

    function pickRestorableStateSnapshot(state = {}) {
      return {
        panelMode: state.panelMode,
        plusModeEnabled: state.plusModeEnabled,
        plusAccountAccessStrategy: state.plusAccountAccessStrategy,
        signupMethod: state.signupMethod,
        resolvedSignupMethod: state.resolvedSignupMethod,
        accountIdentifierType: state.accountIdentifierType,
        accountIdentifier: state.accountIdentifier,
        email: state.email,
        password: state.password,
        currentHotmailAccountId: state.currentHotmailAccountId,
        oauthUrl: state.oauthUrl,
        localhostUrl: state.localhostUrl,
        loginVerificationRequestedAt: state.loginVerificationRequestedAt,
        signupVerificationRequestedAt: state.signupVerificationRequestedAt,
        oauthFlowDeadlineAt: state.oauthFlowDeadlineAt,
        oauthFlowDeadlineSourceUrl: state.oauthFlowDeadlineSourceUrl,
        sub2apiSessionId: state.sub2apiSessionId,
        sub2apiOAuthState: state.sub2apiOAuthState,
        sub2apiGroupId: state.sub2apiGroupId,
        sub2apiGroupIds: Array.isArray(state.sub2apiGroupIds) ? state.sub2apiGroupIds : [],
        sub2apiDraftName: state.sub2apiDraftName,
        sub2apiProxyId: state.sub2apiProxyId,
        step8VerificationTargetEmail: state.step8VerificationTargetEmail,
        bindEmailSubmitted: state.bindEmailSubmitted,
        plusCheckoutAlreadyPaid: state.plusCheckoutAlreadyPaid,
        plusCheckoutAlreadyPaidAt: state.plusCheckoutAlreadyPaidAt,
        plusCheckoutAlreadyPaidDetail: state.plusCheckoutAlreadyPaidDetail,
        plusAlreadyPaidNeedsPostLoginPhoneBind: state.plusAlreadyPaidNeedsPostLoginPhoneBind,
        signupPhoneNumber: state.signupPhoneNumber,
        signupPhoneActivation: state.signupPhoneActivation,
        signupPhoneCompletedActivation: state.signupPhoneCompletedActivation,
        nodeStatuses: cloneNodeStatuses(state.nodeStatuses),
        currentNodeId: state.currentNodeId,
      };
    }

    async function runNode(nodeId) {
      const latestState = await getState();
      if (doesNodeUseCompletionSignal(nodeId, latestState)) {
        return executeNodeViaCompletionSignal(nodeId);
      }
      return executeNode(nodeId);
    }

    function getNextRunnableNodeId(currentNodeId, state = {}) {
      let nextNodeId = normalizeString(getNextNodeIdForState(currentNodeId, state));
      while (nextNodeId && isDoneStatus(state?.nodeStatuses?.[nextNodeId])) {
        nextNodeId = normalizeString(getNextNodeIdForState(nextNodeId, state));
      }
      return nextNodeId;
    }

    async function executePreConfirmOauthChain(localAccount) {
      await runNode('open-chatgpt');
      let currentNodeId = 'oauth-login';
      while (currentNodeId) {
        await runNode(currentNodeId);
        const latestState = await getState();
        const nextNodeId = getNextRunnableNodeId(currentNodeId, latestState);
        if (!nextNodeId || nextNodeId === 'confirm-oauth') {
          return latestState;
        }
        currentNodeId = nextNodeId;
      }
      throw new Error(`账号 ${localAccount?.email || '(unknown)'} 的授权链未能进入 OAuth 确认前阶段。`);
    }

    async function executeConfirmOauthTail() {
      let currentNodeId = 'confirm-oauth';
      while (currentNodeId) {
        await runNode(currentNodeId);
        if (currentNodeId === 'platform-verify') {
          return await getState();
        }
        const latestState = await getState();
        currentNodeId = getNextRunnableNodeId(currentNodeId, latestState);
      }
      return getState();
    }

    async function inspectCurrentPlusActivation() {
      await openSignupEntryTab(1);
      const sessionState = await readCurrentChatGptSessionForExport();
      return {
        ...sessionState,
        ...inspectPlusActivationFromSession(sessionState?.session || null),
      };
    }

    async function deleteRemoteErrorAccount(origin, token, remoteAccount, reason = '') {
      const remoteAccountId = normalizePositiveInteger(remoteAccount?.id);
      if (!remoteAccountId) {
        return false;
      }
      await deleteSub2ApiAccount(origin, token, remoteAccountId);
      if (reason) {
        await addLog(`SUB2API 老号刷新：已删除远端 error 账号 #${remoteAccountId}（${reason}）。`, 'warn');
      } else {
        await addLog(`SUB2API 老号刷新：已删除远端 error 账号 #${remoteAccountId}。`, 'warn');
      }
      return true;
    }

    async function markLocalAccountUsed(localAccount) {
      if (!localAccount?.id) {
        return;
      }
      await patchHotmailAccount(localAccount.id, {
        used: true,
        lastUsedAt: Date.now(),
      }, {
        preserveCurrentSelection: true,
      });
    }

    async function reviveMatchedLocalAccount(localAccount) {
      const originalState = await getState();
      const restoreSnapshot = pickRestorableStateSnapshot(originalState);
      try {
        await updateRuntimeState(buildExecutionStatePatch(originalState, localAccount));
        await executePreConfirmOauthChain(localAccount);
        const inspection = await inspectCurrentPlusActivation();
        if (!inspection?.active) {
          return {
            status: 'non_plus',
            planType: normalizeString(inspection?.planType),
            reason: inspection?.planType
              ? `当前会话未检测到 Plus（planType=${inspection.planType}）`
              : '当前会话未检测到 Plus',
          };
        }
        await executeConfirmOauthTail();
        return {
          status: 'synced_success',
          planType: normalizeString(inspection?.planType),
        };
      } finally {
        await updateRuntimeState(restoreSnapshot);
      }
    }

    async function runSub2ApiErrorRefresh(options = {}) {
      const initialState = options.stateOverride || await getState();
      const runId = normalizeString(options.runId) || buildRunId();
      const startedAt = new Date().toISOString();
      const { origin, token } = await loginSub2Api(initialState, {
        timeoutMs: 30000,
      });
      const remoteErrors = await listSub2ApiErrorOpenAiOauthAccounts(origin, token, {
        timeoutMs: 30000,
        maxPages: 50,
        pageSize: 100,
      });
      const details = [];
      const allEntries = remoteErrors.map((remoteAccount) => ({
        email: normalizeEmail(
          remoteAccount?.credentials?.email
          || remoteAccount?.extra?.email
          || remoteAccount?.name
        ),
        remoteAccountId: normalizePositiveInteger(remoteAccount?.id),
        localAccountId: '',
        category: 'pending',
        status: 'pending',
        statusLabel: '待刷新',
        reason: '',
        planType: '',
        processedAt: '',
      }));
      const summaryStats = {
        ...RUNTIME_STATS_DEFAULT,
      };

      summaryStats.totalRemoteErrors = remoteErrors.length;
      await updateRuntimeState({
        sub2apiErrorRefreshRunning: true,
        sub2apiErrorRefreshRunId: runId,
        sub2apiErrorRefreshCurrentEmail: '',
        sub2apiErrorRefreshStats: buildStatsPatch(summaryStats),
      });

      await addLog(`SUB2API 老号刷新：共拉取到 ${remoteErrors.length} 个远端 error 账号，开始逐个刷新。`, 'info');

      for (const remoteAccount of remoteErrors) {
        if (activeRun?.stopRequested) {
          throw new Error('SUB2API 老号刷新已停止。');
        }
        const email = normalizeEmail(
          remoteAccount?.credentials?.email
          || remoteAccount?.extra?.email
          || remoteAccount?.name
        );
        const entryIndex = allEntries.findIndex((entry) => entry.remoteAccountId === normalizePositiveInteger(remoteAccount?.id));
        await updateRuntimeState({
          sub2apiErrorRefreshCurrentEmail: email,
        });

        const latestState = await getState();
        const localAccount = findLocalHotmailAccountByEmail(latestState, email);
        if (!localAccount) {
          const detail = buildHistoryDetail(remoteAccount, null, 'not_found_locally', '本地邮箱池未找到对应账号', {
            status: 'not_found_locally',
            statusLabel: '本地未找到',
          });
          details.push(detail);
          if (entryIndex >= 0) {
            allEntries[entryIndex] = {
              ...allEntries[entryIndex],
              ...detail,
            };
          }
          summaryStats.processedCount += 1;
          summaryStats.notFoundLocallyCount += 1;
          await addLog(`SUB2API 老号刷新：${email} 未在本地邮箱池中找到，已记录到未找到列表。`, 'warn');
          await updateRuntimeState({
            sub2apiErrorRefreshStats: buildStatsPatch(summaryStats),
          });
          continue;
        }

        await markLocalAccountUsed(localAccount);

        try {
          const reviveResult = await reviveMatchedLocalAccount(localAccount);
          if (reviveResult?.status === 'synced_success') {
            const detail = buildHistoryDetail(remoteAccount, localAccount, 'synced_success', '', {
              status: 'revived_success',
              statusLabel: '已复活',
              planType: reviveResult.planType,
            });
            details.push(detail);
            if (entryIndex >= 0) {
              allEntries[entryIndex] = {
                ...allEntries[entryIndex],
                ...detail,
              };
            }
            summaryStats.processedCount += 1;
            summaryStats.revivedSuccessCount += 1;
            await addLog(`SUB2API 老号刷新：${email} 已复活并同步到远端。`, 'ok');
          } else {
            await deleteRemoteErrorAccount(origin, token, remoteAccount, reviveResult?.reason || '非 Plus 账号');
            const detail = buildHistoryDetail(
              remoteAccount,
              localAccount,
              'deleted_non_plus',
              reviveResult?.reason || '非 Plus 账号',
              {
                status: 'dead_non_plus',
                statusLabel: '已判死',
                planType: reviveResult?.planType,
              }
            );
            details.push(detail);
            if (entryIndex >= 0) {
              allEntries[entryIndex] = {
                ...allEntries[entryIndex],
                ...detail,
              };
            }
            summaryStats.processedCount += 1;
            summaryStats.deletedAfterReauthFailedCount += 1;
          }
        } catch (error) {
          const reason = getErrorMessage(error);
          await deleteRemoteErrorAccount(origin, token, remoteAccount, reason);
          const detail = buildHistoryDetail(remoteAccount, localAccount, 'deleted_after_reauth_failed', reason, {
            status: 'dead_reauth_failed',
            statusLabel: '已判死',
          });
          details.push(detail);
          if (entryIndex >= 0) {
            allEntries[entryIndex] = {
              ...allEntries[entryIndex],
              ...detail,
            };
          }
          summaryStats.processedCount += 1;
          summaryStats.deletedAfterReauthFailedCount += 1;
          await addLog(`SUB2API 老号刷新：${email} 本地命中但未能完成认证配置，已删除远端 error。原因：${reason}`, 'warn');
        }

        await updateRuntimeState({
          sub2apiErrorRefreshStats: buildStatsPatch(summaryStats),
        });
      }

      const finishedAt = new Date().toISOString();
      const historyRecord = {
        runId,
        startedAt,
        finishedAt,
        totalRemoteErrors: summaryStats.totalRemoteErrors,
        processedCount: summaryStats.processedCount,
        revivedSuccessCount: summaryStats.revivedSuccessCount,
        deletedAfterReauthFailedCount: summaryStats.deletedAfterReauthFailedCount,
        notFoundLocallyCount: summaryStats.notFoundLocallyCount,
        details,
        allEntries,
      };
      const persisted = await appendSub2ApiErrorRefreshHistoryRun(historyRecord, initialState);
      const finalRecord = persisted || historyRecord;

      await addLog(
        `SUB2API 老号刷新完成：已处理 ${summaryStats.processedCount}/${summaryStats.totalRemoteErrors}，复活成功 ${summaryStats.revivedSuccessCount}，删除失败号 ${summaryStats.deletedAfterReauthFailedCount}，本地未找到 ${summaryStats.notFoundLocallyCount}。`,
        'info'
      );
      if (Array.isArray(finalRecord?.notFoundEntries) && finalRecord.notFoundEntries.length) {
        await addLog(`SUB2API 老号刷新：本地未找到邮箱 -> ${formatEmailListForLog(finalRecord.notFoundEntries)}`, 'warn');
      }
      if (Array.isArray(finalRecord?.deletedEntries) && finalRecord.deletedEntries.length) {
        await addLog(`SUB2API 老号刷新：已删除远端 error 邮箱 -> ${formatEmailListForLog(finalRecord.deletedEntries)}`, 'warn');
      }
      if (Array.isArray(finalRecord?.revivedEntries) && finalRecord.revivedEntries.length) {
        await addLog(`SUB2API 老号刷新：已复活同步邮箱 -> ${formatEmailListForLog(finalRecord.revivedEntries)}`, 'ok');
      }

      return {
        ok: true,
        runId,
        historyRecord: finalRecord,
      };
    }

    async function startSub2ApiErrorRefresh(options = {}) {
      if (activeRun && !activeRun.finished) {
        throw new Error('SUB2API 老号刷新正在运行，请先等待当前任务完成。');
      }
      const state = options.stateOverride || await getState();
      if (!state?.sub2apiErrorRefreshEnabled) {
        throw new Error('请先开启“老号存活同步刷新”开关。');
      }

      const runContext = {
        stopRequested: false,
        finished: false,
      };
      activeRun = runContext;

      try {
        const result = await runSub2ApiErrorRefresh({
          ...options,
          stateOverride: state,
          runId: buildRunId(),
        });
        return result;
      } finally {
        runContext.finished = true;
        const latestState = await getState().catch(() => state);
        await updateRuntimeState({
          sub2apiErrorRefreshRunning: false,
          sub2apiErrorRefreshCurrentEmail: '',
          sub2apiErrorRefreshHistoryPath: latestState?.sub2apiErrorRefreshHistoryPath || '',
          sub2apiErrorRefreshRunId: '',
          sub2apiErrorRefreshStats: buildStatsPatch(latestState?.sub2apiErrorRefreshStats || {}),
        });
        activeRun = null;
      }
    }

    async function stopSub2ApiErrorRefresh() {
      if (!activeRun || activeRun.finished) {
        return { ok: true, stopped: false };
      }
      activeRun.stopRequested = true;
      await updateRuntimeState({
        sub2apiErrorRefreshRunning: false,
      });
      return { ok: true, stopped: true };
    }

    return {
      startSub2ApiErrorRefresh,
      stopSub2ApiErrorRefresh,
      runSub2ApiErrorRefresh,
      buildStatsPatch,
      findLocalHotmailAccountByEmail,
    };
  }

  return {
    createSub2ApiErrorRefreshRunner,
  };
});
