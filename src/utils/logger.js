(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};
  const MAX_LOGS = 150;
  const inMemoryLogs = [];
  let writeQueue = Promise.resolve();
  function sanitize(value, key = "") {
    if (value == null) return value;
    if (/token|authorization|cookie|secret/i.test(key)) return "[REDACTED]";
    if (typeof value === "string") {
      return value
        .replace(/([?&](?:token|token_business|access_token|authorization)=)[^&\s]+/giu, "$1[REDACTED]")
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]");
    }
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
    return value;
  }
  function log(scope, message, details = null) {
    const entry = { time: new Date().toISOString(), scope, message, details: sanitize(details) };
    inMemoryLogs.push(entry);
    if (inMemoryLogs.length > MAX_LOGS) inMemoryLogs.shift();

    writeQueue = writeQueue.then(async () => {
      try {
        if (!globalThis.chrome?.runtime?.id || !chrome.storage?.local) return entry;
        const result = await chrome.storage.local.get("debugLogs");
        const logs = Array.isArray(result.debugLogs) ? result.debugLogs : [];
        logs.push(entry);
        await chrome.storage.local.set({ debugLogs: logs.slice(-MAX_LOGS) });
      } catch { /* Context cũ: bỏ qua. */ }
      return entry;
    });
    return writeQueue.then(() => entry);
  }
  async function getLogs() {
    try {
      const stored = (await chrome.storage.local.get("debugLogs")).debugLogs || [];
      if (stored.length) return stored;
    } catch { /* noop */ }
    return inMemoryLogs;
  }
  async function clearLogs() {
    inMemoryLogs.length = 0;
    try { await chrome.storage.local.set({ debugLogs: [] }); } catch { /* noop */ }
  }
  function formatLogs(logs) { return logs.map(item => `[${item.time}] [${item.scope}] ${item.message}${item.details == null ? "" : ` ${JSON.stringify(item.details)}`}`).join("\n"); }
  api.logger = { log, getLogs, clearLogs, formatLogs };
})(typeof globalThis !== "undefined" ? globalThis : this);
