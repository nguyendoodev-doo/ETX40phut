(async function () {
  const storage = globalThis.TaskKpi.storage;
  const ids = [
    "activeTarget",
    "passiveTarget",
    "taskNotificationMinutes",
    "taskNotificationEnabled",
    "showOverlay",
    "showPrediction",
    "notificationsEnabled"
  ];

  const settings = await storage.getSettings();
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") {
      el.checked = !!settings[id];
    } else {
      el.value = settings[id] ?? "";
    }
  });

  // Check notification permission
  if (typeof chrome !== "undefined" && chrome.notifications?.getPermissionLevel) {
    chrome.notifications.getPermissionLevel(level => {
      const warningEl = document.getElementById("permissionWarning");
      if (warningEl && level === "denied") {
        warningEl.style.display = "block";
      }
    });
  }

  document.getElementById("form").onsubmit = async event => {
    event.preventDefault();
    await storage.saveSettings({
      activeTarget: Number(document.getElementById("activeTarget").value),
      passiveTarget: Number(document.getElementById("passiveTarget").value),
      taskNotificationMinutes: Math.max(1, Number(document.getElementById("taskNotificationMinutes").value) || 40),
      taskNotificationEnabled: document.getElementById("taskNotificationEnabled").checked,
      showOverlay: document.getElementById("showOverlay").checked,
      showPrediction: document.getElementById("showPrediction").checked,
      notificationsEnabled: document.getElementById("notificationsEnabled").checked
    });
    const message = document.getElementById("message");
    message.textContent = "Đã lưu.";
    setTimeout(() => message.textContent = "", 1800);
  };
})();
