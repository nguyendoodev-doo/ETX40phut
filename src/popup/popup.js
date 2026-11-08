(function () {
  const api = globalThis.TaskKpi;
  const { formatClock, formatDurationCompact: dur } = api.duration;
  const debug = !!api.CONFIG.DEBUG_MODE;
  const $ = id => document.getElementById(id);

  let last = null;
  let synced = null;
  let syncError = false;
  let notificationPermissionDenied = false;

  if (typeof chrome !== "undefined" && chrome.notifications?.getPermissionLevel) {
    chrome.notifications.getPermissionLevel(level => {
      if (level === "denied") {
        notificationPermissionDenied = true;
        if (typeof render === "function") render();
      }
    });
  }

  const esc = v => {
    const d = document.createElement("div");
    d.textContent = v || "";
    return d.innerHTML;
  };

  const label = t => t === "active" ? "Chủ động" : "Bị động";
  const pct = s => s.targetMinutes ? Math.min(100, Math.round(s.currentMinutes / s.targetMinutes * 100)) : 100;
  const cls = s => s.completed ? "complete" : pct(s) >= 85 ? "near" : "";
  const words = m => m < 60 ? `${Math.max(0, Math.round(m))} phút` : dur(m);

  function eventTime(text, value) {
    const raw = String(text || (typeof value === "string" ? value : "") || "").trim();
    const m = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m) return `${String(+m[1]).padStart(2, "0")}:${m[2]}`;
    if (!value || value === "null" || value === "undefined") return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "—";
    return formatClock(d);
  }

  function renderHeader(now) {
    return `<div class="app-header"><div class="logo-flag" title="Việt Nam"><svg viewBox="0 0 128 128" class="flag-icon"><rect width="128" height="128" rx="24" fill="#DA251D"/><polygon points="64.00,26.00 72.53,52.26 100.14,52.26 77.80,68.49 86.34,94.74 64.00,78.51 41.66,94.74 50.20,68.49 27.86,52.26 55.47,52.26" fill="#FFFF00"/></svg></div><div class="brand-block"><h1 class="brand"><span class="brand-main">Bot</span><span class="brand-accent">banhang</span></h1><div class="brand-tag">KPI Tracker · by Botbanhang</div></div><div class="header-right"><div class="date-time">${now.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })} · ${formatClock(now)}</div><button id="settings" class="icon-button" title="Cài đặt" aria-label="Cài đặt">⚙</button></div></div>`;
  }

  function hero(s) {
    if (s.total.completed) {
      return `
        <section class="panel hero complete">
          <div class="hero-top-row">
            <span class="hero-badge complete">✓ ĐÃ ĐẠT KPI HÔM NAY</span>
            <span class="hero-total-pct">100%</span>
          </div>
          <div class="hero-title">XUẤT SẮC! ĐÃ HOÀN THÀNH ĐỦ KPI</div>
          <div class="hero-copy">Dư tổng <strong>${dur(s.total.overtimeMinutes)}</strong> (${words(s.total.overtimeMinutes)})</div>
          <div class="hero-checks">
            <span class="hero-chip done">✓ Chủ động đủ: ${dur(s.active.currentMinutes)} / ${dur(s.active.targetMinutes)}${s.active.overtimeMinutes ? ` (+${words(s.active.overtimeMinutes)})` : ""}</span>
            <span class="hero-chip done">✓ Bị động đủ: ${dur(s.passive.currentMinutes)} / ${dur(s.passive.targetMinutes)}${s.passive.overtimeMinutes ? ` (+${words(s.passive.overtimeMinutes)})` : ""}</span>
          </div>
        </section>
      `;
    }

    const totalRemaining = s.total.remainingMinutes;
    const activeDone = s.active.completed;
    const passiveDone = s.passive.completed;
    const isNear = pct(s.total) >= 85;

    return `
      <section class="panel hero ${isNear ? "near" : ""}">
        <div class="hero-top-row">
          <span class="hero-badge ${isNear ? "near" : "ongoing"}">${isNear ? "GẦN ĐẠT KPI" : "MỤC TIÊU CẦN ĐẠT HÔM NAY"}</span>
          <span class="hero-total-pct">${pct(s.total)}%</span>
        </div>
        <div class="hero-main-stat">
          <div class="hero-stat-label">Tổng thời gian cần làm thêm</div>
          <div class="hero-stat-val">${dur(totalRemaining)} <small>(${words(totalRemaining)})</small></div>
        </div>
        <div class="hero-kpi-grid">
          <div class="hero-kpi-col ${activeDone ? "done" : "need"}">
            <div class="kpi-col-label">Chủ động</div>
            <div class="kpi-col-status">${activeDone ? `✓ Đã đủ${s.active.overtimeMinutes ? ` (+${words(s.active.overtimeMinutes)})` : ""}` : `Còn thiếu <strong>${words(s.active.remainingMinutes)}</strong>`}</div>
            <div class="kpi-col-sub">${dur(s.active.currentMinutes)} / ${dur(s.active.targetMinutes)} (${pct(s.active)}%)</div>
          </div>
          <div class="hero-kpi-col ${passiveDone ? "done" : "need"}">
            <div class="kpi-col-label">Bị động</div>
            <div class="kpi-col-status">${passiveDone ? `✓ Đã đủ${s.passive.overtimeMinutes ? ` (+${words(s.passive.overtimeMinutes)})` : ""}` : `Còn thiếu <strong>${words(s.passive.remainingMinutes)}</strong>`}</div>
            <div class="kpi-col-sub">${dur(s.passive.currentMinutes)} / ${dur(s.passive.targetMinutes)} (${pct(s.passive)}%)</div>
          </div>
        </div>
      </section>
    `;
  }

  const bar = s => `<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(s)}"><div class="bar" style="width:${pct(s)}%"></div></div>`;

  function daily(s) {
    return `<section class="panel ${cls(s.total)}"><div class="section-heading"><span class="eyebrow">Tiến độ ngày</span><span class="percent">${pct(s.total)}%</span></div><div class="metric">${dur(s.total.currentMinutes)} <small>/ ${dur(s.total.targetMinutes)}</small></div>${bar(s.total)}<div class="kpi-state">${s.total.completed ? `✓ Đủ · Dư ${words(s.total.overtimeMinutes)}` : `Còn ${dur(s.total.remainingMinutes)}`}</div></section>`;
  }

  function kpi(type, s) {
    const name = label(type);
    const empty = s.currentMinutes === 0 ? `<p class="empty-note">Chưa có thời gian ${name} hôm nay</p>` : "";
    return `<section class="panel ${cls(s)}"><div class="kpi-heading"><span class="eyebrow">${name}</span><span class="percent">${pct(s)}%</span></div><div class="metric">${dur(s.currentMinutes)} <small>/ ${dur(s.targetMinutes)}</small></div>${bar(s)}${empty}<div class="kpi-state">${s.completed ? `✓ Đủ${s.overtimeMinutes ? ` · Dư ${words(s.overtimeMinutes)}` : ""}` : `Còn ${dur(s.remainingMinutes)}`}</div></section>`;
  }

  function running(r, s, now) {
    if (!r?.task) return "";
    const t = r.task;
    const paused = t.status === "paused" || t.runtimeStatus === "paused" || r.runtimeStatus === "paused";
    const c = t.type === "passive" ? s.passive : s.active;
    const name = label(t.type);
    const tl = api.calculator.analyzeTimeline(t.timeline || [], now);
    const lastEvent = tl.timeline.at(-1)?.at;
    const workedMins = r.effectiveElapsedMinutes ?? r.workedMinutes ?? t.workedMinutes ?? tl.workedMinutes ?? 0;
    const startEvt = (t.timeline || []).find(e => e.type === "start");
    const startTimeText = t.startedAtText || r.startedAtText || startEvt?.time || (r.startedAt ? formatClock(new Date(r.startedAt)) : null);
    const startTimeVal = t.startedAt || r.startedAt || startEvt?.at || null;

    const pausedMins = tl.pausedMinutes || r.pausedMinutes || t.pausedMinutes || (t.lastPausedAt ? Math.max(0, Math.floor((now - new Date(t.lastPausedAt)) / 60000)) : 0);
    const pauseCount = tl.pauseCount || r.pauseCount || t.pauseCount || (paused ? 1 : 0);
    const lastPausedTime = t.lastPausedAtText || (t.lastPausedAt ? formatClock(new Date(t.lastPausedAt)) : (lastEvent ? formatClock(new Date(lastEvent)) : null));

    const pause = paused
      ? `<div class="pause-grid"><div class="meta"><span>Tạm dừng lúc</span><strong>${eventTime(lastPausedTime, t.lastPausedAt || lastEvent)}</strong></div><div class="meta"><span>Đã tạm dừng</span><strong>${dur(pausedMins)}</strong></div><div class="meta"><span>Số lần</span><strong>${pauseCount}</strong></div></div>`
      : (pauseCount ? `<div class="recommendation-sub">Tạm dừng: ${pauseCount} lần · Tổng nghỉ: ${dur(pausedMins)}</div>` : "");
    const prediction = !paused && r.targetReachedAt && !c.completed
      ? `🎯 Dự kiến đủ ${name} lúc <strong>${formatClock(new Date(r.targetReachedAt))}</strong>`
      : "";
    const outcome = c.completed
      ? `✓ KPI ${name} đã đủ${c.overtimeMinutes ? ` · Dư ${words(c.overtimeMinutes)}` : ""}`
      : (paused
          ? `✓ Đã cộng ${dur(workedMins)} vào tiến độ ${name} · Còn thiếu ${dur(c.remainingMinutes)}`
          : (prediction || `KPI ${name} còn ${dur(c.remainingMinutes)}`));

    return `<section class="panel task-card ${paused ? "paused" : ""}"><div class="task-status">${paused ? "⏸ ĐANG TẠM DỪNG" : "▶ ĐANG CHẠY"}</div><div class="task-name" title="${esc(t.name).replace(/"/g, "&quot;")}">${esc(t.name || "Task chưa có tên")}</div><span class="badge">${name}</span><div class="task-grid"><div class="meta"><span>Bắt đầu</span><strong>${eventTime(startTimeText, startTimeVal)}</strong></div><div class="meta"><span>Đã làm</span><strong>${dur(workedMins)}</strong></div></div>${pause}<div class="task-outcome ${c.completed ? "complete" : ""}">${outcome}</div></section>`;
  }

  function prediction(s) {
    const r = s.runningTask;
    if (!r || r.task.status === "paused") return "";
    const other = r.task.type === "passive" ? s.active : s.passive;
    const otherType = r.task.type === "active" ? "passive" : "active";
    if (other.completed && r.targetReachedAt) {
      return `<section class="panel prediction"><div><div class="eyebrow">Dự kiến hoàn thành KPI ngày</div><strong>${formatClock(new Date(r.targetReachedAt))}</strong></div></section>`;
    }
    if (!other.completed) {
      return `<section class="panel prediction"><div class="eyebrow">Dự kiến hoàn thành</div><div class="prediction-note">Chưa thể dự đoán toàn ngày<br>${label(otherType)} còn thiếu ${dur(other.remainingMinutes)}</div></section>`;
    }
    return "";
  }

  function recommendation(s) {
    if (s.total.completed) {
      return `<section class="panel recommendation"><div class="eyebrow">Gợi ý tiếp theo</div><div class="recommendation-main success">✓ KPI hôm nay đã hoàn thành</div><div class="recommendation-sub">Dư tổng ${words(s.total.overtimeMinutes)}</div></section>`;
    }
    const p = [["active", s.active], ["passive", s.passive]].filter(x => !x[1].completed).sort((a, b) => pct(a[1]) - pct(b[1]) || b[1].remainingMinutes - a[1].remainingMinutes)[0];
    if (!p) return "";
    return `<section class="panel recommendation"><div class="eyebrow">Gợi ý tiếp theo</div><div class="recommendation-main">Ưu tiên task ${label(p[0])}</div><div class="recommendation-sub">Còn thiếu ${dur(p[1].remainingMinutes)}</div></section>`;
  }

  function summary(tasks, s, nowParam = new Date()) {
    if (!tasks || !tasks.length) {
      return `
        <section class="panel">
          <div class="eyebrow">Tổng quan tất cả các task hôm nay</div>
          <p class="empty-note">Chưa có task nào được ghi nhận hôm nay.</p>
        </section>
      `;
    }

    const now = nowParam instanceof Date ? nowParam : new Date(nowParam);
    const count = x => tasks.filter(t => t.status === x).length;
    const c = count("completed");
    const r = count("running");
    const p = count("paused");
    const other = Math.max(0, tasks.length - c - r - p);

    const activeTasks = tasks.filter(t => t.type === "active");
    const passiveTasks = tasks.filter(t => t.type === "passive");
    const otherTasks = tasks.filter(t => t.type !== "active" && t.type !== "passive");
    const countedActiveCount = activeTasks.filter(t => t.status === "completed" || t.status === "running" || (t.status === "paused" && api.calculator.effectiveTaskMinutes(t, now) > 0)).length;
    const countedPassiveCount = passiveTasks.filter(t => t.status === "completed" || t.status === "running" || (t.status === "paused" && api.calculator.effectiveTaskMinutes(t, now) > 0)).length;

    const taskRows = tasks.map((t, idx) => {
      const mins = api.calculator.effectiveTaskMinutes(t, now);
      const isRun = t.status === "running" && t.runtimeStatus !== "paused" && !t.inUpcomingSection;
      const isPause = t.status === "paused" || t.runtimeStatus === "paused";
      const isComp = t.status === "completed";
      const statusClass = isRun ? "status-running" : isPause ? "status-paused" : isComp ? "status-comp" : "status-other";
      const livePausedMins = (isPause && Array.isArray(t.timeline) && t.timeline.length)
        ? api.calculator.calculatePausedMinutes(t.timeline, now)
        : (t.lastPausedAt ? Math.max(0, Math.floor((now - new Date(t.lastPausedAt)) / 60000)) : 0);
      const pausedMins = Math.max(livePausedMins, Number(t.pausedMinutes) || 0);
      const statusLabel = isRun ? "▶ Đang chạy" : isPause ? (pausedMins > 0 ? `⏸ Tạm dừng (${dur(pausedMins)})` : "⏸ Tạm dừng") : isComp ? "✓ Hoàn thành" : "Chưa hoàn thành";
      const isAct = t.type === "active";
      const isPas = t.type === "passive";
      const typeLabel = isAct ? "Chủ động" : (isPas ? "Bị động" : "Khác");
      const typeClass = isAct ? "tag-active" : (isPas ? "tag-passive" : "tag-unknown");

      return `
        <div class="task-row-item ${statusClass}">
          <div class="task-row-left">
            <span class="task-num">${idx + 1}.</span>
            <div class="task-row-info">
              <div class="task-row-name" title="${esc(t.name).replace(/"/g, "&quot;")}">${esc(t.name || "Task không tên")}</div>
              <div class="task-row-badges">
                <span class="mini-tag ${typeClass}">${typeLabel}</span>
                <span class="mini-status ${statusClass}">${statusLabel}</span>
              </div>
            </div>
          </div>
          <div class="task-row-right">
            <span class="task-dur">${mins > 0 ? dur(mins) : (isRun ? "Đang chạy" : "0m")}</span>
          </div>
        </div>
      `;
    }).join("");

    const activeMins = activeTasks.reduce((sum, t) => sum + api.calculator.effectiveTaskMinutes(t, now), 0);
    const passiveMins = passiveTasks.reduce((sum, t) => sum + api.calculator.effectiveTaskMinutes(t, now), 0);
    const otherMins = otherTasks.reduce((sum, t) => sum + api.calculator.effectiveTaskMinutes(t, now), 0);
    const totalMins = activeMins + passiveMins + otherMins;

    return `
      <section class="panel task-summary-panel">
        <div class="summary-header">
          <div class="eyebrow">Tổng quan tất cả các task (${tasks.length} task)</div>
          <div class="summary-counts">
            <span class="cnt-badge done">${c} hoàn thành</span>
            ${r ? `<span class="cnt-badge run">${r} đang chạy</span>` : ""}
            ${p ? `<span class="cnt-badge pause">${p} tạm dừng</span>` : ""}
            ${other ? `<span class="cnt-badge other">${other} chưa xong</span>` : ""}
          </div>
        </div>
        <div class="task-list-container">
          ${taskRows}
        </div>
        <div class="task-summary-footer">
          <div class="subtotal-item">
            <span class="subtotal-label">Chủ động (${countedActiveCount}/${activeTasks.length} task tính KPI):</span>
            <strong>${dur(activeMins)}</strong>
          </div>
          <div class="subtotal-item">
            <span class="subtotal-label">Bị động (${countedPassiveCount}/${passiveTasks.length} task tính KPI):</span>
            <strong>${dur(passiveMins)}</strong>
          </div>
          ${otherTasks.length ? `<div class="subtotal-item"><span class="subtotal-label">Khác (${otherTasks.length} task):</span><strong>${dur(otherMins)}</strong></div>` : ""}
          <div class="subtotal-item total-row">
            <span class="subtotal-label">Tổng đã làm:</span>
            <strong>${dur(totalMins)} / ${s ? dur(s.total.targetMinutes) : "7h30"}</strong>
          </div>
        </div>
      </section>
    `;
  }

  let copyFeedbackText = null;
  let currentTasksSnapshot = [];

  function footer() {
    const syncText = syncError
      ? "Chưa kết nối Timeboxing"
      : (synced ? `Dữ liệu hôm nay · ${formatClock(new Date(synced))}` : "Đã đồng bộ");
    const copyLabel = copyFeedbackText || "Sao chép log";
    return `<div class="footer"><div class="sync ${syncError ? "error" : ""}"><span class="sync-dot">●</span> ${syncText}</div><div class="footer-actions"><button id="refresh" class="footer-button" type="button">↻ Làm mới</button><button id="footerCopyLogs" class="footer-button" type="button">${copyLabel}</button></div></div>`;
  }

  async function render(result = null) {
    if (result?.tasks?.length) {
      last = result;
      synced = Date.now();
      syncError = false;
    }
    const chosen = result?.tasks?.length ? result : last;
    const settings = await api.storage.getSettings();
    const cached = await api.storage.getTodayData();

    // Prioritize fresh live tasks, otherwise use today's cached data
    let tasks = [];
    if (chosen?.tasks?.length) {
      tasks = chosen.tasks;
    } else if (cached?.tasks?.length) {
      tasks = cached.tasks;
    }

    if (tasks.length && api.timelineDebug?.enrichAllTasksWithCachedRuntime) {
      tasks = api.timelineDebug.enrichAllTasksWithCachedRuntime(tasks);
    }

    if (!synced && cached?.updatedAt) synced = cached.updatedAt;
    const now = new Date();
    const s = api.calculator.calculateStats(tasks, settings, now);
    window.currentStats = s;
    currentTasksSnapshot = tasks;

    $('header').innerHTML = renderHeader(now);
    const permNotice = notificationPermissionDenied
      ? `<div class="permission-notice" style="background:#fee2e2; border:1px solid #f87171; color:#991b1b; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:8px; line-height:1.4;">⚠️ <strong>Chưa cấp quyền thông báo:</strong> Vui lòng bật quyền Thông báo trong cài đặt trình duyệt để nhận Desktop Notification khi task đủ thời gian.</div>`
      : "";
    $('content').innerHTML = `<div class="stack">${permNotice}${hero(s)}${daily(s)}${kpi("active", s.active)}${kpi("passive", s.passive)}${running(s.runningTask, s, now)}${prediction(s)}${recommendation(s)}${summary(tasks, s, now)}</div>`;
    $('footer').innerHTML = footer();

    $('settings').onclick = () => chrome.runtime.openOptionsPage();
    $('refresh').onclick = handleRefresh;
    $('footerCopyLogs').onclick = copyLogs;

    if (debug) {
      $('status').hidden = false;
      $('status').textContent = tasks.length ? `Đã đọc ${tasks.length} task.` : "Chưa có task hôm nay.";
      await renderLogs();
    }
  }

  async function renderLogs() {
    const logs = await api.logger.getLogs();
    $('logs').textContent = logs.length ? api.logger.formatLogs(logs.slice(-60)) : "Chưa có log.";
  }

  async function writeClipboardText(text) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fallback below */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  async function buildFullLogText() {
    const storedLogs = await api.logger.getLogs();
    const now = new Date();
    const snapshotEntry = {
      time: now.toISOString(),
      scope: "popup",
      message: "Trạng thái KPI hiện tại",
      details: {
        parsedTasks: currentTasksSnapshot.length,
        tasks: currentTasksSnapshot.map(t => ({
          name: t.name,
          type: t.type,
          status: t.status,
          minutes: api.calculator.effectiveTaskMinutes(t, now)
        })),
        stats: window.currentStats ? {
          activeCurrentMinutes: window.currentStats.active?.currentMinutes || 0,
          passiveCurrentMinutes: window.currentStats.passive?.currentMinutes || 0,
          totalCurrentMinutes: window.currentStats.total?.currentMinutes || 0,
          activeRemainingMinutes: window.currentStats.active?.remainingMinutes || 0,
          passiveRemainingMinutes: window.currentStats.passive?.remainingMinutes || 0,
          totalRemainingMinutes: window.currentStats.total?.remainingMinutes || 0
        } : null
      }
    };
    const combined = [...storedLogs.slice(-80), snapshotEntry];
    return api.logger.formatLogs(combined);
  }

  async function copyLogs(event) {
    if (event) event.preventDefault();
    const button = event?.currentTarget || $('footerCopyLogs');
    try {
      const logText = await buildFullLogText();
      const copied = await writeClipboardText(logText || "Chưa có log.");
      copyFeedbackText = copied ? "✓ Đã sao chép" : "Không thể sao chép";
    } catch {
      copyFeedbackText = "Không thể sao chép";
    }
    if (button) button.textContent = copyFeedbackText;
    const footerBtn = $('footerCopyLogs');
    if (footerBtn) footerBtn.textContent = copyFeedbackText;
    setTimeout(() => {
      copyFeedbackText = null;
      const b = $('footerCopyLogs');
      if (b) b.textContent = "Sao chép log";
    }, 1800);
  }

  function buildTimeboxingContext(tab) {
    try {
      const url = new URL(tab.url);
      return { formId: url.searchParams.get("form_id"), tabId: url.searchParams.get("tab_id"), parentUrl: tab.url, date: api.storage.dateKey() };
    } catch {
      return { formId: null, tabId: null, parentUrl: null, date: api.storage.dateKey() };
    }
  }

  const frames = id => new Promise(ok => chrome.webNavigation.getAllFrames({ tabId: id }, x => ok(chrome.runtime.lastError ? [] : x || [])));

  function ask(id, f, context) {
    return new Promise(ok => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; ok(null); }
      }, 600); // 600ms timeout max
      try {
        chrome.tabs.sendMessage(id, { type: "REQUEST_KPI_REFRESH", context }, { frameId: f.frameId }, r => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !r) {
            ok(null);
          } else {
            ok({ ...r, frameId: f.frameId, frameUrl: f.url || r.frameUrl });
          }
        });
      } catch {
        if (!done) { done = true; clearTimeout(timer); ok(null); }
      }
    });
  }

  const best = a => a.filter(x => x?.tasks?.length).sort((a, b) => b.tasks.length - a.tasks.length)[0] || null;

  async function read(id, context) {
    const fs = await frames(id);
    const preferred = fs.filter(f => /(?:timeboxing|vercel\.app|merchant\.vn)/iu.test(f.url || ""));
    const targetFrames = preferred.length > 0 ? preferred : fs;
    const results = await Promise.all(targetFrames.map(f => ask(id, f, context)));
    return best(results);
  }

  async function inject(id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id, allFrames: true },
        files: ["src/config.js", "src/utils/duration.js", "src/utils/calculator.js", "src/utils/storage.js", "src/utils/logger.js", "src/utils/taskIdentity.js", "src/utils/taskNotification.js", "src/mock/tasks.js", "src/content/timelineDebug.js", "src/content/taskParser.js", "src/content/content.js"]
      });
      return true;
    } catch {
      return false;
    }
  }

  async function refresh() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) return { ok: false };

      // Fast-path: If user is not on a Merchant/Timeboxing tab, don't crawl frames or inject
      const isMerchant = /(?:merchant\.vn|timeboxing|vercel\.app)/iu.test(tab.url);
      if (!isMerchant) {
        return { ok: false, reason: "not_merchant_tab" };
      }

      const context = buildTimeboxingContext(tab);
      let r = await read(tab.id, context);
      if (r?.tasks?.length) return { ok: true, ...r };

      if (!await inject(tab.id)) return { ok: false };
      await new Promise(ok => setTimeout(ok, 100));
      r = await read(tab.id, context);
      return r?.tasks?.length ? { ok: true, ...r } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  async function handleRefresh(e) {
    const btn = e?.currentTarget;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Đang đọc…";
    }
    const r = await refresh();
    if (r?.ok && r?.tasks?.length) {
      synced = Date.now();
      syncError = false;
      await render(r);
    } else {
      const cached = await api.storage.getTodayData();
      if (cached?.tasks?.length) {
        synced = cached.updatedAt || Date.now();
        syncError = false;
        await render(cached);
      } else {
        syncError = true;
        await render(null);
      }
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = "↻ Làm mới";
    }
  }

  $('debugPanel').hidden = !debug;
  $('copyLogs').onclick = copyLogs;
  $('clearLogs').onclick = async () => { await api.logger.clearLogs(); renderLogs(); };

  document.addEventListener("click", e => {
    const btn = e.target?.closest?.("#footerCopyLogs, #copyLogs");
    if (btn && !btn.onclick) copyLogs(e);
  });

  chrome.runtime.onMessage.addListener(m => {
    if (m.type === "KPI_STATS_UPDATED") render();
  });

  const timer = setInterval(() => render(last), 30000);
  addEventListener("unload", () => clearInterval(timer), { once: true });

  // 1. INSTANT RENDER (0ms latency): Immediately show cached data upon opening popup!
  render().finally(() => {
    // 2. BACKGROUND REVALIDATE: Seamlessly check live frames without freezing UI
    refresh().then(r => {
      if (r?.ok && r?.tasks?.length) {
        synced = Date.now();
        syncError = false;
        render(r);
      }
    }).catch(() => {});
  });
})();
