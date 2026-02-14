const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const clearAllBtn = document.getElementById('clearAllBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFile');
const statusEl = document.getElementById('status');

function createRuleId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#065f46';
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

async function saveRules(rules) {
  await chrome.storage.local.set({ renameRules: dedupeRules(rules) });
}

function sanitizeRule(rawRule) {
  if (!rawRule || typeof rawRule !== 'object') {
    return null;
  }

  const targetText = typeof rawRule.targetText === 'string' ? rawRule.targetText.trim() : '';
  if (!targetText) {
    return null;
  }

  const replacementText =
    typeof rawRule.replacementText === 'string' ? rawRule.replacementText.trim() : '';
  const domain = normalizeDomain(rawRule.domain || '');
  const enabled = rawRule.enabled !== false;

  return {
    id: typeof rawRule.id === 'string' && rawRule.id ? rawRule.id : createRuleId(),
    targetText,
    replacementText,
    domain,
    enabled
  };
}

function dedupeRules(rules) {
  const seen = new Set();
  const unique = [];

  for (const rule of rules) {
    const key = `${rule.targetText}||${rule.replacementText || ''}||${rule.domain || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(rule);
  }

  return unique;
}

function extractRulesFromImport(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.renameRules)) {
    return payload.renameRules;
  }

  if (payload && Array.isArray(payload.rules)) {
    return payload.rules;
  }

  return [];
}

function mergeRules(existingRules, incomingRules) {
  const merged = [...existingRules];
  const exists = new Set(
    existingRules.map(
      (rule) => `${rule.targetText}||${rule.replacementText || ''}||${rule.domain || ''}`
    )
  );

  for (const rule of incomingRules) {
    const key = `${rule.targetText}||${rule.replacementText || ''}||${rule.domain || ''}`;
    if (exists.has(key)) {
      continue;
    }
    exists.add(key);
    merged.push(rule);
  }

  return merged;
}

async function clearAllRules() {
  const confirmed = window.confirm('Are you sure you want to delete all rules?');
  if (!confirmed) {
    return;
  }

  await chrome.storage.local.remove(['renameRules', 'renameRule']);
  chrome.runtime.sendMessage({ type: 'CLEAR_RULE' });
  renderRules([]);
}

async function exportRules() {
  const rules = await getRulesFromStorage();
  if (!rules.length) {
    setStatus('No rules to export.', true);
    return;
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    rules
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chrome-tab-renamer-rules-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${rules.length} rule${rules.length === 1 ? '' : 's'}.`);
}

async function importRulesFromFile(file) {
  if (!file) {
    return;
  }

  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (error) {
    setStatus('Import failed: file is not valid JSON.', true);
    return;
  }

  const rawRules = extractRulesFromImport(payload);
  if (!rawRules.length) {
    setStatus('Import failed: no rules found in file.', true);
    return;
  }

  const incomingRules = rawRules.map(sanitizeRule).filter(Boolean);
  if (!incomingRules.length) {
    setStatus('Import failed: rules were invalid or empty.', true);
    return;
  }

  const existingRules = await getRulesFromStorage();
  const mergedRules = mergeRules(existingRules, incomingRules);
  await saveRules(mergedRules);
  chrome.runtime.sendMessage({ type: 'APPLY_RULE_NOW' });
  renderRules(mergedRules);

  const addedCount = mergedRules.length - existingRules.length;
  const skippedCount = incomingRules.length - addedCount;
  setStatus(
    `Imported ${addedCount} new rule${addedCount === 1 ? '' : 's'}.` +
      (skippedCount ? ` Skipped ${skippedCount} duplicate${skippedCount === 1 ? '' : 's'}.` : '')
  );
}

function renderRules(rules) {
  listEl.innerHTML = '';

  if (!rules.length) {
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;

  for (const rule of rules) {
    const row = document.createElement('div');
    row.className = 'row';

    const text = document.createElement('div');
    text.className = 'rule-text';
    const domainLabel = rule.domain ? ` [${rule.domain}]` : ' [all domains]';
    text.textContent = `${rule.targetText} → ${rule.replacementText || ''}${domainLabel}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'link-btn';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const nextRules = rules.filter((item) => item.id !== rule.id);
      await saveRules(nextRules);
      chrome.runtime.sendMessage({ type: 'APPLY_RULE_NOW' });
      renderRules(nextRules);
    });

    row.appendChild(text);
    row.appendChild(deleteBtn);
    listEl.appendChild(row);
  }
}

async function init() {
  const rules = await getRulesFromStorage();
  const uniqueRules = dedupeRules(rules);
  if (uniqueRules.length !== rules.length) {
    await saveRules(uniqueRules);
  }
  renderRules(uniqueRules);
}

clearAllBtn.addEventListener('click', clearAllRules);
exportBtn.addEventListener('click', exportRules);
importBtn.addEventListener('click', () => {
  importFileInput.value = '';
  importFileInput.click();
});
importFileInput.addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  importRulesFromFile(file);
});

init();
