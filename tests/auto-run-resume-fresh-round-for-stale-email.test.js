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

test('resume switches to fresh round when previous failure already marked email as consumed', async () => {
  const module = loadAutoRunControllerModule();
  const logs = [];
  const runCalls = [];
  let currentState = {
    autoRunFallbackThreadIntervalMinutes: 0,
    currentNodeId: 'fill-profile',
    nodeStatuses: {
      'open-chatgpt': 'completed',
      'submit-signup-email': 'completed',
      'fill-password': 'skipped',
      'fetch-signup-code': 'completed',
      'fill-profile': 'failed',
    },
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
    appendAccountRunRecord: async () => ({ ok: true }),
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 2,
    AUTO_RUN_RETRY_DELAY_MS: 1,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async () => {},
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 99,
    ensureHotmailMailboxReadyForAutoRunRound: async () => {},
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun ?? 0,
      autoRunTotalRuns: payload.totalRuns ?? 0,
      autoRunAttemptRun: payload.attemptRun ?? 0,
      autoRunSessionId: payload.sessionId ?? 0,
    }),
    getErrorMessage: (error) => String(error?.message || error || ''),
    getFirstUnfinishedNodeId: () => 'fill-profile',
    getPendingAutoRunTimerPlan: () => null,
    getRunningNodeIds: () => [],
    getState: async () => currentState,
    hasSavedNodeProgress: () => true,
    isAddPhoneAuthFailure: () => false,
    isCloudCheckoutAlreadyPaidFailure: () => false,
    isGpcTaskEndedFailure: () => false,
    isHostedCheckoutGenericErrorFailure: () => false,
    isHostedCheckoutVerificationResendLimitFailure: () => false,
    isPhoneSmsPlatformRateLimitFailure: () => false,
    isPlusCheckoutNonFreeTrialFailure: () => false,
    isRestartCurrentAttemptError: () => false,
    isSignupIdentityRateLimitFailure: () => false,
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
    runAutoSequenceFromNode: async (startNodeId) => {
      runCalls.push(startNodeId);
    },
    runtime: {
      get: () => ({ ...runtimeState }),
      set: (updates = {}) => {
        Object.assign(runtimeState, updates);
      },
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

  await controller.autoRunLoop(1, {
    mode: 'continue',
    resumeCurrentRun: 1,
    resumeAttemptRun: 1,
    resumeRoundSummaries: [{
      round: 1,
      status: 'failed',
      attempts: 1,
      failureReasons: [
        'STEP5_STALE_SIGNUP_VERIFICATION::步骤 5：资料页启动时认证页仍停留在邮箱验证码阶段，当前轮将结束并进入下一轮。 URL: https://auth.openai.com/email-verification',
      ],
      finalFailureReason: 'STEP5_STALE_SIGNUP_VERIFICATION::步骤 5：资料页启动时认证页仍停留在邮箱验证码阶段，当前轮将结束并进入下一轮。 URL: https://auth.openai.com/email-verification',
    }],
    autoRunSkipFailures: true,
  });

  assert.deepEqual(runCalls, ['open-chatgpt']);
  assert.ok(logs.some((message) => message.includes('当前邮箱为旧邮箱/已消耗邮箱')));
});
