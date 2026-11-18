(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};

  function parseDuration(text) {
    if (typeof text !== "string") return null;
    const normalized = text.trim().toLowerCase().replace(/,/g, " ");
    if (!normalized) return null;
    const hourMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:giờ|gio|h)(?![\p{L}\p{N}])/iu);
    const minuteMatch = normalized.match(/(\d+)\s*(?:phút|phut|m)(?![\p{L}\p{N}])/iu);
    if (!hourMatch && !minuteMatch) return null;
    const hours = hourMatch ? Number(hourMatch[1].replace(",", ".")) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return Math.max(0, Math.round(hours * 60 + minutes));
  }

  function formatDuration(minutes) {
    const safe = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    if (!hours) return `${mins} phút`;
    if (!mins) return `${hours}h`;
    return `${hours}h${String(mins).padStart(2, "0")}`;
  }

  function formatDurationCompact(minutes) {
    const safe = Math.max(0, Math.round(Number(minutes) || 0));
    if (safe < 60) return `${safe}m`;
    return `${Math.floor(safe / 60)}h${String(safe % 60).padStart(2, "0")}`;
  }

  function formatClock(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--:--";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  api.duration = { parseDuration, formatDuration, formatDurationCompact, formatClock };
  if (typeof module !== "undefined") module.exports = api.duration;
})(typeof globalThis !== "undefined" ? globalThis : this);
