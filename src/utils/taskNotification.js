(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};

  const NOTIFICATION_TITLE = "🔔 TASK ĐÃ ĐỦ THỜI GIAN!";

  function formatTaskNotificationMessage(taskName, currentMinutes, thresholdMinutes) {
    const name = String(taskName || "Chưa có tên").trim();
    const curr = Math.max(0, Math.round(Number(currentMinutes) || 0));
    const thresh = Math.max(1, Math.round(Number(thresholdMinutes) || 40));
    return `Task: ${name}\n\nThời gian thực hiện: ${curr} phút/${thresh} phút.\n\nBạn đã hoàn thành đủ thời gian cho task này!`;
  }

  function getDateKey(now = new Date()) {
    const d = now instanceof Date ? now : new Date(now);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getNotificationStorageKey(dateKey) {
    return `taskNotificationState:${dateKey}`;
  }

  /**
   * Core logic to check tasks against notification threshold and dispatch Desktop + Telegram notifications.
   * Pure/modular design allowing comprehensive testing with mock dependencies.
   */
  async function evaluateTaskNotifications(tasks, settings, now = new Date(), deps = {}) {
    const chromeApi = deps.chrome || (typeof chrome !== "undefined" ? chrome : null);
    const calculator = deps.calculator || api.calculator;
    const taskIdentity = deps.taskIdentity || api.taskIdentity;
    const telegram = deps.telegram || api.telegram;

    const sendNotification = deps.sendNotification || (async (id, options) => {
      if (chromeApi?.notifications?.create) {
        return new Promise(resolve => {
          chromeApi.notifications.create(id, options, notificationId => resolve(notificationId));
        });
      }
      return null;
    });

    const sendTelegram = deps.sendTelegram || (async (token, chatId, text) => {
      if (telegram?.sendTelegramMessage) {
        return telegram.sendTelegramMessage(token, chatId, text);
      }
      return { ok: false, error: "Telegram module not available" };
    });

    const getStorage = deps.getStorage || (async key => {
      if (!chromeApi?.storage?.local?.get) return {};
      return new Promise(resolve => chromeApi.storage.local.get(key, resolve));
    });

    const setStorage = deps.setStorage || (async data => {
      if (!chromeApi?.storage?.local?.set) return false;
      return new Promise(resolve => chromeApi.storage.local.set(data, () => resolve(true)));
    });

    const isDesktopEnabled = settings?.taskNotificationEnabled !== false;
    const isTelegramEnabled = Boolean(settings?.telegramNotificationEnabled)
      && Boolean(settings?.telegramBotToken)
      && Boolean(settings?.telegramChatId);

    // If both notifications are disabled, return early
    if (!isDesktopEnabled && !isTelegramEnabled) {
      return { sentCount: 0, notifiedTasks: [], reason: "disabled" };
    }

    const threshold = Math.max(1, Number(settings?.taskNotificationMinutes) || 40);
    const dateKey = getDateKey(now);
    const stateKey = getNotificationStorageKey(dateKey);

    const storedData = await getStorage(stateKey);
    const notifiedState = { ...(storedData?.[stateKey] || {}) };

    const taskList = Array.isArray(tasks) ? tasks : [];
    const newlyNotified = [];

    for (const task of taskList) {
      if (!task) continue;
      const effectiveMinutes = calculator?.effectiveTaskMinutes
        ? calculator.effectiveTaskMinutes(task, now)
        : (Number(task.durationMinutes) || Number(task.workedMinutes) || 0);

      // Only notify when effective duration has reached or exceeded threshold
      if (effectiveMinutes < threshold) {
        continue;
      }

      const taskId = taskIdentity?.getTaskIdentifier
        ? taskIdentity.getTaskIdentifier(task)
        : (task.id || task.taskId || task.name);

      if (!taskId) continue;

      const previousState = notifiedState[taskId];
      // Check if both desktop & telegram (if enabled) are already fulfilled
      const desktopAlreadySent = Boolean(previousState?.desktopSent || previousState?.notifiedAt);
      const telegramAlreadySent = Boolean(previousState?.telegramSent);

      const needDesktop = isDesktopEnabled && !desktopAlreadySent;
      const needTelegram = isTelegramEnabled && !telegramAlreadySent;

      if (!needDesktop && !needTelegram) {
        continue;
      }

      let desktopSentSuccess = desktopAlreadySent;
      let telegramSentSuccess = telegramAlreadySent;
      let notificationId = previousState?.notificationId || null;

      // 1. Desktop Notification
      if (needDesktop) {
        const title = NOTIFICATION_TITLE;
        const message = formatTaskNotificationMessage(task.name, effectiveMinutes, threshold);
        notificationId = `task_notif_${dateKey}_${taskId}`;

        const iconUrl = deps.iconUrl || (chromeApi?.runtime?.getURL ? chromeApi.runtime.getURL("assets/icon128.png") : "assets/icon128.png");

        const options = {
          type: "basic",
          iconUrl,
          title,
          message,
          priority: 2,
          requireInteraction: false
        };

        try {
          await sendNotification(notificationId, options);
          desktopSentSuccess = true;
        } catch (err) {
          console.error("Failed to send desktop task notification", err);
        }
      }

      // 2. Telegram Notification (Independent execution, errors will not affect desktop notification)
      let telegramResult = null;
      if (needTelegram) {
        try {
          const tgText = telegram?.formatTelegramTaskMessage
            ? telegram.formatTelegramTaskMessage(task.name, effectiveMinutes, threshold, now)
            : `🔔 TASK ĐÃ ĐỦ THỜI GIAN!\n\n📌 Tên task: ${task.name || "Chưa có tên"}\n⏱ Thời gian: ${effectiveMinutes}/${threshold} phút\n✅ Hoàn thành đủ thời gian!`;

          telegramResult = await sendTelegram(settings.telegramBotToken, settings.telegramChatId, tgText);
          if (telegramResult?.ok) {
            telegramSentSuccess = true;
          } else {
            console.warn("Telegram task notification warning:", telegramResult?.error);
          }
        } catch (tgErr) {
          console.error("Telegram task notification exception:", tgErr);
        }
      }

      notifiedState[taskId] = {
        ...(previousState || {}),
        notifiedAt: (now instanceof Date ? now : new Date(now)).getTime(),
        effectiveMinutes,
        threshold,
        taskName: task.name || "",
        notificationId,
        desktopSent: desktopSentSuccess,
        telegramSent: telegramSentSuccess,
        telegramResult: telegramResult?.ok ? "ok" : (telegramResult?.error || null)
      };

      newlyNotified.push({
        taskId,
        taskName: task.name,
        effectiveMinutes,
        threshold,
        notificationId,
        desktopSent: desktopSentSuccess && needDesktop,
        telegramSent: telegramSentSuccess && needTelegram
      });
    }

    if (newlyNotified.length > 0) {
      await setStorage({ [stateKey]: notifiedState });
    }

    return {
      sentCount: newlyNotified.length,
      notifiedTasks: newlyNotified,
      dateKey,
      threshold
    };
  }

  async function checkPermission(chromeApi = (typeof chrome !== "undefined" ? chrome : null)) {
    if (!chromeApi?.notifications?.getPermissionLevel) {
      return { granted: true, supported: false };
    }
    return new Promise(resolve => {
      chromeApi.notifications.getPermissionLevel(level => {
        resolve({ granted: level === "granted", level, supported: true });
      });
    });
  }

  api.taskNotification = {
    NOTIFICATION_TITLE,
    formatTaskNotificationMessage,
    getDateKey,
    getNotificationStorageKey,
    evaluateTaskNotifications,
    checkPermission
  };

  if (typeof module !== "undefined") {
    module.exports = api.taskNotification;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
