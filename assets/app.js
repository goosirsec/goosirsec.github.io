(() => {
  'use strict';

  const STORAGE_KEY = 'aml-browser-lab:kyc:v3';
  const SESSION_LOG_KEY = 'aml-browser-lab:session-log:v1';
  const PAGE_SIZE = 10;
  const RAW_CONFIRM_TEXT = '导出未脱敏测试数据';
  const RAW_COPY_CONFIRM_TEXT = '复制未脱敏测试数据';
  const MASKED_FIELDS = ['name', 'idCard', 'passport', 'phone', 'email', 'bankCard', 'iban', 'swift', 'address'];
  const EXPORT_FIELDS = ['customerId', 'name', 'risk', 'idCard', 'passport', 'phone', 'email', 'bankCard', 'iban', 'swift', 'address', 'company', 'occupation'];

  const state = {
    records: [],
    selected: new Set(),
    search: '',
    risk: '',
    page: 1,
    revealUntil: 0,
    revealTimer: null,
    lastDeletedId: null,
    deleteTargetId: null,
    drawerRecordId: null,
    drawerReturnFocus: null,
    rawCopyKind: null,
    logs: [],
    recordStorageAvailable: true,
    sessionStorageAvailable: true,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const dialogReturnFocus = new WeakMap();

  function pad(value, length = 2) {
    return String(value).padStart(length, '0');
  }

  function updateStorageMode() {
    const badge = $('#storageMode');
    if (!badge) return;
    const recordMemoryOnly = !state.recordStorageAvailable;
    const logMemoryOnly = !state.sessionStorageAvailable;
    badge.hidden = !recordMemoryOnly && !logMemoryOnly;
    badge.textContent = recordMemoryOnly
      ? '内存模式 · 刷新会丢失'
      : '日志内存模式 · 刷新会丢失';
  }

  function chinaIdChecksum(body) {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    const sum = body.split('').reduce((total, digit, index) => total + (Number(digit) * weights[index]), 0);
    return checkCodes[sum % 11];
  }

  function createInitialRecords() {
    const occupations = ['测试工程师', '合规专员', '产品经理', '财务分析师', '采购专员', '设计师', '运营经理', '数据分析师'];
    const cities = ['模拟市测试区', '样例市演示区', '虚构市沙盒区', '测试市无真实区'];
    const risks = ['低', '低', '中', '低', '高', '中', '低', '中'];
    return Array.from({ length: 40 }, (_, index) => {
      const number = index + 1;
      const month = pad((index % 12) + 1);
      const day = pad((index % 27) + 1);
      const sequence = pad(100 + number, 3);
      const idBody = `9900001990${month}${day}${sequence}`;
      return {
        customerId: `MOCK-KYC-${pad(number, 3)}`,
        name: `测试用户${pad(number, 3)}`,
        risk: risks[index % risks.length],
        idCard: `${idBody}${chinaIdChecksum(idBody)}`,
        passport: `MOCK-PASS-${pad(number, 3)}`,
        phone: `000-TEST-${pad(number, 4)}`,
        email: `mock.kyc.${pad(number, 3)}@example.test`,
        bankCard: '4111111111111111',
        iban: 'GB82WEST12345698765432',
        swift: `MOCKZZZZ${pad(number, 3)}`,
        address: `${cities[index % cities.length]}示例路 ${number} 号（MOCK）`,
        company: `MOCK 风控科技 ${pad((index % 10) + 1, 2)} 公司`,
        occupation: occupations[index % occupations.length],
        createdAt: `2026-07-${pad((index % 20) + 1)}T09:${pad(index % 60)}:00+08:00`,
        updatedAt: `2026-07-${pad((index % 20) + 1)}T09:${pad(index % 60)}:00+08:00`,
        deletedAt: null,
        mock: true,
        source: 'builtin-mock',
        schemaVersion: 3,
      };
    });
  }

  function validStoredRecords(value) {
    return Array.isArray(value) && value.every((item) => item
      && typeof item.customerId === 'string'
      && item.schemaVersion === 3
      && ['builtin-mock', 'user-confirmed-test'].includes(item.source));
  }

  function loadRecords() {
    let stored;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      state.records = createInitialRecords();
      state.recordStorageAvailable = false;
      updateStorageMode();
      return;
    }
    if (stored === null) {
      state.records = createInitialRecords();
      saveRecords();
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      state.records = validStoredRecords(parsed) ? parsed : createInitialRecords();
      if (!validStoredRecords(parsed)) saveRecords();
    } catch {
      state.records = createInitialRecords();
      saveRecords();
    }
  }

  function saveRecords() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
      state.recordStorageAvailable = true;
      updateStorageMode();
      return true;
    } catch {
      state.recordStorageAvailable = false;
      updateStorageMode();
      return false;
    }
  }

  function loadLogs() {
    let stored;
    try {
      stored = sessionStorage.getItem(SESSION_LOG_KEY) || '[]';
    } catch {
      state.logs = [];
      state.sessionStorageAvailable = false;
      updateStorageMode();
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      state.logs = Array.isArray(parsed) ? parsed.slice(0, 200) : [];
    } catch {
      state.logs = [];
    }
  }

  function addLog(action, result = '完成') {
    const entry = {
      timestamp: new Date().toISOString(),
      action: String(action).slice(0, 80),
      result: String(result).slice(0, 40),
    };
    state.logs.unshift(entry);
    state.logs = state.logs.slice(0, 200);
    try {
      sessionStorage.setItem(SESSION_LOG_KEY, JSON.stringify(state.logs));
      state.sessionStorageAvailable = true;
    } catch {
      state.sessionStorageAvailable = false;
    }
    updateStorageMode();
    renderLogs();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function xmlEscape(value) {
    return escapeHtml(value);
  }

  function csvCell(value) {
    const text = String(value ?? '');
    const safeText = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  }

  function maskValue(field, value) {
    const text = String(value ?? '');
    if (!text) return '';
    if (field === 'name') return `${text.slice(0, 1)}${'*'.repeat(Math.max(2, text.length - 1))}`;
    if (field === 'email') {
      const [local, domain = ''] = text.split('@');
      return `${local.slice(0, 2)}***@${domain}`;
    }
    if (field === 'address') return `${text.slice(0, 6)}********（MOCK）`;
    if (field === 'phone') return `${text.slice(0, 3)}****${text.slice(-4)}`;
    if (field === 'idCard') return `${text.slice(0, 6)}********${text.slice(-4)}`;
    if (field === 'passport') return `${text.slice(0, 2)}****${text.slice(-3)}`;
    if (field === 'bankCard') return `${text.slice(0, 4)} **** **** ${text.slice(-4)}`;
    if (field === 'iban') return `${text.slice(0, 4)} **** **** ${text.slice(-4)}`;
    if (field === 'swift') return `${text.slice(0, 4)}***${text.slice(-2)}`;
    return text.length > 6 ? `${text.slice(0, 2)}***${text.slice(-2)}` : '***';
  }

  function presentRecord(record, masked = true) {
    return Object.fromEntries(EXPORT_FIELDS.map((field) => [field, masked && MASKED_FIELDS.includes(field) ? maskValue(field, record[field]) : record[field]]));
  }

  function recordNature(record) {
    return record.source === 'builtin-mock' ? 'BUILT-IN MOCK' : 'USER-CONFIRMED TEST DATA / CONTENT NOT VERIFIED';
  }

  function activeRecords() {
    return state.records.filter((record) => !record.deletedAt);
  }

  function filteredRecords() {
    const term = state.search.trim().toLowerCase();
    return activeRecords().filter((record) => {
      const searchMatch = !term || [record.customerId, record.name, record.company, record.email, record.phone]
        .some((value) => String(value).toLowerCase().includes(term));
      const riskMatch = !state.risk || record.risk === state.risk;
      return searchMatch && riskMatch;
    });
  }

  function pageRecords() {
    const records = filteredRecords();
    const start = (state.page - 1) * PAGE_SIZE;
    return records.slice(start, start + PAGE_SIZE);
  }

  function isRevealed() {
    return Date.now() < state.revealUntil;
  }

  function riskClass(risk) {
    return risk === '高' ? 'risk-high' : risk === '中' ? 'risk-medium' : 'risk-low';
  }

  function renderTable() {
    const rows = pageRecords();
    const reveal = isRevealed();
    $('#customerRows').innerHTML = rows.map((record) => `
      <tr>
        <td><input class="row-select" type="checkbox" data-id="${escapeHtml(record.customerId)}" aria-label="选择 ${escapeHtml(record.name)}" ${state.selected.has(record.customerId) ? 'checked' : ''}></td>
        <td class="mono">${escapeHtml(record.customerId)}</td>
        <td><span class="customer-name"><strong>${escapeHtml(record.name)}</strong><span>${record.source === 'builtin-mock' ? '内置 MOCK' : '用户确认测试数据'}</span></span></td>
        <td><span class="risk ${riskClass(record.risk)}">${escapeHtml(record.risk)}风险</span></td>
        <td class="mono">${escapeHtml(reveal ? record.idCard : maskValue('idCard', record.idCard))}</td>
        <td class="mono">${escapeHtml(reveal ? record.phone : maskValue('phone', record.phone))}</td>
        <td class="mono">${escapeHtml(reveal ? record.bankCard : maskValue('bankCard', record.bankCard))}</td>
        <td><strong>${escapeHtml(record.company)}</strong><br><span class="section-help">${escapeHtml(record.occupation)}</span></td>
        <td class="row-actions">
          <button class="text-action view-record" data-id="${escapeHtml(record.customerId)}" type="button">查看</button>
          <button class="text-action edit-record" data-id="${escapeHtml(record.customerId)}" type="button">编辑</button>
          <button class="text-action danger delete-record" data-id="${escapeHtml(record.customerId)}" type="button">删除</button>
        </td>
      </tr>
    `).join('');

    const count = filteredRecords().length;
    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    $('#emptyState').hidden = rows.length !== 0;
    $('.table-scroll').hidden = rows.length === 0;
    $('#resultCount').textContent = `共 ${count} 条（内置数据均为 MOCK）`;
    $('#pageStatus').textContent = `第 ${state.page} / ${totalPages} 页`;
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= totalPages;

    const pageIds = rows.map((record) => record.customerId);
    const selectedOnPage = pageIds.filter((id) => state.selected.has(id)).length;
    const selectPage = $('#selectPage');
    selectPage.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    selectPage.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    updateSelectionSummary();
  }

  function updateSelectionSummary() {
    const activeIds = new Set(activeRecords().map((record) => record.customerId));
    state.selected.forEach((id) => { if (!activeIds.has(id)) state.selected.delete(id); });
    const count = state.selected.size;
    $('#selectionSummary').textContent = `已选 ${count} 条`;
    $('#exportSelectionCount').textContent = String(count);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function switchView(viewName, updateHash = true) {
    $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === viewName));
    $$('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === viewName;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    $('#sidebar').classList.remove('is-open');
    $('#mobileMenu').setAttribute('aria-expanded', 'false');
    if (viewName === 'manual') renderLogs();
    if (updateHash && window.location.hash.slice(1) !== viewName) window.location.hash = viewName;
    $('#main-content').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function customerById(id) {
    return state.records.find((record) => record.customerId === id);
  }

  function focusableElements(root) {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
  }

  function trapFocus(event, root) {
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(root);
    if (!focusable.length) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showDialog(dialog, initialFocusSelector) {
    dialogReturnFocus.set(dialog, document.activeElement);
    dialog.showModal();
    window.setTimeout(() => {
      const target = initialFocusSelector ? $(initialFocusSelector, dialog) : focusableElements(dialog)[0];
      (target || dialog).focus();
    }, 0);
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function restoreDialogFocus(dialog) {
    const target = dialogReturnFocus.get(dialog);
    dialogReturnFocus.delete(dialog);
    if (target?.isConnected) target.focus();
  }

  function openDrawer(id) {
    const record = customerById(id);
    if (!record) return;
    if (!$('#detailDrawer').classList.contains('is-open')) state.drawerReturnFocus = document.activeElement;
    state.drawerRecordId = id;
    const reveal = isRevealed();
    const sensitive = (field) => escapeHtml(reveal ? record[field] : maskValue(field, record[field]));
    $('#drawerContent').innerHTML = `
      <div class="summary-box"><strong>${record.source === 'builtin-mock' ? '内置 MOCK 数据' : '用户确认的本机测试数据'} / 无后端</strong><br>${record.source === 'builtin-mock' ? '由程序合成且不来源于真实 KYC；格式可能与公开编号空间重叠，禁止联系、支付或核验。' : '此档案来自用户输入，页面不验证其真实性；录入者已确认只使用获批测试信息。'}</div>
      <div class="button-row"><button class="btn btn-secondary" id="drawerReveal" type="button">${reveal ? '敏感字段将在短时间后自动隐藏' : '临时显示敏感字段 30 秒'}</button><button class="btn btn-secondary copy-record" data-id="${escapeHtml(id)}" type="button">复制脱敏组合 KYC</button></div>
      <section class="detail-section"><h3>基本信息</h3><dl class="detail-grid"><dt>客户编号</dt><dd>${escapeHtml(record.customerId)}</dd><dt>姓名</dt><dd>${escapeHtml(record.name)}</dd><dt>风险等级</dt><dd><span class="risk ${riskClass(record.risk)}">${escapeHtml(record.risk)}风险</span></dd><dt>公司</dt><dd>${escapeHtml(record.company)}</dd><dt>职业</dt><dd>${escapeHtml(record.occupation)}</dd></dl></section>
      <section class="detail-section"><h3>身份与联系方式</h3><dl class="detail-grid"><dt>身份证</dt><dd class="mono">${sensitive('idCard')}</dd><dt>护照</dt><dd class="mono">${sensitive('passport')}</dd><dt>手机号</dt><dd class="mono">${sensitive('phone')}</dd><dt>邮箱</dt><dd>${sensitive('email')}</dd><dt>地址</dt><dd>${sensitive('address')}</dd></dl></section>
      <section class="detail-section"><h3>金融标识</h3><dl class="detail-grid"><dt>银行卡</dt><dd class="mono">${sensitive('bankCard')}</dd><dt>IBAN</dt><dd class="mono">${sensitive('iban')}</dd><dt>SWIFT</dt><dd class="mono">${sensitive('swift')}</dd></dl></section>
    `;
    $('#drawerScrim').hidden = false;
    $('#detailDrawer').inert = false;
    $('#detailDrawer').classList.add('is-open');
    $('#detailDrawer').setAttribute('aria-hidden', 'false');
    $('#closeDrawer').focus();
    addLog('查看 MOCK 客户详情', '完成');
  }

  function closeDrawer() {
    $('#detailDrawer').classList.remove('is-open');
    $('#detailDrawer').setAttribute('aria-hidden', 'true');
    $('#detailDrawer').inert = true;
    $('#drawerScrim').hidden = true;
    state.drawerRecordId = null;
    const target = state.drawerReturnFocus;
    state.drawerReturnFocus = null;
    if (target?.isConnected) target.focus();
  }

  function startReveal() {
    state.revealUntil = Date.now() + 30000;
    $('#toggleReveal').textContent = '敏感字段已显示（30 秒）';
    $('#toggleReveal').setAttribute('aria-pressed', 'true');
    window.clearTimeout(state.revealTimer);
    state.revealTimer = window.setTimeout(() => {
      state.revealUntil = 0;
      $('#toggleReveal').textContent = '临时显示敏感字段';
      $('#toggleReveal').setAttribute('aria-pressed', 'false');
      renderTable();
      if (state.drawerRecordId) openDrawer(state.drawerRecordId);
      showToast('敏感字段已自动恢复脱敏显示');
    }, 30000);
    renderTable();
    if (state.drawerRecordId) openDrawer(state.drawerRecordId);
    addLog('临时显示模拟敏感字段', '30 秒');
  }

  function openCustomerDialog(record = null) {
    $('#customerDialogTitle').textContent = record ? '编辑 KYC 测试记录' : '新增 KYC 测试记录';
    $('#formId').value = record?.customerId || '';
    $('#formName').value = record?.name || '';
    $('#formRisk').value = record?.risk || '低';
    $('#formIdCard').value = record?.idCard || '';
    $('#formPassport').value = record?.passport || '';
    $('#formPhone').value = record?.phone || '';
    $('#formEmail').value = record?.email || '';
    $('#formBankCard').value = record?.bankCard || '';
    $('#formIban').value = record?.iban || '';
    $('#formSwift').value = record?.swift || '';
    $('#formCompany').value = record?.company || '';
    $('#formOccupation').value = record?.occupation || '';
    $('#formAddress').value = record?.address || '';
    $('#confirmMockOnly').checked = false;
    $('#saveCustomer').disabled = true;
    showDialog($('#customerDialog'), '#cancelCustomer');
  }

  function formRecord() {
    const existingId = $('#formId').value;
    const existing = existingId ? customerById(existingId) : null;
    const nextNumber = state.records.reduce((max, item) => {
      const match = item.customerId.match(/(\d+)$/);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 40) + 1;
    const now = new Date().toISOString();
    return {
      customerId: existing?.customerId || `MOCK-KYC-${pad(nextNumber, 3)}`,
      name: $('#formName').value.trim(),
      risk: $('#formRisk').value,
      idCard: $('#formIdCard').value.trim(),
      passport: $('#formPassport').value.trim(),
      phone: $('#formPhone').value.trim(),
      email: $('#formEmail').value.trim(),
      bankCard: $('#formBankCard').value.trim(),
      iban: $('#formIban').value.trim(),
      swift: $('#formSwift').value.trim(),
      company: $('#formCompany').value.trim(),
      occupation: $('#formOccupation').value.trim(),
      address: $('#formAddress').value.trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      deletedAt: existing?.deletedAt || null,
      mock: false,
      source: 'user-confirmed-test',
      schemaVersion: 3,
    };
  }

  function saveCustomer(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (!$('#confirmMockOnly').checked) {
      showToast('请先确认只使用合成测试信息，不得录入真实个人信息');
      return;
    }
    const record = formRecord();
    const index = state.records.findIndex((item) => item.customerId === record.customerId);
    if (index >= 0) state.records[index] = { ...record };
    else state.records.push({ ...record });
    const persisted = saveRecords();
    closeDialog($('#customerDialog'));
    renderTable();
    addLog(index >= 0 ? '编辑 KYC 测试记录' : '新增 KYC 测试记录', persisted ? '保存到本机' : '仅当前会话');
    showToast(persisted
      ? (index >= 0 ? '测试记录已更新到本机' : '测试记录已新增到本机')
      : '仅当前页内存模式，刷新会丢失');
  }

  function requestDelete(id) {
    const record = customerById(id);
    if (!record) return;
    state.deleteTargetId = id;
    $('#deleteSummary').textContent = `${record.name}（${record.customerId}）将从列表隐藏，可通过“撤销删除”恢复。`;
    showDialog($('#deleteDialog'), '#cancelDelete');
  }

  function confirmDelete() {
    const record = customerById(state.deleteTargetId);
    if (!record) return;
    record.deletedAt = new Date().toISOString();
    record.updatedAt = record.deletedAt;
    state.selected.delete(record.customerId);
    state.lastDeletedId = record.customerId;
    $('#undoDelete').disabled = false;
    const persisted = saveRecords();
    state.deleteTargetId = null;
    renderTable();
    addLog('软删除 MOCK 客户', persisted ? '可撤销' : '仅当前会话可撤销');
    showToast(persisted ? '记录已软删除，可点击“撤销删除”恢复' : '记录已软删除；仅当前页内存模式，刷新会丢失');
    closeDialog($('#deleteDialog'));
  }

  function undoDelete() {
    const record = customerById(state.lastDeletedId);
    if (!record) return;
    record.deletedAt = null;
    record.updatedAt = new Date().toISOString();
    const persisted = saveRecords();
    state.lastDeletedId = null;
    $('#undoDelete').disabled = true;
    renderTable();
    addLog('撤销软删除', persisted ? '完成' : '仅当前会话');
    showToast(persisted ? 'MOCK 记录已恢复' : '记录已恢复；仅当前页内存模式，刷新会丢失');
  }

  function exportRecords() {
    const selectedRecords = activeRecords().filter((record) => state.selected.has(record.customerId));
    return selectedRecords.length ? selectedRecords : filteredRecords().slice(0, 10);
  }

  function dateStamp() {
    const date = new Date();
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function downloadBlob(content, type, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toCsv(records, masked) {
    const header = EXPORT_FIELDS.map(csvCell).join(',');
    const rows = records.map((record) => {
      const presented = presentRecord(record, masked);
      return EXPORT_FIELDS.map((field) => csvCell(presented[field])).join(',');
    });
    return `\ufeff${[header, ...rows].join('\r\n')}`;
  }

  function toTxt(records, masked) {
    return records.map((record) => {
      const item = presentRecord(record, masked);
      return [
        `=== KYC TEST RECORD / ${recordNature(record)} ===`,
        ...EXPORT_FIELDS.map((field) => `${field}: ${item[field]}`),
      ].join('\n');
    }).join('\n\n');
  }

  function toHtml(records, masked) {
    const rows = records.map((record) => {
      const item = presentRecord(record, masked);
      return `<tr><td>${escapeHtml(recordNature(record))}</td>${EXPORT_FIELDS.map((field) => `<td>${escapeHtml(item[field])}</td>`).join('')}</tr>`;
    }).join('');
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>KYC Test Export</title><style>body{font:14px sans-serif;padding:24px}body:before{content:'TEST DATA / 内置数据均为 MOCK';display:block;color:#b42318;font-size:24px;font-weight:bold}table{border-collapse:collapse}th,td{padding:6px;border:1px solid #aaa}</style><h1>KYC Test Export</h1><p>用户输入内容未由页面验证；禁止使用真实个人信息。</p><table><thead><tr><th>dataNature</th>${EXPORT_FIELDS.map((field) => `<th>${escapeHtml(field)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></html>`;
  }

  function toXml(records, masked) {
    const rows = records.map((record) => {
      const item = presentRecord(record, masked);
      return `  <customer source="${record.source === 'builtin-mock' ? 'builtin-mock' : 'user-confirmed-test'}">\n${EXPORT_FIELDS.map((field) => `    <${field}>${xmlEscape(item[field])}</${field}>`).join('\n')}\n  </customer>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kycTestExport masked="${masked}" userInputVerified="false">\n${rows}\n</kycTestExport>`;
  }

  function pdfEscape(value) {
    return String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  }

  function pdfAscii(value) {
    return String(value).replace(/[^\x20-\x7E]/g, '?');
  }

  function createPdf(records) {
    const lines = [
      'KYC TEST EXPORT - BUILT-IN DATA IS MOCK',
      'USER INPUT IS NOT VERIFIED - NEVER USE REAL PII',
      `Generated: ${new Date().toISOString()}`,
      `Records: ${records.length} (masked)`,
      '',
      ...records.slice(0, 18).map((record) => {
        const item = presentRecord(record, true);
        const risk = record.risk === '高' ? 'HIGH' : record.risk === '中' ? 'MEDIUM' : 'LOW';
        return `${item.customerId} | TEST USER | ${risk} | ${item.idCard} | ${item.phone}`;
      }),
    ];
    const textOps = lines.map((line, index) => `BT /F1 ${index === 0 ? 15 : 9} Tf 48 ${790 - (index * 27)} Td (${pdfEscape(pdfAscii(line))}) Tj ET`).join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${textOps.length} >>\nstream\n${textOps}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n%KYC-TEST\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { pdf += `${pad(offset, 10)} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  async function exportPng(record) {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      addLog('下载脱敏 PNG 文件', '失败：Canvas 不可用');
      showToast('PNG 生成失败：浏览器未提供 Canvas 绘图能力');
      return false;
    }
    ctx.fillStyle = '#f6f9fd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b1728';
    ctx.fillRect(0, 0, canvas.width, 110);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText(record.source === 'builtin-mock' ? 'MOCK KYC IDENTIFICATION' : 'KYC TEST / USER INPUT', 50, 68);
    ctx.strokeStyle = '#155eef';
    ctx.lineWidth = 4;
    ctx.strokeRect(42, 145, 916, 410);
    ctx.fillStyle = '#172033';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(`Name: ${maskValue('name', record.name)}`, 80, 225);
    ctx.font = '24px monospace';
    ctx.fillText(`ID: ${maskValue('idCard', record.idCard)}`, 80, 290);
    ctx.fillText(`Passport: ${maskValue('passport', record.passport)}`, 80, 345);
    ctx.fillText(`Customer: ${record.customerId}`, 80, 400);
    ctx.fillText(`Risk: ${record.risk}`, 80, 455);
    ctx.save();
    ctx.translate(710, 500);
    ctx.rotate(-0.23);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#b42318';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(record.source === 'builtin-mock' ? '模拟数据' : '测试数据', -120, 0);
    ctx.restore();
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => {
          if (!blob) {
            addLog('下载脱敏 PNG 文件', '失败：Canvas 编码返回空结果');
            showToast('PNG 生成失败：浏览器未返回图片数据');
            resolve(false);
            return;
          }
          downloadBlob(blob, 'image/png', `KYC_TEST_ID_${record.customerId}_${dateStamp()}.png`);
          resolve(true);
        }, 'image/png');
      } catch (error) {
        addLog('下载脱敏 PNG 文件', `失败：${error?.name || 'Error'}`);
        showToast('PNG 生成失败：浏览器拒绝 Canvas 编码');
        resolve(false);
      }
    });
  }

  async function performMaskedExport(format) {
    const records = exportRecords();
    if (!records.length) {
      showToast('没有可导出的测试记录');
      return;
    }
    const base = `KYC_TEST_MASKED_${records.length}_${dateStamp()}`;
    if (format === 'csv') downloadBlob(toCsv(records, true), 'text/csv;charset=utf-8', `${base}.csv`);
    if (format === 'json') downloadBlob(JSON.stringify({ builtInDataIsMock: true, userInputVerified: false, masked: true, records: records.map((record) => ({ source: record.source, ...presentRecord(record, true) })) }, null, 2), 'application/json', `${base}.json`);
    if (format === 'txt') downloadBlob(toTxt(records, true), 'text/plain;charset=utf-8', `${base}.txt`);
    if (format === 'html') downloadBlob(toHtml(records, true), 'text/html;charset=utf-8', `${base}.html`);
    if (format === 'xml') downloadBlob(toXml(records, true), 'application/xml;charset=utf-8', `${base}.xml`);
    if (format === 'pdf') downloadBlob(createPdf(records), 'application/pdf', `${base}.pdf`);
    if (format === 'png' && !await exportPng(records[0])) return;
    addLog(`下载脱敏 ${format.toUpperCase()} 文件`, `记录数 ${records.length}`);
    showToast(`已触发 ${format.toUpperCase()} 脱敏测试文件下载`);
  }

  function openRawExportDialog() {
    const records = exportRecords();
    if (!records.length) {
      showToast('没有可导出的测试记录');
      return;
    }
    const userSuppliedCount = records.filter((record) => record.source !== 'builtin-mock').length;
    $('#rawExportSummary').innerHTML = `<strong>导出摘要</strong><br>格式：CSV<br>记录数：${records.length}<br>字段数：${EXPORT_FIELDS.length}<br>敏感字段：姓名、身份证、护照、手机号、邮箱、银行卡、IBAN、SWIFT、地址<br>内置 MOCK：${records.length - userSuppliedCount} 条<br>用户确认的测试数据：${userSuppliedCount} 条<br>页面不会验证用户输入内容的真实性。`;
    $('#rawExportConfirm').value = '';
    $('#confirmRawExport').disabled = true;
    showDialog($('#rawExportDialog'), '#cancelRawExport');
  }

  function confirmRawExport(event) {
    event.preventDefault();
    if ($('#rawExportConfirm').value !== RAW_CONFIRM_TEXT) return;
    const records = exportRecords();
    downloadBlob(toCsv(records, false), 'text/csv;charset=utf-8', `KYC_TEST_UNMASKED_HIGH_RISK_${records.length}_${dateStamp()}.csv`);
    closeDialog($('#rawExportDialog'));
    addLog('下载未脱敏测试 CSV', `高风险确认，记录数 ${records.length}`);
    showToast('已触发未脱敏测试 CSV 下载');
  }

  function utf8Base64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function copySourceRecord() {
    const selected = activeRecords().find((record) => state.selected.has(record.customerId));
    return selected || filteredRecords()[0] || null;
  }

  async function copyText(text, action, raw = false) {
    try {
      await navigator.clipboard.writeText(text);
      $('#copyStatus').textContent = raw
        ? `${action}：写入成功。测试后请立即单击“覆盖剪贴板”，或手动复制无敏感内容覆盖。`
        : `${action}：写入剪贴板成功（默认已脱敏，内容未被本站保存）`;
      addLog(action, '允许');
      showToast(raw ? '未脱敏测试内容已写入；测试后请立即覆盖剪贴板' : '脱敏测试内容已写入剪贴板');
      return true;
    } catch (error) {
      $('#copyStatus').textContent = `${action}：被浏览器拒绝或不可用`;
      addLog(action, `拒绝 ${error?.name || 'Error'}`);
      showToast('剪贴板写入被拒绝或不可用');
      return false;
    }
  }

  function copyPayload(record, kind, masked) {
    if (kind === 'idCard') return masked ? maskValue('idCard', record.idCard) : record.idCard;
    if (kind === 'kyc') return toTxt([record], masked);
    if (kind === 'json') return JSON.stringify({ builtInMock: record.source === 'builtin-mock', masked, ...presentRecord(record, masked) }, null, 2);
    return utf8Base64(JSON.stringify({ builtInMock: record.source === 'builtin-mock', masked, ...presentRecord(record, masked) }));
  }

  async function performCopy(kind, masked = true, explicitId = null) {
    const record = explicitId ? customerById(explicitId) : copySourceRecord();
    if (!record) {
      showToast('没有可用于复制的测试记录');
      return;
    }
    const labels = {
      idCard: '证件号码',
      kyc: '组合 KYC 文本',
      json: 'KYC JSON',
      base64: 'KYC Base64',
    };
    const action = `复制${masked ? '脱敏' : '未脱敏'} ${labels[kind] || '测试数据'}`;
    await copyText(copyPayload(record, kind, masked), action, !masked);
  }

  function openRawCopyDialog(kind = 'kyc') {
    const record = copySourceRecord();
    if (!record) {
      showToast('没有可用于复制的测试记录');
      return;
    }
    state.rawCopyKind = kind;
    $('#rawCopySummary').innerHTML = `<strong>复制摘要</strong><br>记录：${escapeHtml(record.customerId)}<br>内容：未脱敏组合 KYC 文本<br>来源：${record.source === 'builtin-mock' ? '内置 MOCK' : '用户确认的测试数据'}<br>测试后请立即覆盖剪贴板。`;
    $('#rawCopyConfirm').value = '';
    $('#confirmRawCopy').disabled = true;
    showDialog($('#rawCopyDialog'), '#cancelRawCopy');
  }

  async function confirmRawCopy(event) {
    event.preventDefault();
    if ($('#rawCopyConfirm').value !== RAW_COPY_CONFIRM_TEXT || !state.rawCopyKind) return;
    await performCopy(state.rawCopyKind, false);
    state.rawCopyKind = null;
    closeDialog($('#rawCopyDialog'));
  }

  function displayFileMetadata(fileList) {
    const files = Array.from(fileList || []);
    const container = $('#fileMetadata');
    if (!files.length) {
      container.innerHTML = '<p>尚未选择文件</p>';
      return;
    }
    container.innerHTML = `<ul>${files.map((file) => `<li><strong>${escapeHtml(file.name)}</strong> · ${escapeHtml(file.type || '未知类型')} · ${Math.ceil(file.size / 1024)} KB · 修改于 ${escapeHtml(new Date(file.lastModified).toLocaleString('zh-CN'))}</li>`).join('')}</ul><p class="section-help">只读取以上 File 元数据，没有读取文件内容，也没有网络上传。</p>`;
    addLog('选择或拖放本地文件', `仅元数据，文件数 ${files.length}`);
  }

  function setPermissionStatus(name, status) {
    const output = $(`#status-${name}`);
    if (output) output.textContent = status;
  }

  async function testNotification() {
    if (!('Notification' in window)) throw new Error('浏览器不支持 Notification API');
    const result = await Notification.requestPermission();
    setPermissionStatus('notification', result === 'granted' ? '已允许' : result === 'denied' ? '已拒绝' : '未决定');
    addLog('通知权限请求', result);
  }

  function testGeolocation() {
    if (!navigator.geolocation) {
      setPermissionStatus('geolocation', '浏览器不支持');
      addLog('位置权限请求', '不支持');
      return;
    }
    setPermissionStatus('geolocation', '等待用户决定…');
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermissionStatus('geolocation', '已允许（坐标未显示、未保存）');
        addLog('位置权限请求', '允许，坐标未记录');
      },
      (error) => {
        setPermissionStatus('geolocation', '已拒绝或不可用');
        addLog('位置权限请求', `拒绝 ${error.code}`);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }

  async function testMedia(kind) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持媒体权限 API');
    const constraints = kind === 'camera' ? { video: true, audio: false } : { video: false, audio: true };
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const trackCount = stream.getTracks().length;
      setPermissionStatus(kind, `已允许；${trackCount} 条媒体轨道将立即停止`);
      addLog(`${kind === 'camera' ? '摄像头' : '麦克风'}权限请求`, '允许并立即停止轨道');
    } finally {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    }
  }

  function testPopup() {
    const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const popup = window.open('', `mock-browser-test-${randomPart}`, 'width=460,height=300');
    if (!popup) {
      setPermissionStatus('popup', '被浏览器拦截');
      addLog('弹窗测试', '拦截');
      return;
    }
    popup.opener = null;
    popup.document.title = 'MOCK 弹窗测试';
    popup.document.body.textContent = 'MOCK 企业浏览器弹窗测试：无数据、无后端。此窗口可直接关闭。';
    setPermissionStatus('popup', '已允许打开同源窗口');
    addLog('弹窗测试', '允许');
  }

  async function testFullscreen() {
    if (!document.documentElement.requestFullscreen) throw new Error('浏览器不支持全屏 API');
    await document.documentElement.requestFullscreen();
    setPermissionStatus('fullscreen', '已进入全屏，按 Esc 退出');
    addLog('全屏权限请求', '允许');
  }

  async function handlePermission(name) {
    try {
      if (name === 'notification') await testNotification();
      if (name === 'geolocation') testGeolocation();
      if (name === 'camera' || name === 'microphone') await testMedia(name);
      if (name === 'clipboard') {
        await navigator.clipboard.writeText('MOCK ENTERPRISE BROWSER CLIPBOARD WRITE TEST - NO PII');
        setPermissionStatus('clipboard', '写入成功（未读取剪贴板）');
        addLog('剪贴板写入权限测试', '允许');
      }
      if (name === 'popup') testPopup();
      if (name === 'fullscreen') await testFullscreen();
    } catch (error) {
      setPermissionStatus(name, `被拒绝或不可用：${error?.name || 'Error'}`);
      addLog(`${name} 权限测试`, `拒绝 ${error?.name || 'Error'}`);
    }
  }

  function renderLogs() {
    const container = $('#activityLog');
    if (!container) return;
    if (!state.logs.length) {
      container.innerHTML = '<li>当前会话尚无测试日志</li>';
      return;
    }
    container.innerHTML = state.logs.map((entry) => `<li><time datetime="${escapeHtml(entry.timestamp)}">${escapeHtml(new Date(entry.timestamp).toLocaleString('zh-CN'))}</time> · ${escapeHtml(entry.action)} · <strong>${escapeHtml(entry.result)}</strong></li>`).join('');
  }

  function bindEvents() {
    $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-view-link]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewLink)));
    $('#mobileMenu').addEventListener('click', () => {
      const sidebar = $('#sidebar');
      sidebar.classList.toggle('is-open');
      $('#mobileMenu').setAttribute('aria-expanded', String(sidebar.classList.contains('is-open')));
    });

    $('#filterForm').addEventListener('submit', (event) => {
      event.preventDefault();
      state.search = $('#searchInput').value;
      state.risk = $('#riskFilter').value;
      state.page = 1;
      renderTable();
      addLog('筛选 MOCK 客户', '完成');
    });
    $('#resetFilter').addEventListener('click', () => {
      $('#searchInput').value = '';
      $('#riskFilter').value = '';
      state.search = '';
      state.risk = '';
      state.page = 1;
      renderTable();
    });
    $('#prevPage').addEventListener('click', () => { state.page = Math.max(1, state.page - 1); renderTable(); });
    $('#nextPage').addEventListener('click', () => { state.page += 1; renderTable(); });
    $('#selectPage').addEventListener('change', (event) => {
      pageRecords().forEach((record) => event.target.checked ? state.selected.add(record.customerId) : state.selected.delete(record.customerId));
      renderTable();
    });
    $('#customerRows').addEventListener('change', (event) => {
      if (!event.target.matches('.row-select')) return;
      event.target.checked ? state.selected.add(event.target.dataset.id) : state.selected.delete(event.target.dataset.id);
      renderTable();
    });
    $('#customerRows').addEventListener('click', (event) => {
      const id = event.target.dataset.id;
      if (event.target.matches('.view-record')) openDrawer(id);
      if (event.target.matches('.edit-record')) openCustomerDialog(customerById(id));
      if (event.target.matches('.delete-record')) requestDelete(id);
    });

    $('#toggleReveal').addEventListener('click', startReveal);
    $('#closeDrawer').addEventListener('click', closeDrawer);
    $('#drawerScrim').addEventListener('click', closeDrawer);
    $('#drawerContent').addEventListener('click', (event) => {
      if (event.target.id === 'drawerReveal') startReveal();
      if (event.target.matches('.copy-record')) performCopy('kyc', true, event.target.dataset.id);
    });
    $('#addCustomer').addEventListener('click', () => openCustomerDialog());
    $('#confirmMockOnly').addEventListener('change', (event) => { $('#saveCustomer').disabled = !event.target.checked; });
    $('#cancelCustomer').addEventListener('click', () => closeDialog($('#customerDialog')));
    $('#closeCustomer').addEventListener('click', () => closeDialog($('#customerDialog')));
    $('#customerForm').addEventListener('submit', saveCustomer);

    $('#cancelDelete').addEventListener('click', () => { state.deleteTargetId = null; closeDialog($('#deleteDialog')); });
    $('#confirmDelete').addEventListener('click', confirmDelete);
    $('#undoDelete').addEventListener('click', undoDelete);
    $('#restoreData').addEventListener('click', () => showDialog($('#resetDialog'), '#cancelReset'));
    $('#cancelReset').addEventListener('click', () => closeDialog($('#resetDialog')));
    $('#confirmReset').addEventListener('click', () => {
      state.records = createInitialRecords();
      state.selected.clear();
      state.lastDeletedId = null;
      $('#undoDelete').disabled = true;
      const persisted = saveRecords();
      state.page = 1;
      renderTable();
      addLog('恢复初始 MOCK 数据', persisted ? '40 条' : '40 条，仅当前会话');
      showToast(persisted ? '已恢复 40 条初始 MOCK 数据' : '已恢复 40 条数据；仅当前页内存模式，刷新会丢失');
      closeDialog($('#resetDialog'));
    });

    $('#maskedExports').addEventListener('click', (event) => {
      const button = event.target.closest('[data-export]');
      if (button) performMaskedExport(button.dataset.export);
    });
    $('#rawExport').addEventListener('click', openRawExportDialog);
    $('#rawExportConfirm').addEventListener('input', (event) => { $('#confirmRawExport').disabled = event.target.value !== RAW_CONFIRM_TEXT; });
    $('#cancelRawExport').addEventListener('click', () => closeDialog($('#rawExportDialog')));
    $('#rawExportForm').addEventListener('submit', confirmRawExport);
    $('#downloadBlob').addEventListener('click', () => {
      downloadBlob('MOCK BLOB DOWNLOAD TEST\nNo real personal information.\n', 'text/plain;charset=utf-8', `MOCK_BLOB_DOWNLOAD_${dateStamp()}.txt`);
      addLog('普通 Blob 下载', '触发');
    });

    $$('.copy-test').forEach((button) => button.addEventListener('click', () => performCopy(button.dataset.copy, true)));
    $('#rawCopy').addEventListener('click', () => openRawCopyDialog('kyc'));
    $('#rawCopyConfirm').addEventListener('input', (event) => { $('#confirmRawCopy').disabled = event.target.value !== RAW_COPY_CONFIRM_TEXT; });
    $('#cancelRawCopy').addEventListener('click', () => { state.rawCopyKind = null; closeDialog($('#rawCopyDialog')); });
    $('#rawCopyForm').addEventListener('submit', confirmRawCopy);
    $('#clearClipboard').addEventListener('click', () => copyText('MOCK CLIPBOARD CLEARED - NO SENSITIVE TEST DATA', '覆盖剪贴板为无敏感测试文本'));
    $('#clipboardWriteTest').addEventListener('click', () => copyText('MOCK ENTERPRISE BROWSER CLIPBOARD WRITE TEST - NO PII', '无敏感文本剪贴板写入'));
    $('#pasteArea').addEventListener('input', (event) => { $('#pasteCount').textContent = `${event.target.value.length} 个字符`; });
    $('#clearPaste').addEventListener('click', () => { $('#pasteArea').value = ''; $('#pasteCount').textContent = '0 个字符'; addLog('清空手动粘贴区', '完成'); });

    $('#fileInput').addEventListener('change', (event) => displayFileMetadata(event.target.files));
    ['dragenter', 'dragover'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.add('is-dragging'); }));
    ['dragleave', 'drop'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.remove('is-dragging'); }));
    $('#dropZone').addEventListener('drop', (event) => displayFileMetadata(event.dataTransfer.files));
    $('#clearFiles').addEventListener('click', () => { $('#fileInput').value = ''; displayFileMetadata([]); addLog('清空文件元数据', '完成'); });
    $('#printPage').addEventListener('click', () => { addLog('打印页面测试', '触发'); window.print(); });
    $('#openWindow').addEventListener('click', testPopup);
    $('#externalLink').addEventListener('click', () => addLog('打开外部测试链接', '触发'));

    $$('.permission-test').forEach((button) => button.addEventListener('click', () => handlePermission(button.dataset.permission)));

    $('#manualChecklist').addEventListener('change', (event) => {
      if (event.target.type === 'checkbox') addLog('更新人工验证清单', event.target.checked ? '已勾选' : '取消勾选');
    });
    $('#clearLog').addEventListener('click', () => {
      state.logs = [];
      try {
        sessionStorage.removeItem(SESSION_LOG_KEY);
        state.sessionStorageAvailable = true;
      } catch {
        state.sessionStorageAvailable = false;
      }
      updateStorageMode();
      renderLogs();
      showToast(state.sessionStorageAvailable ? '当前会话测试日志已清空' : '内存日志已清空；浏览器阻止了会话存储操作');
    });
    $('#exportLog').addEventListener('click', () => {
      const payload = { mockLab: true, containsPii: false, exportedAt: new Date().toISOString(), events: state.logs };
      downloadBlob(JSON.stringify(payload, null, 2), 'application/json', `MOCK_BROWSER_TEST_LOG_${dateStamp()}.json`);
      addLog('导出非敏感测试日志', `事件数 ${state.logs.length}`);
    });

    $$('dialog').forEach((dialog) => {
      dialog.addEventListener('keydown', (event) => trapFocus(event, dialog));
      dialog.addEventListener('close', () => restoreDialogFocus(dialog));
    });

    document.addEventListener('keydown', (event) => {
      const drawer = $('#detailDrawer');
      if (!drawer.classList.contains('is-open') || $('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      } else {
        trapFocus(event, drawer);
      }
    });

    window.addEventListener('hashchange', () => {
      const requestedView = window.location.hash.slice(1);
      switchView($(`[data-view-panel="${CSS.escape(requestedView)}"]`) ? requestedView : 'customers', false);
    });
  }

  function init() {
    loadRecords();
    loadLogs();
    bindEvents();
    renderTable();
    renderLogs();
    updateStorageMode();
    if (!state.recordStorageAvailable || !state.sessionStorageAvailable) {
      showToast('浏览器限制了站点存储；数据或日志仅在当前页面会话可用');
    }
    const requestedView = window.location.hash.slice(1);
    if ($(`[data-view-panel="${CSS.escape(requestedView)}"]`)) switchView(requestedView, false);
  }

  if (globalThis.__BROWSER_LAB_TEST__ === true) {
    globalThis.__BROWSER_LAB_TEST_API__ = Object.freeze({
      chinaIdChecksum,
      createPdf,
      createInitialRecords,
      csvCell,
      exportPng,
      maskValue,
      pdfAscii,
      presentRecord,
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
