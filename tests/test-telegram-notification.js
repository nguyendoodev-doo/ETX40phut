const assert = require("assert");

require("../src/config.js");
require("../src/utils/duration.js");
require("../src/utils/calculator.js");
require("../src/utils/taskIdentity.js");
require("../src/utils/telegram.js");
require("../src/utils/taskNotification.js");

const { evaluateTaskNotifications } = globalThis.TaskKpi.taskNotification;
const {
  formatTelegramTaskMessage,
  testTelegramConnection,
  sendTelegramMessage,
  maskToken,
  sanitizeError
} = globalThis.TaskKpi.telegram;

console.log("=== BẮT ĐẦU CHẠY KIỂM THỬ TÍNH NĂNG TELEGRAM NOTIFICATION ===");

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: async key => ({ [key]: store[key] }),
    set: async obj => { Object.assign(store, obj); return true; }
  };
}

async function runTests() {
  // Test định dạng tin nhắn Telegram
  const sampleNow = new Date("2026-11-08T14:30:00");
  const tgMsg = formatTelegramTaskMessage("HỖ TRỢ KHÁCH HÀNG", 40, 40, sampleNow);
  assert.ok(tgMsg.includes("🔔 TASK ĐÃ ĐỦ THỜI GIAN!"));
  assert.ok(tgMsg.includes("📌 Tên task: HỖ TRỢ KHÁCH HÀNG"));
  assert.ok(tgMsg.includes("⏱ Thời gian thực hiện: 40 phút/40 phút"));
  assert.ok(tgMsg.includes("📅 Ngày: 08/11/2026"));
  assert.ok(tgMsg.includes("✅ Task đã đạt đủ thời gian yêu cầu."));

  // Test mask token & sanitize error
  assert.strictEqual(maskToken("123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"), "1234...wxyZ");
  const sanitized = sanitizeError("Error calling https://api.telegram.org/botMY_SECRET_TOKEN/sendMessage", "MY_SECRET_TOKEN");
  assert.ok(!sanitized.includes("MY_SECRET_TOKEN"));
  assert.ok(sanitized.includes("[TOKEN_REDACTED]"));

  // --- TRƯỜNG HỢP 1: Task đạt 39 phút -> Không gửi Telegram ---
  {
    console.log("Test Case 1: Task đạt 39 phút -> Không gửi Telegram");
    const desktopNotifs = [];
    const telegramNotifs = [];
    const storage = createMockStorage();
    const tasks = [{ id: "t1", taskId: "1001", name: "Task 39m", durationMinutes: 39, status: "completed" }];
    const settings = {
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      telegramNotificationEnabled: true,
      telegramBotToken: "TEST_TOKEN",
      telegramChatId: "TEST_CHAT_ID"
    };

    const res = await evaluateTaskNotifications(tasks, settings, sampleNow, {
      sendNotification: async (id, opts) => desktopNotifs.push({ id, ...opts }),
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ token, chatId, text });
        return { ok: true };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(res.sentCount, 0);
    assert.strictEqual(desktopNotifs.length, 0);
    assert.strictEqual(telegramNotifs.length, 0);
    console.log("✓ Case 1 Passed!");
  }

  // --- TRƯỜNG HỢP 2: Task đạt 40 phút -> Gửi cả Desktop và Telegram ---
  {
    console.log("Test Case 2: Task đạt 40 phút -> Gửi Telegram và Desktop");
    const desktopNotifs = [];
    const telegramNotifs = [];
    const storage = createMockStorage();
    const tasks = [{ id: "t1", taskId: "1001", name: "Task 40m", durationMinutes: 40, status: "completed" }];
    const settings = {
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      telegramNotificationEnabled: true,
      telegramBotToken: "TEST_TOKEN",
      telegramChatId: "TEST_CHAT_ID"
    };

    const res = await evaluateTaskNotifications(tasks, settings, sampleNow, {
      sendNotification: async (id, opts) => desktopNotifs.push({ id, ...opts }),
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ token, chatId, text });
        return { ok: true, messageId: 101 };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(res.sentCount, 1);
    assert.strictEqual(desktopNotifs.length, 1);
    assert.strictEqual(telegramNotifs.length, 1);
    assert.strictEqual(telegramNotifs[0].chatId, "TEST_CHAT_ID");
    assert.ok(telegramNotifs[0].text.includes("Task 40m"));
    assert.ok(telegramNotifs[0].text.includes("40 phút/40 phút"));
    console.log("✓ Case 2 Passed!");
  }

  // --- TRƯỜNG HỢP 3: Task đạt 41 phút -> Không gửi trùng Telegram ---
  {
    console.log("Test Case 3: Task đạt 41 phút -> Không gửi trùng Telegram");
    const desktopNotifs = [];
    const telegramNotifs = [];
    const storage = createMockStorage();
    const settings = {
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      telegramNotificationEnabled: true,
      telegramBotToken: "TEST_TOKEN",
      telegramChatId: "TEST_CHAT_ID"
    };

    // Lần 1: 40 phút
    const tasks40 = [{ id: "t1", taskId: "1001", name: "Task A", durationMinutes: 40, status: "completed" }];
    await evaluateTaskNotifications(tasks40, settings, sampleNow, {
      sendNotification: async (id, opts) => desktopNotifs.push({ id, ...opts }),
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ token, chatId, text });
        return { ok: true, messageId: 1 };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(telegramNotifs.length, 1);

    // Lần 2: 41 phút
    const tasks41 = [{ id: "t1", taskId: "1001", name: "Task A", durationMinutes: 41, status: "completed" }];
    const res41 = await evaluateTaskNotifications(tasks41, settings, sampleNow, {
      sendNotification: async (id, opts) => desktopNotifs.push({ id, ...opts }),
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ token, chatId, text });
        return { ok: true, messageId: 2 };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(res41.sentCount, 0);
    assert.strictEqual(telegramNotifs.length, 1, "Tổng số tin Telegram vẫn là 1");
    console.log("✓ Case 3 Passed!");
  }

  // --- TRƯỜNG HỢP 4: Hai task cùng đạt 40 phút -> Gửi hai thông báo riêng ---
  {
    console.log("Test Case 4: Hai task cùng đạt 40 phút -> Gửi 2 tin nhắn Telegram riêng");
    const telegramNotifs = [];
    const storage = createMockStorage();
    const tasks = [
      { id: "t1", taskId: "1001", name: "Task Alpha", durationMinutes: 40, status: "completed" },
      { id: "t2", taskId: "2002", name: "Task Beta", durationMinutes: 45, status: "completed" }
    ];
    const settings = {
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      telegramNotificationEnabled: true,
      telegramBotToken: "TEST_TOKEN",
      telegramChatId: "TEST_CHAT_ID"
    };

    const res = await evaluateTaskNotifications(tasks, settings, sampleNow, {
      sendNotification: async () => {},
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ token, chatId, text });
        return { ok: true };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(res.sentCount, 2);
    assert.strictEqual(telegramNotifs.length, 2);
    assert.ok(telegramNotifs.some(n => n.text.includes("Task Alpha")));
    assert.ok(telegramNotifs.some(n => n.text.includes("Task Beta")));
    console.log("✓ Case 4 Passed!");
  }

  // --- TRƯỜNG HỢP 5: Tắt Telegram -> Desktop Notification vẫn hoạt động bình thường ---
  {
    console.log("Test Case 5: Tắt Telegram -> Desktop Notification vẫn hoạt động");
    const desktopNotifs = [];
    const telegramNotifs = [];
    const storage = createMockStorage();
    const tasks = [{ id: "t1", taskId: "1001", name: "Task Desktop Only", durationMinutes: 40, status: "completed" }];
    const settings = {
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      telegramNotificationEnabled: false, // TẮT TELEGRAM
      telegramBotToken: "TEST_TOKEN",
      telegramChatId: "TEST_CHAT_ID"
    };

    const res = await evaluateTaskNotifications(tasks, settings, sampleNow, {
      sendNotification: async (id, opts) => desktopNotifs.push({ id, ...opts }),
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ token, chatId, text });
        return { ok: true };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(res.sentCount, 1);
    assert.strictEqual(desktopNotifs.length, 1, "Desktop notification phải được gửi");
    assert.strictEqual(telegramNotifs.length, 0, "Không được gửi tin nhắn Telegram khi đã tắt");
    console.log("✓ Case 5 Passed!");
  }

  // --- TRƯỜNG HỢP 6: Sai Bot Token -> Báo lỗi cấu hình rõ ràng ---
  {
    console.log("Test Case 6: Sai Bot Token -> Báo lỗi kết nối");
    const mockFetch = async () => ({
      status: 401,
      json: async () => ({ ok: false, error_code: 401, description: "Unauthorized" })
    });
    const result = await testTelegramConnection("INVALID_TOKEN", mockFetch);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, 401);
    assert.ok(result.error.includes("Unauthorized"));
    console.log("✓ Case 6 Passed!");
  }

  // --- TRƯỜNG HỢP 7: Sai Chat ID -> Báo lỗi gửi tin nhắn ---
  {
    console.log("Test Case 7: Sai Chat ID -> Báo lỗi chat not found");
    const mockFetch = async () => ({
      status: 400,
      json: async () => ({ ok: false, error_code: 400, description: "Bad Request: chat not found" })
    });
    const result = await sendTelegramMessage("VALID_TOKEN", "INVALID_CHAT_ID", "Hello", mockFetch);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, 400);
    assert.ok(result.error.includes("chat not found"));
    console.log("✓ Case 7 Passed!");
  }

  // --- TRƯỜNG HỢP 8: Telegram mất kết nối -> Không ảnh hưởng đến Desktop Notification ---
  {
    console.log("Test Case 8: Telegram mất kết nối -> Desktop Notification vẫn thành công");
    const desktopNotifs = [];
    const storage = createMockStorage();
    const tasks = [{ id: "t1", taskId: "1001", name: "Task Failover", durationMinutes: 40, status: "completed" }];
    const settings = {
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      telegramNotificationEnabled: true,
      telegramBotToken: "TOKEN",
      telegramChatId: "CHAT_ID"
    };

    const res = await evaluateTaskNotifications(tasks, settings, sampleNow, {
      sendNotification: async (id, opts) => desktopNotifs.push({ id, ...opts }),
      sendTelegram: async () => {
        throw new Error("Network timeout or disconnected");
      },
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(res.sentCount, 1);
    assert.strictEqual(desktopNotifs.length, 1, "Desktop Notification phải thành công dù Telegram lỗi");
    assert.strictEqual(res.notifiedTasks[0].desktopSent, true);
    assert.strictEqual(res.notifiedTasks[0].telegramSent, false);
    console.log("✓ Case 8 Passed!");
  }

  // --- TRƯỜNG HỢP 9 & 10: Tải lại trang & Khởi động lại -> Không gửi trùng tin nhắn ---
  {
    console.log("Test Case 9 & 10: Tải lại trang và khởi động lại -> Không gửi trùng Telegram");
    const telegramNotifs = [];
    const storage = createMockStorage();
    const settings = {
      taskNotificationEnabled: true,
      taskNotificationMinutes: 40,
      telegramNotificationEnabled: true,
      telegramBotToken: "TOKEN",
      telegramChatId: "CHAT_ID"
    };

    // Trước khi reload
    const task = [{ id: "t1", taskId: "PERSIST_100", name: "Task Persist", durationMinutes: 40, status: "completed" }];
    await evaluateTaskNotifications(task, settings, sampleNow, {
      sendNotification: async () => {},
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ text });
        return { ok: true };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(telegramNotifs.length, 1);

    // Giả lập reload trang / Chrome restart (quét lại danh sách với cùng storage đã lưu)
    const reloadedTasks = [{ id: "t1_new_dom", taskId: "PERSIST_100", name: "Task Persist", durationMinutes: 42, status: "completed" }];
    const resReload = await evaluateTaskNotifications(reloadedTasks, settings, sampleNow, {
      sendNotification: async () => {},
      sendTelegram: async (token, chatId, text) => {
        telegramNotifs.push({ text });
        return { ok: true };
      },
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(resReload.sentCount, 0, "Không được gửi lại khi trang tải lại");
    assert.strictEqual(telegramNotifs.length, 1, "Vẫn chỉ gửi đúng 1 tin Telegram duy nhất");
    console.log("✓ Case 9 & 10 Passed!");
  }

  console.log("\n🎉 TẤT CẢ 10 TRƯỜNG HỢP KIỂM THỬ TELEGRAM ĐÃ ĐẠT 100%!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
