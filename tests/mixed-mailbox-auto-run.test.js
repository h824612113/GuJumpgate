const test = require('node:test');
const assert = require('node:assert/strict');

global.self = global;
require('../background/auto-run-controller');
const mixedMailboxRuntime = require('../mixed-mailbox-runtime');

function createHarness({
  runError = null,
  totalRuns = 1,
  initialState = {},
  mixedModeResolver = (currentState) => currentState?.emailGenerator === 'mixed-pool',
} = {}) {
  let state = {
    emailGenerator: 'mixed-pool',
    mixedMailboxQueueEntries: [
      {
        id: 'one',
        type: 'icloud-url',
        email: 'one@icloud.com',
        credential: 'one@icloud.com----http://yangyang.website/messages/token/one@icloud.com',
        enabled: true,
        used: false,
      },
      { id: 'two', type: 'outlook', email: 'two@outlook.com', enabled: true, used: false, hotmailAccountId: 'hotmail-two' },
    ],
    autoRunFallbackThreadIntervalMinutes: 0,
    nodeStatuses: {},
    ...initialState,
  };
  const runtimeState = {
    autoRunActive: false,
    autoRunTotalRuns: totalRuns,
    autoRunCurrentRun: 0,
    autoRunAttemptRun: 0,
    autoRunSessionId: 0,
  };
  const prepared = [];
  const used = [];
  const failed = [];
  let sequenceCalls = 0;
  let ensureCalls = 0;

  const controller = global.MultiPageBackgroundAutoRunController.createAutoRunController({
    addLog: async () => {},
    appendAccountRunRecord: async () => null,
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 2,
    AUTO_RUN_RETRY_DELAY_MS: 1,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before-retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between-rounds',
    broadcastAutoRunStatus: async () => {},
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 1,
    ensureHotmailMailboxReadyForAutoRunRound: async () => {
      ensureCalls += 1;
      throw new Error('Hotmail prerequisite should be skipped for mixed queue');
    },
    getAutoRunStatusPayload: (phase, payload) => ({ autoRunPhase: phase, ...payload }),
    getErrorMessage: (error) => String(error?.message || error || ''),
    getFirstUnfinishedNodeId: () => null,
    getPendingAutoRunTimerPlan: () => null,
    getRunningNodeIds: () => [],
    getState: async () => state,
    hasSavedNodeProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isCloudCheckoutAlreadyPaidFailure: () => false,
    isGpcTaskEndedFailure: () => false,
    isHostedCheckoutGenericErrorFailure: () => false,
    isHostedCheckoutVerificationResendLimitFailure: () => false,
    isPhoneSmsPlatformRateLimitFailure: () => false,
    isPlusCheckoutNonFreeTrialFailure: () => false,
    isRestartCurrentAttemptError: () => false,
    isSignupUserAlreadyExistsFailure: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: () => 0,
    persistAutoRunTimerPlan: async () => {},
    resetState: async () => { state = {}; },
    runAutoSequenceFromNode: async () => {
      sequenceCalls += 1;
      if (runError) throw runError;
    },
    runtime: {
      get: () => ({ ...runtimeState }),
      set: (patch) => Object.assign(runtimeState, patch),
    },
    setState: async (patch) => { state = { ...state, ...patch }; },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningNodesToFinish: async () => state,
    getStopRequested: () => false,
    chrome: { runtime: { sendMessage: async () => {} } },
    isMixedMailboxGenerator: mixedModeResolver,
    prepareMixedMailboxRunForAutoRound: async () => {
      const entry = state.mixedMailboxQueueEntries.find((item) => item.enabled && !item.used);
      prepared.push(entry.id);
      state = { ...state, activeMixedMailboxEntryId: entry.id, email: entry.email };
    },
    markActiveMixedMailboxEntryUsed: async () => { used.push(state.activeMixedMailboxEntryId); },
    markActiveMixedMailboxEntryError: async (error) => { failed.push([state.activeMixedMailboxEntryId, error.message]); },
  });

  return {
    controller,
    failed,
    getSequenceCalls: () => sequenceCalls,
    getEnsureCalls: () => ensureCalls,
    prepared,
    used,
  };
}

test('marks a mixed mailbox entry used only after a successful full round', async () => {
  const harness = createHarness();

  await harness.controller.autoRunLoop(1, { autoRunSkipFailures: true });

  assert.deepEqual(harness.prepared, ['one']);
  assert.deepEqual(harness.used, ['one']);
  assert.deepEqual(harness.failed, []);
});

test('mixed mailbox failure stops before the next entry even when skip failures is requested', async () => {
  const harness = createHarness({ runError: new Error('HTTP 403'), totalRuns: 2 });

  await harness.controller.autoRunLoop(2, { autoRunSkipFailures: true });

  assert.deepEqual(harness.prepared, ['one']);
  assert.deepEqual(harness.used, []);
  assert.deepEqual(harness.failed, [['one', 'HTTP 403']]);
  assert.equal(harness.getSequenceCalls(), 1);
});

test('skips the Hotmail prerequisite when iCloud queue fallback is active', async () => {
  const harness = createHarness({
    initialState: {
      mailProvider: 'hotmail-api',
      emailGenerator: 'provider-default',
      hotmailAccounts: [],
    },
    mixedModeResolver: mixedMailboxRuntime.shouldUseMixedMailboxQueue,
  });

  await harness.controller.autoRunLoop(1, { autoRunSkipFailures: true });

  assert.deepEqual(harness.prepared, ['one']);
  assert.equal(harness.getEnsureCalls(), 0);
  assert.deepEqual(harness.used, ['one']);
});
