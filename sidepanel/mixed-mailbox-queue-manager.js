(function attachMixedMailboxQueueManager(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.SidepanelMixedMailboxQueueManager = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createMixedMailboxQueueManagerModule() {
  function normalizeEmail(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function buildDisplayEntry(entry = {}, activeId = '') {
    const type = String(entry?.type || '').trim().toLowerCase();
    return {
      id: String(entry?.id || ''),
      type,
      typeLabel: type === 'outlook' ? 'Outlook' : 'iCloud URL',
      email: normalizeEmail(entry?.email),
      enabled: Boolean(entry?.enabled),
      used: Boolean(entry?.used),
      current: Boolean(activeId) && String(entry?.id || '') === String(activeId),
      hasError: Boolean(String(entry?.lastError || '').trim()),
      errorLabel: String(entry?.lastError || '').trim() ? '异常' : '',
    };
  }

  function getAvailableEntryCount(entries = []) {
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry?.enabled && !entry?.used)
      .length;
  }

  function buildActiveStatePatch(entry = {}) {
    const type = String(entry?.type || '').trim().toLowerCase();
    return {
      activeMixedMailboxEntryId: String(entry?.id || '').trim(),
      email: normalizeEmail(entry?.email),
      currentHotmailAccountId: type === 'outlook'
        ? (String(entry?.hotmailAccountId || '').trim() || null)
        : null,
    };
  }

  function buildGeneratorUiPolicy(mailProvider = '', currentGenerator = '') {
    const provider = String(mailProvider || '').trim().toLowerCase();
    const generator = String(currentGenerator || '').trim().toLowerCase();
    if (!['hotmail-api', 'luckmail-api', 'custom', '2925'].includes(provider)) {
      return {
        allowedGenerators: null,
        selectedGenerator: generator,
        showGenerator: true,
      };
    }
    return {
      allowedGenerators: ['provider-default', 'mixed-pool'],
      selectedGenerator: generator === 'mixed-pool' ? 'mixed-pool' : 'provider-default',
      showGenerator: true,
    };
  }

  function summarizeEntries(entries = []) {
    const list = Array.isArray(entries) ? entries : [];
    return {
      total: list.length,
      outlook: list.filter((entry) => entry?.type === 'outlook').length,
      icloudUrl: list.filter((entry) => entry?.type === 'icloud-url').length,
      available: getAvailableEntryCount(list),
      used: list.filter((entry) => entry?.used).length,
      errors: list.filter((entry) => String(entry?.lastError || '').trim()).length,
    };
  }

  function createMixedMailboxQueueManager(context = {}) {
    const { dom = {}, helpers = {}, state = {}, actions = {} } = context;
    let renderedEntries = [];
    let searchTerm = '';
    let filterMode = 'all';
    let loading = false;

    function getEntries() {
      return Array.isArray(state.getEntries?.()) ? state.getEntries() : [];
    }

    function escapeHtml(value = '') {
      return helpers.escapeHtml ? helpers.escapeHtml(value) : String(value || '');
    }

    function setLoading(nextLoading) {
      loading = Boolean(nextLoading);
      [dom.btnImport, dom.btnRefresh, dom.btnClearUsed, dom.btnDeleteAll]
        .filter(Boolean)
        .forEach((button) => { button.disabled = loading; });
      if (dom.inputImport) dom.inputImport.disabled = loading;
    }

    function getFilteredEntries(entries) {
      const activeId = String(state.getActiveId?.() || '');
      const needle = searchTerm.trim().toLowerCase();
      return entries
        .map((entry) => ({ source: entry, display: buildDisplayEntry(entry, activeId) }))
        .filter(({ display }) => {
          const filterMatches = (() => {
            if (filterMode === 'current') return display.current;
            if (filterMode === 'available') return display.enabled && !display.used;
            if (filterMode === 'used') return display.used;
            if (filterMode === 'error') return display.hasError;
            return true;
          })();
          if (!filterMatches) return false;
          return !needle || `${display.email} ${display.typeLabel}`.toLowerCase().includes(needle);
        });
    }

    function renderEntries(entries = getEntries()) {
      renderedEntries = Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [];
      const summary = summarizeEntries(renderedEntries);
      if (dom.summary) {
        dom.summary.textContent = `共 ${summary.total} 条：Outlook ${summary.outlook}，iCloud URL ${summary.icloudUrl}，可用 ${summary.available}，已用 ${summary.used}，异常 ${summary.errors}`;
      }
      if (dom.btnClearUsed) dom.btnClearUsed.disabled = loading || summary.used === 0;
      if (dom.btnDeleteAll) dom.btnDeleteAll.disabled = loading || summary.total === 0;
      if (!dom.list) return;

      const filtered = getFilteredEntries(renderedEntries);
      if (!filtered.length) {
        dom.list.innerHTML = '<div class="luckmail-empty">没有匹配的统一邮箱队列记录。</div>';
        return;
      }

      dom.list.innerHTML = filtered.map(({ display }) => `
        <div class="luckmail-item mixed-mailbox-item${display.current ? ' is-current' : ''}" data-entry-id="${escapeHtml(display.id)}">
          <div class="luckmail-item-main">
            <div class="luckmail-item-email-row">
              <div class="luckmail-item-email">${escapeHtml(display.email)}</div>
              <span class="luckmail-tag ${display.type === 'outlook' ? 'active' : 'current'}">${escapeHtml(display.typeLabel)}</span>
            </div>
            <div class="luckmail-item-meta">
              ${display.current ? '<span class="luckmail-tag current">当前</span>' : ''}
              ${display.used ? '<span class="luckmail-tag used">已用</span>' : '<span class="luckmail-tag active">未用</span>'}
              ${display.enabled ? '<span class="luckmail-tag active">启用</span>' : '<span class="luckmail-tag disabled">停用</span>'}
              ${display.hasError ? '<span class="luckmail-tag used">异常</span>' : ''}
            </div>
          </div>
          <div class="luckmail-item-actions">
            <button class="btn btn-outline btn-xs" type="button" data-action="use">使用</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-used">${display.used ? '标记未用' : '标记已用'}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-enabled">${display.enabled ? '停用' : '启用'}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="delete">删除</button>
          </div>
        </div>
      `).join('');
    }

    async function persist(nextEntries) {
      setLoading(true);
      try {
        const savedEntries = await actions.patchEntries?.(nextEntries);
        state.setEntries?.(Array.isArray(savedEntries) ? savedEntries : nextEntries);
        renderEntries(Array.isArray(savedEntries) ? savedEntries : nextEntries);
      } finally {
        setLoading(false);
      }
    }

    async function importText() {
      const text = String(dom.inputImport?.value || '');
      if (!text.trim()) {
        helpers.showToast?.('请先粘贴 Outlook 或 iCloud URL 邮箱记录。', 'warn');
        return;
      }
      setLoading(true);
      try {
        const result = await actions.importEntries?.(text);
        if (result?.error) throw new Error(result.error);
        state.setEntries?.(result?.entries || getEntries());
        renderEntries(result?.entries || getEntries());
        if (dom.inputImport) dom.inputImport.value = '';
        const errorCount = Array.isArray(result?.errors) ? result.errors.length : 0;
        helpers.showToast?.(
          `新增 ${result?.addedCount || 0} 条，更新 ${result?.updatedCount || 0} 条${errorCount ? `，${errorCount} 行无效` : ''}`,
          errorCount ? 'warn' : 'success',
          2600
        );
      } catch (error) {
        helpers.showToast?.(`统一邮箱导入失败：${error.message}`, 'error');
      } finally {
        setLoading(false);
      }
    }

    async function handleListClick(event) {
      const button = event.target.closest('[data-action]');
      const item = event.target.closest('[data-entry-id]');
      if (!button || !item || loading) return;
      const id = String(item.dataset.entryId || '');
      const action = String(button.dataset.action || '');
      const entry = renderedEntries.find((candidate) => String(candidate.id) === id);
      if (!entry) return;

      if (action === 'use') {
        await actions.setActive?.(entry);
        renderEntries(getEntries());
        return;
      }
      if (action === 'delete') {
        const confirmed = await helpers.openConfirmModal?.({
          title: '删除邮箱',
          message: `确认从统一队列删除 ${entry.email} 吗？`,
          confirmLabel: '确认删除',
          confirmVariant: 'btn-danger',
        });
        if (!confirmed) return;
        await persist(renderedEntries.filter((candidate) => String(candidate.id) !== id));
        return;
      }

      await persist(renderedEntries.map((candidate) => {
        if (String(candidate.id) !== id) return candidate;
        if (action === 'toggle-used') return { ...candidate, used: !candidate.used, lastError: '' };
        if (action === 'toggle-enabled') return { ...candidate, enabled: !candidate.enabled };
        return candidate;
      }));
    }

    function bindEvents() {
      dom.btnImport?.addEventListener('click', importText);
      dom.btnRefresh?.addEventListener('click', () => renderEntries(getEntries()));
      dom.inputSearch?.addEventListener('input', (event) => {
        searchTerm = String(event.target.value || '');
        renderEntries(renderedEntries);
      });
      dom.selectFilter?.addEventListener('change', (event) => {
        filterMode = String(event.target.value || 'all');
        renderEntries(renderedEntries);
      });
      dom.list?.addEventListener('click', handleListClick);
      dom.btnClearUsed?.addEventListener('click', async () => {
        await persist(renderedEntries.filter((entry) => !entry.used));
      });
      dom.btnDeleteAll?.addEventListener('click', async () => {
        const confirmed = await helpers.openConfirmModal?.({
          title: '清空统一邮箱队列',
          message: '确认删除统一邮箱队列中的全部记录吗？底层 Outlook 账号不会被删除。',
          confirmLabel: '全部删除',
          confirmVariant: 'btn-danger',
        });
        if (confirmed) await persist([]);
      });
    }

    return {
      bindEvents,
      renderEntries,
      refresh: () => renderEntries(getEntries()),
      reset: () => renderEntries([]),
    };
  }

  return {
    buildActiveStatePatch,
    buildDisplayEntry,
    buildGeneratorUiPolicy,
    createMixedMailboxQueueManager,
    getAvailableEntryCount,
    summarizeEntries,
  };
});
