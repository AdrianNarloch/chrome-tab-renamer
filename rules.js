const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const clearAllBtn = document.getElementById('clearAllBtn');

function createRuleId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
  await chrome.storage.local.set({ renameRules: rules });
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
  renderRules(rules);
}

clearAllBtn.addEventListener('click', clearAllRules);

init();
