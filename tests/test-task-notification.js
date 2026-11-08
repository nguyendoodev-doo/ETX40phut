const assert = require("assert");

require("../src/config.js");
require("../src/utils/duration.js");
require("../src/utils/calculator.js");
require("../src/utils/taskIdentity.js");
require("../src/utils/taskNotification.js");

const { evaluateTaskNotifications, checkPermission, formatTaskNotificationMessage, NOTIFICATION_TITLE } = globalThis.TaskKpi.taskNotification;
const { getTaskIdentifier } = globalThis.TaskKpi.taskIdentity;

console.log("=== BẮT ĐẦU CHẠY KIỂM THỬ TÍNH NĂNG TASK NOTIFICATION ===");

// Helper mock storage
function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: async key => ({ [key]: store[key] }),
    set: async obj => { Object.assign(store, obj); return true; }
  };
}

async function runTests() {
  // Test format message
  const msg = formatTaskNotificationMessage("TEST TASK", 40, 40);
  assert.ok(msg.includes("Task: TEST TASK"));
  assert.ok(msg.includes("Thời gian thực hiện: 40 phút/40 phút."));
  assert.ok(msg.includes("Bạn đã hoàn thành đủ thời gian cho task này!"));

  // --- TRƯỜNG HỢP 1: Task đạt 39 phút -> Không gửi thông báo ---
  {
    console.log("Test Case 1: Task đạt 39 phút -> Không gửi thông báo");
    const notifications = [];
    const storage = createMockStorage();
    const tasks = [{ id: "task-1", taskId: "1001", name: "Kế hoạch ngày", durationMinutes: 39, status: "completed" }];
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };

    const result = await evaluateTaskNotifications(tasks, settings, new Date("2026-11-08T10:00:00"), {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(result.sentCount, 0, "Không được gửi thông báo khi task mới 39 phút");
    assert.strictEqual(notifications.length, 0);
    console.log("✓ Case 1 Passed!");
  }

  // --- TRƯỜNG HỢP 2: Task đạt đúng 40 phút -> Gửi thông báo ---
  {
    console.log("Test Case 2: Task đạt đúng 40 phút -> Gửi thông báo");
    const notifications = [];
    const storage = createMockStorage();
    const tasks = [{ id: "task-1", taskId: "1001", name: "Hỗ trợ khách hàng", durationMinutes: 40, status: "completed" }];
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };

    const result = await evaluateTaskNotifications(tasks, settings, new Date("2026-11-08T10:00:00"), {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(result.sentCount, 1, "Phải gửi đúng 1 thông báo khi task đạt 40 phút");
    assert.strictEqual(notifications.length, 1);
    assert.strictEqual(notifications[0].title, NOTIFICATION_TITLE);
    assert.ok(notifications[0].message.includes("Task: Hỗ trợ khách hàng"));
    assert.ok(notifications[0].message.includes("Thời gian thực hiện: 40 phút/40 phút."));
    console.log("✓ Case 2 Passed!");
  }

  // --- TRƯỜNG HỢP 3: Task đạt 41 phút -> Không gửi thêm thông báo ---
  {
    console.log("Test Case 3: Task đạt 41 phút -> Không gửi thêm thông báo");
    const notifications = [];
    const storage = createMockStorage();
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };
    const now = new Date("2026-11-08T10:00:00");

    // Lần 1: Task đạt 40 phút -> gửi thông báo
    const tasks40 = [{ id: "task-1", taskId: "1001", name: "Hỗ trợ khách hàng", durationMinutes: 40, status: "completed" }];
    await evaluateTaskNotifications(tasks40, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(notifications.length, 1, "Lần đầu 40m phải gửi 1 thông báo");

    // Lần 2: Task tăng lên 41 phút -> không gửi thêm
    const tasks41 = [{ id: "task-1", taskId: "1001", name: "Hỗ trợ khách hàng", durationMinutes: 41, status: "completed" }];
    const result2 = await evaluateTaskNotifications(tasks41, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(result2.sentCount, 0, "Không được gửi thêm thông báo khi tăng lên 41 phút");
    assert.strictEqual(notifications.length, 1, "Tổng số thông báo vẫn là 1");
    console.log("✓ Case 3 Passed!");
  }

  // --- TRƯỜNG HỢP 4: Task đạt 60 phút -> Chỉ gửi một thông báo ---
  {
    console.log("Test Case 4: Task đạt 60 phút -> Chỉ gửi một thông báo");
    const notifications = [];
    const storage = createMockStorage();
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };
    const now = new Date("2026-11-08T10:00:00");

    const tasks60 = [{ id: "task-2", taskId: "2002", name: "Báo cáo tuần", durationMinutes: 60, status: "completed" }];
    const res1 = await evaluateTaskNotifications(tasks60, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(res1.sentCount, 1);
    assert.strictEqual(notifications.length, 1);

    // Chạy lại
    const res2 = await evaluateTaskNotifications(tasks60, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(res2.sentCount, 0);
    assert.strictEqual(notifications.length, 1);
    console.log("✓ Case 4 Passed!");
  }

  // --- TRƯỜNG HỢP 5: Hai task cùng đạt 40 phút -> Gửi thông báo riêng cho cả hai ---
  {
    console.log("Test Case 5: Hai task cùng đạt 40 phút -> Gửi thông báo riêng cho cả hai");
    const notifications = [];
    const storage = createMockStorage();
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };
    const now = new Date("2026-11-08T10:00:00");

    const tasks = [
      { id: "task-A", taskId: "A101", name: "Task Alpha", durationMinutes: 40, status: "completed" },
      { id: "task-B", taskId: "B202", name: "Task Beta", durationMinutes: 40, status: "completed" }
    ];

    const result = await evaluateTaskNotifications(tasks, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(result.sentCount, 2, "Phải gửi thông báo cho cả 2 task");
    assert.strictEqual(notifications.length, 2);
    assert.ok(notifications.some(n => n.message.includes("Task Alpha")));
    assert.ok(notifications.some(n => n.message.includes("Task Beta")));
    assert.notStrictEqual(notifications[0].id, notifications[1].id, "Mỗi task phải có notification ID riêng");
    console.log("✓ Case 5 Passed!");
  }

  // --- TRƯỜNG HỢP 6: Tải lại trang sau khi đã gửi thông báo -> Không gửi lại ---
  {
    console.log("Test Case 6: Tải lại trang sau khi đã gửi thông báo -> Không gửi lại");
    const notifications = [];
    const storage = createMockStorage();
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };
    const now = new Date("2026-11-08T10:00:00");
    const tasks = [{ id: "task-1", taskId: "1001", name: "Test Reload", durationMinutes: 40, status: "completed" }];

    // Trước khi reload: gửi thông báo
    await evaluateTaskNotifications(tasks, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(notifications.length, 1);

    // Giả lập reload trang: DOM parse lại tasks từ đầu, nhưng storage giữ nguyên
    const reloadedTasks = [{ id: "task-1-dom-reload", taskId: "1001", name: "Test Reload", durationMinutes: 40, status: "completed" }];
    const reloadResult = await evaluateTaskNotifications(reloadedTasks, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(reloadResult.sentCount, 0, "Không được gửi lại khi trang tải lại");
    assert.strictEqual(notifications.length, 1, "Vẫn chỉ có 1 thông báo ban đầu");
    console.log("✓ Case 6 Passed!");
  }

  // --- TRƯỜNG HỢP 7: Đóng popup Extension nhưng Chrome vẫn hoạt động -> Vẫn theo dõi và gửi thông báo qua Background Service Worker / Storage ---
  {
    console.log("Test Case 7: Popup đóng nhưng Background Service Worker vẫn quét và gửi thông báo");
    const notifications = [];
    const storage = createMockStorage();
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };
    const now = new Date("2026-11-08T10:00:00");

    // Task đang chạy realtime (startedAt 40 phút trước)
    const runningTask = {
      id: "task-running",
      taskId: "RUN_999",
      name: "Task Đang Chạy Ngầm",
      status: "running",
      startedAt: new Date(now.getTime() - 40 * 60000),
      durationMinutes: 0
    };

    const result = await evaluateTaskNotifications([runningTask], settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(result.sentCount, 1, "Background worker phải tính được thời gian thực tế đang chạy và bắn thông báo");
    assert.ok(notifications[0].message.includes("Task: Task Đang Chạy Ngầm"));
    console.log("✓ Case 7 Passed!");
  }

  // --- TRƯỜNG HỢP 8: Sang ngày mới -> Có thể gửi thông báo lại cho các task mới ---
  {
    console.log("Test Case 8: Sang ngày mới -> Cho phép gửi thông báo lại cho task của ngày mới");
    const notifications = [];
    const storage = createMockStorage();
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };

    const day1 = new Date("2026-11-08T10:00:00");
    const taskDay1 = [{ id: "task-daily", taskId: "DAILY_1", name: "Check Email Đầu Ngày", durationMinutes: 40, status: "completed" }];

    // Ngày 1
    await evaluateTaskNotifications(taskDay1, settings, day1, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(notifications.length, 1);

    // Ngày 2: Cùng task (hoặc task cùng ID của ngày hôm sau)
    const day2 = new Date("2026-11-09T10:00:00");
    const taskDay2 = [{ id: "task-daily", taskId: "DAILY_1", name: "Check Email Đầu Ngày", durationMinutes: 40, status: "completed" }];

    const resultDay2 = await evaluateTaskNotifications(taskDay2, settings, day2, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });

    assert.strictEqual(resultDay2.sentCount, 1, "Ngày mới phải cho phép gửi thông báo mới");
    assert.strictEqual(notifications.length, 2);
    console.log("✓ Case 8 Passed!");
  }

  // --- TRƯỜNG HỢP 9: Người dùng chưa cấp quyền thông báo -> Kiểm tra và hiển thị hướng dẫn ---
  {
    console.log("Test Case 9: Người dùng chưa cấp quyền thông báo (denied)");
    const mockChromeDenied = {
      notifications: {
        getPermissionLevel: cb => cb("denied")
      }
    };
    const permResult = await checkPermission(mockChromeDenied);
    assert.strictEqual(permResult.granted, false);
    assert.strictEqual(permResult.level, "denied");

    const mockChromeGranted = {
      notifications: {
        getPermissionLevel: cb => cb("granted")
      }
    };
    const permGranted = await checkPermission(mockChromeGranted);
    assert.strictEqual(permGranted.granted, true);
    console.log("✓ Case 9 Passed!");
  }

  // --- TRƯỜNG HỢP 10: Task bị chỉnh sửa hoặc xóa để tránh gửi nhầm thông báo ---
  {
    console.log("Test Case 10: Task bị xóa hoặc chỉnh sửa giảm giờ -> Không gửi nhầm");
    const notifications = [];
    const storage = createMockStorage();
    const settings = { taskNotificationEnabled: true, taskNotificationMinutes: 40 };
    const now = new Date("2026-11-08T10:00:00");

    // Task ban đầu chưa đủ giờ, sau đó bị sửa thời lượng từ 39m xuống 10m
    const tasksModified = [{ id: "task-mod", taskId: "MOD_1", name: "Task Sửa", durationMinutes: 10, status: "completed" }];
    const resMod = await evaluateTaskNotifications(tasksModified, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(resMod.sentCount, 0, "Task bị sửa giảm giờ không được gửi thông báo");

    // Task bị xóa khỏi danh sách (danh sách rỗng)
    const resDeleted = await evaluateTaskNotifications([], settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(resDeleted.sentCount, 0, "Task bị xóa không còn trong danh sách -> không gửi nhầm");
    assert.strictEqual(notifications.length, 0);

    // Thử trường hợp 2 task trùng tên nhưng có id/formId/thời gian khác nhau -> phân biệt độc lập
    const duplicateNameTasks = [
      { id: "task-dup-1", taskId: "D1", name: "HỖ TRỢ KHÁCH", durationMinutes: 40, status: "completed", startedAtText: "08:30" },
      { id: "task-dup-2", taskId: "D2", name: "HỖ TRỢ KHÁCH", durationMinutes: 40, status: "completed", startedAtText: "14:00" }
    ];
    const resDup = await evaluateTaskNotifications(duplicateNameTasks, settings, now, {
      sendNotification: async (id, opts) => notifications.push({ id, ...opts }),
      getStorage: storage.get,
      setStorage: storage.set
    });
    assert.strictEqual(resDup.sentCount, 2, "Hai task trùng tên nhưng khác ID phải được gửi riêng độc lập");
    console.log("✓ Case 10 Passed!");
  }

  console.log("\n🎉 TẤT CẢ 10 TRƯỜNG HỢP KIỂM THỬ ĐÃ ĐẠT 100%!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});

