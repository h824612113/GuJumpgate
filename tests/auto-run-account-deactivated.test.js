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

test('auto run skips to next round when signup hits account_deactivated', async () => {
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
    createAutoRunSessionId: () => 92,
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
    isPlusCheckoutNonFreeTrialFailure: () => false,
    isAutoRunNextRoundPageFailure: () => false,
    isRestartCurrentAttemptError: () => false,
    isSignupIdentityProviderMismatchFailure: () => false,
    isSignupAccountDeactivatedFailure: (error) => /SIGNUP_ACCOUNT_DEACTIVATED::/.test(String(error?.message || error || '')),
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
        throw new Error('SIGNUP_ACCOUNT_DEACTIVATED::步骤 2：检测到 account_deactivated / 账号已删除或停用，当前轮将结束并进入下一轮。');
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
  assert.ok(logs.some((message) => message.includes('第 1/2 轮触发 account_deactivated/账号已删除或停用，本轮将直接失败并跳过剩余重试。')));
  assert.ok(logs.some((message) => message.includes('第 1/2 轮因 account_deactivated/账号已删除或停用提前结束，自动流程将继续下一轮。')));
  assert.ok(appendedRecords.some((record) => /SIGNUP_ACCOUNT_DEACTIVATED::/.test(record.reason)));
  assert.equal(unavailableMarks.length, 1);
  assert.equal(unavailableMarks[0].reason, 'account_deactivated');
  assert.equal(unavailableMarks[0].reasonLabel, '账号已删除或停用');
});
