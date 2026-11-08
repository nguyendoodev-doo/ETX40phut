(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};
  api.CONFIG = Object.freeze({
    USE_MOCK_DATA: false,
    DEBUG_MODE: false,
    FALLBACK_INTERVAL_MS: 45000,
    MUTATION_DEBOUNCE_MS: 1200,
    TIMEBOXING: Object.freeze({
      enabled: true,
      dryRun: false,
      timezone: "Asia/Ho_Chi_Minh",
      taskPrefix: "KẾ HOẠCH NGÀY",
      startHour: 8,
      startMinute: 46,
      endHour: 8,
      endMinute: 55,
      retrySeconds: 30,
      workingDays: Object.freeze([1, 2, 3, 4, 5, 6]),
      domWaitMs: 10000,
      completionWaitMs: 10000
    }),
    DEFAULT_SETTINGS: Object.freeze({
      activeTarget: 270,
      passiveTarget: 180,
      showOverlay: true,
      showPrediction: true,
      notificationsEnabled: false,
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      autoTimeboxingEnabled: true,
      autoTimeboxingDryRun: false
    })
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
