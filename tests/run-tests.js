const assert = require("assert");
require("../src/config.js");
const { parseDuration, formatDuration, formatDurationCompact } = require("../src/utils/duration.js");
const { calculateRemaining, calculateTargetTime, calculateStats, effectiveTaskMinutes, calculateWorkedMinutes, calculatePausedMinutes, normalizeTimeline, analyzeTimeline } = require("../src/utils/calculator.js");
const { parseTimelineText, parseTimelineEvents, normalizeStatus, mergeRunningDetails, buildLocalStartedAt, extractDate, isDateToday, isDateHeader, parseDurationFlexible, detectTaskStatus, inferTaskTypeByName } = require("../src/content/taskParser.js");
const { matchOpenedTask } = require("../src/utils/taskIdentity.js");
const { attachRuntimeToMatchedTask, parseTimelineEvents: parseTimelineEventsDebug } = require("../src/content/timelineDebug.js");


const cases = [["2h 53m", 173], ["1h 3m", 63], ["1 giờ 03 phút", 63], ["15m", 15], ["0 phút", 0]];
for (const [input, expected] of cases) assert.strictEqual(parseDuration(input), expected);
assert.strictEqual(parseDuration("không hợp lệ"), null);
assert.strictEqual(formatDuration(173), "2h53");
assert.deepStrictEqual([0, 1, 59, 60, 61, 270].map(formatDurationCompact), ["0m", "1m", "59m", "1h00", "1h01", "4h30"]);
assert.strictEqual(calculateRemaining(174, 270), 96);
const identityTasks = [
  { id: "291955", name: "Hỗ trợ khách hàng - 291955", type: "active" },
  { id: "291956", name: "Hỗ trợ khách hàng", type: "passive" }
];
assert.strictEqual(matchOpenedTask({ formId: "291955", name: null }, identityTasks).matchedTask, identityTasks[0]);
assert.strictEqual(matchOpenedTask({ formId: "291955", name: null }, identityTasks).method, "formId");
assert.strictEqual(matchOpenedTask({ name: "  Hỗ trợ   khách hàng " }, [identityTasks[1]]).method, "exactName");
assert.strictEqual(matchOpenedTask({ name: "Trùng" }, [{ name: "Trùng" }, { name: "Trùng" }]).matched, false);
assert.strictEqual(matchOpenedTask({}, [{ status: "not_completed" }]).matched, false);
assert.strictEqual(matchOpenedTask({ taskId: "task-1", formId: "291955" }, [
  { taskId: "task-1", formId: "wrong", name: "A" },
  { taskId: "task-2", formId: "291955", name: "B" }
]).matchedTask.name, "A");
assert.strictEqual(matchOpenedTask({ formId: "291955" }, [
  { formId: "291955", name: "A" },
  { formId: "291955", name: "B" }
]).matched, false);
const identityRuntimeTask = { id: "291955", formId: "291955", name: "Runtime target", type: "active", status: "not_completed", durationMinutes: 15 };
const identityRuntimeEvent = { type: "start", at: new Date(2026, 7, 22, 9, 0), time: "09:00", date: "22/08" };
const identityRuntimeAttached = attachRuntimeToMatchedTask([identityRuntimeTask], { matched: true, method: "formId", matchedTask: identityRuntimeTask }, { runtimeStatus: "running", workedMinutes: 17, pausedMinutes: 0, pauseCount: 0, timeline: [identityRuntimeEvent] });
assert.strictEqual(identityRuntimeAttached.taskWithRuntime.formId, "291955");
assert.strictEqual(identityRuntimeAttached.taskWithRuntime.status, "running");
assert.strictEqual(identityRuntimeAttached.taskWithRuntime.timeline[0], identityRuntimeEvent);
assert.strictEqual(identityRuntimeAttached.taskWithRuntime.workedMinutes, 17);
assert.strictEqual(identityRuntimeAttached.taskWithRuntime.startedAt, identityRuntimeEvent.at);
assert.strictEqual(identityRuntimeAttached.taskWithRuntime.startedAtText, "09:00");
assert.strictEqual(identityRuntimeAttached.taskWithRuntime.startedDate, "22/08");

// Test: Running task with durationMinutes 0 and workedMinutes 26
const zeroDurationRunningTask = { id: "test-run", name: "Task Live", type: "passive", durationMinutes: 0, status: "running", workedMinutes: 26, timeline: [{ type: "start", at: new Date(2026, 9, 22, 9, 39), time: "09:39", date: "22/10" }] };
const zeroDurationStats = calculateStats([zeroDurationRunningTask], { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 9, 22, 10, 5));
assert.strictEqual(zeroDurationStats.passive.currentMinutes, 26);
assert.strictEqual(zeroDurationStats.runningTask.effectiveElapsedMinutes, 26);
assert.strictEqual(zeroDurationStats.runningTask.startedAtText, "09:39");
assert.strictEqual(zeroDurationStats.runningTask.workedMinutes, 26);

// Test: normalizeTimeline with timestamp numbers
const timestampTimeline = normalizeTimeline([{ type: "start", timestamp: new Date(2026, 9, 22, 9, 0).getTime() }]);
assert.strictEqual(timestampTimeline.events.length, 1);
assert.strictEqual(timestampTimeline.events[0].type, "start");
const target = calculateTargetTime(new Date(2026, 7, 21, 11, 28), 96);
assert.strictEqual(`${target.getHours()}:${String(target.getMinutes()).padStart(2, "0")}`, "13:04");

const tasks = [{ type: "active", durationMinutes: 174, status: "running", startedAt: "10:25" }];
const stats = calculateStats(tasks, { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 7, 21, 11, 28));
assert.strictEqual(stats.active.remainingMinutes, 96);
assert.strictEqual(stats.total.remainingMinutes, 276);
assert.strictEqual(stats.runningTask.targetReachedAt.getHours(), 13);
assert.strictEqual(stats.runningTask.targetReachedAt.getMinutes(), 4);

const limited = calculateStats(
  [{ type: "active", durationMinutes: 150, status: "running", startedAt: "11:00", expectedEndAt: "12:28" }],
  { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 7, 21, 11, 28)
);
assert.strictEqual(limited.runningTask.canReachBeforeEnd, false);
assert.strictEqual(limited.runningTask.targetReachedAt, null);
assert.strictEqual(limited.runningTask.remainingAfterTask, 60);

