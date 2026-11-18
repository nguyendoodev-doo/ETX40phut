(async function () {
  const storage = globalThis.TaskKpi.storage;
  const telegram = globalThis.TaskKpi.telegram;

  const ids = [
    "activeTarget",
    "passiveTarget",
    "taskNotificationMinutes",
    "taskNotificationEnabled",
    "telegramNotificationEnabled",
    "telegramBotToken",
    "telegramChatId",
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

  // Toggle show/hide bot token
  const toggleBtn = document.getElementById("toggleBotToken");
  const tokenInput = document.getElementById("telegramBotToken");
  if (toggleBtn && tokenInput) {
    toggleBtn.addEventListener("click", () => {
      if (tokenInput.type === "password") {
        tokenInput.type = "text";
        toggleBtn.textContent = "🙈";
      } else {
        tokenInput.type = "password";
        toggleBtn.textContent = "👁";
      }
    });
  }

  // Check Chrome Desktop notification permission
  if (typeof chrome !== "undefined" && chrome.notifications?.getPermissionLevel) {
    chrome.notifications.getPermissionLevel(level => {
      const warningEl = document.getElementById("permissionWarning");
      if (warningEl && level === "denied") {
        warningEl.style.display = "block";
      }
    });
  }

  const statusBox = document.getElementById("telegramStatusBox");
  function showTelegramStatus(type, html) {
    if (!statusBox) return;
    statusBox.className = `status-box ${type}`;
    statusBox.innerHTML = html;
    statusBox.style.display = "block";
  }

  // Test Telegram Connection button
  const btnTestConnection = document.getElementById("btnTestConnection");
  if (btnTestConnection) {
    btnTestConnection.addEventListener("click", async () => {
      const token = tokenInput ? tokenInput.value.trim() : "";
      if (!token) {
        showTelegramStatus("error", "⚠️ Vui lòng nhập <strong>Bot Token</strong> trước khi kiểm tra kết nối.");
        if (tokenInput) tokenInput.focus();
        return;
      }

      btnTestConnection.disabled = true;
      btnTestConnection.textContent = "⏳ Đang kiểm tra...";
      showTelegramStatus("info", "Đang kết nối đến máy chủ Telegram API...");

      try {
        const result = await telegram.testTelegramConnection(token);
        if (result.ok) {
          const bot = result.bot;
          showTelegramStatus(
            "success",
            `✓ <strong>Kết nối thành công!</strong><br>Tên Bot: <strong>${bot.firstName || "Bot"}</strong><br>Username: <strong>@${bot.username || "Chưa có username"}</strong>`
          );
        } else {
          showTelegramStatus(
            "error",
            `❌ <strong>Kết nối thất bại:</strong> ${result.error}<br><small>Vui lòng kiểm tra lại Bot Token đã sao chép từ @BotFather.</small>`
          );
        }
      } catch (err) {
        showTelegramStatus("error", `❌ <strong>Lỗi:</strong> ${err.message}`);
      } finally {
        btnTestConnection.disabled = false;
        btnTestConnection.textContent = "🔍 Kiểm tra kết nối";
      }
    });
  }

  // Send Test Message button
  const btnSendTestMessage = document.getElementById("btnSendTestMessage");
  const chatIdInput = document.getElementById("telegramChatId");
  if (btnSendTestMessage) {
    btnSendTestMessage.addEventListener("click", async () => {
      const token = tokenInput ? tokenInput.value.trim() : "";
      const chatId = chatIdInput ? chatIdInput.value.trim() : "";

      if (!token) {
        showTelegramStatus("error", "⚠️ Vui lòng nhập <strong>Bot Token</strong>.");
        if (tokenInput) tokenInput.focus();
        return;
      }
      if (!chatId) {
        showTelegramStatus("error", "⚠️ Vui lòng nhập <strong>Chat ID</strong> nhận thông báo.");
        if (chatIdInput) chatIdInput.focus();
        return;
      }

      btnSendTestMessage.disabled = true;
      btnSendTestMessage.textContent = "⏳ Đang gửi...";
      showTelegramStatus("info", "Đang gửi tin nhắn thử nghiệm đến Telegram...");

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const testMsg = `🔔 THÔNG BÁO THỬ NGHIỆM TELEGRAM\n\n🎉 Chúc mừng! Extension Botbanhang KPI Tracker đã kết nối thành công với tài khoản Telegram của bạn.\n\n⏱ Thời gian thử nghiệm: ${timeStr}\n✅ Cấu hình hợp lệ và sẵn sàng nhận thông báo task đủ 40 phút!`;

      try {
        const result = await telegram.sendTelegramMessage(token, chatId, testMsg);
        if (result.ok) {
          showTelegramStatus(
            "success",
            `✓ <strong>Gửi tin nhắn thử thành công!</strong><br>Vui lòng mở ứng dụng Telegram để kiểm tra tin nhắn vừa nhận từ Bot.`
          );
        } else {
          let advice = "";
          if (result.errorCode === 400 || (result.error && result.error.includes("chat not found"))) {
            advice = "<br><small><strong>Mẹo:</strong> Nếu vừa tạo bot, bạn cần mở Telegram, tìm bot và nhấn <strong>/start</strong> để bot có quyền gửi tin nhắn cho bạn.</small>";
          } else if (result.errorCode === 403) {
            advice = "<br><small><strong>Mẹo:</strong> Bot đang bị chặn hoặc chưa được bấm /start.</small>";
          }
          showTelegramStatus(
            "error",
            `❌ <strong>Gửi tin nhắn thất bại:</strong> ${result.error}${advice}`
          );
        }
      } catch (err) {
        showTelegramStatus("error", `❌ <strong>Lỗi:</strong> ${err.message}`);
      } finally {
        btnSendTestMessage.disabled = false;
        btnSendTestMessage.textContent = "✉️ Gửi tin nhắn thử";
      }
    });
  }

  // Save Settings
  document.getElementById("form").onsubmit = async event => {
    event.preventDefault();
    await storage.saveSettings({
      activeTarget: Number(document.getElementById("activeTarget").value),
      passiveTarget: Number(document.getElementById("passiveTarget").value),
      taskNotificationMinutes: Math.max(1, Number(document.getElementById("taskNotificationMinutes").value) || 40),
      taskNotificationEnabled: document.getElementById("taskNotificationEnabled").checked,
      telegramNotificationEnabled: document.getElementById("telegramNotificationEnabled").checked,
      telegramBotToken: document.getElementById("telegramBotToken").value.trim(),
      telegramChatId: document.getElementById("telegramChatId").value.trim(),
      showOverlay: document.getElementById("showOverlay").checked,
      showPrediction: document.getElementById("showPrediction").checked,
      notificationsEnabled: document.getElementById("notificationsEnabled").checked
    });
    const message = document.getElementById("message");
    message.textContent = "✓ Đã lưu cài đặt.";
    setTimeout(() => message.textContent = "", 2500);
  };
})();
