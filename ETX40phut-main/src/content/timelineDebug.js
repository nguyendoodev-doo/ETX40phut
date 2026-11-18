(function (root) {
  const inBrowser = typeof location !== "undefined" && typeof document !== "undefined";
  const contextUrls = inBrowser ? `${location.href} ${document.referrer || ""}` : "";
  if (inBrowser && !/(?:merchant\.vn\/a\/timeboxing|timeboxing|vercel\.app)/iu.test(contextUrls)) return;
  const DEBUG_VERSION = "1.3.2-dom-debug";
  if (root.__TASK_KPI_TIMELINE_DEBUG_VERSION__ === DEBUG_VERSION) return;
  root.__TASK_KPI_TIMELINE_DEBUG_VERSION__ = DEBUG_VERSION;
  if (inBrowser) console.log("TASK IDENTITY DEBUG LOADED", { version: DEBUG_VERSION, script: "src/content/timelineDebug.js" });

  const api = root.TaskKpi = root.TaskKpi || {};
  let debounceTimer = null;
  let lastSignature = null;

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, character => character === "Đ" ? "D" : "d")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("vi");
  }

  function compact(value, limit = 5000) {
    const text = String(value || "");
    return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text;
  }

  function elementSnapshot(element) {
    return {
      tagName: element?.tagName || null,
      className: typeof element?.className === "string" ? element.className : "",
      textContent: compact(element?.textContent?.trim(), 5000),
      childCount: element?.children?.length || 0,
      outerHTML: compact(element?.outerHTML, 5000)
    };
  }

  function findTimelineHeading(documentRoot = document) {
    const body = documentRoot.body;
    if (!body) return null;
    const walker = documentRoot.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (normalizeText(walker.currentNode.nodeValue) === "tien do thuc hien") return walker.currentNode.parentElement;
    }
    return null;
  }

  function isBoardOrPageContainer(element) {
    if (!element) return false;
    const raw = element.innerText || element.textContent || "";
    if (raw.length > 3500) return true;
    const normalized = normalizeText(raw);
    return normalized.includes("muc tieu trong ngay")
      || normalized.includes("muc tieu trong tuan")
      || normalized.includes("cong viec trong ngay")
      || normalized.includes("sap dien ra");
  }

  function markerScore(text) {
    const normalized = normalizeText(text);
    return ["tien do thuc hien", "bat dau", "tam dung", "tiep tuc", "hoan thanh"]
      .reduce((score, marker) => score + (normalized.includes(marker) ? 1 : 0), 0)
      + (/luc\s*\d{1,2}:\d{2}/u.test(normalized) ? 1 : 0);
  }

  function selectTimelineContainer(parents) {
    const eligible = parents.filter(element => {
      if (isBoardOrPageContainer(element)) return false;
      const normalized = normalizeText(element.innerText || element.textContent);
      return normalized.includes("tien do thuc hien") && normalized.includes("bat dau") && /luc\s*\d{1,2}:\d{2}/u.test(normalized);
    });
    if (!eligible.length) return null;
    return eligible[0];
  }

  function findTimelineContainer(documentRoot = document) {
    const heading = findTimelineHeading(documentRoot);
    const parents = [];
    for (let node = heading, depth = 0; node && depth < 10; node = node.parentElement, depth += 1) {
      if (depth > 0 && isBoardOrPageContainer(node)) break;
      parents.push(node);
    }
    return selectTimelineContainer(parents);
  }

  function relevantDomNodes(container) {
    const nodes = [];
    for (const element of container.querySelectorAll("*")) {
      const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.nodeValue).join(" ").trim();
      const normalized = normalizeText(directText);
      if (!directText || !/(tien do thuc hien|bat dau|tam dung|tiep tuc|hoan thanh|luc\s*\d{1,2}:\d{2})/u.test(normalized)) continue;
      nodes.push({
        index: nodes.length,
        tag: element.tagName,
        className: typeof element.className === "string" ? element.className : "",
        text: compact(directText, 1000),
        parentText: compact(element.parentElement?.innerText || element.parentElement?.textContent, 1500)
      });
    }
    return nodes;
  }

  function resolveTimelineYear(dateText, documentRoot = document, now = new Date()) {
    const date = String(dateText || "").match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/u);
    if (date?.[3]) return { year: Number(date[3]), source: "timeline-date" };
    if (date) {
      const bodyText = documentRoot.body?.innerText || "";
      const contextYear = bodyText.match(new RegExp(`\\b${Number(date[1])}\\/${Number(date[2])}\\/(\\d{4})\\b`, "u"))?.[1];
      if (contextYear) return { year: Number(contextYear), source: "document-context" };
    }
    return { year: now.getFullYear(), source: "current-date" };
  }

  function parseTimelineEvents(container, documentRoot = document, now = new Date()) {
    const rawText = typeof container === "string" ? container : (container?.innerText || container?.textContent || "");
    let lines = rawText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);

    // Bắt đầu đọc từ sau tiêu đề "Tiến độ thực hiện" nếu có trong container
    const headingIndex = lines.findIndex(line => {
      const norm = normalizeText(line);
      return norm === "tien do thuc hien" || norm.startsWith("tien do thuc hien");
    });
    if (headingIndex !== -1) {
      lines = lines.slice(headingIndex + 1);
    }

    // Dừng lại trước các section nằm sau timeline (Hoạt động, Bình luận, Hệ thống, Lịch sử...)
    const stopMarkers = ["hoat dong", "binh luan", "he thong", "lich su", "tep dinh kem", "thao luan"];
    const stopIndex = lines.findIndex(line => {
      const norm = normalizeText(line).replace(/[^a-z\s]/gu, "").replace(/\s+/g, " ").trim();
      return stopMarkers.includes(norm);
    });
    if (stopIndex !== -1) {
      lines = lines.slice(0, stopIndex);
    }

    const typeMap = { "bat dau": "start", "tam dung": "pause", "tiep tuc": "resume", "hoan thanh": "complete" };
    const normalizeEventLabel = value => normalizeText(value).replace(/[^a-z\s]/gu, "").replace(/\s+/g, " ").trim();
    const detectType = label => {
      if (typeMap[label]) return typeMap[label];
      for (const [key, val] of Object.entries(typeMap)) {
        if (label === key || label.startsWith(key + " ")) return val;
      }
      return null;
    };
    const events = [];
    const parseErrors = [];
    let hasTrailingPause = false;
    for (let index = 0; index < lines.length; index += 1) {
      const normalizedLabel = normalizeEventLabel(lines[index]);
      const type = detectType(normalizedLabel);
      if (!type) continue;
      let timeMatch = null;
      let rawTime = null;
      for (let next = index; next < lines.length; next += 1) {
        if (next > index && detectType(normalizeEventLabel(lines[next]))) break;
        const match = lines[next].match(/(?:lúc\s*)?(\d{1,2}):([0-5]\d)(?:\s*(?:-|lúc|,)\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?))?/iu);
        if (match) { timeMatch = match; rawTime = lines[next]; break; }
      }
      if (!timeMatch) {
        if (type === "pause" && events.length > 0) {
          hasTrailingPause = true;
        }
        parseErrors.push({ index: events.length, rawLabel: lines[index], reason: "Không tìm thấy timestamp HH:mm sau event." });
        continue;
      }
      if (type === "resume" || type === "complete") {
        hasTrailingPause = false;
      }
      const time = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;
      let date = timeMatch[3];
      if (!date) {
        if (events.length > 0) {
          date = events[events.length - 1].date;
        } else {
          date = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`;
        }
      }
      const yearInfo = resolveTimelineYear(date, documentRoot, now);
      const dateParts = date.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{4})?$/u);
      const at = new Date(yearInfo.year, Number(dateParts[2]) - 1, Number(dateParts[1]), Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
      if (Number.isNaN(at.getTime())) {
        parseErrors.push({ index: events.length, rawLabel: lines[index], rawTime, reason: "Datetime local không hợp lệ." });
        continue;
      }
      events.push({ type, time, date, timestamp: at.getTime(), at, rawLabel: lines[index], rawTime, timelineYearSource: yearInfo });
    }
    return { events, parseErrors, hasTrailingPause };
  }

  function clock(date) {
    return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

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

  function fieldValues(element) {
    return [element?.value, element?.textContent, element?.getAttribute?.("aria-label"), element?.getAttribute?.("title")]
      .map(value => String(value || "").trim()).filter(Boolean);
  }

  function filterSubstringTaskCandidates(candidates, containerNormalizedText) {
    if (!Array.isArray(candidates) || candidates.length <= 1) return candidates;
    const withNorm = candidates.map(item => ({
      item,
      norm: normalizeTaskName(item.name || item)
    })).filter(entry => entry.norm);
    return withNorm.filter(entry => {
      const longerContainers = withNorm.filter(other =>
        other.norm !== entry.norm &&
        other.norm.length > entry.norm.length &&
        other.norm.includes(entry.norm)
      );
      if (!longerContainers.length) return true;
      let stripped = String(containerNormalizedText || "");
      for (const longer of longerContainers) {
        stripped = stripped.split(longer.norm).join(" ");
      }
      return stripped.includes(entry.norm);
    }).map(entry => entry.item);
  }

  function extractOpenedTaskName(documentRoot = document, parsedTasks = [], timelineContainer = null) {
    const taskNames = new Map(parsedTasks.map(task => [normalizeTaskName(task.name), task.name]).filter(([name]) => name));
    const scopes = [];
    for (let node = timelineContainer, depth = 0; node && depth < 10; node = node.parentElement, depth += 1) {
      if (depth > 0 && isBoardOrPageContainer(node)) break;
      scopes.push(node);
    }
    const modal = timelineContainer?.closest?.('[role="dialog"],dialog,[aria-modal="true"],.drawer,.modal');
    if (modal && !isBoardOrPageContainer(modal) && !scopes.includes(modal)) scopes.unshift(modal);
    const selectors = 'h1,h2,h3,h4,h5,h6,[role="heading"],[class*="title"],[class*="name"],[class*="header"],[aria-label],[title],input,textarea,[contenteditable="true"],a[href]';
    const exactMatches = [];
    const substringMatches = [];
    const inspect = (element, source) => {
      for (const value of fieldValues(element)) {
        const normalized = normalizeTaskName(value);
        if (!normalized) continue;
        if (taskNames.has(normalized)) {
          exactMatches.push({ name: taskNames.get(normalized), source, text: normalized });
        } else if (normalized.length < 140) {
          const matchedInField = [];
          for (const [normTaskName, origName] of taskNames) {
            if (normalized.includes(normTaskName)) {
              matchedInField.push({ name: origName, source, text: normalized });
            }
          }
          const filtered = filterSubstringTaskCandidates(matchedInField, normalized);
          substringMatches.push(...filtered);
        }
      }
    };
    for (const scope of scopes) for (const element of scope.querySelectorAll?.(selectors) || []) inspect(element, "detail-name");
    const uniqueExact = [...new Map(exactMatches.map(match => [normalizeTaskName(match.name), match])).values()];
    if (uniqueExact.length === 1) return uniqueExact[0];
    const uniqueSubstring = [...new Map(substringMatches.map(match => [normalizeTaskName(match.name), match])).values()];
    if (uniqueSubstring.length === 1) return uniqueSubstring[0];
    return null;
  }

  function safeIdentityUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const params = {};
      for (const key of ["form_id", "tab_id", "task_id", "item_id", "record_id"]) if (url.searchParams.has(key)) params[key] = url.searchParams.get(key);
      return { pathname: url.pathname, params };
    } catch { return null; }
  }

  function elementLocator(element) {
    if (!element) return null;
    const id = element.id ? `#${element.id}` : "";
    const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/u).filter(Boolean).slice(0, 3).map(name => `.${name}`).join("") : "";
    return `${element.tagName?.toLowerCase() || "unknown"}${id}${classes}`;
  }

  function findOpenedDetailContainer(timelineContainer) {
    if (!timelineContainer) return null;
    const explicit = timelineContainer.closest?.('[role="dialog"],dialog,[aria-modal="true"],.drawer,.modal,[class*="drawer"],[class*="modal"]');
    if (explicit && !isBoardOrPageContainer(explicit)) return explicit;
    let best = timelineContainer;
    for (let node = timelineContainer, depth = 0; node?.parentElement && depth < 8; node = node.parentElement, depth += 1) {
      const parent = node.parentElement;
      if (isBoardOrPageContainer(parent)) break;
      const text = parent.innerText || parent.textContent || "";
      if (normalizeText(text).includes("tien do thuc hien")) best = parent;
    }
    return best;
  }

  function debugOpenedTaskDom(documentRoot = document, parsedTasks = [], identity = null) {
    const timelineContainer = findTimelineContainer(documentRoot);
    const container = findOpenedDetailContainer(timelineContainer);
    const taskNames = parsedTasks.map(task => ({ original: task.name, normalized: normalizeTaskName(task.name) })).filter(task => task.normalized);
    const candidateNames = [];
    const possibleIds = new Set();
    const candidateSelector = 'h1,h2,h3,h4,h5,h6,[role="heading"],label,[aria-label],[title],a,button,input,textarea,[contenteditable="true"]';
    for (const element of (container ? [...container.querySelectorAll(candidateSelector)] : []).slice(0, 300)) {
      for (const rawValue of fieldValues(element)) {
        const normalized = normalizeTaskName(rawValue);
        const matches = taskNames.filter(task => normalized === task.normalized || normalized.includes(task.normalized) || task.normalized.includes(normalized)).map(task => task.original);
        if (matches.length) candidateNames.push({ element: elementLocator(element), value: rawValue.slice(0, 300), exactNormalized: matches.some(name => normalizeTaskName(name) === normalized), matches });
        for (const id of rawValue.match(/\b\d{5,}\b/gu) || []) possibleIds.add(id);
      }
    }
    return {
      containerFound: Boolean(container),
      containerSelector: elementLocator(container),
      candidateNames: candidateNames.slice(0, 20),
      possibleIds: [...possibleIds].slice(0, 30)
    };
  }

  function collectIdentityDebug(documentRoot = document, parsedTasks = [], context = null) {
    const selector = 'h1,h2,h3,h4,h5,h6,[role="heading"],[aria-label],[title],input,textarea,[contenteditable="true"],a[href],button,[data-form-id],[data-task-id],[data-item-id],[data-record-id]';
    const timelineContainer = findTimelineContainer(documentRoot);
    const detailContainer = findOpenedDetailContainer(timelineContainer);
    const elements = detailContainer ? [...detailContainer.querySelectorAll(selector)].slice(0, 300) : [];
    const clean = value => String(value || "").replace(/([?&](?:token|token_business|access_token)=)[^&\s]+/giu, "$1[REDACTED]").slice(0, 240);
    const headings = elements.filter(element => /^H[1-6]$/u.test(element.tagName) || element.getAttribute("role") === "heading").flatMap(fieldValues).map(clean).slice(0, 30);
    const candidateNames = elements.flatMap(fieldValues).map(clean).filter(value => parsedTasks.some(task => normalizeTaskName(task.name) === normalizeTaskName(value))).slice(0, 30);
    const dataAttributes = elements.map(element => Object.fromEntries([...element.attributes].filter(attribute => attribute.name.startsWith("data-") && !/token|auth|cookie|secret/iu.test(attribute.name)).map(attribute => [attribute.name, clean(attribute.value)]))).filter(value => Object.keys(value).length).slice(0, 30);
    const links = elements.filter(element => element.tagName === "A").map(element => safeIdentityUrl(element.href)).filter(Boolean).filter(value => Object.keys(value.params).length).slice(0, 30);
    const buttons = elements.filter(element => element.tagName === "BUTTON").flatMap(fieldValues).map(clean).slice(0, 30);
    const combined = JSON.stringify({ context, headings, candidateNames, dataAttributes, links, buttons });
    const possibleIds = [...new Set(combined.match(/\b\d{5,}\b/gu) || [])].slice(0, 50);
    return { container: elementLocator(detailContainer), iframeUrl: safeIdentityUrl(location.href), parentContext: context ? { formId: context.formId || null, tabId: context.tabId || null, pathname: safeIdentityUrl(context.parentUrl)?.pathname || null } : null, headings, candidateNames, dataAttributes, links, buttons, possibleIds };
  }

  function getOpenedTaskIdentity(documentRoot = document, parsedTasks = [], context = null) {
    const container = findTimelineContainer(documentRoot);
    if (!container) return { taskId: null, formId: null, name: null, startTime: null, source: null, detailContainer: null };

    const identity = { taskId: null, formId: context?.formId ? String(context.formId) : null, name: null, type: null, startTime: null, startDate: null, sources: [], detailContainer: container };
    if (identity.formId) identity.sources.push("parent-form-id");
    for (const rawUrl of [location.href, documentRoot.referrer]) {
      try {
        const url = new URL(rawUrl);
        const urlTaskId = url.searchParams.get("task_id") || url.searchParams.get("item_id") || null;
        const urlFormId = url.searchParams.get("form_id") || null;
        identity.taskId ||= urlTaskId;
        identity.formId ||= urlFormId;
        if ((urlTaskId || urlFormId) && !identity.sources.includes("url-identifier")) identity.sources.push("url-identifier");
      } catch { /* URL is optional. */ }
    }

    for (let node = container, depth = 0; node && depth < 10; node = node.parentElement, depth += 1) {
      if (depth > 0 && isBoardOrPageContainer(node)) break;
      identity.taskId ||= node.dataset?.taskId || node.dataset?.itemId || node.getAttribute?.("data-task-id") || node.getAttribute?.("data-item-id") || null;
      identity.formId ||= node.dataset?.formId || node.getAttribute?.("data-form-id") || null;
      if ((identity.taskId || identity.formId) && !identity.sources.includes("dom-identifier")) identity.sources.push("dom-identifier");

      const nodeText = normalizeTaskName(node.innerText || node.textContent);
      const rawCandidates = parsedTasks.filter(task => {
        const normalized = normalizeTaskName(task.name);
        return normalized && nodeText.includes(normalized);
      });
      const nameCandidates = filterSubstringTaskCandidates(rawCandidates, nodeText);
      const distinctNormalizedNames = new Set(nameCandidates.map(task => normalizeTaskName(task.name)));

      if (distinctNormalizedNames.size > 1) {
        // Đã leo ra ngoài phạm vi 1 task đơn lẻ (chứa nhiều task khác nhau)
        break;
      }

      const metadataText = normalizeText(node.innerText || node.textContent);
      const hasActive = metadataText.includes("chu dong");
      const hasPassive = metadataText.includes("bi dong");
      if (!identity.type && hasActive !== hasPassive) {
        identity.type = hasActive ? "active" : "passive";
        identity.sources.push("detail-type");
      }

      if (nameCandidates.length === 1 || distinctNormalizedNames.size === 1) {
        identity.name = nameCandidates[0].name;
        identity.detailContainer = node;
        identity.sources.push(nameCandidates.length === 1 ? "detail-name" : "ambiguous-detail-name");
        break;
      }
    }
    if (!identity.name) {
      const extractedName = extractOpenedTaskName(documentRoot, parsedTasks, container);
      if (extractedName) { identity.name = extractedName.name; identity.sources.push(extractedName.source); }
    }
    const parsedTimeline = parseTimelineEvents(container, documentRoot, new Date()).events;
    const startEvent = parsedTimeline.find(event => event.type === "start");
    identity.startTime = startEvent?.time || null;
    identity.startDate = startEvent?.date || null;
    if (startEvent) identity.sources.push("timeline-start");
    return identity;
  }

  function taskIdentifiers(task) {
    return [task?.taskId, task?.formId, /^\d{5,}$/u.test(String(task?.id || "")) ? task.id : null, task?.name?.match(/(?:^|\s|-)(\d{5,})\s*$/u)?.[1]]
      .filter(Boolean).map(String);
  }

  function matchOpenedTaskToParsedTask(openedTask, parsedTasks = []) {
    if (api.taskIdentity?.matchOpenedTask) return api.taskIdentity.matchOpenedTask(openedTask, parsedTasks);
    const normalizedName = normalizeTaskName(openedTask?.name);
    if (normalizedName) {
      const candidates = parsedTasks.filter(task => normalizeTaskName(task.name) === normalizedName);
      if (candidates.length === 1) return { matched: true, method: "exactName", candidateCount: 1, openedTask, matchedTask: candidates[0], ambiguousCandidates: [] };
      if (candidates.length > 1) return { matched: false, method: null, candidateCount: candidates.length, openedTask, matchedTask: null, ambiguousCandidates: candidates, reason: "Nhiều task có cùng normalized name." };
    }
    const identifiers = [openedTask?.taskId, openedTask?.formId].filter(Boolean).map(String);
    if (identifiers.length) {
      const eligible = (openedTask?.type && ["active", "passive"].includes(openedTask.type))
        ? parsedTasks.filter(t => !t.type || t.type === openedTask.type)
        : parsedTasks;
      const candidates = eligible.filter(task => taskIdentifiers(task).some(id => identifiers.includes(id)));
      if (candidates.length === 1) return { matched: true, method: "id", candidateCount: 1, openedTask, matchedTask: candidates[0], ambiguousCandidates: [] };
      if (candidates.length > 1) return { matched: false, method: null, candidateCount: candidates.length, openedTask, matchedTask: null, ambiguousCandidates: candidates, reason: "Nhiều task trùng identifier." };
    }
    return { matched: false, method: null, candidateCount: 0, openedTask, matchedTask: null, ambiguousCandidates: [], reason: "Không có ID hoặc exact normalized name khớp duy nhất." };
  }

  function attachRuntimeToMatchedTask(parsedTasks, matchResult, runtime) {
    if (!matchResult?.matched || !matchResult.matchedTask) return { tasks: parsedTasks, taskWithRuntime: null };
    const runtimeData = { runtimeStatus: runtime.runtimeStatus, workedMinutes: runtime.workedMinutes, pausedMinutes: runtime.pausedMinutes, pauseCount: runtime.pauseCount, timeline: runtime.timeline.map(event => ({ type: event.type, time: event.time, date: event.date, timestamp: event.at.getTime() })) };
    const lastPaused = [...runtime.timeline].reverse().find(event => event.type === "pause") || null;
    const lastResumed = [...runtime.timeline].reverse().find(event => event.type === "resume") || null;
    const startEvent = runtime.timeline?.find(event => event.type === "start") || null;
    const taskWithRuntime = {
      ...matchResult.matchedTask,
      inUpcomingSection: false,
      status: runtime.runtimeStatus === "idle" ? matchResult.matchedTask.status : runtime.runtimeStatus,
      runtimeStatus: runtime.runtimeStatus,
      workedMinutes: runtime.workedMinutes,
      durationMinutes: Math.max(Number(matchResult.matchedTask.durationMinutes) || 0, runtime.workedMinutes),
      pausedMinutes: runtime.pausedMinutes,
      pauseCount: runtime.pauseCount,
      startedAt: matchResult.matchedTask.startedAt || startEvent?.at || null,
      startedAtText: matchResult.matchedTask.startedAtText || startEvent?.time || null,
      startedDate: matchResult.matchedTask.startedDate || startEvent?.date || null,
      lastPausedAt: lastPaused?.at || null,
      lastResumedAt: lastResumed?.at || null,
      timeline: runtime.timeline,
      runtime: runtimeData,
      detailDiagnostics: {
        ...(matchResult.matchedTask.detailDiagnostics || {}),
        matchedBy: matchResult.method,
        confidence: "high",
        identityMatched: true
      }
    };
    return { taskWithRuntime, tasks: parsedTasks.map(task => task === matchResult.matchedTask ? taskWithRuntime : task) };
  }

  const taskRuntimeStore = new Map();

  function cacheTaskRuntime(task, runtime) {
    if (!task || !runtime) return;
    const key = normalizeTaskName(task.name);
    if (!key) return;
    const existing = taskRuntimeStore.get(key);
    const newWorked = Number(runtime.workedMinutes) || 0;
    const oldWorked = Number(existing?.runtime?.workedMinutes) || 0;
    const isStatusTransition = runtime.runtimeStatus === "paused" || runtime.runtimeStatus === "completed" || existing?.runtime?.runtimeStatus !== runtime.runtimeStatus;
    if (!existing || isStatusTransition || newWorked >= oldWorked) {
      // Clean up any stale entries that had the exact same start timestamp/time but were incorrectly assigned
      if (runtime.timeline?.length) {
        const startEvt = runtime.timeline.find(e => e.type === "start") || runtime.timeline[0];
        const firstTimestamp = startEvt?.timestamp || (startEvt?.at ? new Date(startEvt.at).getTime() : null);
        const firstTime = startEvt?.time;
        for (const [existingKey, existingVal] of taskRuntimeStore.entries()) {
          if (existingKey !== key && existingVal.runtime?.timeline?.length) {
            const exStart = existingVal.runtime.timeline.find(e => e.type === "start") || existingVal.runtime.timeline[0];
            const exTs = exStart?.timestamp || (exStart?.at ? new Date(exStart.at).getTime() : null);
            const exTime = exStart?.time;
            if ((firstTimestamp && exTs === firstTimestamp) || (firstTime && exTime === firstTime)) {
              taskRuntimeStore.delete(existingKey);
            }
          }
        }
      }

      taskRuntimeStore.set(key, {
        identifiers: taskIdentifiers(task),
        normalizedName: key,
        taskName: task.name,
        runtime: runtime,
        updatedAt: Date.now()
      });
    }
  }

  function seedTaskRuntimeStore(tasks) {
    if (!Array.isArray(tasks)) return;
    const seenStartTimes = new Set();
    for (const [, val] of taskRuntimeStore.entries()) {
      const startEvt = val.runtime?.timeline?.find(e => e.type === "start") || val.runtime?.timeline?.[0];
      if (startEvt?.time) seenStartTimes.add(startEvt.time);
    }
    for (const t of tasks) {
      if (!t || t.status === "not_completed") continue;
      if (Number(t.workedMinutes) > 0 || (Array.isArray(t.timeline) && t.timeline.length > 0) || t.status === "paused") {
        const normName = normalizeTaskName(t.name);
        if (normName && !taskRuntimeStore.has(normName)) {
          const startEvt = (t.timeline || []).find(e => e.type === "start") || (t.timeline || [])[0];
          const startTime = startEvt?.time || t.startedAtText || null;
          if (startTime && seenStartTimes.has(startTime)) {
            continue;
          }
          if (startTime) seenStartTimes.add(startTime);
          const resolvedStatus = (t.status === "paused" || t.runtimeStatus === "paused") ? "paused" : (t.runtimeStatus || t.status);
          taskRuntimeStore.set(normName, {
            identifiers: taskIdentifiers(t),
            normalizedName: normName,
            taskName: t.name,
            runtime: t.runtime ? { ...t.runtime, runtimeStatus: resolvedStatus } : {
              runtimeStatus: resolvedStatus,
              workedMinutes: Number(t.workedMinutes) || 0,
              pausedMinutes: t.pausedMinutes || 0,
              pauseCount: t.pauseCount || 0,
              timeline: t.timeline || []
            },
            updatedAt: Date.now()
          });
        }
      }
    }
  }

  function enrichAllTasksWithCachedRuntime(parsedTasks, liveMatchedTask = null, now = new Date()) {
    const usedStartTimes = new Set();
    if (liveMatchedTask) {
      const liveStartEvt = (liveMatchedTask.timeline || []).find(e => e.type === "start") || (liveMatchedTask.timeline || [])[0];
      const liveStartTime = liveStartEvt?.time || liveMatchedTask.startedAtText || null;
      if (liveStartTime) usedStartTimes.add(liveStartTime);
    }

    return parsedTasks.map(task => {
      if (liveMatchedTask && task === liveMatchedTask) return task;
      if (task.status === "completed" && Number(task.durationMinutes) > 0) return task;

      const normName = normalizeTaskName(task.name);
      let cached = taskRuntimeStore.get(normName);

      if (cached && cached.runtime) {
        const cachedStartEvt = (cached.runtime.timeline || []).find(e => e.type === "start") || (cached.runtime.timeline || [])[0];
        const cachedStartTime = cachedStartEvt?.time || null;
        if (cachedStartTime && usedStartTimes.has(cachedStartTime)) {
          taskRuntimeStore.delete(normName);
          cached = null;
        } else if (cachedStartTime) {
          usedStartTimes.add(cachedStartTime);
        }
      }

      if (task.inUpcomingSection) {
        if (cached && cached.runtime && (Number(cached.runtime.workedMinutes) > 0 || cached.runtime.runtimeStatus === "paused" || cached.runtime.runtimeStatus === "running")) {
          // Task has worked runtime or is paused/running! It is not an unstarted upcoming task.
          task.inUpcomingSection = false;
        } else {
          return {
            ...task,
            status: task.status === "paused" ? "paused" : "not_completed",
            runtimeStatus: "paused",
            workedMinutes: 0,
            durationMinutes: 0
          };
        }
      }

      if (cached && cached.runtime) {
        const startEvent = cached.runtime.timeline?.find(e => e.type === "start");
        const lastPaused = [...(cached.runtime.timeline || [])].reverse().find(e => e.type === "pause") || null;
        const lastResumed = [...(cached.runtime.timeline || [])].reverse().find(e => e.type === "resume") || null;
        const isTaskPaused = task.status === "paused"
          || cached.runtime.runtimeStatus === "paused"
          || Boolean(liveMatchedTask && liveMatchedTask.runtimeStatus === "running" && cached.runtime.runtimeStatus === "running");
        const effectiveStatus = isTaskPaused
          ? "paused"
          : (cached.runtime.runtimeStatus === "idle" ? task.status : cached.runtime.runtimeStatus);

        const liveAnalyzed = (Array.isArray(cached.runtime.timeline) && cached.runtime.timeline.length && api.calculator?.analyzeTimeline)
          ? api.calculator.analyzeTimeline(cached.runtime.timeline, now)
          : null;
        const resolvedWorked = isTaskPaused
          ? Math.max(Number(task.workedMinutes) || 0, Number(cached.runtime.workedMinutes) || 0)
          : Math.max(Number(task.workedMinutes) || 0, Number(liveAnalyzed?.workedMinutes) || 0, Number(cached.runtime.workedMinutes) || 0);
        const resolvedPaused = isTaskPaused
          ? Math.max(Number(liveAnalyzed?.pausedMinutes) || 0, Number(cached.runtime.pausedMinutes) || 0, Number(task.pausedMinutes) || 0)
          : (cached.runtime.pausedMinutes ?? task.pausedMinutes ?? 0);

        return {
          ...task,
          status: task.status === "completed" ? "completed" : effectiveStatus,
          runtimeStatus: isTaskPaused ? "paused" : cached.runtime.runtimeStatus,
          workedMinutes: resolvedWorked,
          durationMinutes: Math.max(Number(task.durationMinutes) || 0, resolvedWorked),
          pausedMinutes: resolvedPaused,
          pauseCount: cached.runtime.pauseCount ?? task.pauseCount ?? 0,
          startedAt: task.startedAt || startEvent?.at || null,
          startedAtText: task.startedAtText || startEvent?.time || null,
          startedDate: task.startedDate || startEvent?.date || null,
          lastPausedAt: task.lastPausedAt || lastPaused?.at || null,
          lastResumedAt: task.lastResumedAt || lastResumed?.at || null,
          timeline: (task.timeline && task.timeline.length) ? task.timeline : cached.runtime.timeline,
          runtime: task.runtime || {
            runtimeStatus: isTaskPaused ? "paused" : cached.runtime.runtimeStatus,
            workedMinutes: resolvedWorked,
            pausedMinutes: resolvedPaused,
            pauseCount: cached.runtime.pauseCount,
            timeline: (cached.runtime.timeline || []).map(event => ({
              type: event.type,
              time: event.time,
              date: event.date,
              timestamp: event.at ? new Date(event.at).getTime() : event.timestamp
            }))
          }
        };
      }
      return task;
    });
  }

  function extractDetailTaskType(detailRoot, taskName) {
      if (!detailRoot || isBoardOrPageContainer(detailRoot)) {
          return { type: null, rawText: null, detectedBy: null };
      }
      const rootNorm = normalizeText(detailRoot.innerText || detailRoot.textContent);
      if (rootNorm.includes("chu dong") && rootNorm.includes("bi dong")) {
          return { type: null, rawText: null, detectedBy: null };
      }

      let detectedType = null;
      let detectedBy = null;
      let rawTypeText = null;
      
      const candidateTexts = [];
      const candidateAttributes = [];
      
      try {
          const walker = document.createTreeWalker(detailRoot, NodeFilter.SHOW_ELEMENT);
          while (walker.nextNode()) {
              const el = walker.currentNode;
              const isLeaf = el.children.length === 0;
              const text = isLeaf ? (el.innerText || el.textContent || "") : "";
              
              if (isLeaf && text.trim()) {
                  candidateTexts.push(text.trim());
              }
              
              const title = el.getAttribute("title") || "";
              const aria = el.getAttribute("aria-label") || "";
              const dt = Object.entries(el.dataset || {}).map(([k,v]) => k+"="+v).join(" ");
              
              if (title) candidateAttributes.push(title);
              if (aria) candidateAttributes.push(aria);
              if (dt) candidateAttributes.push(dt);
              
              const normText = normalizeText(text);
              const normTitle = normalizeText(title);
              const normAria = normalizeText(aria);
              const normDt = normalizeText(dt);
              
              if (normText.includes("chu dong") || normTitle.includes("chu dong") || normAria.includes("chu dong") || normDt.includes("chu dong")) {
                  detectedType = "active";
                  detectedBy = "text/attribute";
                  rawTypeText = "chu dong";
                  break;
              }
              
              if (normText.includes("bi dong") || normTitle.includes("bi dong") || normAria.includes("bi dong") || normDt.includes("bi dong")) {
                  detectedType = "passive";
                  detectedBy = "text/attribute";
                  rawTypeText = "bi dong";
                  break;
              }
          }
      } catch (err) {
          console.error("DETAIL_TYPE_ERROR", err);
      }
      
      return { type: detectedType, rawText: rawTypeText, detectedBy };
  }

  async function mapOpenedTaskRuntime(parsedTasks, documentRoot = document, now = new Date(), context = null) {
    let container = findTimelineContainer(documentRoot);
    let parsed = null;
    let attempts = 0;

    if (container) {
      parsed = parseTimelineEvents(container, documentRoot, now);
      if (parsed.events.length === 0 && attempts < 1) {
        attempts += 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        container = findTimelineContainer(documentRoot);
        if (container) parsed = parseTimelineEvents(container, documentRoot, new Date());
      }
    }

    if (!container) {
      const enrichedTasks = enrichAllTasksWithCachedRuntime(parsedTasks, null, now);
      const runningTask = enrichedTasks.find(t => t.status === "running")
        || enrichedTasks.find(t => t.status === "paused")
        || null;
      return {
        matched: Boolean(runningTask),
        method: runningTask ? "cache" : null,
        candidateCount: runningTask ? 1 : 0,
        openedTask: null,
        matchedTask: runningTask,
        taskWithRuntime: runningTask,
        runtime: runningTask?.runtime || null,
        tasks: enrichedTasks
      };
    }
    
    if (!parsed) parsed = parseTimelineEvents(container, documentRoot, now);
    const runtime = api.calculator.analyzeTimeline(parsed.events, now);
    const openedTask = getOpenedTaskIdentity(documentRoot, parsedTasks, context);
    const detailRoot = findOpenedDetailContainer(container) || openedTask.detailContainer || container;
    const hasResumeButton = [...(detailRoot?.querySelectorAll?.('button,[role="button"]') || [])].some(btn => normalizeText(btn.textContent) === "tiep tuc");
    const hasPauseButton = [...(detailRoot?.querySelectorAll?.('button,[role="button"]') || [])].some(btn => normalizeText(btn.textContent) === "tam dung");
    if (runtime.runtimeStatus === "running" && (hasResumeButton || (parsed.hasTrailingPause && !hasPauseButton))) {
      runtime.runtimeStatus = "paused";
    }
    const match = matchOpenedTaskToParsedTask(openedTask, parsedTasks);
    
    // DETAIL TYPE PARSER - only enrich if task type was unknown
    if (detailRoot && match.matched && match.matchedTask && (!match.matchedTask.type || match.matchedTask.type === "unknown")) {
        try {
            if (typeof extractDetailTaskType === "function") {
                const detailTypeInfo = extractDetailTaskType(detailRoot, match.matchedTask.name);
                if (detailTypeInfo.type) {
                    match.matchedTask.type = detailTypeInfo.type;
                    if (api.taskParser?.cacheTaskType) {
                        api.taskParser.cacheTaskType(match.matchedTask.name, detailTypeInfo.type);
                    }
                }
            }
        } catch (error) {
            console.error("DETAIL_TYPE_ERROR", error);
        }
    }

    if (!match.matched) {
      const enrichedTasks = enrichAllTasksWithCachedRuntime(parsedTasks, null, now);
      return { ...match, tasks: enrichedTasks, runtime };
    }
    const attached = attachRuntimeToMatchedTask(parsedTasks, match, runtime);
    cacheTaskRuntime(match.matchedTask, runtime);
    
    const fullyEnrichedTasks = enrichAllTasksWithCachedRuntime(attached.tasks, attached.taskWithRuntime, now);
    const taskWithRuntime = attached.taskWithRuntime;

    if (api.CONFIG?.DEBUG_MODE) {
      await emit("=== TASK WITH RUNTIME ===", { id: taskWithRuntime.id, taskId: taskWithRuntime.taskId, formId: taskWithRuntime.formId, name: taskWithRuntime.name, minutes: taskWithRuntime.minutes ?? taskWithRuntime.durationMinutes, status: taskWithRuntime.status, type: taskWithRuntime.type, runtimeStatus: taskWithRuntime.runtimeStatus, workedMinutes: taskWithRuntime.workedMinutes, pausedMinutes: taskWithRuntime.pausedMinutes, pauseCount: taskWithRuntime.pauseCount, timelineAttached: taskWithRuntime.timeline.length, runtime: taskWithRuntime.runtime });
    }
    return { ...match, taskWithRuntime, runtime, tasks: fullyEnrichedTasks };
  }

  async function emit(label, payload) {
    console.log(label, payload);
    try { await api.logger?.log("timeline-dom", label, payload); } catch { /* Console remains the source of truth. */ }
  }

  async function debugTimelineDOM(documentRoot = document) {
    const heading = findTimelineHeading(documentRoot);
    if (!heading) {
      lastSignature = null;
      return null;
    }

    const parents = [];
    let node = heading;
    for (let index = 0; index < 6 && node; index += 1, node = node.parentElement) parents.push(node);
    const container = selectTimelineContainer(parents);
    const signature = `${location.href}|${container?.innerText || heading.textContent}`;
    if (signature === lastSignature) return null;
    lastSignature = signature;

    if (!container) {
      return { heading, container: null };
    }

    const rawText = container.innerText || container.textContent || "";
    const selector = `${container.tagName.toLowerCase()}${container.id ? `#${container.id}` : ""}${typeof container.className === "string" && container.className.trim() ? `.${container.className.trim().split(/\s+/).join(".")}` : ""}`;
    const domNodes = relevantDomNodes(container);
    const parsed = parseTimelineEvents(container, documentRoot, new Date());
    const calculation = api.calculator.analyzeTimeline(parsed.events, new Date());
    const parsedOutput = {
      runtimeStatus: calculation.runtimeStatus,
      workedMinutes: calculation.workedMinutes,
      pausedMinutes: calculation.pausedMinutes,
      pauseCount: calculation.pauseCount,
      timeline: calculation.timeline.map(event => ({ type: event.type, time: event.time, date: event.date, timestamp: event.at.getTime(), timelineYearSource: event.timelineYearSource })),
      parseErrors: parsed.parseErrors,
      invalidTransitions: calculation.invalidTransitions
    };
    await emit("=== TIMELINE PARSED ===", parsedOutput);
    const segmentOutput = calculation.segments.map(segment => `${segment.kind} ${clock(segment.from)} -> ${segment.open ? "NOW" : clock(segment.to)} = ${segment.minutes}`);
    await emit("=== TIMELINE CALCULATION ===", segmentOutput);
    if (api.CONFIG?.DEBUG_MODE && api.taskParser?.parseTasks) {
      const currentParsedTasks = api.taskParser.parseTasks(documentRoot);
      await mapOpenedTaskRuntime(currentParsedTasks, documentRoot, new Date());
    }
    return { heading, container, selector, rawText, domNodes, ...parsedOutput, segments: segmentOutput };
  }

  api.timelineDebug = { normalizeText, normalizeTaskName, filterSubstringTaskCandidates, findTimelineHeading, resolveTimelineYear, parseTimelineEvents, extractOpenedTaskName, collectIdentityDebug, debugOpenedTaskDom, getOpenedTaskIdentity, matchOpenedTaskToParsedTask, attachRuntimeToMatchedTask, mapOpenedTaskRuntime, debugTimelineDOM, cacheTaskRuntime, seedTaskRuntimeStore, enrichAllTasksWithCachedRuntime };
  if (typeof module !== "undefined") module.exports = api.timelineDebug;
})(typeof globalThis !== "undefined" ? globalThis : this);
