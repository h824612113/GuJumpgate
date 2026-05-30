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

test('auto run skips to next round when step 5 hits stale signup verification error', async () => {
  const module = loadAutoRunControllerModule();
  const logs = [];
  const statusEvents = [];
  const stateUpdates = [];
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
    broadcastAutoRunStatus: async (phase, payload) => {
      statusEvents.push({ phase, payload });
    },
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 77,
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun ?? 0,
      autoRunTotalRuns: payload.totalRuns ?? 0,
      autoRunAttemptRun: payload.attemptRun ?? 0,
      autoRunSessionId: payload.sessionId ?? 0,
    }),
    getErrorMessage: (error) => String(error?.message || error || ''),
    getFirstUnfinishedNodeId: () => null,
    getRegistrationAccountUnavailableMarking: () => ({
      logPrefix: '检测到当前注册邮箱命中认证页残留',
      reason: 'stale_signup_verification',
      reasonLabel: '认证页残留',
    }),
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
    isRestartCurrentAttemptError: () => false,
    isStep5StaleSignupVerificationFailure: (error) => /STEP5_STALE_SIGNUP_VERIFICATION::/.test(String(error?.message || error || '')),
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
        throw new Error('STEP5_STALE_SIGNUP_VERIFICATION::步骤 5：资料页启动时认证页仍停留在邮箱验证码阶段，当前轮将结束并进入下一轮。 URL: https://auth.openai.com/email-verification');
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
      stateUpdates.push(updates);
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
  assert.ok(logs.some((message) => message.includes('第 1/2 轮触发步骤 5 认证页残留，本轮将直接失败并跳过剩余重试。')));
  assert.ok(logs.some((message) => message.includes('第 1/2 轮因步骤 5 认证页残留提前结束，自动流程将继续下一轮。')));
  assert.ok(appendedRecords.some((record) => /STEP5_STALE_SIGNUP_VERIFICATION::/.test(record.reason)));
  assert.equal(unavailableMarks.length, 1);
  assert.equal(unavailableMarks[0].reason, 'stale_signup_verification');
  assert.ok(statusEvents.some((event) => event.phase === 'complete'));
  assert.ok(stateUpdates.some((update) => Array.isArray(update.autoRunRoundSummaries) && update.autoRunRoundSummaries.length === 2));
});
