const test = require('node:test');
const assert = require('node:assert/strict');

global.self = global;
require('../background/signup-flow-helpers');

function createHelpers(overrides = {}) {
  return global.MultiPageSignupFlowHelpers.createSignupFlowHelpers({
    addLog: async () => {},
    buildGeneratedAliasEmail: () => '',
    chrome: {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureHotmailAccountForFlow: async () => ({ email: 'fallback@outlook.com' }),
    ensureMail2925AccountForFlow: async () => ({ email: 'fallback@example.com' }),
    ensureLuckmailPurchaseForFlow: async () => ({ email_address: 'fallback@example.com' }),
    fetchGeneratedEmail: async () => '',
    isGeneratedAliasProvider: () => false,
    isReusableGeneratedAliasEmail: () => false,
    isHotmailProvider: (state) => state?.mailProvider === 'hotmail-api',
    isLuckmailProvider: () => false,
    isSignupEmailVerificationPageUrl: () => false,
    isSignupPasswordPageUrl: () => false,
    persistRegistrationEmailState: async () => {},
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({}),
    setEmailState: async () => {},
    setState: async () => {},
    SIGNUP_ENTRY_URL: 'https://chatgpt.com/',
    SIGNUP_PAGE_INJECT_FILES: [],
    waitForTabUrlMatch: async () => null,
    ...overrides,
  });
}

test('resolves the active iCloud queue mailbox without allocating a Hotmail account', async () => {
  let hotmailAllocations = 0;
  const helpers = createHelpers({
    ensureHotmailAccountForFlow: async () => {
      hotmailAllocations += 1;
      throw new Error('没有可用的 Hotmail 账号');
    },
    isMixedMailboxGenerator: (state) => state?.emailGenerator === 'mixed-pool'
      || state?.activeMixedMailboxEntryId === 'icloud-entry',
    getActiveMixedMailboxEntry: (state) => state?.mixedMailboxQueueEntries?.find(
      (entry) => entry.id === state?.activeMixedMailboxEntryId
    ) || null,
    resolveMixedMailboxProvider: (entry) => entry?.type === 'icloud-url' ? 'icloud-url' : 'hotmail-api',
  });

  const state = {
    emailGenerator: 'provider-default',
    mailProvider: 'hotmail-api',
    email: 'icloud-entry@example.com',
    activeMixedMailboxEntryId: 'icloud-entry',
    mixedMailboxQueueEntries: [{
      id: 'icloud-entry',
      type: 'icloud-url',
      email: 'icloud-entry@example.com',
      enabled: true,
      used: false,
    }],
  };

  const resolved = await helpers.resolveSignupEmailForFlow(state);

  assert.equal(resolved, state.email);
  assert.equal(hotmailAllocations, 0);
});