const iframeTasks = [
  { type: "active", durationMinutes: 1, status: "completed" },
  { type: "active", durationMinutes: 173, status: "completed" },
  { type: "passive", durationMinutes: 118, status: "completed" },
  { type: "passive", durationMinutes: 63, status: "completed" },
  { type: "active", durationMinutes: 97, status: "running" }
];
const iframeStats = calculateStats(iframeTasks, { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 7, 21, 14, 0));
assert.strictEqual(iframeTasks.length, 5);
assert.strictEqual(iframeStats.active.currentMinutes, 271);
assert.strictEqual(iframeStats.active.overtimeMinutes, 1);
assert.strictEqual(iframeStats.active.completed, true);
assert.strictEqual(iframeStats.passive.currentMinutes, 181);
assert.strictEqual(iframeStats.passive.overtimeMinutes, 1);
assert.strictEqual(iframeStats.passive.completed, true);
const timeline = parseTimelineText(`Tiến độ thực hiện\n\nBắt đầu\n0 phút\nlúc 10:25 - 21/08\n\nDự kiến hoàn thành\nlúc 14:25 - 21/08\n\nHoàn thành\n1 giờ 03 phút\nlúc 11:28 - 21/08`);
assert.strictEqual(timeline.startedAt, "10:25");
assert.strictEqual(timeline.startedDate, "21/08");
assert.strictEqual(timeline.expectedEndAt, "14:25");
assert.strictEqual(timeline.expectedEndDate, "21/08");
assert.strictEqual(timeline.elapsedMinutes, 63);
const actualTimeline = parseTimelineText(`Tiến độ thực hiện\n\nBắt đầu\n\n0 phút\n\nlúc 15:43 - 21/08`);
assert.strictEqual(actualTimeline.startedAt, "15:43");
assert.strictEqual(actualTimeline.startedDate, "21/08");
assert.strictEqual(actualTimeline.expectedEndAt, null);
assert.strictEqual(actualTimeline.elapsedMinutes, 0);
assert.strictEqual(actualTimeline.hasStarted, true);
assert.strictEqual(normalizeStatus("Tiến độ thực hiện Hoàn thành", ""), "unknown");
assert.strictEqual(normalizeStatus("Không có trạng thái", ""), "unknown");
const kickoff = { id: "52350002", name: "THAM GIA KICKOFF - BBH - anh Khánh - AI BASE - 52350002", type: "active", durationMinutes: 0, status: "not_completed", rawStatusText: "Chưa hoàn thành", startedAt: null, expectedEndAt: null, elapsedMinutes: null };
const kickoffStartedAt = buildLocalStartedAt("15:00", "21/08", "21/8/2026", new Date(2026, 7, 21, 16, 0));
const mergedKickoff = mergeRunningDetails([kickoff], { openedTaskName: kickoff.name, startedAt: "15:00", startedAtDate: kickoffStartedAt, startedDate: "21/08", expectedEndAt: "17:00", expectedEndDate: "21/08", elapsedMinutes: 63, hasPauseAction: true, documentText: `${kickoff.name}\n${kickoff.name}`, detailText: "Tiến độ thực hiện", matchedTexts: {}, matchedContainer: "div.detail" })[0];
assert.strictEqual(mergedKickoff.status, "running");
assert.strictEqual(mergedKickoff.startedAt.getHours(), 15);
assert.strictEqual(mergedKickoff.startedAtText, "15:00");
assert.strictEqual(mergedKickoff.expectedEndAt, "17:00");
assert.strictEqual(mergedKickoff.elapsedMinutes, 63);
assert.strictEqual(mergedKickoff.durationMinutes, 0);
const notStarted = mergeRunningDetails([kickoff], { startedAt: null, startedAtDate: null, expectedEndAt: "17:00", elapsedMinutes: null, hasPauseAction: true, documentText: kickoff.name, detailText: "Tiến độ thực hiện", matchedTexts: {}, matchedContainer: "div.detail" })[0];
assert.strictEqual(notStarted.status, "not_completed");
const realtimeNow = new Date(2026, 7, 21, 14, 40);
const realtimeTask = { type: "active", durationMinutes: 97, elapsedMinutes: 97, status: "running", startedAt: "13:00", startedDate: "21/08" };
assert.strictEqual(effectiveTaskMinutes(realtimeTask, realtimeNow), 100);
const realtimeStats = calculateStats([{ type: "active", durationMinutes: 174, elapsedMinutes: null, status: "completed" }, realtimeTask], { activeTarget: 270, passiveTarget: 180 }, realtimeNow);
assert.strictEqual(realtimeStats.active.currentMinutes, 274);
assert.strictEqual(realtimeStats.active.overtimeMinutes, 4);
assert.strictEqual(realtimeStats.runningTask.effectiveElapsedMinutes, 100);
const noDuplicate = effectiveTaskMinutes({ durationMinutes: 63, elapsedMinutes: 63, status: "running", startedAt: "13:37", startedDate: "21/08" }, realtimeNow);
assert.strictEqual(noDuplicate, 63);

const caseANow = new Date(2026, 7, 21, 16, 1);
const caseA = calculateStats([
  { type: "active", durationMinutes: 250, status: "completed" },
  { type: "active", durationMinutes: 50, elapsedMinutes: 50, status: "running", startedAt: "15:11", startedDate: "21/08" }
], { activeTarget: 270, passiveTarget: 180 }, caseANow);
assert.strictEqual(caseA.active.currentMinutes, 300);
assert.strictEqual(caseA.active.overtimeMinutes, 30);
assert.strictEqual(caseA.runningTask.baseMinutes, 250);
assert.strictEqual(caseA.runningTask.effectiveRunningMinutes, 50);
assert.strictEqual(caseA.active.targetReachedAt.getHours(), 15);
assert.strictEqual(caseA.active.targetReachedAt.getMinutes(), 31);

const caseB = calculateStats([
  { type: "active", durationMinutes: 271, status: "completed" },
  { type: "active", durationMinutes: 0, elapsedMinutes: 0, status: "running", startedAt: "16:01", startedDate: "21/08" }
], { activeTarget: 270, passiveTarget: 180 }, caseANow);
assert.strictEqual(caseB.active.completed, true);
assert.strictEqual(caseB.active.overtimeMinutes, 1);
assert.strictEqual(caseB.active.targetReachedAt, null);

const caseC = calculateStats([
  { type: "active", durationMinutes: 200, status: "completed" },
  { type: "active", durationMinutes: 18, elapsedMinutes: 18, status: "running", startedAt: "15:41", startedDate: "21/08" }
], { activeTarget: 270, passiveTarget: 180 }, caseANow);
assert.strictEqual(caseC.runningTask.calculatedElapsedMinutes, 20);
assert.strictEqual(caseC.runningTask.reportedRunningMinutes, 18);
assert.strictEqual(caseC.runningTask.effectiveRunningMinutes, 20);
assert.strictEqual(caseC.active.currentMinutes, 220);

const event = (type, hour, minute) => ({ type, at: new Date(2026, 7, 21, hour, minute) });
const pauseCaseA = [event("start", 10, 0), event("pause", 12, 4)];
assert.strictEqual(calculateWorkedMinutes(pauseCaseA, new Date(2026, 7, 21, 13, 0)), 124);
assert.strictEqual(normalizeTimeline(pauseCaseA).events.at(-1).type, "pause");

const pauseCaseB = [...pauseCaseA, event("resume", 13, 20)];
assert.strictEqual(calculateWorkedMinutes(pauseCaseB, new Date(2026, 7, 21, 14, 0)), 164);

const pauseCaseC = [...pauseCaseB, event("pause", 15, 43), event("resume", 16, 33)];
assert.strictEqual(calculateWorkedMinutes(pauseCaseC, new Date(2026, 7, 21, 17, 0)), 294);
assert.strictEqual(calculatePausedMinutes(pauseCaseC, new Date(2026, 7, 21, 17, 0)), 126);
const analyzedRealTimeline = analyzeTimeline(pauseCaseC, new Date(2026, 7, 21, 17, 0));
assert.strictEqual(analyzedRealTimeline.runtimeStatus, "running");
assert.strictEqual(analyzedRealTimeline.workedMinutes, 294);
assert.strictEqual(analyzedRealTimeline.pausedMinutes, 126);
assert.strictEqual(analyzedRealTimeline.pauseCount, 2);
assert.deepStrictEqual(analyzedRealTimeline.segments.map(segment => [segment.kind, segment.minutes]), [["WORK", 124], ["PAUSE", 76], ["WORK", 143], ["PAUSE", 50], ["WORK", 27]]);

