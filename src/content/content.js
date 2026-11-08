(function (root) {
  const isMerchantTop = window === window.top && /merchant\.vn$/iu.test(location.hostname);
  const isTimeboxingIframe = window !== window.top && (
      /timeboxing/iu.test(location.hostname) || 
      /vercel\.app$/iu.test(location.hostname) ||
      /merchant\.vn$/iu.test(location.hostname)
  );
  if (!isMerchantTop && !isTimeboxingIframe) return;
  const CONTENT_VERSION = "2.3.1-identity";
  if (root.__TASK_KPI_CONTENT_VERSION__ === CONTENT_VERSION) return;
  root.__TASK_KPI_CONTENT_VERSION__ = CONTENT_VERSION;
  const api = root.TaskKpi;
  let timer = null;
  let lastDate = api.storage.dateKey(new Date());
  let stopped = false;
  let timeboxingContext = null;
  let globalLastValidTasks = [];
  let globalLastValidTasksTime = 0;

  function readParentContext() {
    if (!isMerchantTop) return null;
    const url = new URL(location.href);
    return { formId: url.searchParams.get("form_id"), tabId: url.searchParams.get("tab_id"), parentUrl: location.href, date: api.storage.dateKey(), capturedAt: Date.now() };
  }
  function publicContext(context) {
    return { pathname: (() => { try { return new URL(context?.parentUrl).pathname; } catch { return null; } })(), formId: context?.formId || null, tabId: context?.tabId || null, capturedAt: context?.capturedAt || null };
  }
  function routeSnapshot(rawUrl) {
    try { const url = new URL(rawUrl); return { pathname: url.pathname, formId: url.searchParams.get("form_id"), tabId: url.searchParams.get("tab_id") }; }
    catch { return { pathname: null, formId: null, tabId: null }; }
  }
  async function publishParentContext(reason) {
    const context = readParentContext();
    if (!context) return;
    timeboxingContext = context;
    console.log("PARENT TIMEBOXING CONTEXT", { ...publicContext(context), reason });
    try { await chrome.runtime.sendMessage({ type: "TIMEBOXING_PARENT_CONTEXT", context }); } catch { /* Extension may be reloading. */ }
  }
  function installRouteWatcher() {
    if (!isMerchantTop || root.__TASK_KPI_ROUTE_WATCHER__) return;
    root.__TASK_KPI_ROUTE_WATCHER__ = true;
    let previousUrl = location.href;
    const routeChanged = reason => {
      const nextUrl = location.href;
      if (nextUrl === previousUrl) return;
      const oldUrl = previousUrl;
      previousUrl = nextUrl;
      const context = readParentContext();
      console.log("TIMEBOXING ROUTE CHANGED", { oldUrl: routeSnapshot(oldUrl), newUrl: routeSnapshot(nextUrl), formId: context?.formId || null, tabId: context?.tabId || null, reason });
      publishParentContext(reason);
      if (/^\/a\/timeboxing(?:\/|$)/iu.test(location.pathname)) {
        scheduleUpdate(400);
      }
    };
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) { const result = original.apply(this, args); queueMicrotask(() => routeChanged(method)); return result; };
    }
    addEventListener("popstate", () => routeChanged("popstate"));
    setInterval(() => routeChanged("url-poll"), 3000);
    publishParentContext("content-load");
  }
  async function requestCachedParentContext() {
    if (!isTimeboxingIframe) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "TIMEBOXING_CONTEXT_REQUEST" });
      if (!response?.context) return;
      timeboxingContext = { ...response.context };
      console.log("IFRAME RECEIVED PARENT CONTEXT", { ...publicContext(timeboxingContext), source: "background-cache" });
    } catch { /* Extension may be reloading. */ }
  }

  function sourcePageUrl() {
    if (window === window.top) return location.href;
    return document.referrer || location.href;
  }
  function safeUrl(value) {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
    catch { return "unknown"; }
  }

  let lastUpdateTime = 0;
  let isUpdating = false;
  let lastLoggedSignature = "";

  async function update(context = timeboxingContext, forceLog = false) {
    if (stopped || !api.storage.contextAvailable()) { stopped = true; return; }
    if (isUpdating) return;
    const nowMs = Date.now();
    if (!forceLog && nowMs - lastUpdateTime < 800) {
      scheduleUpdate(800);
      return;
    }
    isUpdating = true;
    lastUpdateTime = nowMs;
    try {
      if (window === window.top && !/^\/a\/timeboxing(?:\/|$)/iu.test(location.pathname)) {
        const settings = await api.storage.getSettings();
        const now = new Date();
        const cachedToday = await api.storage.getTodayData(now);
        const tasks = cachedToday?.tasks || [];
        const stats = cachedToday?.stats || (tasks.length ? api.calculator.calculateStats(tasks, settings, now) : null);
        if (stats) {
          try { chrome.runtime.sendMessage({ type: "KPI_STATS_UPDATED", stats, settings, tasks }).catch(() => {}); } catch {}
        }
        return { tasksCount: tasks.length, tasks, stats, diagnostics: null, context, sourceUrl: location.href, topFrame: true, fromCache: true };
      }

      const settings = await api.storage.getSettings();
      const now = new Date();
      if (globalLastValidTasks.length && api.timelineDebug?.seedTaskRuntimeStore) {
        api.timelineDebug.seedTaskRuntimeStore(globalLastValidTasks);
      }
      let tasks = api.CONFIG.USE_MOCK_DATA ? api.MOCK_TASKS : api.taskParser.parseTasks(document, now);
      if (tasks.length === 0 && globalLastValidTasks.length > 0 && (Date.now() - globalLastValidTasksTime < 3000)) {
          tasks = globalLastValidTasks;
      }
      if (!api.CONFIG.USE_MOCK_DATA && api.timelineDebug?.mapOpenedTaskRuntime) {
        const openedTaskMapping = await api.timelineDebug.mapOpenedTaskRuntime(tasks, document, now, context);
        tasks = openedTaskMapping.tasks || tasks;
      }
      if (tasks.length > 0) {
        globalLastValidTasks = tasks;
        globalLastValidTasksTime = Date.now();
      }
      const pageUrl = sourcePageUrl();
      const stats = api.calculator.calculateStats(tasks, settings, now);

      const currentSignature = JSON.stringify({
        url: safeUrl(location.href),
        tasks: tasks.map(t => ({ n: t.name, tp: t.type, st: t.status, m: api.calculator.effectiveTaskMinutes(t, now) })),
        tot: stats.total.currentMinutes
      });
      const shouldLog = forceLog || api.CONFIG.DEBUG_MODE || (tasks.length > 0 && currentSignature !== lastLoggedSignature);

      if (shouldLog) {
        lastLoggedSignature = currentSignature;
        await api.logger.log("content", "Bắt đầu đọc DOM", { url: safeUrl(location.href), pageUrl: safeUrl(pageUrl), topFrame: window === window.top });
        const diagnostics = api.taskParser.diagnose(document, tasks, now);
        await api.logger.log("parser", "Kết quả parser", {
          ...diagnostics,
          parsedTasks: tasks.length,
          tasks: tasks.map(task => ({ name: task.name, type: task.type, minutes: api.calculator.effectiveTaskMinutes(task, now), status: task.status }))
        });
        const detailTask = tasks.find(task => task.detailDiagnostics);
        if (detailTask) {
          const runtimeLog = {
            name: detailTask.name,
            type: detailTask.type,
            runtimeStatus: detailTask.runtimeStatus,
            workedMinutes: detailTask.workedMinutes,
            pausedMinutes: api.calculator.calculatePausedMinutes(detailTask.timeline, now),
            pauseCount: detailTask.pauseCount
          };
          await api.logger.log("parser", "=== TASK RUNTIME ===", runtimeLog);
        }
        const kpiLog = {
          activeBaseMinutes: stats.active.baseMinutes,
          activeRunningMinutes: stats.active.runningMinutes,
          activeCurrentMinutes: stats.active.currentMinutes,
          passiveBaseMinutes: stats.passive.baseMinutes,
          passiveCurrentMinutes: stats.passive.currentMinutes,
          totalCurrentMinutes: stats.total.currentMinutes
        };
        await api.logger.log("calculator", "KPI REALTIME", kpiLog);
      }
      if (window === window.top) document.getElementById("task-kpi-overlay-host")?.remove();
      if (tasks.length) {
        await api.storage.saveDailyData({ tasks, stats, sourceUrl: pageUrl, source: api.CONFIG.USE_MOCK_DATA ? "mock" : "website" }, now);
      }
      try { chrome.runtime.sendMessage({ type: "KPI_STATS_UPDATED", stats, settings, tasks }).catch(() => {}); }
      catch { stopped = true; }
      const today = api.storage.dateKey(now);
      if (today !== lastDate) lastDate = today;
      return { tasksCount: tasks.length, tasks, stats, diagnostics: null, context, sourceUrl: context?.parentUrl || pageUrl, frameUrl: safeUrl(location.href), topFrame: window === window.top };
    } finally {
      isUpdating = false;
    }
  }

  function scheduleUpdate(delay = api.CONFIG.MUTATION_DEBOUNCE_MS || 1200) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => update().catch(() => { stopped = true; }), delay);
  }

  if (isTimeboxingIframe) {
    const observer = new MutationObserver(mutations => {
      if (mutations.every(m => m.target?.getRootNode?.()?.host?.id === "task-kpi-overlay-host")) return;
      scheduleUpdate();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  setInterval(() => update().catch(() => { stopped = true; }), api.CONFIG.FALLBACK_INTERVAL_MS);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.settings) scheduleUpdate();
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.type !== "REQUEST_KPI_REFRESH" && message.type !== "TIMEBOXING_CONTEXT") return;
    if (message.context) {
      timeboxingContext = { ...message.context };
      if (isTimeboxingIframe) console.log("IFRAME RECEIVED PARENT CONTEXT", publicContext(timeboxingContext));
    }
    update(timeboxingContext, message.type === "REQUEST_KPI_REFRESH").then(result => sendResponse({ ok: true, ...result })).catch(async error => {
      await api.logger.log("content", "Lỗi cập nhật", { message: error.message, stack: error.stack });
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  });
  installRouteWatcher();
  requestCachedParentContext().finally(() => update().catch(() => { stopped = true; }));
})(typeof globalThis !== "undefined" ? globalThis : this);
