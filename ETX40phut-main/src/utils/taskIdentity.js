(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};

  function normalizeTaskName(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/gu, "-")
      .replace(/\s*-\s*/g, " - ")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("vi");
  }

  function numericIdentifiers(task) {
    const trailingId = String(task?.name || "").match(/(?:^|\s|-)(\d{5,})\s*$/u)?.[1];
    return [task?.taskId, task?.formId, /^\d{5,}$/u.test(String(task?.id || "")) ? task.id : null, trailingId].filter(Boolean).map(String);
  }

  function uniqueMatch(tasks, predicate, method, openedTask) {
    const candidates = tasks.filter(predicate);
    if (candidates.length === 1) return { matched: true, method, candidateCount: 1, openedTask, matchedTask: candidates[0], ambiguousCandidates: [] };
    if (candidates.length > 1) return { matched: false, method: null, candidateCount: candidates.length, openedTask, matchedTask: null, ambiguousCandidates: candidates, reason: `Ambiguous ${method}.` };
    return null;
  }

  function matchOpenedTask(openedTask, tasks = []) {
    // 1. Highest confidence: Exact normalized name match from visible drawer title
    const name = normalizeTaskName(openedTask?.name);
    if (name) {
      const result = uniqueMatch(tasks, task => normalizeTaskName(task.name) === name, "exactName", openedTask);
      if (result) return result;
    }

    // 2. Exact taskId match (data-task-id, explicit task ID on DOM node)
    const taskId = openedTask?.taskId && String(openedTask.taskId);
    if (taskId) {
      const result = uniqueMatch(tasks, task => [task?.taskId, /^\d{5,}$/u.test(String(task?.id || "")) ? task.id : null].filter(Boolean).map(String).includes(taskId), "taskId", openedTask);
      if (result) return result;
    }

    // 3. Form ID match - with type and startTime compatibility check
    const formId = openedTask?.formId && String(openedTask.formId);
    const openedStartTime = openedTask?.startTime && String(openedTask.startTime).trim();
    if (formId) {
      const otherTaskMatchesStartTime = openedStartTime && tasks.some(t =>
        t.status !== "completed" &&
        t.startedAtText === openedStartTime &&
        !numericIdentifiers(t).includes(formId)
      );
      if (!otherTaskMatchesStartTime) {
        let eligible = (openedTask?.type && ["active", "passive"].includes(openedTask.type))
          ? tasks.filter(t => !t.type || t.type === openedTask.type)
          : tasks;
        if (openedStartTime) {
          eligible = eligible.filter(t => !t.startedAtText || t.startedAtText === openedStartTime);
        }
        const result = uniqueMatch(eligible, task => [task?.formId, /^\d{5,}$/u.test(String(task?.id || "")) ? task.id : null].filter(Boolean).map(String).includes(formId), "formId", openedTask)
          || uniqueMatch(eligible, task => numericIdentifiers(task).includes(formId), "formId", openedTask);
        if (result) return result;
      }
    }

    // 4. Exact timeline startTime match against uncompleted board card startTime
    if (openedStartTime) {
      const eligibleByStart = tasks.filter(t =>
        t.status !== "completed" &&
        t.startedAtText === openedStartTime &&
        (!openedTask?.type || !t.type || t.type === openedTask.type)
      );
      if (eligibleByStart.length === 1) {
        return { matched: true, method: "startTime", candidateCount: 1, openedTask, matchedTask: eligibleByStart[0], ambiguousCandidates: [] };
      }
    }

    return { matched: false, method: null, candidateCount: 0, openedTask, matchedTask: null, ambiguousCandidates: [], reason: "No unique exact identity match." };
  }

  function getTaskIdentifier(task) {
    if (!task) return "";
    if (task.taskId) return `task_${String(task.taskId).trim()}`;
    if (task.id && !String(task.id).startsWith("dom-task-") && !String(task.id).startsWith("semantic-task-") && !String(task.id).startsWith("adaptive-")) {
      return `id_${String(task.id).trim()}`;
    }
    const trailingId = String(task.name || "").match(/(?:^|\s|-)(\d{5,})\s*$/u)?.[1];
    if (trailingId) return `num_${trailingId}`;
    if (task.formId) {
      const start = String(task.startedAtText || "").trim();
      return `form_${task.formId}${start ? `_${start}` : ""}`;
    }
    const norm = normalizeTaskName(task.name);
    const start = String(task.startedAtText || "").trim();
    if (start) return `task_${norm}_${start}`;
    if (task.id) return `row_${String(task.id).trim()}_${norm}`;
    return `task_${norm}`;
  }

  api.taskIdentity = { normalizeTaskName, numericIdentifiers, matchOpenedTask, getTaskIdentifier };
  if (typeof module !== "undefined") module.exports = api.taskIdentity;
})(typeof globalThis !== "undefined" ? globalThis : this);