const pauseCaseD = [...pauseCaseB, event("pause", 15, 43)];
assert.strictEqual(calculateWorkedMinutes(pauseCaseD, new Date(2026, 7, 21, 16, 30)), 267);
assert.strictEqual(calculateWorkedMinutes(pauseCaseD, new Date(2026, 7, 21, 17, 30)), 267);
const pausedStatsAt1630 = calculateStats([{ type: "active", durationMinutes: 0, elapsedMinutes: 0, status: "paused", timeline: pauseCaseD, startedAt: "10:00", startedDate: "21/08" }], { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 7, 21, 16, 30));
const pausedStatsAt1730 = calculateStats([{ type: "active", durationMinutes: 0, elapsedMinutes: 0, status: "paused", timeline: pauseCaseD, startedAt: "10:00", startedDate: "21/08" }], { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 7, 21, 17, 30));
assert.strictEqual(pausedStatsAt1630.active.currentMinutes, 267);
assert.strictEqual(pausedStatsAt1730.active.currentMinutes, 267);
assert.strictEqual(pausedStatsAt1730.runningTask.workedMinutes, 267);
assert.strictEqual(pausedStatsAt1730.runningTask.runtimeStatus, "paused");
assert.strictEqual(analyzeTimeline([event("start", 10, 0)], new Date(2026, 7, 21, 11, 0)).runtimeStatus, "running");
assert.strictEqual(analyzeTimeline([event("start", 10, 0), event("pause", 10, 30)], new Date(2026, 7, 21, 11, 0)).runtimeStatus, "paused");
assert.strictEqual(analyzeTimeline([event("start", 10, 0), event("pause", 10, 30), event("resume", 10, 45)], new Date(2026, 7, 21, 11, 0)).runtimeStatus, "running");
assert.strictEqual(analyzeTimeline([event("start", 10, 0), event("pause", 10, 30), event("resume", 10, 45), event("complete", 11, 0)], new Date(2026, 7, 21, 12, 0)).runtimeStatus, "completed");
assert.strictEqual(analyzeTimeline([event("start", 10, 0), event("complete", 11, 0)], new Date(2026, 7, 21, 12, 0)).workedMinutes, 60);
const completeWhilePaused = analyzeTimeline([event("start", 10, 0), event("pause", 10, 30), event("complete", 11, 0)], new Date(2026, 7, 21, 12, 0));
assert.strictEqual(completeWhilePaused.runtimeStatus, "completed");
assert.strictEqual(completeWhilePaused.workedMinutes, 30);
assert.strictEqual(completeWhilePaused.pausedMinutes, 30);

const invalidTimeline = normalizeTimeline([event("start", 10, 0), event("pause", 12, 4), event("pause", 12, 5), event("resume", 13, 20), event("resume", 13, 21)]);
assert.strictEqual(invalidTimeline.warnings.length, 2);
assert.strictEqual(calculateWorkedMinutes(invalidTimeline.events, new Date(2026, 7, 21, 14, 0)), 164);

const parsedPauseTimeline = parseTimelineEvents(`Tiến độ thực hiện\nBắt đầu\n0 phút\nlúc 10:00 - 21/08\nTạm dừng\nlúc 12:04 - 21/08\nTiếp tục\nlúc 13:20 - 21/08`, new Date(2026, 7, 21, 14, 0));
assert.deepStrictEqual(parsedPauseTimeline.map(item => item.type), ["start", "pause", "resume"]);

const wrongType = calculateStats([
  { type: "active", durationMinutes: 240, status: "completed" },
  { type: "passive", durationMinutes: 10, status: "running", startedAt: "15:51", startedDate: "21/08" }
], { activeTarget: 270, passiveTarget: 180 }, caseANow);
assert.strictEqual(wrongType.active.remainingMinutes, 30);
assert.strictEqual(wrongType.active.targetReachedAt, null);
assert.strictEqual(wrongType.total.overtimeMinutes, 0);

// Date header & date boundary isolation tests
const testNow = new Date(2026, 9, 22); // 22/10/2026
assert.strictEqual(isDateHeader("22/10/2026"), true);
assert.strictEqual(isDateHeader("22/10"), true);
assert.strictEqual(isDateHeader("Thứ 5, 22/10/2026"), true);
assert.strictEqual(isDateHeader("Hôm nay (22/10)"), true);
assert.strictEqual(isDateHeader("Hôm nay (3)"), true);
assert.strictEqual(isDateHeader("Hôm qua"), true);
assert.strictEqual(isDateHeader("Hôm qua (26)"), true);
assert.strictEqual(isDateHeader("21/10 (26)"), true);
assert.strictEqual(isDateHeader("21 Tháng 10"), true);
assert.strictEqual(isDateHeader("21 Thg 10"), true);
assert.strictEqual(isDateHeader("21 th10"), true);
assert.strictEqual(isDateHeader("Thứ 4, 21/10 (26)"), true);
assert.strictEqual(isDateHeader("Meeting 22/10"), false);
assert.strictEqual(isDateHeader("BÁO CÁO NGHIỆM THU AI"), false);
assert.strictEqual(isDateHeader("KẾ HOẠCH NGÀY 21"), false);

assert.strictEqual(isDateToday(extractDate("22/10/2026", testNow), testNow), true);
assert.strictEqual(isDateToday(extractDate("22/10", testNow), testNow), true);
assert.strictEqual(isDateToday(extractDate("Hôm nay", testNow), testNow), true);
assert.strictEqual(isDateToday(extractDate("Hôm nay (3)", testNow), testNow), true);
assert.strictEqual(isDateToday(extractDate("09:00 - 22/10", testNow), testNow), true);

assert.strictEqual(isDateToday(extractDate("21/10/2026", testNow), testNow), false);
assert.strictEqual(isDateToday(extractDate("21/10", testNow), testNow), false);
assert.strictEqual(isDateToday(extractDate("Hôm qua", testNow), testNow), false);
assert.strictEqual(isDateToday(extractDate("Hôm qua (26)", testNow), testNow), false);
assert.strictEqual(isDateToday(extractDate("21/10 (26)", testNow), testNow), false);
assert.strictEqual(isDateToday(extractDate("21 Tháng 10", testNow), testNow), false);
assert.strictEqual(isDateToday(extractDate("21 Thg 10", testNow), testNow), false);
assert.strictEqual(isDateToday(extractDate("17:30 - 21/10", testNow), testNow), false);

// Multi-task runtime caching & preservation test
const { cacheTaskRuntime, enrichAllTasksWithCachedRuntime } = require("../src/content/timelineDebug.js");
const taskA = { name: "TEST AI V3", type: "active", status: "not_completed", durationMinutes: 0 };
const runtimeA = { runtimeStatus: "paused", workedMinutes: 81, pausedMinutes: 238, pauseCount: 1, timeline: [{ type: "start", at: new Date(2026, 9, 22, 10, 0) }, { type: "pause", at: new Date(2026, 9, 22, 11, 21) }] };
cacheTaskRuntime(taskA, runtimeA);

const taskB = { name: "HỖ TRỢ - BBH anh Triệu Thắng", type: "passive", status: "running", durationMinutes: 0, workedMinutes: 24, timeline: [{ type: "start", at: new Date(2026, 9, 22, 14, 58) }] };
const boardTasks = [
  { name: "KẾ HOẠCH NGÀY", type: "active", status: "completed", durationMinutes: 1 },
  { name: "CHECK TIN NHẮN", type: "active", status: "completed", durationMinutes: 38 },
  { name: "Talad Thai", type: "passive", status: "completed", durationMinutes: 16 },
  { name: "Chị Tú", type: "passive", status: "completed", durationMinutes: 73 },
  { name: "TEST AI V3", type: "active", status: "not_completed", durationMinutes: 0 },
  taskB
];

const enriched = enrichAllTasksWithCachedRuntime(boardTasks, taskB);
const enrichedA = enriched.find(t => t.name === "TEST AI V3");
assert.strictEqual(enrichedA.workedMinutes, 81);
assert.strictEqual(enrichedA.status, "paused");
assert.strictEqual(effectiveTaskMinutes(enrichedA, new Date(2026, 9, 22, 15, 22)), 81);

const dayStats = calculateStats(enriched, { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 9, 22, 15, 22));
// Active: 1 + 38 + 81 (paused TEST AI V3 worked time IS counted) = 120
assert.strictEqual(dayStats.active.currentMinutes, 120);
// Passive: 16 + 73 + 24 (from Triệu Thắng) = 113
assert.strictEqual(dayStats.passive.currentMinutes, 113);
// Total = 120 + 113 = 233
assert.strictEqual(dayStats.total.currentMinutes, 233);
assert.strictEqual(dayStats.runningTask.task.name, "HỖ TRỢ - BBH anh Triệu Thắng");
assert.strictEqual(dayStats.runningTask.workedMinutes, 24);
assert.strictEqual(dayStats.active.remainingMinutes, 150);
assert.strictEqual(dayStats.passive.remainingMinutes, 67);
assert.strictEqual(dayStats.total.remainingMinutes, 217);

