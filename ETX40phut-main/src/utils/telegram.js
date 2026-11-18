(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};

  function maskToken(token) {
    if (!token || typeof token !== "string") return "";
    const trimmed = token.trim();
    if (trimmed.length <= 10) return "****";
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
  }

  function sanitizeError(err, token) {
    let msg = String(err?.message || err || "Lỗi không xác định");
    if (token && typeof token === "string" && token.length > 5) {
      msg = msg.split(token).join("[TOKEN_REDACTED]");
    }
    return msg;
  }

  function formatTelegramTaskMessage(taskName, currentMinutes, thresholdMinutes, now = new Date()) {
    const d = now instanceof Date ? now : new Date(now);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    const curr = Math.max(0, Math.round(Number(currentMinutes) || 0));
    const thresh = Math.max(1, Math.round(Number(thresholdMinutes) || 40));
    const name = String(taskName || "Chưa có tên").trim();

    return `🔔 TASK ĐÃ ĐỦ THỜI GIAN!\n\n📌 Tên task: ${name}\n\n⏱ Thời gian thực hiện: ${curr} phút/${thresh} phút\n\n📅 Ngày: ${dateStr}\n\n✅ Task đã đạt đủ thời gian yêu cầu.`;
  }

  async function testTelegramConnection(token, fetchFn = (typeof fetch !== "undefined" ? fetch : null)) {
    if (!token || !String(token).trim()) {
      return { ok: false, error: "Chưa nhập Bot Token." };
    }
    if (!fetchFn) {
      return { ok: false, error: "Môi trường không hỗ trợ fetch API." };
    }
    const cleanToken = String(token).trim();
    const url = `https://api.telegram.org/bot${cleanToken}/getMe`;

    try {
      const response = await fetchFn(url, { method: "GET" });
      const data = await response.json();
      if (data && data.ok) {
        return {
          ok: true,
          bot: {
            id: data.result?.id,
            firstName: data.result?.first_name,
            username: data.result?.username
          }
        };
      }
      return {
        ok: false,
        error: data?.description || `Telegram API trả về mã lỗi ${response.status}`,
        errorCode: data?.error_code
      };
    } catch (err) {
      return {
        ok: false,
        error: `Không thể kết nối đến máy chủ Telegram: ${sanitizeError(err, cleanToken)}`
      };
    }
  }

  async function sendTelegramMessage(token, chatId, text, fetchFn = (typeof fetch !== "undefined" ? fetch : null)) {
    if (!token || !String(token).trim()) {
      return { ok: false, error: "Chưa cấu hình Telegram Bot Token." };
    }
    if (!chatId || !String(chatId).trim()) {
      return { ok: false, error: "Chưa cấu hình Telegram Chat ID." };
    }
    if (!fetchFn) {
      return { ok: false, error: "Môi trường không hỗ trợ fetch API." };
    }

    const cleanToken = String(token).trim();
    const cleanChatId = String(chatId).trim();
    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cleanChatId,
          text: String(text || "")
        })
      });

      const data = await response.json();
      if (data && data.ok) {
        return { ok: true, messageId: data.result?.message_id };
      }
      return {
        ok: false,
        error: data?.description || `Telegram gửi tin thất bại (HTTP ${response.status})`,
        errorCode: data?.error_code
      };
    } catch (err) {
      return {
        ok: false,
        error: `Lỗi gửi tin nhắn Telegram: ${sanitizeError(err, cleanToken)}`
      };
    }
  }

  async function getTelegramUpdates(token, fetchFn = (typeof fetch !== "undefined" ? fetch : null)) {
    if (!token || !String(token).trim()) {
      return { ok: false, error: "Chưa nhập Bot Token." };
    }
    if (!fetchFn) {
      return { ok: false, error: "Môi trường không hỗ trợ fetch API." };
    }
    const cleanToken = String(token).trim();
    const url = `https://api.telegram.org/bot${cleanToken}/getUpdates`;
    try {
      const response = await fetchFn(url, { method: "GET" });
      const data = await response.json();
      if (data && data.ok) {
        return { ok: true, updates: data.result || [] };
      }
      return { ok: false, error: data?.description || "Không thể lấy danh sách cập nhật." };
    } catch (err) {
      return { ok: false, error: sanitizeError(err, cleanToken) };
    }
  }

  api.telegram = {
    maskToken,
    sanitizeError,
    formatTelegramTaskMessage,
    testTelegramConnection,
    sendTelegramMessage,
    getTelegramUpdates
  };

  if (typeof module !== "undefined") {
    module.exports = api.telegram;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
