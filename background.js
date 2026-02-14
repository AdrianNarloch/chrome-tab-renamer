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

function getHostname(tabUrl) {
  if (!tabUrl || typeof tabUrl !== 'string') {
    return '';
  }

  try {
    return new URL(tabUrl).hostname.toLowerCase();
  } catch (error) {
    return '';
  }
}

function ruleMatchesDomain(rule, hostname) {
  const ruleDomain = normalizeDomain(rule?.domain || '');

  if (!ruleDomain) {
    return true;
  }

  if (!hostname) {
    return false;
  }

  return hostname === ruleDomain || hostname.endsWith(`.${ruleDomain}`);
}

async function getRules() {
  const result = await chrome.storage.local.get(['renameRules', 'renameRule']);

  if (Array.isArray(result.renameRules)) {
    return result.renameRules.filter((rule) => rule?.enabled !== false && rule?.targetText);
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

function replaceTitleText(originalTitle, targetText, replacementText) {
  if (!originalTitle || !targetText || !originalTitle.includes(targetText)) {
    return originalTitle;
  }

  return originalTitle.split(targetText).join(replacementText);
}

function applyRulesToText(originalTitle, rules) {
  return rules.reduce(
    (currentTitle, rule) => replaceTitleText(currentTitle, rule.targetText, rule.replacementText || ''),
    originalTitle
  );
}

async function rewriteTabTitle(tabId, rules) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [rules],
      func: (renameRules) => {
        if (typeof document === 'undefined' || !document?.title) {
          return;
        }

        let updatedTitle = document.title;
        for (const rule of renameRules) {
          if (!rule?.targetText || !updatedTitle.includes(rule.targetText)) {
            continue;
          }

          updatedTitle = updatedTitle.split(rule.targetText).join(rule.replacementText || '');
        }

        document.title = updatedTitle;
      }
    });
  } catch (error) {
    // Some pages (like chrome://) cannot be scripted.
  }
}

async function applyRuleToAllTabs() {
  const rules = await getRules();

  if (!rules.length) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === 'number' && typeof tab.title === 'string')
      .map((tab) => ({
        tab,
        matchedRules: rules.filter((rule) => ruleMatchesDomain(rule, getHostname(tab.url)))
      }))
      .filter(({ tab, matchedRules }) => matchedRules.length && applyRulesToText(tab.title, matchedRules) !== tab.title)
      .map(({ tab, matchedRules }) => rewriteTabTitle(tab.id, matchedRules))
  );
}

async function applyRuleToTab(tabId) {
  const rules = await getRules();

  if (!rules.length) {
    return;
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab || typeof tab.title !== 'string') {
    return;
  }

  const matchedRules = rules.filter((rule) => ruleMatchesDomain(rule, getHostname(tab.url)));
  if (!matchedRules.length) {
    return;
  }

  const updated = applyRulesToText(tab.title, matchedRules);
  if (updated === tab.title) {
    return;
  }

  await rewriteTabTitle(tabId, matchedRules);
}

chrome.runtime.onInstalled.addListener(() => {
  applyRuleToAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
  applyRuleToAllTabs();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'APPLY_RULE_NOW') {
    applyRuleToAllTabs();
  }

  if (message?.type === 'CLEAR_RULE') {
    // Intentionally no action needed other than leaving future updates untouched.
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || typeof changeInfo.title === 'string') {
    applyRuleToTab(tabId);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id === 'number') {
    applyRuleToTab(tab.id);
  }
});
