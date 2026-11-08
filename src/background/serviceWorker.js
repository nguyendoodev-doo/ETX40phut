importScripts(
  "../config.js",
  "../utils/duration.js",
  "../utils/calculator.js",
  "../utils/taskIdentity.js",
  "../utils/telegram.js",
  "../utils/taskNotification.js"
);

const DEFAULT_SETTINGS = globalThis.TaskKpi.CONFIG.DEFAULT_SETTINGS;
const TIMEBOXING_CONFIG = globalThis.TaskKpi.CONFIG.TIMEBOXING;
const parentContextByTab = new Map();
const TASK_CHECK_ALARM = "CHECK_TASK_NOTIFICATIONS";

function formatBadgeText(remaining) {
  if (remaining <= 0) return "✓";
  if (remaining < 60) return `${remaining}m`;
  const h = Math.floor(remaining / 60);
  const m = remaining % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function formatCompact(mins) {
  const m = Math.max(0, Math.round(mins || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, "0")}`;
}

function updateBadge(stats) {
  if (!stats?.total) return;
  const remaining = stats.total.remainingMinutes;
  const isDone = stats.total.completed;
  const badgeText = formatBadgeText(remaining);

  chrome.action.setBadgeText({ text: badgeText });
  if (isDone) {
    chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
    chrome.action.setTitle({
      title: `Botbanhang\n✓ ĐÃ HOÀN THÀNH KPI HÔM NAY!\nTổng đã làm: ${formatCompact(stats.total.currentMinutes)} (Dư ${formatCompact(stats.total.overtimeMinutes)})`
    });
  } else {
    const isNear = (stats.total.currentMinutes / stats.total.targetMinutes) >= 0.85;
    chrome.action.setBadgeBackgroundColor({ color: isNear ? "#2563EB" : "#40E0D0" });
    chrome.action.setTitle({
      title: `Botbanhang\nCần làm thêm: ${badgeText} để đủ KPI\n- Chủ động: ${stats.active.completed ? "✓ Đã đủ" : `Còn thiếu ${formatCompact(stats.active.remainingMinutes)}`}\n- Bị động: ${stats.passive.completed ? "✓ Đã đủ" : `Còn thiếu ${formatCompact(stats.passive.remainingMinutes)}`}\nTổng đã làm: ${formatCompact(stats.total.currentMinutes)} / ${formatCompact(stats.total.targetMinutes)}`
    });
  }
}

async function refreshBadgeFromStorage() {
  try {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const key = `daily:${day}`;
    const stored = await chrome.storage.local.get([key, "dailyData"]);
    if (stored[key]?.stats) {
      updateBadge(stored[key].stats);
    } else if (stored.dailyData?.[day]?.stats) {
      updateBadge(stored.dailyData[day].stats);
    }
  } catch {}
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function checkTaskNotifications(tasks, settings, now = new Date()) {
  if (!Array.isArray(tasks) || tasks.length === 0) return;
  const currentSettings = settings || await getSettings();
  if (globalThis.TaskKpi?.taskNotification?.evaluateTaskNotifications) {
    try {
      await globalThis.TaskKpi.taskNotification.evaluateTaskNotifications(tasks, currentSettings, now);
    } catch (err) {
      console.error("Error evaluating task notifications:", err);
    }
  }
}

async function checkTaskNotificationsFromStorage(settings, now = new Date()) {
  try {
    const d = now instanceof Date ? now : new Date(now);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const stored = await chrome.storage.local.get([`daily:${day}`, "dailyData"]);
    const tasks = stored[`daily:${day}`]?.tasks || stored.dailyData?.[day]?.tasks || [];
    if (tasks.length > 0) {
      await checkTaskNotifications(tasks, settings, now);
    }
  } catch (err) {
    console.error("Error checking task notifications from storage:", err);
  }
}

function setupAlarms() {
  try {
    chrome.alarms.create(TASK_CHECK_ALARM, { periodInMinutes: 1 });
  } catch (err) {
    console.warn("Failed to create alarm:", err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["settings"]);
  if (!stored.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  setupAlarms();
  refreshBadgeFromStorage();
  checkTaskNotificationsFromStorage();
});

chrome.runtime.onStartup?.addListener(() => {
  setupAlarms();
  refreshBadgeFromStorage();
  checkTaskNotificationsFromStorage();
});

chrome.alarms?.onAlarm?.addListener(async alarm => {
  if (alarm.name === TASK_CHECK_ALARM) {
    const settings = await getSettings();
    await checkTaskNotificationsFromStorage(settings);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of Object.keys(changes)) {
    if (key.startsWith("daily:")) {
      const stats = changes[key].newValue?.stats;
      if (stats) updateBadge(stats);
      const tasks = changes[key].newValue?.tasks;
      if (Array.isArray(tasks) && tasks.length > 0) {
        checkTaskNotifications(tasks);
      }
    }
    if (key === "dailyData") {
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const todayData = changes[key].newValue?.[day];
      if (todayData?.stats) updateBadge(todayData.stats);
      if (Array.isArray(todayData?.tasks) && todayData.tasks.length > 0) {
        checkTaskNotifications(todayData.tasks);
      }
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TIMEBOXING_PARENT_CONTEXT") {
    if (!sender.tab?.id || !message.context) {
      sendResponse({ ok: false });
      return;
    }
    parentContextByTab.set(sender.tab.id, { ...message.context });
    chrome.tabs.sendMessage(sender.tab.id, { type: "TIMEBOXING_CONTEXT", context: message.context })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "TIMEBOXING_CONTEXT_REQUEST") {
    sendResponse({ ok: true, context: sender.tab?.id ? parentContextByTab.get(sender.tab.id) || null : null });
    return;
  }

  if (message.type !== "KPI_STATS_UPDATED") return;

  if (message.stats) updateBadge(message.stats);

  const settingsPromise = message.settings ? Promise.resolve(message.settings) : getSettings();
  settingsPromise.then(settings => {
    if (Array.isArray(message.tasks) && message.tasks.length > 0) {
      checkTaskNotifications(message.tasks, settings);
    } else {
      checkTaskNotificationsFromStorage(settings);
    }
    return handleTransitions(message.stats, settings);
  }).then(sendResponse);

  return true;
});

chrome.tabs.onRemoved.addListener(id => parentContextByTab.delete(id));

async function handleTransitions(stats, settings) {
  if (!settings || !settings.notificationsEnabled) return;
  const day = new Date().toLocaleDateString("en-CA");
  const key = `notificationState:${day}`;
  const stored = await chrome.storage.local.get(key);
  const previous = stored[key] || { active: false, passive: false };

  for (const type of ["active", "passive"]) {
    if (stats[type]?.completed && !previous[type]) {
      const label = type === "active" ? "Chủ động" : "Bị động";
      chrome.notifications.create(`${day}:${type}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("assets/icon.svg"),
        title: "🎉 Đã đạt KPI",
        message: `Đã đủ ${label} hôm nay.`
      }).catch(() => {});
    }
  }
  await chrome.storage.local.set({ [key]: { active: !!stats.active?.completed, passive: !!stats.passive?.completed } });
}

setupAlarms();
refreshBadgeFromStorage();
checkTaskNotificationsFromStorage();
