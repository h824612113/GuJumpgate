(function attachBackgroundStep10(root, factory) {
  root.MultiPageBackgroundStep10 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep10Module() {
  function createStep10Executor(deps = {}) {
    const {
      addLog,
      buildLocalHelperEndpoint = null,
      buildDailySessionExportBundle = null,
      chrome,
      closeConflictingTabsForSource,
      completeNodeFromBackground,
      createLocalCliProxyApi = null,
      ensureContentScriptReadyOnTab,
      getState = null,
      getPanelMode,
      getTabId,
      isLocalhostOAuthCallbackUrl,
      isTabAlive,
      normalizeHotmailLocalBaseUrl = (value) => String(value || '').trim(),
      normalizeCodex2ApiUrl,
      normalizeSub2ApiUrl,
      rememberSourceLastUrl,
      reuseOrCreateTab,
      sendToContentScript,
      sendToContentScriptResilient,
      shouldBypassStep9ForLocalCpa,
      DEFAULT_SUB2API_GROUP_NAME = 'codex',
      SUB2API_STEP9_RESPONSE_TIMEOUT_MS,
    } = deps;

    let sub2ApiApi = null;
    let localCliProxyApi = null;

    function getSub2ApiApi() {
      if (sub2ApiApi) {
        return sub2ApiApi;
      }
      const factory = deps.createSub2ApiApi
        || self.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi;
      if (typeof factory !== 'function') {
        throw new Error('SUB2API 直连接口模块未加载，无法提交回调。');
      }
      sub2ApiApi = factory({
        addLog,
        normalizeSub2ApiUrl,
        DEFAULT_SUB2API_GROUP_NAME,
      });
      return sub2ApiApi;
    }

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function getLocalCliProxyApi() {
      if (localCliProxyApi) {
        return localCliProxyApi;
      }
      const factory = createLocalCliProxyApi
        || self.MultiPageBackgroundLocalCliProxyApi?.createLocalCliProxyApi;
      if (typeof factory !== 'function') {
        throw new Error('本地 CPA JSON 有RT 模块未加载，无法导出认证文件。');
      }
      localCliProxyApi = factory({
        crypto: globalThis.crypto,
        fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
        sessionToJsonConverter: self.MultiPageSessionToJsonConverter,
      });
      return localCliProxyApi;
    }

    function resolvePlatformVerifyStep(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep >= 10 ? visibleStep : 10;
    }

    function resolveConfirmOauthStep(platformVerifyStep = 10) {
      const normalizedStep = Math.floor(Number(platformVerifyStep) || 0);
      if (normalizedStep >= 13) {
        return 12;
      }
      if (normalizedStep >= 12) {
        return 11;
      }
      return 9;
    }

    function resolveAuthLoginStep(platformVerifyStep = 10) {
      const normalizedStep = Math.floor(Number(platformVerifyStep) || 0);
      if (normalizedStep >= 13) {
        return 10;
      }
      if (normalizedStep >= 12) {
        return 6;
      }
      return 7;
    }

    function addStepLog(step, message, level = 'info') {
      return addLog(message, level, { step, stepKey: 'platform-verify' });
    }

    function formatLocalHelperFetchError(endpoint, helperBaseUrl, error) {
      const originalMessage = normalizeString(error?.message) || 'Failed to fetch';
      return `本地 helper 请求失败：无法连接 ${endpoint}。请检查本地 hotmail-helper 是否启动（运行 start-hotmail-helper.bat），并确认侧边栏“本地助手地址”为 ${helperBaseUrl}。原始错误：${originalMessage}`;
    }

    async function readChatGptSessionExportDataFromTab(tabId, platformVerifyStep) {
      const numericTabId = Number(tabId) || 0;
      if (!numericTabId || !chrome?.scripting?.executeScript) {
        throw new Error(`步骤 ${platformVerifyStep}：缺少可读取 ChatGPT 会话的标签页。`);
      }
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: numericTabId },
        func: async () => {
          const response = await fetch('/api/auth/session', { credentials: 'include' });
          const session = await response.json().catch(() => ({}));
          return {
            ok: response.ok,
            status: response.status,
            session,
            accessToken: String(session?.accessToken || '').trim(),
          };
        },
      });
      if (!result?.ok && !result?.accessToken) {
        throw new Error(`步骤 ${platformVerifyStep}：当前页面未返回可用 SESSION（HTTP ${result?.status || 'unknown'}）。`);
      }
      if (!result?.accessToken) {
        throw new Error(`步骤 ${platformVerifyStep}：当前 SESSION 中没有 accessToken。`);
      }
      return {
        session: result.session && typeof result.session === 'object' ? result.session : {},
        accessToken: result.accessToken,
      };
    }

    async function resolveDailySessionExportState(platformVerifyStep) {
      const knownTabIds = [];
      if (typeof getTabId === 'function') {
        knownTabIds.push(Number(await getTabId('chatgpt').catch(() => 0)) || 0);
        knownTabIds.push(Number(await getTabId('plus-checkout').catch(() => 0)) || 0);
      }

      for (const tabId of knownTabIds.filter(Boolean)) {
        try {
          if (typeof isTabAlive === 'function' && !(await isTabAlive(tabId))) {
            continue;
          }
          return await readChatGptSessionExportDataFromTab(tabId, platformVerifyStep);
        } catch (_error) {
          // Fall back to scanning tabs.
        }
      }

      const tabs = await chrome.tabs.query({}).catch(() => []);
      const candidates = tabs.filter((tab) => {
        if (!Number.isInteger(tab?.id)) {
          return false;
        }
        try {
          const parsed = new URL(String(tab.url || ''));
          const hostname = String(parsed.hostname || '').trim().toLowerCase();
          return /(^|\.)chatgpt\.com$/.test(hostname)
            || hostname === 'chat.openai.com'
            || /(^|\.)openai\.com$/.test(hostname);
        } catch {
          return false;
        }
      });

      for (const tab of candidates) {
        try {
          return await readChatGptSessionExportDataFromTab(tab.id, platformVerifyStep);
        } catch (_error) {
          // Try next candidate.
        }
      }

      throw new Error(`步骤 ${platformVerifyStep}：未找到可读取 ChatGPT 会话的已登录标签页。`);
    }

    async function saveDailySessionExportsViaHelper(helperBaseUrl, payload) {
      const endpoint = typeof buildLocalHelperEndpoint === 'function'
        ? buildLocalHelperEndpoint(helperBaseUrl, '/save-daily-session-exports')
        : new URL('/save-daily-session-exports', `${helperBaseUrl.replace(/\/+$/, '')}/`).toString();
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new Error(formatLocalHelperFetchError(endpoint, helperBaseUrl, error));
      }

      let result = {};
      try {
        result = await response.json();
      } catch {
        result = {};
      }

      if (!response.ok || result?.ok === false) {
        throw new Error(normalizeString(result?.error) || `本地 helper 写入每日导出失败（HTTP ${response.status}）。`);
      }

      return result;
    }

    async function exportDailySessionArtifactsAfterPlatformVerify(state = {}, platformVerifyStep = 10) {
      if (typeof buildDailySessionExportBundle !== 'function') {
        return null;
      }
      const helperBaseUrl = normalizeHotmailLocalBaseUrl(state.hotmailLocalBaseUrl);
      if (!helperBaseUrl) {
        await addStepLog(platformVerifyStep, '每日导出已跳过：未配置本地助手地址。', 'warn');
        return null;
      }

      await addStepLog(platformVerifyStep, `每日导出启动：准备从已登录 ChatGPT 页面读取 session，并写入 ${helperBaseUrl}。`, 'info');
      const sessionState = await resolveDailySessionExportState(platformVerifyStep);
      await addStepLog(
        platformVerifyStep,
        `每日导出：已读取 session，邮箱=${normalizeString(sessionState?.session?.user?.email || sessionState?.session?.email || '') || '(未知)'}。`,
        'info'
      );
      const bundle = buildDailySessionExportBundle(sessionState.session, {
        now: new Date(),
        sourceName: `platform-verify-step-${platformVerifyStep}`,
      });
      const now = new Date();
      const dateKey = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
      const helperResult = await saveDailySessionExportsViaHelper(helperBaseUrl, {
        date: dateKey,
        accountKey: bundle.accountKey,
        files: {
          'session.json': JSON.stringify(sessionState.session, null, 2),
          'cpa.json': JSON.stringify(bundle.cpaDocument, null, 2),
          'sub2api.json': JSON.stringify(bundle.sub2apiDocument, null, 2),
        },
      });

      for (const warning of bundle.warnings || []) {
        await addStepLog(platformVerifyStep, `每日导出提示：${warning}`, 'warn');
      }

      await addStepLog(
        platformVerifyStep,
        `已归档 session / CPA / SUB2API 到 ${normalizeString(helperResult?.directoryPath) || '当日目录'}`,
        'ok'
      );

      return {
        directoryPath: normalizeString(helperResult?.directoryPath),
        files: helperResult?.files && typeof helperResult.files === 'object' ? helperResult.files : {},
        sessionEmail: bundle.email || '',
      };
    }

    function startDailySessionExportJob(state = {}, platformVerifyStep = 10) {
      if (typeof buildDailySessionExportBundle !== 'function') {
        return null;
      }
      void (async () => {
        try {
          await addStepLog(platformVerifyStep, '已启动每日导出后台任务。', 'info');
          await exportDailySessionArtifactsAfterPlatformVerify(state, platformVerifyStep);
        } catch (error) {
          await addStepLog(platformVerifyStep, `每日导出失败：${normalizeString(error?.message) || 'unknown error'}`, 'warn');
        }
      })();
      return true;
    }

    async function completePlatformVerifyNode(state, payload, platformVerifyStep) {
      await completeNodeFromBackground(state?.nodeId || 'platform-verify', {
        ...(payload || {}),
      });
    }

    function parseLocalhostCallback(rawUrl, platformVerifyStep = 10) {
      const confirmOauthStep = resolveConfirmOauthStep(platformVerifyStep);
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new Error(`步骤 ${platformVerifyStep} 捕获到的 localhost OAuth 回调地址格式无效，请重新执行步骤 ${confirmOauthStep}。`);
      }

      const code = normalizeString(parsed.searchParams.get('code'));
      const state = normalizeString(parsed.searchParams.get('state'));
      if (!code || !state) {
        throw new Error(`步骤 ${platformVerifyStep} 捕获到的 localhost OAuth 回调地址缺少 code 或 state，请重新执行步骤 ${confirmOauthStep}。`);
      }

      return {
        url: parsed.toString(),
        code,
        state,
      };
    }

    function getCodex2ApiErrorMessage(payload, responseStatus = 500) {
      const details = [
        payload?.error,
        payload?.message,
        payload?.detail,
        payload?.reason,
      ]
        .map((value) => normalizeString(value))
        .find(Boolean);
      return details || `Codex2API 请求失败（HTTP ${responseStatus}）。`;
    }

    function deriveCpaManagementOrigin(vpsUrl) {
      const normalizedUrl = normalizeString(vpsUrl);
      if (!normalizedUrl) {
        throw new Error('尚未填写 CPA 地址，请先在侧边栏输入。');
      }
      let parsed;
      try {
        parsed = new URL(normalizedUrl);
      } catch {
        throw new Error('CPA 地址格式无效，请先在侧边栏检查。');
      }
      return parsed.origin;
    }

    function getCpaApiErrorMessage(payload, responseStatus = 500) {
      const details = [
        payload?.error,
        payload?.message,
        payload?.detail,
        payload?.reason,
      ]
        .map((value) => normalizeString(value))
        .find(Boolean);
      return details || `CPA 管理接口请求失败（HTTP ${responseStatus}）。`;
    }

    async function fetchCpaManagementJson(origin, path, options = {}) {
      const controller = new AbortController();
      const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 20000));
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const managementKey = normalizeString(options.managementKey);
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (managementKey) {
          headers.Authorization = `Bearer ${managementKey}`;
          headers['X-Management-Key'] = managementKey;
        }

        const response = await fetch(`${origin}${path}`, {
          method: options.method || 'POST',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        let payload = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(getCpaApiErrorMessage(payload, response.status));
        }

        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('CPA 管理接口请求超时，请稍后重试。');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    function isSub2ApiTransientExchangeError(error) {
      const message = normalizeString(error?.message || error);
      if (!message) {
        return false;
      }
      const tokenExchangeFailure = /auth\.openai\.com\/oauth\/token/i.test(message);
      const transientNetworkSignal = /unexpected\s+eof|eof|connection\s+refused|i\/o\s+timeout|context\s+deadline\s+exceeded|connection\s+reset|broken\s+pipe|failed\s+to\s+fetch|temporarily\s+unavailable|timeout/i.test(message);
      const transientExchangeUserSignal = /token_exchange_user_error|invalid\s+request\.\s+please\s+try\s+again\s+later/i.test(message);
      if (transientExchangeUserSignal) {
        return true;
      }
      return tokenExchangeFailure && transientNetworkSignal;
    }

    async function sleep(ms = 0) {
      const timeout = Math.max(0, Number(ms) || 0);
      if (!timeout) return;
      await new Promise((resolve) => setTimeout(resolve, timeout));
    }

    async function fetchCodex2ApiJson(origin, path, options = {}) {
      const controller = new AbortController();
      const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 30000));
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${origin}${path}`, {
          method: options.method || 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Admin-Key': normalizeString(options.adminKey),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        let payload = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(getCodex2ApiErrorMessage(payload, response.status));
        }

        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('Codex2API 请求超时，请稍后重试。');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function saveLocalCpaJsonArtifactViaHelper(helperBaseUrl, artifact) {
      const endpoint = typeof buildLocalHelperEndpoint === 'function'
        ? buildLocalHelperEndpoint(helperBaseUrl, '/save-auth-json')
        : new URL('/save-auth-json', `${helperBaseUrl.replace(/\/+$/, '')}/`).toString();
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filePath: artifact.filePath,
            directoryPath: artifact.directoryPath,
            content: artifact.jsonText,
          }),
        });
      } catch (error) {
        throw new Error(formatLocalHelperFetchError(endpoint, helperBaseUrl, error));
      }

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok || payload?.ok === false) {
        throw new Error(normalizeString(payload?.error) || `本地 helper 写入失败（HTTP ${response.status}）。`);
      }

      return {
        ...artifact,
        filePath: normalizeString(payload?.filePath) || artifact.filePath,
      };
    }

    async function executeStep10(state) {
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      const effectiveState = {
        ...(state || {}),
        ...(latestState || {}),
      };
      const platformVerifyStep = resolvePlatformVerifyStep(effectiveState);
      startDailySessionExportJob(effectiveState, platformVerifyStep);

      if (getPanelMode(effectiveState) === 'local-cpa-json') {
        return executeLocalCpaJsonStep10(effectiveState);
      }
      if (getPanelMode(effectiveState) === 'codex2api') {
        return executeCodex2ApiStep10(effectiveState);
      }
      if (getPanelMode(effectiveState) === 'sub2api') {
        return executeSub2ApiStep10(effectiveState);
      }
      return executeCpaStep10(effectiveState);
    }

    async function executeCpaStep10(state) {
      const platformVerifyStep = resolvePlatformVerifyStep(state);
      const confirmOauthStep = resolveConfirmOauthStep(platformVerifyStep);
      const authLoginStep = resolveAuthLoginStep(platformVerifyStep);
      if (state.localhostUrl && !isLocalhostOAuthCallbackUrl(state.localhostUrl)) {
        throw new Error(`步骤 ${confirmOauthStep} 捕获到的 localhost OAuth 回调地址无效，请重新执行步骤 ${confirmOauthStep}。`);
      }
      if (!state.localhostUrl) {
        throw new Error(`缺少 localhost 回调地址，请先完成步骤 ${confirmOauthStep}。`);
      }
      if (!state.vpsUrl) {
        throw new Error('尚未填写 CPA 地址，请先在侧边栏输入。');
      }

      if (shouldBypassStep9ForLocalCpa(state)) {
        await addStepLog(platformVerifyStep, '检测到本地 CPA，且当前策略为“跳过平台回调验证”，本轮不再重复提交回调地址。', 'info');
        await completePlatformVerifyNode(state, {
          localhostUrl: state.localhostUrl,
          verifiedStatus: 'local-auto',
        }, platformVerifyStep);
        return;
      }

      const callback = parseLocalhostCallback(state.localhostUrl, platformVerifyStep);
      const expectedState = normalizeString(state.cpaOAuthState);
      if (expectedState && expectedState !== callback.state) {
        throw new Error(`CPA 回调 state 与当前授权会话不匹配，请重新执行步骤 ${authLoginStep}。`);
      }
      const managementKey = normalizeString(state.vpsPassword);
      if (!managementKey) {
        throw new Error('尚未配置 CPA 管理密钥，请先在侧边栏填写。');
      }

      await addStepLog(platformVerifyStep, '正在通过 CPA 管理接口提交回调地址...');
      try {
        const origin = normalizeString(state.cpaManagementOrigin) || deriveCpaManagementOrigin(state.vpsUrl);
        const result = await fetchCpaManagementJson(origin, '/v0/management/oauth-callback', {
          method: 'POST',
          managementKey,
          body: {
            provider: 'codex',
            redirect_url: callback.url,
          },
        });

        const verifiedStatus = normalizeString(result?.message)
          || normalizeString(result?.status_message)
          || 'CPA 已通过接口提交回调';
        await addStepLog(platformVerifyStep, verifiedStatus, 'ok');
        await completePlatformVerifyNode(state, {
          localhostUrl: callback.url,
          verifiedStatus,
        }, platformVerifyStep);
      } catch (error) {
        const reason = normalizeString(error?.message) || 'unknown error';
        await addStepLog(platformVerifyStep, `CPA 接口提交失败：${reason}`, 'error');
        throw error;
      }
    }

    async function executeLocalCpaJsonStep10(state) {
      const platformVerifyStep = resolvePlatformVerifyStep(state);
      const confirmOauthStep = resolveConfirmOauthStep(platformVerifyStep);
      const authLoginStep = resolveAuthLoginStep(platformVerifyStep);
      if (state.localhostUrl && !isLocalhostOAuthCallbackUrl(state.localhostUrl)) {
        throw new Error(`步骤 ${confirmOauthStep} 捕获到的 localhost OAuth 回调地址无效，请重新执行步骤 ${confirmOauthStep}。`);
      }
      if (!state.localhostUrl) {
        throw new Error(`缺少 localhost 回调地址，请先完成步骤 ${confirmOauthStep}。`);
      }

      const helperBaseUrl = normalizeHotmailLocalBaseUrl(state.hotmailLocalBaseUrl);
      const pluginDir = normalizeString(state.localCpaJsonPluginDir);
      if (!helperBaseUrl) {
        throw new Error('尚未配置 Hotmail 本地助手地址，请先在侧边栏填写。');
      }
      if (!pluginDir) {
        throw new Error('尚未配置本地插件目录，请先在侧边栏填写。');
      }
      if (!state.localCpaJsonPkceCodes?.codeVerifier) {
        throw new Error(`缺少本地 CPA JSON 有RT PKCE 会话信息，请重新执行步骤 ${authLoginStep}。`);
      }

      const callback = parseLocalhostCallback(state.localhostUrl, platformVerifyStep);
      const expectedState = normalizeString(state.localCpaJsonOAuthState);
      if (expectedState && expectedState !== callback.state) {
        throw new Error(`本地 CPA JSON 有RT 回调 state 与当前授权会话不匹配，请重新执行步骤 ${authLoginStep}。`);
      }

      await addStepLog(platformVerifyStep, '正在交换 OAuth 授权码并导出本地 CPA JSON 有RT...');
      const api = getLocalCliProxyApi();
      const artifact = await api.exchangeCallbackToAuthArtifact({
        callbackUrl: callback.url,
        expectedState,
        pkceCodes: state.localCpaJsonPkceCodes,
        pluginDir,
        relativeAuthDir: state.localCpaJsonRelativeAuthDir,
        sourceName: 'CLIProxyAPI Local OAuth',
      });

      for (const warning of Array.isArray(artifact.warnings) ? artifact.warnings : []) {
        await addStepLog(platformVerifyStep, warning, 'warn');
      }

      const saved = await saveLocalCpaJsonArtifactViaHelper(helperBaseUrl, artifact);
      const verifiedStatus = `本地CPA JSON 有RT 已导出：${saved.filePath}`;
      await addStepLog(platformVerifyStep, verifiedStatus, 'ok');
      await completePlatformVerifyNode(state, {
        localhostUrl: callback.url,
        verifiedStatus,
        localCpaJsonFilePath: saved.filePath,
      }, platformVerifyStep);
    }

    async function executeCodex2ApiStep10(state) {
      const platformVerifyStep = resolvePlatformVerifyStep(state);
      const confirmOauthStep = resolveConfirmOauthStep(platformVerifyStep);
      const authLoginStep = resolveAuthLoginStep(platformVerifyStep);
      if (state.localhostUrl && !isLocalhostOAuthCallbackUrl(state.localhostUrl)) {
        throw new Error(`步骤 ${confirmOauthStep} 捕获到的 localhost OAuth 回调地址无效，请重新执行步骤 ${confirmOauthStep}。`);
      }
      if (!state.localhostUrl) {
        throw new Error(`缺少 localhost 回调地址，请先完成步骤 ${confirmOauthStep}。`);
      }
      if (!state.codex2apiSessionId) {
        throw new Error(`缺少 Codex2API 会话信息，请重新执行步骤 ${authLoginStep}。`);
      }
      if (!normalizeString(state.codex2apiAdminKey)) {
        throw new Error('尚未配置 Codex2API 管理密钥，请先在侧边栏填写。');
      }

      const callback = parseLocalhostCallback(state.localhostUrl, platformVerifyStep);
      const expectedState = normalizeString(state.codex2apiOAuthState);
      if (expectedState && expectedState !== callback.state) {
        throw new Error(`Codex2API 回调 state 与当前授权会话不匹配，请重新执行步骤 ${authLoginStep}。`);
      }

      const codex2apiUrl = normalizeCodex2ApiUrl(state.codex2apiUrl);
      const origin = new URL(codex2apiUrl).origin;

      await addStepLog(platformVerifyStep, '正在向 Codex2API 提交回调并创建账号...');
      const result = await fetchCodex2ApiJson(origin, '/api/admin/oauth/exchange-code', {
        adminKey: state.codex2apiAdminKey,
        method: 'POST',
        body: {
          session_id: state.codex2apiSessionId,
          code: callback.code,
          state: callback.state,
        },
      });

      const verifiedStatus = normalizeString(result?.message) || 'Codex2API OAuth 账号添加成功';
      await addStepLog(platformVerifyStep, verifiedStatus, 'ok');
      await completePlatformVerifyNode(state, {
        localhostUrl: callback.url,
        verifiedStatus,
      }, platformVerifyStep);
    }

    async function executeSub2ApiStep10(state) {
      const platformVerifyStep = resolvePlatformVerifyStep(state);
      const visibleStep = platformVerifyStep;
      const confirmOauthStep = resolveConfirmOauthStep(visibleStep);
      if (state.localhostUrl && !isLocalhostOAuthCallbackUrl(state.localhostUrl)) {
        throw new Error(`步骤 ${confirmOauthStep} 捕获到的 localhost OAuth 回调地址无效，请重新执行步骤 ${confirmOauthStep}。`);
      }
      if (!state.localhostUrl) {
        throw new Error(`缺少 localhost 回调地址，请先完成步骤 ${confirmOauthStep}。`);
      }
      if (!state.sub2apiSessionId) {
        throw new Error('缺少 SUB2API 会话信息，请重新执行步骤 1。');
      }
      if (!state.sub2apiEmail) {
        throw new Error('尚未配置 SUB2API 登录邮箱，请先在侧边栏填写。');
      }
      if (!state.sub2apiPassword) {
        throw new Error('尚未配置 SUB2API 登录密码，请先在侧边栏填写。');
      }

      const sub2apiUrl = normalizeSub2ApiUrl(state.sub2apiUrl);
      if (!sub2apiUrl) {
        throw new Error('SUB2API URL is not configured. Please fill it in the side panel first.');
      }
      const api = getSub2ApiApi();
      const maxExchangeAttempts = 3;
      let lastError = null;
      for (let attempt = 1; attempt <= maxExchangeAttempts; attempt += 1) {
        try {
          const result = await api.submitOpenAiCallback({
            ...state,
            visibleStep,
            sub2apiUrl,
          }, {
            visibleStep,
            logLabel: `步骤 ${visibleStep}`,
            logOptions: { step: visibleStep, stepKey: 'platform-verify' },
            timeoutMs: SUB2API_STEP9_RESPONSE_TIMEOUT_MS,
          });
          await completePlatformVerifyNode(state, result, platformVerifyStep);
          return;
        } catch (error) {
          lastError = error;
          if (!isSub2ApiTransientExchangeError(error) || attempt >= maxExchangeAttempts) {
            throw error;
          }
          await addLog(
            `SUB2API 回调交换出现临时网络波动（${error.message}），正在重试 ${attempt + 1}/${maxExchangeAttempts}...`,
            'warn',
            { step: visibleStep, stepKey: 'platform-verify' }
          );
          await sleep(1200 * attempt);
        }
      }
      if (lastError) {
        throw lastError;
      }
    }

    return {
      executeCpaStep10,
      executeCodex2ApiStep10,
      executeLocalCpaJsonStep10,
      executeStep10,
      executeSub2ApiStep10,
    };
  }

  return { createStep10Executor };
});
