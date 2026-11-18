(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};
  const defaults = () => ({ ...(api.CONFIG?.DEFAULT_SETTINGS || { activeTarget: 270, passiveTarget: 180, showOverlay: true, showPrediction: true, notificationsEnabled: false }) });
  function contextAvailable() {
    try { return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local); }
    catch { return false; }
  }
  const get = keys => new Promise(resolve => {
    if (!contextAvailable()) { resolve({}); return; }
    try {
      chrome.storage.local.get(keys, result => {
        if (chrome.runtime.lastError) { resolve({}); return; }
        resolve(result || {});
      });
    } catch { resolve({}); }
  });
  const set = value => new Promise(resolve => {
    if (!contextAvailable()) { resolve(false); return; }
    try {
      chrome.storage.local.set(value, () => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(true);
      });
    } catch { resolve(false); }
  });
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  async function getSettings() {
    const { settings } = await get("settings");
    return { ...defaults(), ...(settings || {}) };
  }
  async function saveSettings(settings) {
    const normalized = { ...defaults(), ...settings };
    await set({ settings: normalized });
    return normalized;
  }
  async function saveDailyData(data, date = new Date()) {
    const { dailyData = {} } = await get("dailyData");
    dailyData[dateKey(date)] = { ...data, updatedAt: Date.now() };
    return set({ dailyData });
  }
  async function getTodayData(date = new Date()) {
    const { dailyData = {} } = await get("dailyData");
    return dailyData[dateKey(date)] || null;
  }
  async function getTimeboxingState(dateKeyValue) {
    const key = `timeboxing_${dateKeyValue}`;
    const result = await get(key);
    return result[key] || null;
  }
  async function saveTimeboxingState(dateKeyValue, state) {
    const key = `timeboxing_${dateKeyValue}`;
    await set({ [key]: { ...(await getTimeboxingState(dateKeyValue) || {}), ...state } });
    return getTimeboxingState(dateKeyValue);
  }
  async function addTimeboxingLog(entry) {
    const { timeboxingLogs = [] } = await get("timeboxingLogs");
    const logs = [...timeboxingLogs, entry].slice(-200);
    await set({ timeboxingLogs: logs, timeboxingLastRun: entry });
    return entry;
  }
  async function getTimeboxingLogs() { return (await get("timeboxingLogs")).timeboxingLogs || []; }
  async function getTimeboxingLastRun() { return (await get("timeboxingLastRun")).timeboxingLastRun || null; }
  api.storage = { getSettings, saveSettings, saveDailyData, getTodayData, dateKey, contextAvailable, getTimeboxingState, saveTimeboxingState, addTimeboxingLog, getTimeboxingLogs, getTimeboxingLastRun };
})(typeof globalThis !== "undefined" ? globalThis : this);
