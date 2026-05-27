const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPhoneVerificationModule() {
  const filePath = path.join(__dirname, '..', 'background', 'phone-verification-flow.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundPhoneVerification;
}

test('signup phone verification can directly fill and submit the SMS code', async () => {
  const module = loadPhoneVerificationModule();
  let executedArgs = null;

  const helpers = module.createPhoneVerificationHelpers({
    chrome: {
      scripting: {
        executeScript: async (options) => {
          executedArgs = options.args;
          return [{
            result: {
              ok: true,
              inputType: 'single',
              valueLength: 6,
              buttonText: '继续',
              submitted: true,
              url: 'https://auth.openai.com/create-account/profile',
            },
          }];
        },
      },
    },
  });

  const result = await helpers.submitSignupPhoneVerificationCodeDirectly(123, '123456');

  assert.deepEqual(Array.from(executedArgs), ['123456']);
  assert.equal(result.ok, true);
  assert.equal(result.inputType, 'single');
  assert.equal(result.valueLength, 6);
  assert.equal(result.buttonText, '继续');
  assert.equal(result.submitted, true);
});
