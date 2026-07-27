(function attachBackgroundStep1(root, factory) {
  root.MultiPageBackgroundStep1 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep1Module() {
  const STEP1_COOKIE_CLEAR_DOMAINS = [
    'chatgpt.com',
    'chat.openai.com',
    'pay.openai.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
    'paypal.com',
    'stripe.com',
    'checkout.stripe.com',
    'meiguodizhi.com',
    'mail-api.yuecheng.shop',
    'yuecheng.shop',
  ];
  const STEP1_COOKIE_CLEAR_ORIGINS = [
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://pay.openai.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://accounts.openai.com',
    'https://openai.com',
    'https://www.paypal.com',
    'https://paypal.com',
    'https://checkout.stripe.com',
    'https://www.meiguodizhi.com',
    'https://meiguodizhi.com',
    'https://mail-api.yuecheng.shop',
  ];

  function normalizeCookieDomainForStep1(domain) {
    return String(domain || '').trim().replace(/^\.+/, '').toLowerCase();
  }

  function shouldClearStep1Cookie(cookie) {
    const domain = normalizeCookieDomainForStep1(cookie?.domain);
    if (!domain) return false;
    return STEP1_COOKIE_CLEAR_DOMAINS.some((target) => (
      domain === target || domain.endsWith(`.${target}`)
    ));
  }

  function buildStep1CookieRemovalUrl(cookie) {
    const host = normalizeCookieDomainForStep1(cookie?.domain);
    const rawPath = String(cookie?.path || '/');
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `https://${host}${path}`;
  }

  function getStep1ErrorMessage(error) {
    return error?.message || String(error || '未知错误');
  }

  const AT_MODE_POST_LOGIN_SKIPPED_NODE_IDS = Object.freeze([
    'fill-profile',
    'wait-registration-success',
    'plus-checkout-create',
  ]);
  const AT_MODE_PHONE_BIND_OAUTH_STRATEGY = 'phone_bind_oauth';

  function isAtModePhoneBindOauthState(state = {}) {
    return Boolean(state?.atModeEnabled)
      || String(state?.plusAccountAccessStrategy || '').trim().toLowerCase() === AT_MODE_PHONE_BIND_OAUTH_STRATEGY;
  }

  function collectSessionValues(root, keys = []) {
    const targets = new Set(keys.map((key) => String(key || '').trim().toLowerCase()));
    const values = [];
    const queue = [root];
    const visited = new Set();
    while (queue.length && values.length < 32) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      for (const [key, entry] of Object.entries(value)) {
        if (targets.has(String(key).trim().toLowerCase())) {
          values.push(entry);
        }
        if (entry && typeof entry === 'object') {
          queue.push(entry);
        }
      }
    }
    return values;
  }

  function isPaidPlanType(value = '') {
    const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
    return Boolean(normalized) && !/(^|[_-])(free|guest|basic|default|none|null|unknown)([_-]|$)/i.test(normalized);
  }

  function inspectAtModeSession(result = {}) {
    const session = result?.session && typeof result.session === 'object'
      ? result.session
      : result;
    const accessToken = String(result?.accessToken || session?.accessToken || '').trim();
    const email = collectSessionValues(session, ['email', 'emailAddress', 'email_address'])
      .find((value) => String(value || '').includes('@'));
    const planValues = collectSessionValues(session, ['planType', 'plan_type', 'chatgpt_plan_type']);
    const booleanValues = collectSessionValues(session, [
      'isPaid',
      'is_paid',
      'hasActiveSubscription',
      'has_active_subscription',
      'subscriptionActive',
      'subscription_active',
      'isSubscribed',
      'is_subscribed',
    ]);
    const planType = String(planValues.find((value) => typeof value === 'string' && value.trim()) || '').trim();
    return {
      loggedIn: Boolean(accessToken || email),
      plus: booleanValues.some((value) => value === true) || isPaidPlanType(planType),
      email: String(email || '').trim(),
      planType,
    };
  }

  async function applyAtModePostLoginState(options = {}) {
    const state = options?.state || {};
    const inspection = options?.inspection || {};
    if (!inspection.loggedIn) {
      throw new Error('AT mode requires the email login to complete before checking Plus status.');
    }
    if (!inspection.plus) {
      throw new Error('AT mode requires the logged-in account to be Plus.');
    }

    const inspectedEmail = String(inspection.email || '').trim();
    const stateEmail = String(state?.email || '').trim();
    if (
      inspectedEmail
      && stateEmail
      && inspectedEmail.toLowerCase() !== stateEmail.toLowerCase()
    ) {
      throw new Error(`AT mode session email ${inspectedEmail} does not match the current pool email ${stateEmail}.`);
    }

    const email = inspectedEmail || stateEmail;
    if (!email) {
      throw new Error('AT mode could not determine the logged-in account email.');
    }

    const activeNodeIds = new Set(
      Array.isArray(options?.activeNodeIds)
        ? options.activeNodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)
        : []
    );
    const statuses = options?.nodeStatuses && typeof options.nodeStatuses === 'object'
      ? options.nodeStatuses
      : (state?.nodeStatuses && typeof state.nodeStatuses === 'object' ? state.nodeStatuses : {});
    const skippedNodeIds = [];
    if (typeof options?.setNodeStatus === 'function') {
      for (const nodeId of AT_MODE_POST_LOGIN_SKIPPED_NODE_IDS) {
        if (!activeNodeIds.has(nodeId)) continue;
        const currentStatus = String(statuses[nodeId] || 'pending').trim().toLowerCase();
        if (['running', 'completed', 'manual_completed', 'skipped'].includes(currentStatus)) continue;
        await options.setNodeStatus(nodeId, 'skipped');
        skippedNodeIds.push(nodeId);
      }
    }

    if (typeof options?.setState === 'function') {
      await options.setState({
        email,
        accountIdentifierType: 'email',
        accountIdentifier: email,
      });
    }
    if (typeof options?.addLog === 'function') {
      await options.addLog(
        `AT mode confirmed Plus account ${email}; skipped profile/checkout prerequisites and continuing with OAuth phone binding.`,
        'ok'
      );
    }

    return {
      ...inspection,
      email,
      skippedNodeIds,
    };
  }

  async function applyAtModeAlreadyPaidCheckoutState(options = {}) {
    const state = options?.state || {};
    const email = String(
      state?.email
      || state?.accountIdentifier
      || state?.registrationEmailState?.current
      || ''
    ).trim();
    if (!email) {
      throw new Error('AT mode already-paid checkout fallback requires the current pool email.');
    }

    return applyAtModePostLoginState({
      ...options,
      state: {
        ...state,
        email,
      },
      inspection: {
        ...(options?.inspection && typeof options.inspection === 'object' ? options.inspection : {}),
        loggedIn: true,
        plus: true,
        email,
        planType: String(options?.inspection?.planType || 'already_paid').trim() || 'already_paid',
      },
    });
  }

  async function applyAtModePhoneBindOauthState(options = {}) {
    const state = options?.state || {};
    const email = String(
      state?.email
      || state?.accountIdentifier
      || state?.registrationEmailState?.current
      || ''
    ).trim();
    if (!email) {
      throw new Error('AT mode phone-bind OAuth requires the current pool email.');
    }

    return applyAtModePostLoginState({
      ...options,
      state: {
        ...state,
        email,
      },
      inspection: {
        loggedIn: true,
        plus: true,
        email,
        planType: AT_MODE_PHONE_BIND_OAUTH_STRATEGY,
      },
    });
  }

  async function collectStep1Cookies(chromeApi) {
    if (!chromeApi.cookies?.getAll) {
      return [];
    }

    const stores = chromeApi.cookies.getAllCookieStores
      ? await chromeApi.cookies.getAllCookieStores()
      : [{ id: undefined }];
    const cookies = [];
    const seen = new Set();

    for (const store of stores) {
      const storeId = store?.id;
      const batch = await chromeApi.cookies.getAll(storeId ? { storeId } : {});
      for (const cookie of batch || []) {
        if (!shouldClearStep1Cookie(cookie)) continue;
        const key = [
          cookie.storeId || storeId || '',
          cookie.domain || '',
          cookie.path || '',
          cookie.name || '',
          cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        cookies.push(cookie);
      }
    }

    return cookies;
  }

  async function removeStep1Cookie(chromeApi, cookie) {
    const details = {
      url: buildStep1CookieRemovalUrl(cookie),
      name: cookie.name,
    };
    if (cookie.storeId) {
      details.storeId = cookie.storeId;
    }
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }

    try {
      const result = await chromeApi.cookies.remove(details);
      return Boolean(result);
    } catch (error) {
      console.warn('[MultiPage:step1] remove cookie failed', {
        domain: cookie?.domain,
        name: cookie?.name,
        message: getStep1ErrorMessage(error),
      });
      return false;
    }
  }

  function createStep1Executor(deps = {}) {
    const {
      addLog,
      chrome: chromeApi = globalThis.chrome,
      clearOpenAiCookiesBeforeStep1: injectedClearOpenAiCookiesBeforeStep1,
      completeNodeFromBackground,
      openSignupEntryTab,
    } = deps;

    async function clearOpenAiCookiesBeforeStep1() {
      if (!chromeApi?.cookies?.getAll || !chromeApi.cookies?.remove) {
        await addLog('步骤 1：当前浏览器不支持 cookies API，跳过打开官网前 cookie 清理。', 'warn');
        return;
      }

      await addLog('步骤 1：打开 ChatGPT 官网前清理 ChatGPT / OpenAI cookies...', 'info');
      const cookies = await collectStep1Cookies(chromeApi);
      let removedCount = 0;
      for (const cookie of cookies) {
        if (await removeStep1Cookie(chromeApi, cookie)) {
          removedCount += 1;
        }
      }

      if (chromeApi.browsingData?.removeCookies) {
        try {
          await chromeApi.browsingData.removeCookies({
            since: 0,
            origins: STEP1_COOKIE_CLEAR_ORIGINS,
          });
        } catch (error) {
          await addLog(`步骤 1：browsingData 补扫 cookies 失败：${getStep1ErrorMessage(error)}`, 'warn');
        }
      }

      await addLog(`步骤 1：已清理 ${removedCount} 个 ChatGPT / OpenAI cookies。`, 'ok');
    }

    async function executeStep1(state = {}) {
      const atModeEnabled = isAtModePhoneBindOauthState(state);
      if (typeof injectedClearOpenAiCookiesBeforeStep1 === 'function') {
        await injectedClearOpenAiCookiesBeforeStep1();
      } else {
        await clearOpenAiCookiesBeforeStep1();
      }
      await addLog('步骤 1：正在打开 ChatGPT 官网...');
      if (
        atModeEnabled
        && state?.plusPaymentMethod
        && String(state.plusPaymentMethod).trim().toLowerCase() !== 'paypal'
      ) {
        throw new Error('AT 模式当前仅支持 PayPal Plus 手机绑定链路。');
      }
      await openSignupEntryTab(1, { forceNew: true });
      await completeNodeFromBackground('open-chatgpt', {});
    }

    return { executeStep1 };
  }

  return {
    createStep1Executor,
    inspectAtModeSession,
    applyAtModePostLoginState,
    applyAtModeAlreadyPaidCheckoutState,
    applyAtModePhoneBindOauthState,
    isAtModePhoneBindOauthState,
    AT_MODE_POST_LOGIN_SKIPPED_NODE_IDS,
  };
});
