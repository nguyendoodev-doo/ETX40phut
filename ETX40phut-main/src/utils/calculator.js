(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};

  function calculateRemaining(current, target) {
    return Math.max(0, Math.round(target - current));
  }

  function calculateTargetTime(now, remainingMinutes) {
    const date = now instanceof Date ? new Date(now) : new Date(now);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(remainingMinutes)) return null;
    date.setMinutes(date.getMinutes() + Math.max(0, remainingMinutes));
    return date;
  }

  function parseTaskTime(value, now) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value);
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime()) && /\d{4}|T/.test(String(value))) return direct;
    const match = String(value).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!match) return null;
    const result = new Date(now);
    result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return result;
  }

  function parseTaskDateTime(timeValue, dateValue, now) {
    if (timeValue instanceof Date) return Number.isNaN(timeValue.getTime()) ? null : new Date(timeValue);
    const time = String(timeValue || "").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!time) return null;
    const result = new Date(now);
    const date = String(dateValue || "").match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (date) result.setFullYear(date[3] ? Number(date[3]) : result.getFullYear(), Number(date[2]) - 1, Number(date[1]));
    result.setHours(Number(time[1]), Number(time[2]), 0, 0);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function normalizeTimeline(timeline) {
    const events = (Array.isArray(timeline) ? timeline : []).map(event => ({
      ...event,
      at: event?.at instanceof Date ? new Date(event.at) : new Date(event?.at ?? event?.timestamp)
    })).filter(event => ["start", "pause", "resume", "complete"].includes(event.type) && !Number.isNaN(event.at.getTime()))
      .sort((a, b) => a.at - b.at);
    const deduplicated = events.filter((event, index) => index === 0 || event.type !== events[index - 1].type || event.at.getTime() !== events[index - 1].at.getTime());
    const valid = [];
    const warnings = [];
    let state = "idle";
    for (const event of deduplicated) {
      const allowed = (state === "idle" && event.type === "start")
        || (state === "working" && (event.type === "pause" || event.type === "complete"))
        || (state === "paused" && (event.type === "resume" || event.type === "complete"));
      if (!allowed) {
        warnings.push({ marker: "INVALID TIMELINE SEQUENCE", type: event.type, at: event.at.toISOString(), state });
        continue;
      }
      valid.push(event);
      state = event.type === "pause" ? "paused" : (event.type === "complete" ? "completed" : "working");
    }
    return { events: valid, warnings };
  }

  function calculateWorkedMinutes(timeline, now = new Date()) {
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(current.getTime())) return 0;
    const { events } = normalizeTimeline(timeline);
    let started = null;
    let workedMs = 0;
    for (const event of events) {
      if (event.at > current) break;
      if (event.type === "start" || event.type === "resume") started = event.at;
      if ((event.type === "pause" || event.type === "complete") && started) {
        workedMs += Math.max(0, event.at - started);
        started = null;
      }
    }
    if (started) workedMs += Math.max(0, current - started);
    return Math.floor(workedMs / 60000);
  }

  function calculatePausedMinutes(timeline, now = new Date()) {
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(current.getTime())) return 0;
    const { events } = normalizeTimeline(timeline);
    let pausedAt = null;
    let pausedMs = 0;
    for (const event of events) {
      if (event.at > current) break;
      if (event.type === "pause") pausedAt = event.at;
      if ((event.type === "resume" || event.type === "complete") && pausedAt) {
        pausedMs += Math.max(0, event.at - pausedAt);
        pausedAt = null;
      }
    }
    if (pausedAt) pausedMs += Math.max(0, current - pausedAt);
    return Math.floor(pausedMs / 60000);
  }

  function analyzeTimeline(timeline, now = new Date()) {
    const current = now instanceof Date ? new Date(now) : new Date(now);
    const rawEvents = (Array.isArray(timeline) ? timeline : []).map((event, index) => {
      const at = event?.at instanceof Date ? new Date(event.at) : new Date(event?.at ?? event?.timestamp);
      return {
        ...event,
        sourceIndex: index,
        at: Number.isNaN(at.getTime()) ? null : at
      };
    }).filter(event => ["start", "pause", "resume", "complete"].includes(event.type) && event.at);

    // Clamp small future clock drift (up to 5 minutes) to current time
    for (const e of rawEvents) {
      if (e.at > current && (e.at.getTime() - current.getTime()) <= 300000) {
        e.at = new Date(current);
      }
    }

    rawEvents.sort((a, b) => a.at - b.at || a.sourceIndex - b.sourceIndex);

    const validTimeline = [];
    const segments = [];
    const invalidTransitions = [];
    let state = "idle";
    let runningFrom = null;
    let pausedFrom = null;
    let workedMinutes = 0;
    let pausedMinutes = 0;
    let pauseCount = 0;

    const minutesBetween = (from, to) => Math.max(0, Math.floor((to - from) / 60000));
    const addSegment = (kind, from, to, open = false) => {
      const minutes = minutesBetween(from, to);
      segments.push({ kind, from, to, minutes, open });
      if (kind === "WORK") workedMinutes += minutes;
      else pausedMinutes += minutes;
    };

    for (const event of rawEvents) {
      if (event.at > current) {
        continue;
      }

      if (event.type === "start") {
        if (state === "running") {
          continue; // Duplicate start, keep earliest
        }
        if (state === "paused") {
          // Restarted while paused: treat as resume
          if (pausedFrom) addSegment("PAUSE", pausedFrom, event.at);
          pausedFrom = null;
          runningFrom = event.at;
          state = "running";
          validTimeline.push({ ...event, type: "resume" });
          continue;
        }
        state = "running";
        runningFrom = event.at;
        validTimeline.push(event);
        continue;
      }

      if (event.type === "pause") {
        if (state === "paused") {
          continue; // Already paused, ignore duplicate pause
        }
        if (state === "idle" || !runningFrom) {
          // Paused from start of event
          pausedFrom = event.at;
          pauseCount += 1;
          state = "paused";
          validTimeline.push(event);
          continue;
        }
        addSegment("WORK", runningFrom, event.at);
        runningFrom = null;
        pausedFrom = event.at;
        pauseCount += 1;
        state = "paused";
        validTimeline.push(event);
        continue;
      }

      if (event.type === "resume") {
        if (state === "running") {
          continue; // Already running, ignore duplicate resume
        }
        if (state === "idle" || !pausedFrom) {
          state = "running";
          runningFrom = event.at;
          validTimeline.push({ ...event, type: "start" });
          continue;
        }
        addSegment("PAUSE", pausedFrom, event.at);
        pausedFrom = null;
        runningFrom = event.at;
        state = "running";
        validTimeline.push(event);
        continue;
      }

      if (event.type === "complete") {
        if (state === "completed") continue;
        if (state === "running" && runningFrom) {
          addSegment("WORK", runningFrom, event.at);
        } else if (state === "paused" && pausedFrom) {
          addSegment("PAUSE", pausedFrom, event.at);
        }
        runningFrom = null;
        pausedFrom = null;
        state = "completed";
        validTimeline.push(event);
      }
    }

    if (state === "running" && runningFrom) addSegment("WORK", runningFrom, current, true);
    if (state === "paused" && pausedFrom) addSegment("PAUSE", pausedFrom, current, true);

    const startedAt = validTimeline.find(event => event.type === "start")?.at || null;
    const lastPausedAt = [...validTimeline].reverse().find(event => event.type === "pause")?.at || null;
    const lastResumedAt = [...validTimeline].reverse().find(event => event.type === "resume")?.at || null;

    return {
      runtimeStatus: state,
      workedMinutes,
      pausedMinutes,
      pauseCount,
      startedAt,
      lastPausedAt,
      lastResumedAt,
      timeline: validTimeline,
      segments,
      invalidTransitions
    };
  }

  function calculateRuntime(timeline, now = new Date()) {
    const result = analyzeTimeline(timeline, now);
    return { ...result, runtimeStatus: result.runtimeStatus === "idle" ? "not_started" : result.runtimeStatus };
  }

  function effectiveTaskMinutes(task, now = new Date()) {
    if (!task) return 0;
    const currentNow = now instanceof Date ? now : new Date(now);
    const hasWorkedData = (Number(task.workedMinutes) > 0)
      || (Number(task.durationMinutes) > 0 && task.status !== "not_completed")
      || (Array.isArray(task.timeline) && task.timeline.length > 0)
      || task.status === "paused"
      || task.status === "running";
    if (task.inUpcomingSection && !hasWorkedData) return 0;
    if (task.status === "completed" && Number.isFinite(Number(task.durationMinutes)) && Number(task.durationMinutes) > 0) {
      return Math.max(0, Number(task.durationMinutes));
    }
    const values = [Number(task.durationMinutes), Number(task.elapsedMinutes), Number(task.workedMinutes)]
      .filter(Number.isFinite)
      .map(value => Math.max(0, value));

    if (Array.isArray(task.timeline) && task.timeline.length) {
      const rt = calculateRuntime(task.timeline, currentNow);
      if (rt && Number.isFinite(rt.workedMinutes) && rt.workedMinutes > 0) {
        values.push(rt.workedMinutes);
      }
    }

    const isActivelyRunning = task.status === "running" && task.runtimeStatus !== "paused" && (!task.inUpcomingSection || values.some(v => v > 0));
    if (isActivelyRunning && (!task.timeline || !task.timeline.length)) {
      const started = parseTaskDateTime(task.startedAtText || task.startedAt, task.startedDate, currentNow);
      if (started && started <= currentNow) {
        values.push(Math.max(0, Math.floor((currentNow - started) / 60000)));
      }
    }
    return Math.max(0, ...values);
  }

  function typeStats(currentMinutes, targetMinutes, baseMinutes = currentMinutes, runningMinutes = 0) {
    const current = Math.max(0, Math.round(currentMinutes));
    const target = Math.max(0, Math.round(targetMinutes));
    return {
      baseMinutes: Math.max(0, Math.round(baseMinutes)),
      runningMinutes: Math.max(0, Math.round(runningMinutes)),
      currentMinutes: current,
      targetMinutes: target,
      remainingMinutes: calculateRemaining(current, target),
      overtimeMinutes: Math.max(0, current - target),
      percentage: target ? Math.min(100, Math.round(current / target * 100)) : 100,
      completed: current >= target
    };
  }

  function calculateStats(tasks, settings, now = new Date()) {
    const list = Array.isArray(tasks) ? tasks : [];
    const current = { active: 0, passive: 0, other: 0 };
    const running = { active: 0, passive: 0, other: 0 };

    const runningTasks = list.filter(task => task.status === "running" && task.runtimeStatus !== "paused" && (!task.inUpcomingSection || effectiveTaskMinutes(task, now) > 0));
    const pausedTasks = list.filter(task => (task.status === "paused" || task.runtimeStatus === "paused"));
    const task = runningTasks[0] || pausedTasks[0] || null;

    for (const t of list) {
      const taskType = (t.type === "active" || t.type === "passive") ? t.type : "other";
      const effective = effectiveTaskMinutes(t, now);
      current[taskType] += effective;
      if (t.status === "running" && t.runtimeStatus !== "paused" && (!t.inUpcomingSection || effective > 0)) {
        running[taskType] += effective;
      }
    }
    const active = typeStats(current.active, Number(settings.activeTarget) || 0, current.active - running.active, running.active);
    const passive = typeStats(current.passive, Number(settings.passiveTarget) || 0, current.passive - running.passive, running.passive);
    active.targetReachedAt = null;
    passive.targetReachedAt = null;
    let runningTask = null;
    if (task) {
      const isPaused = task.status === "paused" || task.runtimeStatus === "paused";
      const category = task.type === "passive" ? passive : active;
      const hasTimeline = Array.isArray(task.timeline) && task.timeline.length > 0;
      const runtime = hasTimeline ? calculateRuntime(task.timeline, now) : null;
      const startedAt = parseTaskDateTime(task.startedAtText || task.startedAt, task.startedDate, now) || runtime?.startedAt || null;
      const expectedEndAt = parseTaskDateTime(task.expectedEndAt, task.expectedEndDate, now);
      const reportedRunningMinutes = Math.max(0, Number(task.durationMinutes) || 0, Number(task.elapsedMinutes) || 0, Number(task.workedMinutes) || 0);
      const calculatedElapsedMinutes = hasTimeline
        ? runtime.workedMinutes
        : (isPaused
          ? reportedRunningMinutes
          : (startedAt && startedAt <= now ? Math.max(0, Math.floor((now - startedAt) / 60000)) : null));
      const effectiveRunningMinutes = Math.max(reportedRunningMinutes, calculatedElapsedMinutes ?? 0);
      const baseMinutes = Math.max(0, category.currentMinutes - effectiveRunningMinutes);
      let targetReachedAt = null;
      if (startedAt && !isPaused) {
        if (!category.completed && task.status === "running") {
          targetReachedAt = calculateTargetTime(now, category.remainingMinutes);
        } else if (baseMinutes < category.targetMinutes) {
          const minutesNeededFromRunning = category.targetMinutes - baseMinutes;
          if (effectiveRunningMinutes >= minutesNeededFromRunning) targetReachedAt = calculateTargetTime(startedAt, minutesNeededFromRunning);
        }
      }
      const canReachBeforeEnd = !isPaused && (!expectedEndAt || !targetReachedAt || targetReachedAt <= expectedEndAt);
      if (!canReachBeforeEnd && !category.completed) targetReachedAt = null;
      category.targetReachedAt = canReachBeforeEnd ? targetReachedAt : null;
      const minutesAfterTask = (!isPaused && expectedEndAt)
        ? Math.max(0, category.remainingMinutes - Math.max(0, Math.floor((expectedEndAt - now) / 60000)))
        : null;
      const computedPausedMinutes = runtime?.pausedMinutes
        ?? (task.lastPausedAt ? Math.max(0, Math.floor((now - new Date(task.lastPausedAt)) / 60000)) : null)
        ?? task.pausedMinutes
        ?? 0;
      runningTask = {
        task,
        baseMinutes,
        reportedRunningMinutes,
        calculatedElapsedMinutes,
        effectiveRunningMinutes,
        effectiveElapsedMinutes: effectiveRunningMinutes,
        runtimeStatus: isPaused ? "paused" : (runtime?.runtimeStatus || task.status),
        workedMinutes: runtime?.workedMinutes ?? task.workedMinutes ?? effectiveRunningMinutes,
        pausedMinutes: computedPausedMinutes,
        pauseCount: runtime?.pauseCount ?? task.pauseCount ?? (isPaused ? 1 : 0),
        startedAt,
        startedAtText: task.startedAtText || (startedAt ? `${String(startedAt.getHours()).padStart(2, "0")}:${String(startedAt.getMinutes()).padStart(2, "0")}` : null),
        targetReachedAt: category.targetReachedAt,
        minutesUntilTarget: category.remainingMinutes,
        canReachBeforeEnd,
        remainingAfterTask: canReachBeforeEnd ? 0 : minutesAfterTask,
        multipleRunningDetected: runningTasks.length > 1
      };
    }
    const totalCurrent = active.currentMinutes + passive.currentMinutes + current.other;
    const totalTarget = active.targetMinutes + passive.targetMinutes;
    return {
      active,
      passive,
      total: {
        baseMinutes: active.baseMinutes + passive.baseMinutes,
        runningMinutes: active.runningMinutes + passive.runningMinutes,
        currentMinutes: totalCurrent,
        targetMinutes: totalTarget,
        remainingMinutes: active.remainingMinutes + passive.remainingMinutes,
        overtimeMinutes: Math.max(0, totalCurrent - totalTarget),
        percentage: totalTarget ? Math.min(100, Math.round(totalCurrent / totalTarget * 100)) : 100,
        completed: active.completed && passive.completed
      },
      runningTask,
      warnings: runningTasks.length > 1 ? [{ marker: "MULTIPLE RUNNING TASKS", count: runningTasks.length, names: runningTasks.map(item => item.name) }] : []
    };
  }

  api.calculator = { calculateRemaining, calculateTargetTime, calculateStats, effectiveTaskMinutes, normalizeTimeline, calculateWorkedMinutes, calculatePausedMinutes, analyzeTimeline, calculateRuntime };
  if (typeof module !== "undefined") module.exports = api.calculator;
})(typeof globalThis !== "undefined" ? globalThis : this);