// Full 9-task verification matching user log #9
const userLogTasks = [
  { name: "KẾ HOẠCH NGÀY", type: "active", status: "completed", durationMinutes: 1 },
  { name: "CHECK TIN NHẮN ĐẦU NGÀY", type: "active", status: "completed", durationMinutes: 38 },
  { name: "HỖ TRỢ - Bot Ban Hang - Talad Thai", type: "passive", status: "completed", durationMinutes: 16 },
  { name: "HỖ TRỢ - BBH - Chị Tú - Ai Base - 79363139", type: "passive", status: "completed", durationMinutes: 73 },
  { name: "THEO DÕI TỔNG THỂ AI BASE - ANH TÍNH - 34257592", type: "active", status: "completed", durationMinutes: 34 },
  { name: "REP TIN NHẮN KHÁCH HÀNG", type: "active", status: "completed", durationMinutes: 55 },
  { name: "HỖ TRỢ - Anh Trường", type: "passive", status: "completed", durationMinutes: 18 },
  { name: "TEST AI V3", type: "active", status: "running", durationMinutes: 0, workedMinutes: 81 },
  { name: "HỖ TRỢ - Triệu Thắng - 0989399859", type: "passive", status: "running", durationMinutes: 0, workedMinutes: 24 }
];

const fullDayStats = calculateStats(userLogTasks, { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 9, 22, 15, 25));
// Active: 1 + 38 + 34 + 55 + 81 = 209m (Target 270m -> Remaining: 61m)
assert.strictEqual(fullDayStats.active.currentMinutes, 209);
assert.strictEqual(fullDayStats.active.remainingMinutes, 61);
assert.strictEqual(fullDayStats.active.completed, false);

// Passive: 16 + 73 + 18 + 24 = 131m (Target 180m -> Remaining: 49m)
assert.strictEqual(fullDayStats.passive.currentMinutes, 131);
assert.strictEqual(fullDayStats.passive.remainingMinutes, 49);
assert.strictEqual(fullDayStats.passive.completed, false);

// Total: 209 + 131 = 340m (Target 450m -> Remaining: 110m = 1h50)
assert.strictEqual(fullDayStats.total.currentMinutes, 340);
assert.strictEqual(fullDayStats.total.remainingMinutes, 110);
assert.strictEqual(fullDayStats.total.completed, false);

