(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};
  const { formatDuration, formatClock } = api.duration;
  const HOST_ID = "task-kpi-overlay-host";

  function row(label, stats) {
    const state = stats.completed ? `✓ Đủ${stats.overtimeMinutes ? ` · Dư ${formatDuration(stats.overtimeMinutes)}` : ""}` : `Còn ${formatDuration(stats.remainingMinutes)}`;
    return `<section><b>${label}</b><span>${formatDuration(stats.currentMinutes)} / ${formatDuration(stats.targetMinutes)}</span><small>${state}</small></section>`;
  }
  function prediction(stats, settings) {
    const running = stats.runningTask;
    if (!settings.showPrediction || !running) return "";
    const label = running.task.type === "active" ? "Chủ động" : "Bị động";
    if (!running.canReachBeforeEnd) return `<p class="warn">Task hiện tại chưa đủ để hoàn thành KPI.<br>Sau task còn thiếu ${formatDuration(running.remainingAfterTask)}.</p>`;
    if (running.minutesUntilTarget === 0) return `<p>✓ ${label} đã đủ KPI.</p>`;
    return `<p>🎯 Dự kiến đủ ${label}: <b>${formatClock(running.targetReachedAt)}</b></p>`;
  }
  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    return host;
  }
  function renderOverlay(stats, settings) {
    const existing = document.getElementById(HOST_ID);
    if (!settings.showOverlay) { existing?.remove(); return; }
    const host = ensureHost();
    host.shadowRoot.innerHTML = `<style>
      :host{all:initial} .box{position:fixed;right:14px;bottom:14px;z-index:2147483647;width:245px;padding:14px;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:14px;box-shadow:0 12px 32px #0005;font:13px/1.4 system-ui,sans-serif}
      header{display:flex;justify-content:space-between;align-items:center;font-weight:800;letter-spacing:.06em} button{border:0;background:#374151;color:white;border-radius:7px;cursor:pointer;width:26px;height:26px} section{display:grid;grid-template-columns:1fr auto;gap:3px;margin-top:12px;padding-top:10px;border-top:1px solid #374151} section small{grid-column:1/3;color:#93c5fd} p{margin:12px 0 0;color:#d1fae5}.warn{color:#fde68a}.collapsed section,.collapsed p{display:none}</style>
      <aside class="box ${sessionStorage.getItem("taskKpiCollapsed") === "1" ? "collapsed" : ""}"><header>KPI HÔM NAY <button title="Thu gọn">−</button></header>${row("Chủ động", stats.active)}${row("Bị động", stats.passive)}${prediction(stats, settings)}</aside>`;
    host.shadowRoot.querySelector("button").onclick = event => {
      const box = event.currentTarget.closest(".box"); box.classList.toggle("collapsed");
      sessionStorage.setItem("taskKpiCollapsed", box.classList.contains("collapsed") ? "1" : "0");
    };
  }
  api.overlay = { renderOverlay };
})(typeof globalThis !== "undefined" ? globalThis : this);
