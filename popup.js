const targetInput = document.getElementById('targetText');
const replacementInput = document.getElementById('replacementText');
const domainInput = document.getElementById('domainText');
const saveApplyBtn = document.getElementById('saveApplyBtn');
const browseBtn = document.getElementById('browseBtn');
const statusEl = document.getElementById('status');

function clearFormControls() {
  targetInput.value = '';
  replacementInput.value = '';
  domainInput.value = '';
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#065f46';
}

function createRuleId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

  if (!targetText) {
    setStatus('Target text is required.', true);
    return;
  }

  const rules = await getRulesFromStorage();
  const existingIndex = rules.findIndex(
    (rule) =>
      rule.targetText === targetText &&
      rule.replacementText === replacementText &&
      (rule.domain || '') === domain
  );

  if (existingIndex === -1) {
    rules.push({ id: createRuleId(), targetText, replacementText, domain, enabled: true });
  }

  await chrome.storage.local.set({ renameRules: rules });

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
