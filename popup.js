const targetInput = document.getElementById('targetText');
const replacementInput = document.getElementById('replacementText');
const domainInput = document.getElementById('domainText');
const urlPathInput = document.getElementById('urlPathText');
const saveApplyBtn = document.getElementById('saveApplyBtn');
const browseBtn = document.getElementById('browseBtn');
const statusEl = document.getElementById('status');

function clearFormControls() {
  targetInput.value = '';
  replacementInput.value = '';
  domainInput.value = '';
  urlPathInput.value = '';
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#065f46';
}

function createRuleId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function dedupeRules(rules) {
  const seen = new Set();
  const unique = [];

  for (const rule of rules) {
    const urlKey = getRuleExactUrlKey(rule);
    const key = `${rule.targetText}||${rule.replacementText || ''}||${rule.domain || ''}||${urlKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(rule);
  }

  return unique;
}

function normalizeDomain(value) {
  const trimmed = (value || '').trim().toLowerCase();
  if (!trimmed) {
    return '';
  }

  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch (error) {
    return trimmed.replace(/\/$/, '');
  }
}

function normalizeUrlPath(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return `/${trimmed}`;
}

function normalizeExactUrlKey(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }

  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (!parsed.host) {
      return '';
    }
    const host = parsed.host.toLowerCase();
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    return `${host}${path}`;
  } catch (error) {
    return '';
  }
}

function getRuleExactUrlKey(rule) {
  if (!rule || typeof rule !== 'object') {
    return '';
  }

  const direct = normalizeExactUrlKey(rule.urlExact || rule.exactUrl || rule.url || '');
  if (direct) {
    return direct;
  }

  const domain = normalizeDomain(rule.domain || '');
  const rawUrlPath = typeof rule.urlPath === 'string' ? rule.urlPath.trim() : '';
  const urlPath = normalizeUrlPath(rawUrlPath);
  if (domain && rawUrlPath && urlPath) {
    return normalizeExactUrlKey(`${domain}${urlPath}`);
  }

  return '';
}

async function getRulesFromStorage() {
  const result = await chrome.storage.local.get(['renameRules', 'renameRule']);

  if (Array.isArray(result.renameRules)) {
    return result.renameRules;
  }

  if (result.renameRule && result.renameRule.targetText) {
    const migrated = [
      {
        id: createRuleId(),
        targetText: result.renameRule.targetText,
        replacementText: result.renameRule.replacementText || '',
        domain: '',
        enabled: result.renameRule.enabled !== false
      }
    ];
    await chrome.storage.local.set({ renameRules: migrated });
    await chrome.storage.local.remove(['renameRule']);
    return migrated;
  }

  return [];
}

async function saveAndApply() {
  const targetText = targetInput.value.trim();
  const replacementText = replacementInput.value.trim();
  const domain = normalizeDomain(domainInput.value);
  const urlExact = normalizeExactUrlKey(urlPathInput.value);
  const hasUrlInput = urlPathInput.value.trim().length > 0;
  if (hasUrlInput && !urlExact) {
    setStatus('Exact URL must include a domain.', true);
    return;
  }

  if (!targetText) {
    setStatus('Target text is required.', true);
    return;
  }

  const rules = await getRulesFromStorage();
  const existingIndex = rules.findIndex(
    (rule) =>
      rule.targetText === targetText &&
      rule.replacementText === replacementText &&
      (rule.domain || '') === domain &&
      getRuleExactUrlKey(rule) === urlExact
  );

  if (existingIndex === -1) {
    rules.push({ id: createRuleId(), targetText, replacementText, domain, urlExact, enabled: true });
  }

  const uniqueRules = dedupeRules(rules);
  await chrome.storage.local.set({ renameRules: uniqueRules });

  chrome.runtime.sendMessage({ type: 'APPLY_RULE_NOW' });
  clearFormControls();
  setStatus('Saved and applied to open tabs.');
}

function browseRules() {
  chrome.tabs.create({ url: chrome.runtime.getURL('rules.html') });
}

saveApplyBtn.addEventListener('click', saveAndApply);
browseBtn.addEventListener('click', browseRules);

window.addEventListener('pagehide', clearFormControls);
window.addEventListener('beforeunload', clearFormControls);
