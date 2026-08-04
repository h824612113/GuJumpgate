# ChatGPT Session JSONL Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After registration succeeds, fetch the complete ChatGPT `/api/auth/session` response and append it as one compact JSON object per line to a local JSONL file.

**Architecture:** Reuse the existing temporary ChatGPT tab and content-script session reader in `wait-registration-success`. Add a small helper endpoint that appends a single JSON line under the project `data/` directory using the existing helper process and lock. The registration node completes only after the local append succeeds.

**Tech Stack:** Chrome MV3 background service worker, injected content script, Node test runner, Python `http.server` helper.

## Global Constraints

- Preserve the complete session response; do not reduce it to `accessToken`.
- Keep each serialized record on exactly one line.
- Write only to the local helper; never include session contents in extension logs.
- Preserve unrelated existing registration/export behavior.

### Task 1: Add failing session JSONL executor tests

**Files:**
- Create: `tests/chatgpt-session-jsonl-export.test.js`
- Test: `background/steps/wait-registration-success.js`

**Interfaces:**
- Consumes: `MultiPageBackgroundStep6.createStep6Executor` dependency injection.
- Produces: Regression coverage for session read, compact serialization, helper append payload, and completion ordering.

- [ ] **Step 1: Write the failing test**

Load `background/steps/wait-registration-success.js` in a VM and instantiate the executor with fake tab/session/helper dependencies. Assert that `executeStep6({ hotmailLocalBaseUrl: 'http://127.0.0.1:17373' })` sends the exact complete session object as `JSON.stringify(session) + '\n'` to `/append-chatgpt-session`, and that `completeNodeFromBackground` runs after the append response. Add a second test asserting a missing access token/session object produces an error and does not complete the node.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chatgpt-session-jsonl-export.test.js`

Expected: FAIL because the current step only waits and completes; it does not read or append a ChatGPT session.

### Task 2: Implement background session read and append

**Files:**
- Modify: `background/steps/wait-registration-success.js`
- Modify: `background.js:16295-16330`

**Interfaces:**
- Consumes: existing `openChatGptSessionExportTab`, `ensureContentScriptReadyOnTab`, and `sendToContentScriptResilient` functions.
- Produces: `appendChatGptSessionJsonLine(state, visibleStep)` used by `executeStep6`.

- [ ] **Step 1: Implement minimal session validation and serialization**

Read the session through the existing `PLUS_CHECKOUT_GET_STATE` message with `includeSession: true` and `includeAccessToken: true`. Require a non-array object session and a non-empty `accessToken`; serialize the complete session using `JSON.stringify` and append exactly one newline.

- [ ] **Step 2: Implement local helper POST**

POST `{ content: line }` to `buildLocalHelperEndpoint(normalizedHotmailLocalBaseUrl, '/append-chatgpt-session')`. Treat non-2xx or `{ ok: false }` as a step error. Log only the returned file path, never the session body.

- [ ] **Step 3: Call append before completing registration**

In `executeStep6`, after the existing stabilization/cookie handling and before `completeNodeFromBackground`, call the append function and report the local file path.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/chatgpt-session-jsonl-export.test.js`

Expected: PASS.

### Task 3: Add failing helper append test

**Files:**
- Create: `tests/test_hotmail_helper_session_jsonl.py`
- Test: `scripts/hotmail_helper.py`

**Interfaces:**
- Consumes: helper append function and its fixed `data/chatgpt-session.jsonl` target.
- Produces: coverage that repeated appends preserve prior lines and add one newline per record.

- [ ] **Step 1: Write the failing test**

Import the helper module, replace its target path with a temporary file, call the append function twice with JSON lines, and assert the file contains the two original lines separated by exactly one newline. Assert an input line containing a newline is normalized to one record line.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests/test_hotmail_helper_session_jsonl.py -v`

Expected: FAIL because the append function and endpoint do not exist.

### Task 4: Implement helper append endpoint

**Files:**
- Modify: `scripts/hotmail_helper.py`

**Interfaces:**
- Consumes: POST `/append-chatgpt-session` with `{ "content": "<compact JSON>" }`.
- Produces: `{ "ok": true, "filePath": ".../data/chatgpt-session.jsonl" }`.

- [ ] **Step 1: Add locked append function**

Define a fixed `CHATGPT_SESSION_JSONL_PATH` under `BASE_DIR/data`. Strip CR/LF from the submitted content, reject empty content, create the parent directory, and append `content + '\n'` under `ACCOUNT_RECORDS_LOCK`.

- [ ] **Step 2: Add POST route**

Handle `/append-chatgpt-session`, invoke the append function, and return the absolute path. Keep existing endpoints unchanged.

- [ ] **Step 3: Run the helper test**

Run: `python3 -m unittest tests/test_hotmail_helper_session_jsonl.py -v`

Expected: PASS.

### Task 5: Full verification and commit

**Files:**
- Modify: `tests/chatgpt-session-jsonl-export.test.js`
- Modify: `tests/test_hotmail_helper_session_jsonl.py`
- Modify: `background/steps/wait-registration-success.js`
- Modify: `scripts/hotmail_helper.py`
- Modify: `background.js`

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/chatgpt-session-jsonl-export.test.js && python3 -m unittest tests/test_hotmail_helper_session_jsonl.py -v`

- [ ] **Step 2: Run complete JavaScript tests and syntax checks**

Run: `node --test tests/*.test.js && node --check background/steps/wait-registration-success.js && node --check background.js && python3 -m py_compile scripts/hotmail_helper.py && git diff --check`

- [ ] **Step 3: Review the diff for secret leakage**

Run: `git diff -- background/steps/wait-registration-success.js scripts/hotmail_helper.py background.js tests/chatgpt-session-jsonl-export.test.js tests/test_hotmail_helper_session_jsonl.py` and confirm no real session, token, email credential, or URL token is present.

- [ ] **Step 4: Commit**

```bash
git add background/steps/wait-registration-success.js scripts/hotmail_helper.py background.js tests/chatgpt-session-jsonl-export.test.js tests/test_hotmail_helper_session_jsonl.py
git commit -m "feat: append registration sessions to local jsonl"
```
