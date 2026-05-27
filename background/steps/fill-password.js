(function attachBackgroundStep3(root, factory) {
  root.MultiPageBackgroundStep3 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep3Module() {
  function createStep3Executor(deps = {}) {
    const {
      addLog,
      appendAccountRunRecord,
      chrome,
      completeNodeFromBackground,
      ensureContentScriptReadyOnTab,
      generatePassword,
      getTabId,
      isTabAlive,
      resolveSignupMethod,
      sendToContentScript,
      setPasswordState,
      setState,
      SIGNUP_PAGE_INJECT_FILES,
    } = deps;

    function normalizeSignupMethod(value = '') {
      return String(value || '').trim().toLowerCase() === 'phone'
        ? 'phone'
        : 'email';
    }

    function getResolvedSignupMethodForStep3(state = {}) {
      if (typeof resolveSignupMethod === 'function') {
        return normalizeSignupMethod(resolveSignupMethod(state));
      }
      const frozenMethod = String(state?.resolvedSignupMethod || '').trim().toLowerCase();
      if (frozenMethod === 'phone' || frozenMethod === 'email') {
        return normalizeSignupMethod(frozenMethod);
      }
      return normalizeSignupMethod(state?.signupMethod);
    }

    function createFallbackPassword() {
      const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const lower = 'abcdefghjkmnpqrstuvwxyz';
      const digits = '23456789';
      const symbols = '!@#$%&*?';
      const all = upper + lower + digits + symbols;
      let password = upper[Math.floor(Math.random() * upper.length)]
        + lower[Math.floor(Math.random() * lower.length)]
        + digits[Math.floor(Math.random() * digits.length)]
        + symbols[Math.floor(Math.random() * symbols.length)];
      for (let index = password.length; index < 14; index += 1) {
        password += all[Math.floor(Math.random() * all.length)];
      }
      return password.split('').sort(() => Math.random() - 0.5).join('');
    }

    function resolveStep3Password(state = {}) {
      const existingPassword = String(state.customPassword || state.password || '').trim();
      if (existingPassword) {
        return existingPassword;
      }
      if (typeof generatePassword === 'function') {
        const generated = String(generatePassword() || '').trim();
        if (generated) {
          return generated;
        }
      }
      return createFallbackPassword();
    }

    async function fillSignupPasswordDirectly(tabId, password) {
      if (!chrome?.scripting?.executeScript) {
        return { skipped: true, reason: 'scripting_unavailable' };
      }

      const [executionResult = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (targetPassword) => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const isVisibleElement = (element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect?.();
            const style = window.getComputedStyle?.(element);
            return Boolean(
              (!rect || rect.width > 0 || rect.height > 0)
              && style?.display !== 'none'
              && style?.visibility !== 'hidden'
              && element.type !== 'hidden'
            );
          };
          const findPasswordInput = () => {
            const selectors = [
              'input[name="new-password"]',
              'input[autocomplete="new-password"]',
              'input[id$="-new-password"]',
              'input[type="password"][name*="password" i]',
              'input[type="password"]',
            ];
            for (const selector of selectors) {
              const input = Array.from(document.querySelectorAll(selector)).find(isVisibleElement);
              if (input) return input;
            }
            return null;
          };
          const dispatchInputEvents = (input, value) => {
            try {
              input.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                data: value,
                inputType: 'insertText',
              }));
            } catch {}
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            try {
              input.dispatchEvent(new KeyboardEvent('keyup', { key: String(value || '').slice(-1), bubbles: true }));
            } catch {}
          };
          const setInputValue = (input) => {
            input.focus?.();
            input.click?.();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(input, '');
            } else {
              input.value = '';
            }
            input.setAttribute('value', '');
            dispatchInputEvents(input, '');
            if (nativeSetter) {
              nativeSetter.call(input, targetPassword);
            } else {
              input.value = targetPassword;
            }
            input.setAttribute('value', targetPassword);
            dispatchInputEvents(input, targetPassword);
            input.focus?.();
          };
          const isActionEnabled = (element) => {
            if (!element || !isVisibleElement(element)) return false;
            if (element.disabled) return false;
            if (String(element.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true') return false;
            const ariaBusy = String(element.getAttribute?.('aria-busy') || '').toLowerCase();
            if (ariaBusy === 'true') return false;
            const pending = [
              element.getAttribute?.('data-loading'),
              element.getAttribute?.('data-pending'),
              element.getAttribute?.('data-submitting'),
              element.getAttribute?.('data-state'),
            ].map((value) => String(value || '').toLowerCase()).join(' ');
            return !/\b(?:true|loading|pending|submitting|busy)\b/.test(pending);
          };
          const getActionText = (element) => [
            element?.innerText,
            element?.textContent,
            element?.value,
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
          ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          const findSubmitButton = (input) => {
            const form = input?.form || input?.closest?.('form') || null;
            const roots = [form, document].filter(Boolean);
            for (const root of roots) {
              const direct = Array.from(root.querySelectorAll('button[type="submit"], input[type="submit"]'))
                .find(isActionEnabled);
              if (direct) return direct;
              const byText = Array.from(root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
                .find((element) => isActionEnabled(element) && /continue|sign\s*up|submit|注册|创建|继续|下一步|create/i.test(getActionText(element)));
              if (byText) return byText;
            }
            return null;
          };
          const clickElement = (element) => {
            element.scrollIntoView?.({ block: 'center', inline: 'center' });
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
              try {
                element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
              } catch {}
            }
            element.click?.();
          };
          const submitFormFallback = (input) => {
            const form = input?.form || input?.closest?.('form') || null;
            if (!form) return false;
            try {
              if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
                return true;
              }
            } catch {}
            try {
              form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
              return true;
            } catch {
              try {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return true;
              } catch {}
            }
            return false;
          };
          const waitForPasswordInput = async (timeoutMs = 30000) => {
            const startedAt = Date.now();
            let lastAnyPasswordInput = null;
            while (Date.now() - startedAt < timeoutMs) {
              const input = findPasswordInput();
              if (input) return input;
              lastAnyPasswordInput = document.querySelector('input[type="password"], input[name*="password" i], input[autocomplete="new-password"]');
              await sleep(250);
            }
            return lastAnyPasswordInput && isVisibleElement(lastAnyPasswordInput) ? lastAnyPasswordInput : null;
          };
          const isPasswordPageStillVisible = () => {
            const input = findPasswordInput();
            if (input && isVisibleElement(input)) return true;
            const path = `${location.pathname || ''} ${location.href || ''}`;
            return /\/(?:password|create-account\/password)(?:[/?#]|$)/i.test(path);
          };
          const readPageState = () => {
            const pageText = String(document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ').trim();
            const path = `${location.pathname || ''} ${location.href || ''}`;
            const codeInput = document.querySelector('input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]');
            return {
              url: location.href,
              passwordPage: isPasswordPageStillVisible(),
              phoneVerificationPage: /\/(?:phone|contact)-verification(?:[/?#]|$)/i.test(path)
                || (/check\s+your\s+phone|phone\s+verification|verify\s+your\s+phone|sms|text\s+message|验证码|短信/i.test(pageText) && Boolean(codeInput)),
              emailVerificationPage: /\/email-verification(?:[/?#]|$)/i.test(path),
              profilePage: /profile|birthday|name/i.test(path)
                || /date\s+of\s+birth|birthday|first\s+name|last\s+name|你的生日|名字|姓氏/i.test(pageText),
              bodyTextPreview: pageText.slice(0, 240),
            };
          };
          const waitForSubmitTransition = async (timeoutMs = 15000) => {
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
              const state = readPageState();
              if (state.phoneVerificationPage || state.emailVerificationPage || state.profilePage || !state.passwordPage) {
                return { advanced: true, ...state };
              }
              await sleep(250);
            }
            return { advanced: false, ...readPageState() };
          };

          const input = await waitForPasswordInput();
          if (!input) {
            return { ok: false, error: `未找到 new-password 密码输入框。URL: ${location.href}` };
          }

          let filled = false;
          for (let attempt = 1; attempt <= 5; attempt += 1) {
            setInputValue(input);
            await sleep(250);
            if (String(input.value || '') === String(targetPassword)) {
              filled = true;
              break;
            }
          }
          if (!filled || String(input.value || '') !== String(targetPassword)) {
            return {
              ok: false,
              fatal: true,
              error: `密码输入后页面值未保持。当前长度=${String(input.value || '').length}`,
              inputName: input.name || '',
              inputId: input.id || '',
              url: location.href,
            };
          }

          let button = null;
          for (let attempt = 1; attempt <= 40; attempt += 1) {
            button = findSubmitButton(input);
            if (button) break;
            await sleep(250);
          }
          if (!button) {
            return {
              ok: false,
              fatal: true,
              error: `密码已填写，但未找到可点击的继续按钮。URL: ${location.href}`,
              inputName: input.name || '',
              inputId: input.id || '',
              valueLength: String(input.value || '').length,
              url: location.href,
            };
          }

          clickElement(button);
          let transition = await waitForSubmitTransition(6000);
          if (!transition.advanced) {
            submitFormFallback(input);
            transition = await waitForSubmitTransition(9000);
          }
          if (!transition.advanced) {
            const refreshedInput = findPasswordInput();
            const valueLength = String(refreshedInput?.value || input.value || '').length;
            return {
              ok: false,
              fatal: true,
              error: `密码已写入并点击继续，但页面仍停留在密码页。当前密码长度=${valueLength}。URL: ${location.href}`,
              inputName: input.name || '',
              inputId: input.id || '',
              valueLength,
              buttonText: getActionText(button),
              transition,
              url: location.href,
            };
          }
          return {
            ok: true,
            inputName: input.name || '',
            inputId: input.id || '',
            valueLength: String(input.value || '').length,
            buttonText: getActionText(button),
            transition,
            url: location.href,
          };
        },
        args: [password],
      });

      return executionResult.result || null;
    }

    function resolveStep3AccountIdentity(state = {}) {
      const resolvedEmail = String(state?.email || '').trim();
      const rawAccountIdentifierType = String(state?.accountIdentifierType || '').trim().toLowerCase();
      const signupPhoneNumber = String(
        state?.signupPhoneNumber
        || (rawAccountIdentifierType === 'phone' ? state?.accountIdentifier : '')
        || ''
      ).trim();
      const explicitEmailIdentity = rawAccountIdentifierType === 'email' && resolvedEmail;
      const shouldUsePhoneIdentity = !explicitEmailIdentity && (
        rawAccountIdentifierType === 'phone'
        || Boolean(signupPhoneNumber)
        || getResolvedSignupMethodForStep3(state) === 'phone'
      );
      const accountIdentifierType = shouldUsePhoneIdentity
        ? 'phone'
        : (resolvedEmail ? 'email' : 'email');
      const accountIdentifier = accountIdentifierType === 'phone'
        ? signupPhoneNumber
        : resolvedEmail;

      return {
        accountIdentifierType,
        accountIdentifier,
        email: resolvedEmail,
        phoneNumber: signupPhoneNumber,
      };
    }

    async function executeStep3(state) {
      const identity = resolveStep3AccountIdentity(state);
      if (!identity.accountIdentifier) {
        if (identity.accountIdentifierType === 'phone') {
          throw new Error('缺少注册手机号，请先完成步骤 2 或在侧栏填写注册手机号后再执行步骤 3。');
        }
        throw new Error('缺少注册账号，请先完成步骤 2。');
      }

      const signupTabId = await getTabId('signup-page');
      if (!signupTabId || !(await isTabAlive('signup-page'))) {
        throw new Error('认证页面标签页已关闭，请先重新完成步骤 2。');
      }

      const password = resolveStep3Password(state);
      await setPasswordState(password);

      const accounts = Array.isArray(state.accounts) ? state.accounts.slice() : [];
      accounts.push({
        email: identity.email,
        phoneNumber: identity.phoneNumber,
        accountIdentifierType: identity.accountIdentifierType,
        accountIdentifier: identity.accountIdentifier,
        password,
        createdAt: new Date().toISOString(),
      });
      await setState({ accounts });

      await chrome.tabs.update(signupTabId, { active: true });
      await ensureContentScriptReadyOnTab('signup-page', signupTabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: 'signup-page',
        timeoutMs: 45000,
        retryDelayMs: 900,
        logMessage: '步骤 3：密码页内容脚本未就绪，正在等待页面恢复...',
      });

      const identityLabel = identity.accountIdentifierType === 'phone'
        ? `注册手机号为 ${identity.accountIdentifier}`
        : `邮箱为 ${identity.accountIdentifier}`;
      await addLog(
        `步骤 3：正在填写密码，${identityLabel}，密码为${state.customPassword ? '自定义' : '自动生成'}（${password.length} 位）`
      );
      const completionPayload = {
        email: identity.email,
        phoneNumber: identity.phoneNumber,
        accountIdentifierType: identity.accountIdentifierType,
        accountIdentifier: identity.accountIdentifier,
        password,
        signupVerificationRequestedAt: Date.now(),
        directPasswordFill: true,
      };

      const directFillResult = await fillSignupPasswordDirectly(signupTabId, password);
      if (directFillResult?.ok) {
        await addLog(
          `步骤 3：已直接写入手机号注册密码并点击继续（输入框 ${directFillResult.inputName || directFillResult.inputId || 'password'}，${directFillResult.valueLength} 位）。`,
          'ok'
        );
        if (typeof completeNodeFromBackground === 'function') {
          await completeNodeFromBackground('fill-password', {
            ...completionPayload,
            directFillResult,
          });
        }
      } else {
        if (directFillResult?.error) {
          await addLog(`步骤 3：后台直填密码未成功，回退到内容脚本路径：${directFillResult.error}`, 'warn');
        }
        if (directFillResult?.fatal) {
          throw new Error(`步骤 3：手机号注册密码自动填写失败：${directFillResult.error}`);
        }
        await sendToContentScript('signup-page', {
          type: 'EXECUTE_NODE',
          nodeId: 'fill-password',
          step: 3,
          source: 'background',
          payload: {
            email: identity.email,
            phoneNumber: identity.phoneNumber,
            accountIdentifierType: identity.accountIdentifierType,
            accountIdentifier: identity.accountIdentifier,
            password,
          },
        });
      }

      if (typeof appendAccountRunRecord === 'function') {
        try {
          await appendAccountRunRecord('running', {
            ...state,
            ...identity,
            password,
            currentNodeId: 'fill-password',
          });
        } catch (err) {
          await addLog(`步骤 3：密码已填写，但预保存账号记录失败：${err?.message || err}`, 'warn');
        }
      }
    }

    return { executeStep3 };
  }

  return { createStep3Executor };
});
