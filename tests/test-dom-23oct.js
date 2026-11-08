const assert = require("assert");
require("../src/config.js");
require("../src/utils/duration.js");
const { parseTasks, isDailyColumnHeader, isInsideDailySection, extractDate, isDateToday } = require("../src/content/taskParser.js");
const { calculateStats, effectiveTaskMinutes } = require("../src/utils/calculator.js");

// Mock simple DOM tree for Node.js environment
class MockNode {
  constructor(nodeType, nodeValue = null, tagName = "") {
    this.nodeType = nodeType;
    this.nodeValue = nodeValue;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.attributes = [];
    this.className = "";
    this.id = "";
    this.dataset = {};
    this.isConnected = true;
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument || this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    if (name === "class") return this.className;
    if (name === "id") return this.id;
    return this.dataset[name.replace("data-", "")] || null;
  }

  get textContent() {
    if (this.nodeType === 3) return this.nodeValue || "";
    return this.children.map(c => c.textContent).join("");
  }

  get innerText() {
    return this.textContent;
  }

  querySelectorAll(selector) {
    const results = [];
    function search(node) {
      for (const child of node.children) {
        if (child.nodeType === 1) {
          if (selector === "*" || (selector === "a[href]" && child.tagName === "A")) {
            results.push(child);
          }
          search(child);
        }
      }
    }
    search(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  contains(other) {
    let p = other;
    while (p) {
      if (p === this) return true;
      p = p.parentElement;
    }
    return false;
  }
}

globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

function createMockTreeWalker(root) {
  const nodes = [];
  function collect(node) {
    if (node.nodeType === 3) nodes.push(node);
    for (const child of node.children) collect(child);
  }
  collect(root);
  let index = -1;
  return {
    currentNode: null,
    nextNode() {
      index++;
      if (index < nodes.length) {
        this.currentNode = nodes[index];
        return true;
      }
      return false;
    }
  };
}

// Build Document with 23/10 Kanban Board
const doc = new MockNode(9, null, "#document");
doc.ownerDocument = doc;
globalThis.document = doc;
doc.createTreeWalker = (root) => createMockTreeWalker(root);
doc.title = "Merchant - meOS";
const body = new MockNode(1, null, "BODY");
doc.appendChild(body);
doc.body = body;

// Board container
const board = new MockNode(1, null, "DIV");
board.className = "kanban-board";
body.appendChild(board);

// Column 1: Mục tiêu trong Ngày 5
const col1 = new MockNode(1, null, "DIV");
col1.className = "kanban-column daily-column";
board.appendChild(col1);

const col1Header = new MockNode(1, null, "DIV");
col1Header.className = "column-header";
col1Header.appendChild(new MockNode(3, "Mục tiêu trong Ngày  5"));
col1.appendChild(col1Header);

const cardsList = new MockNode(1, null, "DIV");
cardsList.className = "cards-list";
col1.appendChild(cardsList);

function addCard(name, status, durationText, typeText, priceText) {
  const card = new MockNode(1, null, "DIV");
  card.className = "task-card";

  const title = new MockNode(1, null, "DIV");
  title.className = "task-title";
  title.appendChild(new MockNode(3, name));
  card.appendChild(title);

  const statusBadge = new MockNode(1, null, "SPAN");
  statusBadge.className = "badge status-badge";
  statusBadge.appendChild(new MockNode(3, status));
  card.appendChild(statusBadge);

  const reviewBadge = new MockNode(1, null, "SPAN");
  reviewBadge.className = "badge review-badge";
  reviewBadge.appendChild(new MockNode(3, "Chờ hậu kiểm"));
  card.appendChild(reviewBadge);

  const meta = new MockNode(1, null, "DIV");
  meta.className = "task-meta";
  if (durationText) {
    meta.appendChild(new MockNode(3, `● ${durationText} | `));
  }
  const typeSpan = new MockNode(1, null, "SPAN");
  typeSpan.className = `tag-${typeText === "Chủ động" ? "active" : "passive"}`;
  typeSpan.appendChild(new MockNode(3, typeText));
  meta.appendChild(typeSpan);
  meta.appendChild(new MockNode(3, `  ${priceText}`));
  card.appendChild(meta);

  cardsList.appendChild(card);
  return card;
}

// 5 cards matching user Screenshot 1:
addCard("KẾ HOẠCH NGÀY", "Hoàn thành", "5m", "Chủ động", "815 đ");
addCard("CHECK TIN NHẮN ĐẦU NGÀY", "Hoàn thành", "59m", "Chủ động", "8.148 đ");
addCard("TEST AI V3 - LÊN ĐƠN", "Chưa hoàn thành", null, "Chủ động", "0 đ");
addCard("HỖ TRỢ - BBH - CHỊ THẢO - AI BASE - 80496085", "Hoàn thành", "15m", "Bị động", "2.444 đ");
addCard("HỖ TRỢ - BBH - CHỊ THẢO - AL BASE - 00650910", "Hoàn thành", "20m", "Bị động", "2.444 đ");

// Column 2: Sắp diễn ra 1 (with date 23/10/2026)
const col2 = new MockNode(1, null, "DIV");
col2.className = "kanban-column";
board.appendChild(col2);

const col2Header = new MockNode(1, null, "DIV");
col2Header.className = "column-header";
col2Header.appendChild(new MockNode(3, "Sắp diễn ra  1"));
col2.appendChild(col2Header);

const col2SubHeader = new MockNode(1, null, "DIV");
col2SubHeader.className = "sub-header";
col2SubHeader.appendChild(new MockNode(3, "23/10/2026  1 v"));
col2.appendChild(col2SubHeader);

const col2Card = new MockNode(1, null, "DIV");
col2Card.className = "task-card";
const col2CardTitle = new MockNode(1, null, "DIV");
col2CardTitle.appendChild(new MockNode(3, "TEST AI V3 - LÊN ĐƠN"));
col2Card.appendChild(col2CardTitle);
const col2TimeBadge = new MockNode(1, null, "SPAN");
col2TimeBadge.appendChild(new MockNode(3, "10:00 - 23/10"));
col2Card.appendChild(col2TimeBadge);
const col2Status = new MockNode(1, null, "SPAN");
col2Status.appendChild(new MockNode(3, "Chưa hoàn thành"));
col2Card.appendChild(col2Status);
col2.appendChild(col2Card);

// Test execution:
const now = new Date(2026, 9, 23, 11, 30);
// 1. Kiểm tra đọc thô từ bảng DOM (chưa có runtime cache của task tạm dừng):
const rawParsedTasks = parseTasks(doc, now);
assert.strictEqual(rawParsedTasks.length, 5, "Should deduplicate TEST AI V3 - LÊN ĐƠN across Mục tiêu trong Ngày and Sắp diễn ra into 5 unique tasks");

const completedTasks = rawParsedTasks.filter(t => t.status === "completed");
assert.strictEqual(completedTasks.length, 4, "Should find exactly 4 completed tasks");

const kehoach = completedTasks.find(t => t.name.includes("KẾ HOẠCH NGÀY"));
assert.ok(kehoach, "Must include KẾ HOẠCH NGÀY");
assert.strictEqual(kehoach.durationMinutes, 5);
assert.strictEqual(kehoach.type, "active");

const checktinnhan = completedTasks.find(t => t.name.includes("CHECK TIN NHẮN"));
assert.ok(checktinnhan, "Must include CHECK TIN NHẮN ĐẦU NGÀY");
assert.strictEqual(checktinnhan.durationMinutes, 59);
assert.strictEqual(checktinnhan.type, "active");

const thao1 = completedTasks.find(t => t.name.includes("80496085"));
assert.ok(thao1, "Must include HỖ TRỢ THẢO 80496085");
assert.strictEqual(thao1.durationMinutes, 15);
assert.strictEqual(thao1.type, "passive");

const thao2 = completedTasks.find(t => t.name.includes("00650910"));
assert.ok(thao2, "Must include HỖ TRỢ THẢO 00650910");
assert.strictEqual(thao2.durationMinutes, 20);
assert.strictEqual(thao2.type, "passive");

const rawStats = calculateStats(rawParsedTasks, { activeTarget: 270, passiveTarget: 180 }, now);
assert.strictEqual(rawStats.active.currentMinutes, 64, "Raw active minutes must be 5 + 59 = 64m");
assert.strictEqual(rawStats.passive.currentMinutes, 35, "Raw passive minutes must be 15 + 20 = 35m");
assert.strictEqual(rawStats.total.currentMinutes, 99, "Raw total minutes must be 64 + 35 = 99m");

// 2. Kiểm tra khi task tạm dừng có runtime đã làm (ví dụ làm 55m rồi tạm dừng 5m):
// Yêu cầu: Thời gian đã làm (55m) PHẢI được tính vào KPI, KHÔNG ĐƯỢC để 0m!
const { cacheTaskRuntime, enrichAllTasksWithCachedRuntime } = require("../src/content/timelineDebug.js");
cacheTaskRuntime({ name: "TEST AI V3 - LÊN ĐƠN", type: "active" }, {
  runtimeStatus: "paused",
  workedMinutes: 55,
  pausedMinutes: 5,
  pauseCount: 1,
  timeline: [
    { type: "start", time: "10:00", date: "23/10", at: new Date(2026, 9, 23, 10, 0) },
    { type: "pause", time: "10:55", date: "23/10", at: new Date(2026, 9, 23, 10, 55) }
  ]
});

const enrichedTasks = enrichAllTasksWithCachedRuntime(rawParsedTasks, null);
const pausedTestAi = enrichedTasks.find(t => t.name.includes("TEST AI V3 - LÊN ĐƠN"));
assert.ok(pausedTestAi, "Must include TEST AI V3 - LÊN ĐƠN");
assert.strictEqual(effectiveTaskMinutes(pausedTestAi, now), 55, "Task tạm dừng phải giữ nguyên và tính 55m đã làm, KHÔNG được để 0m!");
assert.strictEqual(pausedTestAi.status, "paused");
assert.strictEqual(pausedTestAi.pausedMinutes, 5);

const enrichedStats = calculateStats(enrichedTasks, { activeTarget: 270, passiveTarget: 180 }, now);
// Active: 5 + 59 + 55 = 119m
assert.strictEqual(enrichedStats.active.currentMinutes, 119, "Active minutes must be 5 + 59 + 55 = 119m");
assert.strictEqual(enrichedStats.passive.currentMinutes, 35, "Passive minutes must be 35m");
assert.strictEqual(enrichedStats.total.currentMinutes, 154, "Total minutes must be 119 + 35 = 154m");

console.log("✓ Kiểm tra thực tế DOM ngày 23/10 (5 task, tính đúng giờ task tạm dừng) đã đạt");
