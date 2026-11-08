# Task KPI Hôm Nay

Chrome Extension Manifest V3 thuần JavaScript để cộng thời gian task theo hai nhóm **Chủ động** và **Bị động**, dự đoán giờ đạt KPI và hiển thị trong popup/panel trên website.

## Kiến trúc

```text
task-kpi-extension/
├── manifest.json
├── assets/
├── src/
│   ├── config.js                 # cấu hình chung và mock mode
│   ├── mock/tasks.js             # dữ liệu mẫu
│   ├── utils/                    # duration, calculator thuần, storage
│   ├── content/                  # DOM parser, overlay, realtime coordinator
│   ├── popup/                    # giao diện popup
│   ├── options/                  # cài KPI và bật/tắt tính năng
│   └── background/               # notification transition
└── tests/run-tests.js
```

Luồng dữ liệu: `DOM → taskParser → task[] chuẩn hóa → calculateStats → UI`. Website là nguồn chính; cache được tách bằng khóa ngày địa phương và không cộng dồn giữa các ngày.

## Tính năng Desktop Notification cho Task

- Tự động theo dõi thời gian thực tế của từng task độc lập.
- **Ngưỡng mặc định:** 40 phút/task (dễ dàng thay đổi thành 30m, 60m,... trong trang Cài đặt / Options).
- Khi thời gian thực hiện của một task đạt từ 40 phút trở lên, Extension tự động gửi thông báo Desktop Notification:
  - **Tiêu đề:** `🔔 TASK ĐÃ ĐỦ THỜI GIAN!`
  - **Nội dung:**
    ```text
    Task: [Tên task]

    Thời gian thực hiện: [Thời gian hiện tại]/40 phút.

    Bạn đã hoàn thành đủ thời gian cho task này!
    ```
- **Quy tắc:**
  - Mỗi task được quản lý bằng ID duy nhất, gửi thông báo độc lập.
  - Mỗi task chỉ gửi 1 lần duy nhất trong ngày; không lặp lại khi thời gian tăng lên 41, 42, 50, 60 phút.
  - Hoạt động ngầm qua Background Service Worker & Alarm 1 phút, không phụ thuộc vào việc mở popup.
  - Tự động làm mới trạng thái khi sang ngày mới để tiếp tục thông báo cho các task của ngày hôm sau.

## Chạy test

Cần Node.js, không cần cài thêm package phụ thuộc:

```bash
cd task-kpi-extension
npm test
```

Bộ test bao gồm:
- `tests/run-tests.js`: Kiểm tra logic bóc tách task, nhận diện loại Chủ động/Bị động và tính toán KPI.
- `tests/test-task-notification.js`: Kiểm thử tự động toàn diện 10 trường hợp nghiệp vụ của Desktop Notification (đạt 100%).

## Load unpacked trên Chrome

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn chính thư mục `task-kpi-extension` (thư mục chứa `manifest.json`).
5. Mở một trang `http`/`https`, sau đó bấm biểu tượng extension.

Extension mặc định đọc dữ liệu realtime từ tab đang mở. Do content script chạy trên mọi trang để phục vụ giai đoạn chưa có domain thật, khi triển khai nên thay `matches` và `host_permissions` trong `manifest.json` bằng domain nội bộ cụ thể.

## Mock data và selector website thật

- `USE_MOCK_DATA` mặc định là `false`; chỉ bật `true` khi cần test UI độc lập.
- Sửa toàn bộ selector tại duy nhất `SELECTORS` trong `src/content/taskParser.js`.
- Khi selector còn trống, parser ngữ nghĩa dự phòng tìm task theo văn bản “Chủ động/Bị động”, duration và trạng thái. Selector thật sẽ ổn định hơn.
- Parser trả task theo data model chuẩn hóa; calculator không truy cập DOM.

Sau khi sửa source extension, bấm **Reload** tại `chrome://extensions` và tải lại website.

## Debug

### Content script và overlay

Mở DevTools của website → **Console**. Có thể kiểm tra `TaskKpi.taskParser.parseTasks()` và `TaskKpi.calculator`. Overlay dùng Shadow DOM trong phần tử `#task-kpi-overlay-host`.

### Popup

Tại `chrome://extensions`, tìm extension → **Inspect views: popup** (hãy mở popup trước nếu liên kết chưa xuất hiện), hoặc bấm phải trong popup → Inspect.

### Service worker

Tại trang extension, bấm liên kết **service worker** để xem console và lỗi notification.

### Storage

Trong DevTools của popup/website: **Application → Storage → Extension storage → Local**. Hoặc chạy:

```javascript
chrome.storage.local.get(null, console.log)
```

Các khóa chính là `settings`, `dailyData` (theo `YYYY-MM-DD`) và `notificationState:YYYY-MM-DD`.

## Auto Timeboxing

- Bật/tắt và chạy `CHẠY NGAY` trong popup hiện tại.
- Mặc định extension hoàn thành thật; chỉ bật `Dry Run` khi muốn kiểm tra việc tìm task/nút mà không click hoàn thành.
- Lịch tự động dùng `chrome.alarms`, chạy Thứ Hai–Thứ Bảy lúc 08:46 theo `Asia/Ho_Chi_Minh` và retry 30 giây đến 08:55.
- Nếu extension khởi động lại hoặc vừa được bật trong khoảng 08:46–08:55, extension chạy bù ngay và tiếp tục retry thay vì bỏ lỡ cả ngày.
- Frame Timeboxing cũng tự kiểm tra mỗi 30 giây trong khung chạy, làm lớp dự phòng khi service worker của Chrome đang ngủ hoặc bỏ lỡ alarm.
- Trạng thái mỗi ngày nằm ở khóa `timeboxing_YYYY-MM-DD`; lịch sử gần nhất nằm trong `timeboxingLogs`.

## Hành vi quan trọng

- Mọi phép tính dùng phút; progress bar chặn ở 100% nhưng vẫn giữ số phút dư.
- Duration của task đang chạy đã nằm trong tổng task nên không được cộng realtime lần hai.
- Nếu task dự kiến kết thúc trước giờ đạt KPI, UI báo phần còn thiếu sau task thay vì báo sai một giờ đạt KPI.
- Nếu DOM đánh dấu nhiều task đang chạy, calculator chỉ chọn task đầu tiên để dự đoán và gắn cờ cảnh báo nội bộ.
- MutationObserver được debounce 500 ms; fallback cập nhật mỗi 45 giây.
- Notification mặc định tắt và chỉ phát khi trạng thái chuyển từ chưa đủ sang đủ trong cùng ngày.

## Giới hạn hiện tại

Chưa có DOM thật nên selector được để trống có chủ ý. Chế độ production chỉ hoàn tất sau khi ánh xạ selector với HTML thật của hệ thống nội bộ.