// Badge formatting helper test
function formatBadgeText(remaining) {
  if (remaining <= 0) return "✓";
  if (remaining < 60) return `${remaining}m`;
  const h = Math.floor(remaining / 60);
  const m = remaining % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
assert.strictEqual(formatBadgeText(110), "1h50");
assert.strictEqual(formatBadgeText(61), "1h01");
assert.strictEqual(formatBadgeText(60), "1h");
assert.strictEqual(formatBadgeText(49), "49m");
assert.strictEqual(formatBadgeText(0), "✓");
assert.strictEqual(formatBadgeText(-10), "✓");

// Multiple running tasks verification: both active and passive running tasks have running minutes recorded
assert.strictEqual(fullDayStats.active.runningMinutes, 81);
assert.strictEqual(fullDayStats.passive.runningMinutes, 24);
assert.strictEqual(fullDayStats.active.baseMinutes, 128);
assert.strictEqual(fullDayStats.passive.baseMinutes, 107);

// Exact match: Sum of all rows equals totalCurrent
const calculatedSum = userLogTasks.reduce((sum, t) => sum + effectiveTaskMinutes(t, new Date(2026, 9, 22, 15, 25)), 0);
assert.strictEqual(calculatedSum, fullDayStats.total.currentMinutes);
assert.strictEqual(calculatedSum, 340);

// Timer format test HH:mm:ss
assert.deepStrictEqual(parseDurationFlexible("01:25:30"), { totalSeconds: 5130, totalMinutes: 85 });
assert.deepStrictEqual(parseDurationFlexible("00:45:12"), { totalSeconds: 2712, totalMinutes: 45 });

// Name inference tests
assert.strictEqual(inferTaskTypeByName("HỖ TRỢ - BBH - Anh Tính"), "passive");
assert.strictEqual(inferTaskTypeByName("CHECK TIN NHẮN ĐẦU NGÀY"), "active");
assert.strictEqual(inferTaskTypeByName("KẾ HOẠCH NGÀY"), "active");
assert.strictEqual(inferTaskTypeByName("REP TIN NHẮN KHÁCH HÀNG"), "active");

// Running task with 'Dự kiến hoàn thành' must NOT be detected as completed!
const runningContainer = { innerText: "Đang thực hiện\nBắt đầu 14:00 - 22/10\nDự kiến hoàn thành 17:00 - 22/10" };
assert.strictEqual(detectTaskStatus(runningContainer), "running");
const pausedContainer = { innerText: "Tạm dừng\nBắt đầu 10:00 - 22/10\nDự kiến hoàn thành 15:00 - 22/10" };
assert.strictEqual(detectTaskStatus(pausedContainer), "paused");

// Preserving multiple tasks with same name across different sessions
const multiSessionTasks = [
  { name: "HỖ TRỢ KHÁCH HÀNG", type: "passive", durationMinutes: 45, status: "completed", startedAtText: "09:00" },
  { name: "HỖ TRỢ KHÁCH HÀNG", type: "passive", durationMinutes: 60, status: "completed", startedAtText: "14:00" }
];
const multiStats = calculateStats(multiSessionTasks, { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 9, 22, 16, 0));
assert.strictEqual(multiStats.passive.currentMinutes, 105);

// Tests for Daily Column Headers & 23/10 Real Scenario
const testOct23 = new Date(2026, 9, 23, 11, 30); // 23/10/2026 11:30
assert.strictEqual(isDateHeader("Mục tiêu trong Ngày  5"), true);
assert.strictEqual(isDateHeader("Mục tiêu trong Ngày (5)"), true);
assert.strictEqual(isDateHeader("Mục tiêu ngày"), true);
assert.strictEqual(isDateHeader("Công việc trong ngày  5"), true);
assert.strictEqual(isDateHeader("Kế hoạch trong ngày  5"), true);
assert.strictEqual(isDateHeader("23/10/2026  1 v"), true);
assert.strictEqual(isDateHeader("23/10/2026  1 ▼"), true);
assert.strictEqual(isDateHeader("KẾ HOẠCH NGÀY"), false);
assert.strictEqual(isDateHeader("CHECK TIN NHẮN ĐẦU NGÀY"), false);

assert.strictEqual(isDateToday(extractDate("Mục tiêu trong Ngày  5", testOct23), testOct23), true);
assert.strictEqual(isDateToday(extractDate("23/10/2026  1 v", testOct23), testOct23), true);

const { isTaskNameCandidate } = require("../src/content/taskParser.js");
assert.strictEqual(isTaskNameCandidate("Chờ hậu kiểm"), false);
assert.strictEqual(isTaskNameCandidate("8.148 đ"), false);
assert.strictEqual(isTaskNameCandidate("2.444 đ"), false);
assert.strictEqual(isTaskNameCandidate("● 59m | Chủ động  8.148 đ"), false);
assert.strictEqual(isTaskNameCandidate("KẾ HOẠCH NGÀY"), true);
assert.strictEqual(isTaskNameCandidate("CHECK TIN NHẮN ĐẦU NGÀY"), true);
assert.strictEqual(isTaskNameCandidate("HỖ TRỢ - BBH - CHỊ THẢO - AI BASE - 80496085"), true);
assert.strictEqual(isTaskNameCandidate("HỖ TRỢ - BBH - CHỊ THẢO - AL BASE - 00650910"), true);

// Verification of Full 23/10 User Scenario: 5 tasks on board
const oct23Tasks = [
  { name: "KẾ HOẠCH NGÀY", type: "active", status: "completed", durationMinutes: 5 },
  { name: "CHECK TIN NHẮN ĐẦU NGÀY", type: "active", status: "completed", durationMinutes: 59 },
  { name: "TEST AI V3 - LÊN ĐƠN", type: "active", status: "not_completed", durationMinutes: 0 },
  { name: "HỖ TRỢ - BBH - CHỊ THẢO - AI BASE - 80496085", type: "passive", status: "completed", durationMinutes: 15 },
  { name: "HỖ TRỢ - BBH - CHỊ THẢO - AL BASE - 00650910", type: "passive", status: "completed", durationMinutes: 20 }
];

const oct23Stats = calculateStats(oct23Tasks, { activeTarget: 270, passiveTarget: 180 }, testOct23);
// Active: 5 + 59 = 64m (Target 270m -> Remaining: 206m = 3h26)
assert.strictEqual(oct23Stats.active.currentMinutes, 64);
assert.strictEqual(oct23Stats.active.remainingMinutes, 206);
assert.strictEqual(oct23Stats.active.completed, false);

// Passive: 15 + 20 = 35m (Target 180m -> Remaining: 145m = 2h25)
assert.strictEqual(oct23Stats.passive.currentMinutes, 35);
assert.strictEqual(oct23Stats.passive.remainingMinutes, 145);
assert.strictEqual(oct23Stats.passive.completed, false);

// Total: 64 + 35 = 99m (Target 450m -> Remaining: 351m = 5h51)
assert.strictEqual(oct23Stats.total.currentMinutes, 99);
assert.strictEqual(oct23Stats.total.remainingMinutes, 351);
assert.strictEqual(oct23Stats.total.completed, false);

// Check exact sum equals 99m
const oct23Sum = oct23Tasks.reduce((sum, t) => sum + effectiveTaskMinutes(t, testOct23), 0);
assert.strictEqual(oct23Sum, 99);

// ============================================================================
// COMPREHENSIVE TESTS: PAUSE / RESUME / NO-ACCUMULATION-DURING-PAUSE
// Requirements:
// 1. Tạm dừng thì tính khoảng thời gian từ lúc bắt đầu đến khi tạm dừng
// 2. Không dồn cộng giờ khi đã tạm dừng (pause -> now is NOT work time)
// 3. Khi nào tiếp tục thì mới tiếp tục cộng giờ
// ============================================================================
const pauseTestDate = new Date(2026, 9, 23, 8, 0); // 23/10/2026 08:00

// Scenario 1: Start 08:00, Pause 08:35 (worked 35m)
const timelineS1 = [
  { type: "start", at: new Date(2026, 9, 23, 8, 0), time: "08:00", date: "23/10" },
  { type: "pause", at: new Date(2026, 9, 23, 8, 35), time: "08:35", date: "23/10" }
];

// Check at 08:35 (moment of pause): 35m worked, 0m paused
const s1At0835 = analyzeTimeline(timelineS1, new Date(2026, 9, 23, 8, 35));
assert.strictEqual(s1At0835.workedMinutes, 35);
assert.strictEqual(s1At0835.pausedMinutes, 0);
assert.strictEqual(s1At0835.runtimeStatus, "paused");

// Check at 09:30 (1 hour after pause!): MUST REMAIN 35m worked, 55m paused!
const s1At0930 = analyzeTimeline(timelineS1, new Date(2026, 9, 23, 9, 30));
assert.strictEqual(s1At0930.workedMinutes, 35, "Worked minutes MUST NOT increase while paused!");
assert.strictEqual(s1At0930.pausedMinutes, 55, "Paused time must accumulate in pausedMinutes, NOT workedMinutes!");
assert.strictEqual(s1At0930.runtimeStatus, "paused");

// Effective task minutes at 09:30 must be exactly 35m
const taskS1 = {
  name: "📄 TEST AI V3 - LÊN ĐƠN",
  type: "active",
  status: "paused",
  timeline: timelineS1,
  startedAt: "08:00",
  startedDate: "23/10"
};
assert.strictEqual(effectiveTaskMinutes(taskS1, new Date(2026, 9, 23, 9, 30)), 35);
assert.strictEqual(effectiveTaskMinutes(taskS1, new Date(2026, 9, 23, 12, 0)), 35, "At 12:00, worked time still 35m");

// Scenario 2: Resumed at 10:00, running until 10:20 (worked 35 + 20 = 55m)
const timelineS2 = [
  ...timelineS1,
  { type: "resume", at: new Date(2026, 9, 23, 10, 0), time: "10:00", date: "23/10" }
];
const s2At1020 = analyzeTimeline(timelineS2, new Date(2026, 9, 23, 10, 20));
assert.strictEqual(s2At1020.workedMinutes, 55, "After resume, worked time resumes adding: 35 + 20 = 55m");
assert.strictEqual(s2At1020.runtimeStatus, "running");

// Scenario 3: Paused again at 10:25 (worked 35 + 25 = 60m = 1h00)
const timelineS3 = [
  ...timelineS2,
  { type: "pause", at: new Date(2026, 9, 23, 10, 25), time: "10:25", date: "23/10" }
];
const s3At1100 = analyzeTimeline(timelineS3, new Date(2026, 9, 23, 11, 0));
assert.strictEqual(s3At1100.workedMinutes, 60, "Second pause freezes worked time at exactly 60m");
assert.strictEqual(s3At1100.runtimeStatus, "paused");
assert.strictEqual(s3At1100.pauseCount, 2);

// Scenario 4: User live scenario with 3 paused tasks + 4 completed tasks
const liveUserScenarioTasks = [
  { name: "📄 TEST AI V3 - LÊN ĐƠN", type: "active", status: "paused", durationMinutes: 45, workedMinutes: 45 },
  { name: "📄 HỖ TRỢ - AI - Salon Hoàng Vũ", type: "passive", status: "paused", durationMinutes: 25, workedMinutes: 25 },
  { name: "📄 HỖ TRỢ - BBH - P2P - AI BASE - 25761567", type: "passive", status: "paused", durationMinutes: 30, workedMinutes: 30 },
  { name: "📄 HỖ TRỢ -", type: "active", status: "not_completed", durationMinutes: 0 },
  { name: "📄 KẾ HOẠCH NGÀY", type: "active", status: "completed", durationMinutes: 5 },
  { name: "📄 CHECK TIN NHẮN ĐẦU NGÀY", type: "active", status: "completed", durationMinutes: 59 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AI BASE - 80496085", type: "passive", status: "completed", durationMinutes: 15 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AL BASE - 00650910", type: "passive", status: "completed", durationMinutes: 20 }
];

const liveStats = calculateStats(liveUserScenarioTasks, { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 9, 23, 14, 0));
// Active: 45 (paused TEST AI) + 5 (completed) + 59 (completed) = 109m (Target 270 -> Remaining 161m)
assert.strictEqual(liveStats.active.currentMinutes, 109);
assert.strictEqual(liveStats.active.remainingMinutes, 161);

// Passive: 25 (paused Salon) + 30 (paused P2P) + 15 (completed) + 20 (completed) = 90m (Target 180 -> Remaining 90m)
assert.strictEqual(liveStats.passive.currentMinutes, 90);
assert.strictEqual(liveStats.passive.remainingMinutes, 90);

// Total: 109 + 90 = 199m (Target 450 -> Remaining 251m)
assert.strictEqual(liveStats.total.currentMinutes, 199);
assert.strictEqual(liveStats.total.remainingMinutes, 251);

// Total of effectiveTaskMinutes for each task row must strictly match totalCurrentMinutes
const sumOfAllTasks = liveUserScenarioTasks.reduce((acc, t) => acc + effectiveTaskMinutes(t, new Date(2026, 9, 23, 14, 0)), 0);
assert.strictEqual(sumOfAllTasks, liveStats.total.currentMinutes);
assert.strictEqual(sumOfAllTasks, 199);

// ============================================================================
// EN-DASH VS HYPHEN & STALE FORMID PROTECTION TEST (User Screenshot Match)
// Opened drawer: "TEST AI V3 – LÊN ĐƠN" (with en-dash '–')
// Board task: "📄 TEST AI V3 - LÊN ĐƠN" (with hyphen '-')
// Other task with numeric ID: "📄 HỖ TRỢ - BBH - P2P - AI BASE - 25761567"
// URL context has form_id = "25761567"
// ============================================================================
const userDocTasks = [
  { name: "📄 TEST AI V3 - LÊN ĐƠN", type: "active", status: "paused", durationMinutes: 0 },
  { name: "📄 HỖ TRỢ - BBH - P2P - AI BASE - 25761567", type: "passive", status: "paused", durationMinutes: 0 },
  { name: "📄 HỖ TRỢ -", type: "active", status: "not_completed", durationMinutes: 0 },
  { name: "📄 KẾ HOẠCH NGÀY", type: "active", status: "completed", durationMinutes: 5 },
  { name: "📄 CHECK TIN NHẮN ĐẦU NGÀY", type: "active", status: "completed", durationMinutes: 59 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AI BASE - 80496085", type: "passive", status: "completed", durationMinutes: 15 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AL BASE - 00650910", type: "passive", status: "completed", durationMinutes: 20 },
  { name: "📄 HỖ TRỢ - AI - Salon Hoàng Vũ", type: "passive", status: "completed", durationMinutes: 22 }
];

// Opened drawer from screenshot: title has en-dash '–', type is 'active', timeline 10:00 -> 11:51 (111m)
const openedDrawerIdentity = {
  name: "TEST AI V3 – LÊN ĐƠN", // with en-dash
  type: "active",
  formId: "25761567" // Stale formId from URL / context
};

const matchResult = matchOpenedTask(openedDrawerIdentity, userDocTasks);
assert.strictEqual(matchResult.matched, true, "Must successfully match opened task");
assert.strictEqual(matchResult.matchedTask.name, "📄 TEST AI V3 - LÊN ĐƠN", "Must match TEST AI V3 - LÊN ĐƠN, NOT HỖ TRỢ P2P!");
assert.strictEqual(matchResult.matchedTask.type, "active", "Must be active type!");

// Timeline: 10:00 -> 11:51 = 111 minutes worked
const openedTimeline = [
  { type: "start", at: new Date(2026, 9, 23, 10, 0), time: "10:00", date: "23/10" },
  { type: "pause", at: new Date(2026, 9, 23, 11, 51), time: "11:51", date: "23/10" }
];
const openedRuntime = analyzeTimeline(openedTimeline, new Date(2026, 9, 23, 14, 0));
assert.strictEqual(openedRuntime.workedMinutes, 111);
assert.strictEqual(openedRuntime.runtimeStatus, "paused");

// Attach runtime to matched task and cache
cacheTaskRuntime(matchResult.matchedTask, openedRuntime);
const enrichedUserTasks = enrichAllTasksWithCachedRuntime(userDocTasks, null);

const enrichedTestAi = enrichedUserTasks.find(t => t.name.includes("TEST AI V3"));
assert.strictEqual(enrichedTestAi.workedMinutes, 111, "TEST AI V3 must have 111 minutes worked!");
assert.strictEqual(enrichedTestAi.type, "active");

const enrichedP2p = enrichedUserTasks.find(t => t.name.includes("25761567"));
assert.strictEqual(Number(enrichedP2p.workedMinutes) || 0, 0, "P2P must NOT steal 111 minutes from TEST AI V3!");
assert.strictEqual(effectiveTaskMinutes(enrichedP2p, new Date(2026, 9, 23, 14, 0)), 0);

// Calculate KPI:
const finalUserStats = calculateStats(enrichedUserTasks, { activeTarget: 270, passiveTarget: 180 }, new Date(2026, 9, 23, 14, 0));
// Active: 5 (Kế hoạch) + 59 (Check tin nhắn) + 111 (TEST AI V3) = 175m = 2h55!
assert.strictEqual(finalUserStats.active.currentMinutes, 175);
assert.strictEqual(finalUserStats.active.targetMinutes, 270);
assert.strictEqual(finalUserStats.active.remainingMinutes, 95); // 1h35
assert.strictEqual(finalUserStats.active.percentage, 65); // 65% progress bar!

// Passive: 15 + 20 + 22 = 57m
assert.strictEqual(finalUserStats.passive.currentMinutes, 57);
assert.strictEqual(finalUserStats.passive.remainingMinutes, 123); // 2h03

// Total: 175 + 57 = 232m = 3h52
assert.strictEqual(finalUserStats.total.currentMinutes, 232);
assert.strictEqual(finalUserStats.total.remainingMinutes, 218); // 3h38
assert.strictEqual(finalUserStats.total.percentage, 52); // 52% progress bar!

// RunningTask must point to the paused task TEST AI V3 - LÊN ĐƠN
assert.ok(finalUserStats.runningTask);
assert.strictEqual(finalUserStats.runningTask.task.name, "📄 TEST AI V3 - LÊN ĐƠN");
assert.strictEqual(finalUserStats.runningTask.runtimeStatus, "paused");
assert.strictEqual(finalUserStats.runningTask.workedMinutes, 111);

// Test timeline bounded between "Tiến độ thực hiện" and "Hoạt động"
const textWithOuterNoise = `
Chi tiết công việc
TEST AI V3 – LÊN ĐƠN
▶ Tiếp tục
Tiến độ thực hiện
Tạm dừng lúc 11:51 - 23/10
Bắt đầu lúc 10:00 - 23/10
Hoạt động
11:51 - Người dùng đã tạm dừng công việc
10:00 - Bắt đầu công việc
Bình luận
`;

const boundedParsedTimeline = parseTimelineEvents(textWithOuterNoise, new Date(2026, 9, 23, 14, 0));
assert.strictEqual(boundedParsedTimeline.length, 2, "Should parse exactly 2 events in taskParser, ignoring top button and activity footer");
assert.strictEqual(boundedParsedTimeline[0].type, "start");
assert.strictEqual(boundedParsedTimeline[1].type, "pause");

const boundedTimelineDebug = parseTimelineEventsDebug(textWithOuterNoise, { body: { innerText: "" } }, new Date(2026, 9, 23, 14, 0));
assert.strictEqual(boundedTimelineDebug.events.length, 2, "Should parse exactly 2 events in timelineDebug, ignoring top button and activity footer");
assert.strictEqual(boundedTimelineDebug.events[0].type, "pause");
assert.strictEqual(boundedTimelineDebug.events[0].time, "11:51");
assert.strictEqual(boundedTimelineDebug.events[1].type, "start");
assert.strictEqual(boundedTimelineDebug.events[1].time, "10:00");

// Test user log scenario: Task "📄 HỖ TRỢ -" is paused, must retain 55m worked and track 5m paused
const userScenarioTasks = [
  { name: "📄 TEST AI V3 - LÊN ĐƠN", status: "completed", type: "active", durationMinutes: 111 },
  {
    name: "📄 HỖ TRỢ -",
    status: "paused",
    type: "active",
    inUpcomingSection: true, // Originally had "Sắp diễn ra" in DOM row snippet
    startedAtText: "13:30",
    startedDate: "23/10",
    workedMinutes: 55,
    pausedMinutes: 5,
    pauseCount: 1,
    timeline: [
      { type: "start", time: "13:30", date: "23/10", at: new Date(2026, 9, 23, 13, 30) },
      { type: "pause", time: "14:25", date: "23/10", at: new Date(2026, 9, 23, 14, 25) }
    ]
  },
  { name: "📄 KẾ HOẠCH NGÀY", status: "completed", type: "active", durationMinutes: 5 },
  { name: "📄 CHECK TIN NHẮN ĐẦU NGÀY", status: "completed", type: "active", durationMinutes: 59 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AI BASE - 80496085", status: "completed", type: "passive", durationMinutes: 15 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AL BASE - 00650910", status: "completed", type: "passive", durationMinutes: 20 },
  { name: "📄 HỖ TRỢ - AI - Salon Hoàng Vũ", status: "completed", type: "passive", durationMinutes: 22 },
  { name: "📄 HỖ TRỢ - BBH - P2P - AI BASE - 25761567", status: "completed", type: "passive", durationMinutes: 52 }
];

const scenarioNow = new Date(2026, 9, 23, 14, 30);
const scenarioStats = calculateStats(userScenarioTasks, { activeTarget: 270, passiveTarget: 180 }, scenarioNow);

// Effective minutes of paused task must be 55, NEVER 0!
const pausedTaskItem = userScenarioTasks.find(t => t.name === "📄 HỖ TRỢ -");
assert.strictEqual(effectiveTaskMinutes(pausedTaskItem, scenarioNow), 55, "HỖ TRỢ - must have 55 minutes, not 0m!");

// Active: 111 + 55 + 5 + 59 = 230m
assert.strictEqual(scenarioStats.active.currentMinutes, 230, "Active KPI must count 55m of paused task to reach 230m!");
assert.strictEqual(scenarioStats.active.remainingMinutes, 40, "Active remaining must be 40m");

// Passive: 15 + 20 + 22 + 52 = 109m
assert.strictEqual(scenarioStats.passive.currentMinutes, 109, "Passive KPI must be 109m");
assert.strictEqual(scenarioStats.passive.remainingMinutes, 71, "Passive remaining must be 71m");

// Total: 230 + 109 = 339m
assert.strictEqual(scenarioStats.total.currentMinutes, 339, "Total KPI must be 339m");
assert.strictEqual(scenarioStats.total.remainingMinutes, 111, "Total remaining must be 111m");

// Running task must point to the paused task "📄 HỖ TRỢ -"
assert.ok(scenarioStats.runningTask, "Must have runningTask representing the paused task");
assert.strictEqual(scenarioStats.runningTask.task.name, "📄 HỖ TRỢ -");
assert.strictEqual(scenarioStats.runningTask.runtimeStatus, "paused");
assert.strictEqual(scenarioStats.runningTask.workedMinutes, 55, "Worked minutes must be 55m");
assert.strictEqual(scenarioStats.runningTask.pausedMinutes, 5, "Paused minutes must be 5m");

// ============================================================================
// REGRESSION TEST: 10-TASK SCENARIO WITH "📄 HỖ TRỢ -" (PAUSED 55m) AND
// NEW PASSIVE TASK "📄 HỖ TRỢ - BBH - Anh Tính - AI Base - 34257592"
// Must NOT duplicate 55m onto Anh Tính and must keep Anh Tính as passive!
// ============================================================================
const { filterSubstringTaskCandidates } = require("../src/content/timelineDebug.js");

const tenBoardTasks = [
  { name: "📄 TEST AI V3 - LÊN ĐƠN", type: "active", status: "completed", durationMinutes: 111 },
  { name: "📄 HỖ TRỢ -", type: "active", status: "not_completed", durationMinutes: 0, startedAtText: "13:30", startedDate: "23/10", inUpcomingSection: true },
  { name: "📄 HỖ TRỢ - BBH - Anh Tính - AI Base - 34257592", type: "passive", status: "not_completed", durationMinutes: 0, startedAtText: "15:05", startedDate: "23/10", inUpcomingSection: true },
  { name: "📄 HỖ TRỢ - BBH - anh Hoàng - AI", type: "passive", status: "not_completed", durationMinutes: 0, startedAtText: "14:39", startedDate: "23/10", inUpcomingSection: true },
  { name: "📄 KẾ HOẠCH NGÀY", type: "active", status: "completed", durationMinutes: 5 },
  { name: "📄 CHECK TIN NHẮN ĐẦU NGÀY", type: "active", status: "completed", durationMinutes: 59 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AI BASE - 80496085", type: "passive", status: "completed", durationMinutes: 15 },
  { name: "📄 HỖ TRỢ - BBH - CHỊ THẢO - AL BASE - 00650910", type: "passive", status: "completed", durationMinutes: 20 },
  { name: "📄 HỖ TRỢ - AI - Salon Hoàng Vũ", type: "passive", status: "completed", durationMinutes: 22 },
  { name: "📄 HỖ TRỢ - BBH - P2P - AI BASE - 25761567", type: "passive", status: "completed", durationMinutes: 52 }
];

// 1. Substring prefix disambiguation: when drawer text has "hỗ trợ - bbh - anh tính - ai base - 34257592",
// "📄 HỖ TRỢ -" must be filtered out because it is a prefix of the longer matched task name!
const rawPrefixCandidates = [tenBoardTasks[1], tenBoardTasks[2]];
const disambiguated = filterSubstringTaskCandidates(
  rawPrefixCandidates,
  "hỗ trợ - bbh - anh tính - ai base - 34257592 bị động chưa hoàn thành"
);
assert.strictEqual(disambiguated.length, 1, "Prefix task 'HỖ TRỢ -' must be filtered out when longer task name is present");
assert.strictEqual(disambiguated[0].name, "📄 HỖ TRỢ - BBH - Anh Tính - AI Base - 34257592");

// 2. Cache runtime for "📄 HỖ TRỢ -" (55m, paused at 14:25) and "anh Hoàng" (27m, running from 14:39)
const nowAt1506 = new Date(2026, 9, 23, 15, 6);
const hoTroTimeline = [
  { type: "start", time: "13:30", date: "23/10", at: new Date(2026, 9, 23, 13, 30) },
  { type: "pause", time: "14:25", date: "23/10", at: new Date(2026, 9, 23, 14, 25) }
];
const hoTroRuntime = analyzeTimeline(hoTroTimeline, nowAt1506);
assert.strictEqual(hoTroRuntime.workedMinutes, 55);
assert.strictEqual(hoTroRuntime.pausedMinutes, 41);
cacheTaskRuntime(tenBoardTasks[1], hoTroRuntime);

const hoangTimeline = [
  { type: "start", time: "14:39", date: "23/10", at: new Date(2026, 9, 23, 14, 39) }
];
const hoangRuntime = analyzeTimeline(hoangTimeline, nowAt1506);
assert.strictEqual(hoangRuntime.workedMinutes, 27);
assert.strictEqual(hoangRuntime.runtimeStatus, "running");
cacheTaskRuntime(tenBoardTasks[3], hoangRuntime);

// 3. Even if user opens "📄 HỖ TRỢ -" drawer while stale formId "34257592" is in parent URL context
// and even if openedTask.name were missing, startTime "13:30" matches "📄 HỖ TRỢ -" and NEVER matches "Anh Tính"!
const matchWithStaleFormId = matchOpenedTask(
  { name: null, formId: "34257592", startTime: "13:30", sources: ["parent-form-id", "timeline-start"] },
  tenBoardTasks
);
assert.strictEqual(matchWithStaleFormId.matched, true);
assert.strictEqual(matchWithStaleFormId.matchedTask.name, "📄 HỖ TRỢ -", "Must match HỖ TRỢ - by 13:30 startTime, never Anh Tính!");

// 4. Enrich all 10 tasks at 15:06 (anh Hoàng = 27m running, HỖ TRỢ - = 55m worked, 41m paused)
const hoTroRuntimeAt1506 = analyzeTimeline(hoTroTimeline, nowAt1506);
const attachedHoTro = attachRuntimeToMatchedTask(tenBoardTasks, matchWithStaleFormId, hoTroRuntimeAt1506);
const enrichedTenTasks = enrichAllTasksWithCachedRuntime(attachedHoTro.tasks, attachedHoTro.taskWithRuntime, nowAt1506);

const taskHoTro = enrichedTenTasks.find(t => t.name === "📄 HỖ TRỢ -");
const taskAnhTinh = enrichedTenTasks.find(t => t.name.includes("Anh Tính"));
const taskAnhHoang = enrichedTenTasks.find(t => t.name.includes("anh Hoàng"));

assert.strictEqual(taskHoTro.type, "active");
assert.strictEqual(taskHoTro.status, "paused");
assert.strictEqual(effectiveTaskMinutes(taskHoTro, nowAt1506), 55, "HỖ TRỢ - must have 55m");
assert.strictEqual(taskHoTro.pausedMinutes, 41, "HỖ TRỢ - pausedMinutes at 15:06 must be 41m");

assert.strictEqual(taskAnhTinh.type, "passive", "Anh Tính must remain passive (Bị động)");
assert.strictEqual(effectiveTaskMinutes(taskAnhTinh, nowAt1506), 0, "Anh Tính must have 0m, never duplicate 55m from HỖ TRỢ -");

assert.strictEqual(taskAnhHoang.type, "passive", "anh Hoàng must be passive");
assert.strictEqual(taskAnhHoang.status, "running", "anh Hoàng must stay running even when viewing a paused task drawer");
assert.strictEqual(effectiveTaskMinutes(taskAnhHoang, nowAt1506), 27, "anh Hoàng must have 27m at 15:06");

const statsAt1506 = calculateStats(
  enrichedTenTasks,
  { activeTarget: 270, passiveTarget: 180 },
  nowAt1506
);
// Active: 111 + 55 + 5 + 59 = 230m (remaining 40m, NOT 285m!)
assert.strictEqual(statsAt1506.active.currentMinutes, 230);
assert.strictEqual(statsAt1506.active.remainingMinutes, 40);
assert.strictEqual(statsAt1506.active.completed, false);
// Passive: 15 + 20 + 22 + 52 + 27 (anh Hoàng) + 0 (Anh Tính) = 136m (remaining 44m)
assert.strictEqual(statsAt1506.passive.currentMinutes, 136);
assert.strictEqual(statsAt1506.passive.remainingMinutes, 44);
// Total: 230 + 136 = 366m (remaining 84m)
assert.strictEqual(statsAt1506.total.currentMinutes, 366);
assert.strictEqual(statsAt1506.total.remainingMinutes, 84);

// ============================================================================
// REGRESSION TEST: 24/10/2026 9-TASK SCENARIO
// Prevents double-counting "📄 BÁO CÁO CUỐI TUẦN - TEAM" (122m) when semantic
// and adaptive parsers produce different `type` values, and preserves visible
// badge type over name-inference!
// ============================================================================
const { parseTasks } = require("../src/content/taskParser.js");

function createMockDocWithCards(cardsSpec) {
  const mockDoc = {
    createTreeWalker(rootNode) {
      const textNodes = [];
      function collect(node) {
        if (!node) return;
        if (node.nodeType === 3) {
          textNodes.push(node);
          return;
        }
        for (const child of node.childNodes || []) {
          collect(child);
        }
      }
      collect(rootNode);
      let idx = -1;
      return {
        currentNode: null,
        nextNode() {
          idx += 1;
          if (idx < textNodes.length) {
            this.currentNode = textNodes[idx];
            return this.currentNode;
          }
          return null;
        }
      };
    }
  };

  function makeLeaf(tag, text, parent) {
    const el = {
      nodeType: 1,
      tagName: tag,
      ownerDocument: mockDoc,
      isConnected: true,
      checkVisibility: () => true,
      closest: () => null,
      dataset: {},
      className: "",
      innerText: text,
      textContent: text,
      children: [],
      childNodes: [],
      parentElement: parent,
      getAttribute: () => null,
      querySelectorAll: () => [],
      contains(other) { return other === this; }
    };
    const textNode = { nodeType: 3, nodeValue: text, parentElement: el };
    el.childNodes.push(textNode);
    return el;
  }

  const cardElements = cardsSpec.map(([name, durText, badgeText, statusText]) => {
    //Simulate inner wrapper containing name + duration + status (without badge),
    // wrapped in outer card that also contains the badge (reproducing the exact DOM hierarchy bug!)
    const card = {
      nodeType: 1,
      tagName: "DIV",
      ownerDocument: mockDoc,
      isConnected: true,
      checkVisibility: () => true,
      closest: () => null,
      dataset: {},
      className: "task-card",
      innerText: `${name}\n${durText}${badgeText}\n${statusText}`,
      textContent: `${name}${durText}${badgeText}${statusText}`,
      children: [],
      childNodes: [],
      parentElement: null,
      getAttribute: () => null,
      querySelectorAll() {
        return [innerWrap, nameEl, durEl, statusEl, badgeEl];
      },
      contains(other) {
        return other === this || [innerWrap, nameEl, durEl, statusEl, badgeEl].includes(other);
      }
    };
    const innerWrap = {
      nodeType: 1,
      tagName: "DIV",
      ownerDocument: mockDoc,
      isConnected: true,
      checkVisibility: () => true,
      closest: () => null,
      dataset: {},
      className: "task-inner",
      innerText: `${name}\n${durText}\n${statusText}`,
      textContent: `${name}${durText}${statusText}`,
      children: [],
      childNodes: [],
      parentElement: card,
      getAttribute: () => null,
      querySelectorAll() {
        return [nameEl, durEl, statusEl];
      },
      contains(other) {
        return other === this || [nameEl, durEl, statusEl].includes(other);
      }
    };
    const nameEl = makeLeaf("DIV", name, innerWrap);
    const durEl = makeLeaf("SPAN", durText, innerWrap);
    const statusEl = makeLeaf("SPAN", statusText, innerWrap);
    innerWrap.children.push(nameEl, durEl, statusEl);
    innerWrap.childNodes.push(nameEl, durEl, statusEl);

    const badgeEl = makeLeaf("SPAN", badgeText, card);
    card.children.push(innerWrap, badgeEl);
    card.childNodes.push(innerWrap, badgeEl);
    return card;
  });

  const body = {
    nodeType: 1,
    tagName: "BODY",
    ownerDocument: mockDoc,
    isConnected: true,
    checkVisibility: () => true,
    closest: () => null,
    innerText: cardElements.map(c => c.innerText).join("\n"),
    textContent: cardElements.map(c => c.textContent).join(""),
    children: cardElements,
    childNodes: cardElements,
    querySelectorAll() {
      return cardElements.flatMap(c => [c, ...c.querySelectorAll()]);
    },
    contains(other) { return true; }
  };
  cardElements.forEach(c => { c.parentElement = body; });
  mockDoc.body = body;
  return mockDoc;
}

const mockDoc2410 = createMockDocWithCards([
  ["📄 BÁO CÁO CUỐI TUẦN - TEAM", "2h 02m", "Bị động", "Hoàn thành"],
  ["📄 TEST AI LÊN ĐƠN", "10:15 - 24/10", "Chủ động", "Chưa hoàn thành"],
  ["📄 HỖ TRỢ - AI Bot Ban Hang - Cuốn Sen - AIBASE - 74785600", "52m", "Chủ động", "Hoàn thành"],
  ["📄 KẾ HOẠCH NGÀY", "54s", "Chủ động", "Hoàn thành"],
  ["📄 CHECK TIN NHẮN ĐẦU NGÀY", "40m", "Chủ động", "Hoàn thành"],
  ["📄 HỖ TRỢ - TROLLBEADS_Chị Hoang Anh - GHL 12TH (14546478)", "14m", "Bị động", "Hoàn thành"],
  ["📄 HỖ TRỢ - BBH - ANH PHẤN - AI CƠ BẢN - 28137591", "28m", "Bị động", "Hoàn thành"],
  ["📄 HỖ TRỢ - BBH - Anh Tính - AI Base - 34257592", "21m", "Bị động", "Hoàn thành"],
  ["📄 TIẾP NHẬN GÓI", "33m", "Chủ động", "Hoàn thành"]
]);

const dedupedTasks = parseTasks(mockDoc2410, new Date(2026, 9, 24, 15, 0));
assert.strictEqual(dedupedTasks.length, 9, "Must parse exactly 9 tasks for 24/10/2026, never 10!");

const baoCaoMatches = dedupedTasks.filter(t => t.name.includes("BÁO CÁO CUỐI TUẦN - TEAM"));
assert.strictEqual(baoCaoMatches.length, 1, "📄 BÁO CÁO CUỐI TUẦN - TEAM must NEVER be counted twice!");
assert.strictEqual(baoCaoMatches[0].durationMinutes, 122);
assert.strictEqual(baoCaoMatches[0].type, "passive", "Must preserve visible badge type 'passive' over name-inference 'active'");

const cuonSenMatches = dedupedTasks.filter(t => t.name.includes("Cuốn Sen"));
assert.strictEqual(cuonSenMatches.length, 1);
assert.strictEqual(cuonSenMatches[0].durationMinutes, 52, "Must parse '52m' even when textContent is '52mChủ động'");
assert.strictEqual(cuonSenMatches[0].type, "active", "Must keep visible badge 'Chủ động' (active) for Cuốn Sen even after completion");

console.log(`✓ Tất cả kiểm tra logic đã đạt`);
