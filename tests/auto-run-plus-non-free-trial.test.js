const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAutoRunControllerModule() {
  const filePath = path.join(__dirname, '..', 'background', 'auto-run-controller.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundAutoRunController;
}

test('auto run skips to next round when plus checkout has no free trial', async () => {
  const module = loadAutoRunControllerModule();
  const logs = [];
  const appendedRecords = [];
  const unavailableMarks = [];
  let runCount = 0;
  let currentState = {
    autoRunFallbackThreadIntervalMinutes: 0,
    nodeStatuses: {},
  };
  const runtimeState = {
    autoRunActive: false,
    autoRunCurrentRun: 0,
    autoRunTotalRuns: 0,
    autoRunAttemptRun: 0,
    autoRunSessionId: 0,
  };

  const controller = module.createAutoRunController({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    appendAccountRunRecord: async (status, _state, reason) => {
      appendedRecords.push({ status, reason });
      return { status, reason };
    },
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 2,
    AUTO_RUN_RETRY_DELAY_MS: 1,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async () => {},
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 66,
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun ?? 0,
      autoRunTotalRuns: payload.totalRuns ?? 0,
      autoRunAttemptRun: payload.attemptRun ?? 0,
      autoRunSessionId: payload.sessionId ?? 0,
    }),
    getErrorMessage: (error) => String(error?.message || error || ''),
    getFirstUnfinishedNodeId: () => null,
    getRegistrationAccountUnavailableMarking: () => null,
    getPendingAutoRunTimerPlan: () => null,
    getRunningNodeIds: () => [],
    getState: async () => currentState,
    hasSavedNodeProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isCloudCheckoutAlreadyPaidFailure: () => false,
    isGpcTaskEndedFailure: () => false,
    isHostedCheckoutGenericErrorFailure: () => false,
    isHostedCheckoutVerificationResendLimitFailure: () => false,
    isPhoneSmsPlatformRateLimitFailure: () => false,
    isPlusCheckoutNonFreeTrialFailure: (error) => /PLUS_CHECKOUT_NON_FREE_TRIAL::/.test(String(error?.message || error || '')),
    isRestartCurrentAttemptError: () => false,
    isSignupIdentityRateLimitFailure: () => false,
    isStep5StaleSignupVerificationFailure: () => false,
    isStep4Route405RecoveryLimitFailure: () => false,
    isSignupUserAlreadyExistsFailure: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => {},
    normalizeAutoRunFallbackThreadIntervalMinutes: (value) => Number(value) || 0,
    persistAutoRunTimerPlan: async () => {},
    resetState: async () => {
      currentState = {
        autoRunFallbackThreadIntervalMinutes: 0,
        nodeStatuses: {},
      };
    },
    runAutoSequenceFromNode: async () => {
      runCount += 1;
      if (runCount === 1) {
        throw new Error('PLUS_CHECKOUT_NON_FREE_TRIAL::步骤 6：检测到今日应付金额不是 0（US$20.00），当前账号没有免费试用资格。');
      }
    },
    runtime: {
      get: () => ({ ...runtimeState }),
      set: (updates = {}) => {
        Object.assign(runtimeState, updates);
      },
    },
    markCurrentRegistrationAccountUnavailable: async (_state, options = {}) => {
      unavailableMarks.push(options);
    },
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
      },
    },
    setState: async (updates) => {
      currentState = { ...currentState, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningNodesToFinish: async () => currentState,
    getStopRequested: () => false,
  });

  await controller.autoRunLoop(2, {
    autoRunSkipFailures: true,
  });

  assert.equal(runCount, 2);
  assert.ok(logs.some((message) => message.includes('第 1/2 轮没有 Plus 免费试用资格，本轮将直接失败并跳过剩余重试。')));
  assert.ok(logs.some((message) => message.includes('第 1/2 轮因 Plus 今日应付金额非 0 提前结束，自动流程将继续下一轮。')));
  assert.ok(appendedRecords.some((record) => /PLUS_CHECKOUT_NON_FREE_TRIAL::/.test(record.reason)));
  assert.equal(unavailableMarks.length, 1);
  assert.equal(unavailableMarks[0].reason, 'plus_non_free_trial');
  assert.equal(unavailableMarks[0].reasonLabel, '没有免费试用资格');
});
