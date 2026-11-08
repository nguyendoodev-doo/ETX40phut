(function (root) {
  const api = root.TaskKpi = root.TaskKpi || {};
  const { parseDuration } = api.duration;
  const taskRowDebugSignatures = new Map();
  let taskRowLogQueue = Promise.resolve();
  let taskRowBuildMarkerLogged = false;

  function exportTaskRowLog(message, payload) {
    console.log(message, payload);
    taskRowLogQueue = taskRowLogQueue.then(() => api.logger?.log("task-row-dom", message, payload)).catch(() => null);
  }

  // TODO: Điền selector thật tại DUY NHẤT vị trí này khi có HTML/DOM của website nội bộ.
  const SELECTORS = Object.freeze({
    taskItem: "",
    taskName: "",
    taskType: "",
    duration: "",
    status: "",
    runningInfo: "",
    startTime: "",
    expectedEndTime: ""
  });

  function textFrom(element, selector) {
    if (!element || !selector) return "";
    return element.querySelector(selector)?.textContent?.trim() || "";
  }
  function normalizeType(text) {
    const value = text.toLocaleLowerCase("vi");
    if (value.includes("chủ động")) return "active";
    if (value.includes("bị động")) return "passive";
    return null;
  }
  function normalizeStatus(text, runningText) {
    const value = `${text} ${runningText}`.toLocaleLowerCase("vi");
    if (value.includes("tiến độ thực hiện")) return "unknown";
    if (value.includes("đang chạy") || value.includes("bắt đầu")) return "running";
    if (value.includes("hoàn thành") && !value.includes("chưa")) return "completed";
    if (value.includes("chưa hoàn thành")) return "not_completed";
    return "unknown";
  }
  function hasExactLeafText(element, expected) {
    if (!element?.querySelectorAll) return false;
    const normalized = expected.toLocaleLowerCase("vi");
    return [...element.querySelectorAll("*")].some(child => {
      const elChildren = child.children ? [...child.children].filter(c => c.nodeType === 1) : [];
      return elChildren.length === 0 && child.textContent?.trim().toLocaleLowerCase("vi") === normalized;
    });
  }

  function getSpacedElementText(element) {
    if (!element) return "";
    const doc = element.ownerDocument || (typeof document !== "undefined" ? document : null);
    const showText = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;
    if (doc?.createTreeWalker) {
      const walker = doc.createTreeWalker(element, showText);
      const parts = [];
      while (walker.nextNode()) {
        const val = walker.currentNode.nodeValue?.trim();
        if (val) parts.push(val);
      }
      if (parts.length > 0) return parts.join(" ");
    }
    return element.innerText || element.textContent || "";
  }

  function semanticStatus(element) {
    if (!element) return "unknown";
    const text = getSpacedElementText(element).trim();
    if (/tiến độ thực hiện/iu.test(text) && !/đang chạy|đang thực hiện|tạm dừng/iu.test(text)) return "unknown";

    // Clean out "dự kiến hoàn thành" so it doesn't trigger false "completed"
    const cleanText = text.replace(/dự\s*kiến(?:\s+hoàn\s*thành)?/giu, "");

    if (hasExactLeafText(element, "Chưa hoàn thành") || /\bchưa\s*hoàn\s*thành\b/iu.test(cleanText)) return "not_completed";
    if (hasExactLeafText(element, "Tạm dừng") || /\btạm\s*dừng\b/iu.test(cleanText)) return "paused";
    if (hasExactLeafText(element, "Đang chạy") || hasExactLeafText(element, "Đang thực hiện") || /\b(?:đang\s*chạy|đang\s*thực\s*hiện)\b/iu.test(cleanText)) return "running";
    if (hasExactLeafText(element, "Hoàn thành") || /\bhoàn\s*thành\b/iu.test(cleanText)) return "completed";
    if (/\bbắt\s*đầu\b/iu.test(cleanText)) return "running";
    return "unknown";
  }
  function rawSemanticStatus(element) {
    if (!element) return null;
    const text = (element.innerText || element.textContent || "").trim();
    const cleanText = text.replace(/dự\s*kiến(?:\s+hoàn\s*thành)?/giu, "");
    if (hasExactLeafText(element, "Chưa hoàn thành") || /chưa\s*hoàn\s*thành/iu.test(cleanText)) return "Chưa hoàn thành";
    if (hasExactLeafText(element, "Tạm dừng") || /\btạm\s*dừng\b/iu.test(cleanText)) return "Tạm dừng";
    if (hasExactLeafText(element, "Đang chạy") || hasExactLeafText(element, "Đang thực hiện") || /\b(?:đang\s*chạy|đang\s*thực\s*hiện)\b/iu.test(cleanText)) return "Đang chạy";
    if (hasExactLeafText(element, "Hoàn thành") || /\bhoàn\s*thành\b/iu.test(cleanText)) return "Hoàn thành";
    return null;
  }
  function extractClock(text) {
    return text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)?.[0] || null;
  }
  function parseTask(element, index) {
    const runningInfo = textFrom(element, SELECTORS.runningInfo);
    const type = normalizeType(textFrom(element, SELECTORS.taskType));
    const duration = parseDuration(textFrom(element, SELECTORS.duration));
    if (!type) return null;
    return {
      id: element.dataset.taskId || element.id || `dom-task-${index}`,
      name: textFrom(element, SELECTORS.taskName) || "Task không tên",
      type,
      durationMinutes: duration ?? 0,
      status: normalizeStatus(textFrom(element, SELECTORS.status), runningInfo),
      startedAt: extractClock(textFrom(element, SELECTORS.startTime) || runningInfo),
      expectedEndAt: extractClock(textFrom(element, SELECTORS.expectedEndTime)),
      elapsedMinutes: null
    };
  }
  function isDailyColumnHeader(text) {
    const str = String(text || "").trim();
    if (!str || str.length > 60) return false;
    return /^(?:mục\s*tiêu\s*(?:trong\s*)?ngày|công\s*việc\s+trong\s+ngày|kế\s*hoạch\s+trong\s+ngày)(?:\s*\(?\s*\d+\s*\)?)?$/iu.test(str);
  }

  function isInsideDailySection(element) {
    if (!element) return false;
    let p = element;
    for (let i = 0; i < 10 && p && (typeof document === "undefined" || p !== document.body); i++) {
      const fullText = (p.innerText || p.textContent || "").trim();
      if (/mục\s*tiêu\s*(?:trong\s*)?ngày/iu.test(fullText) && /sắp\s*diễn\s*ra/iu.test(fullText)) {
        break;
      }
      if (/^(?:mục\s*tiêu\s*(?:trong\s*)?ngày|công\s*việc\s+trong\s+ngày|kế\s*hoạch\s+trong\s+ngày)\b/iu.test(fullText)) {
        return true;
      }
      p = p.parentElement;
    }
    return false;
  }

  function isUpcomingColumnHeader(text) {
    const str = String(text || "").trim();
    if (!str || str.length > 60) return false;
    return /^(?:sắp\s*diễn\s*ra|chưa\s*bắt\s*đầu|tạm\s*dừng|chờ\s*thực\s*hiện)(?:\s*\(?\s*\d+\s*\)?)?$/iu.test(str);
  }

  function isInsideUpcomingSection(element) {
    if (!element) return false;
    let p = element;
    for (let i = 0; i < 10 && p && (typeof document === "undefined" || p !== document.body); i++) {
      const fullText = (p.innerText || p.textContent || "").trim();
      if (/mục\s*tiêu\s*(?:trong\s*)?ngày/iu.test(fullText) && /sắp\s*diễn\s*ra/iu.test(fullText)) {
        break;
      }
      if (/^(?:sắp\s*diễn\s*ra|chưa\s*bắt\s*đầu|chờ\s*thực\s*hiện)\b/iu.test(fullText)) {
        return true;
      }
      p = p.parentElement;
    }
    return false;
  }

  const DATE_HEADER_PATTERN = /^(?:thứ\s+[2-7]|thứ\s+(?:hai|ba|tư|năm|sáu|bảy)|chủ nhật|cn|ngày|hôm nay|hôm qua|today|yesterday)?[\s,:\-\(\)•|–—\.]*(?:(?:0?[1-9]|[12][0-9]|3[01])(?:[\/\-]|(?:\s*(?:tháng|thg|th)\s*))(?:0?[1-9]|1[0-2])(?:[\/\-\s]*(?:\d{4}|\d{2}))?)?[\s,:\-\(\)•|–—\.]*(?:thứ\s+[2-7]|thứ\s+(?:hai|ba|tư|năm|sáu|bảy)|chủ nhật|cn|hôm nay|hôm qua|today|yesterday)?(?:[\s,:\-\(\)•|–—\.]*(?:\(?\s*\d+\s*(?:công\s+việc|việc|task|tasks|[vV▼▽▾▿\^])?\s*\)?))?(?:[\s,:\-\(\)•|–—\.]*[vV▼▽▾▿\^])?$/iu;

  function isDateHeader(text) {
    const str = String(text || "").trim();
    if (!str || str.length >= 80) return false;
    if (/chủ động|bị động/iu.test(str)) return false;
    if (/\b\d+\s*(?:h|m)\b|\d+\s*(?:giờ|phút)/iu.test(str)) return false;
    if (isDailyColumnHeader(str)) return true;
    const hasDateSignal = str.includes("/") || str.includes("-") || /(?:hôm nay|hôm qua|today|yesterday|tháng|thg|th\d)/iu.test(str);
    return hasDateSignal && DATE_HEADER_PATTERN.test(str);
  }

  function extractDate(text, now = new Date()) {
    if (!text || typeof text !== "string") return null;
    const str = text.trim();
    if (!str || str.length > 100) return null;

    // Task rows or duration badges must not be treated as date headers
    if (/chủ động|bị động/iu.test(str)) return null;
    if (/\b\d+\s*(?:h|m)\b|\d+\s*(?:giờ|phút)/iu.test(str)) return null;

    if (isDailyColumnHeader(str)) {
      return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };
    }

    const lower = str.toLowerCase();
    if (/\b(?:hôm nay|today)\b/iu.test(lower)) {
      return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };
    }
    if (/\b(?:hôm qua|yesterday)\b/iu.test(lower)) {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return { day: y.getDate(), month: y.getMonth() + 1, year: y.getFullYear() };
    }

    // Match Vietnamese "21 Tháng 10", "21 Thg 10", "21 Th10"
    const matchThang = lower.match(/\b([0-3]?\d)\s*(?:tháng|thg|th)\s*([01]?\d)(?:\s*(?:năm|,)?\s*(\d{4}))?\b/u);
    if (matchThang) {
      const d = parseInt(matchThang[1], 10);
      const m = parseInt(matchThang[2], 10);
      const y = matchThang[3] ? parseInt(matchThang[3], 10) : null;
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return { day: d, month: m, year: y };
      }
    }

    // Match DD/MM/YYYY or DD/MM or DD-MM-YYYY or DD-MM
    const matchSlash = str.match(/\b([0-3]?\d)[\/\-]([01]?\d)(?:[\/\-](\d{4}|\d{2}))?\b/u);
    if (matchSlash) {
      const d = parseInt(matchSlash[1], 10);
      const m = parseInt(matchSlash[2], 10);
      let y = matchSlash[3] ? parseInt(matchSlash[3], 10) : null;
      if (y && y < 100) y += 2000;
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return { day: d, month: m, year: y };
      }
    }

    // Match YYYY-MM-DD
    const matchIso = str.match(/\b(\d{4})-([01]?\d)-([0-3]?\d)\b/u);
    if (matchIso) {
      const y = parseInt(matchIso[1], 10);
      const m = parseInt(matchIso[2], 10);
      const d = parseInt(matchIso[3], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return { day: d, month: m, year: y };
      }
    }

    return null;
  }

  function isDateToday(dateObj, now = new Date()) {
    if (!dateObj) return false;
    const todayDay = now.getDate();
    const todayMonth = now.getMonth() + 1;
    const todayYear = now.getFullYear();

    if (dateObj.day !== todayDay || dateObj.month !== todayMonth) return false;
    if (dateObj.year !== null && dateObj.year !== todayYear) return false;
    return true;
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    if (typeof element.checkVisibility === "function") {
      return element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }
  function findSemanticTaskContainers(documentRoot = (typeof document !== "undefined" ? document : null), now = new Date()) {
    const rootNode = documentRoot?.body || documentRoot;
    if (!rootNode) return [];
    const doc = documentRoot?.ownerDocument || documentRoot || (typeof document !== "undefined" ? document : null);
    if (!doc?.createTreeWalker) return [];
    const walker = doc.createTreeWalker(rootNode, typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4);
    const typeNodes = [];
    let lastSeenDate = null;

    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue?.trim() || "";
      if (!value) continue;

      const isDate = isDateHeader(value);
      const isType = !isDate && /\b(?:chủ\s*động|bị\s*động)\b/iu.test(value);
      if (!isDate && !isType) continue;

      const parent = walker.currentNode.parentElement;
      if (!parent || isInsideModal(parent) || !isVisible(parent)) continue;

      if (isDate) {
        const parsed = extractDate(value, now);
        if (parsed) {
          lastSeenDate = parsed;
        }
      }

      if (isType) {
        typeNodes.push({ node: parent, lastSeenDate });
      }
    }
    const containers = [];
    for (const { node: typeNode, lastSeenDate } of typeNodes) {
      let candidate = typeNode;
      let best = null;
      for (let depth = 0; depth < 8 && candidate?.parentElement; depth += 1) {
        candidate = candidate.parentElement;
        const text = getSpacedElementText(candidate).trim();
        // Dùng điều kiện rộng để tìm đúng ancestor của hàng. Duration thật sẽ được
        // parse lại bằng regex chặt, giới hạn <= 24 giờ và kiểm tra tên ở bước sau.
        const hasDuration = /\b\d+\s*(?:h|m|s)\b|\d+\s*(?:giờ|phút|giây)|\b\d{1,2}:\d{2}:\d{2}\b/iu.test(text);
        const isZeroDurationTask = /chưa hoàn thành|đang chạy|đang thực hiện|tạm dừng|bắt đầu/iu.test(text);
        const typeCount = (text.match(/chủ\s*động|bị\s*động/giu) || []).length;
        if ((hasDuration || isZeroDurationTask) && typeCount === 1 && text.length < 1500) {
          best = candidate;
          // Khối đầu tiên chứa cả loại và duration thường là vùng metadata;
          // đi thêm tối đa 4 cấp để lấy được tên task nhưng không nuốt hàng khác.
          let named = candidate;
          for (let extra = 0; extra < 4 && named.parentElement; extra += 1) {
            const parentText = getSpacedElementText(named.parentElement).trim();
            const parentTypeCount = (parentText.match(/chủ\s*động|bị\s*động/giu) || []).length;
            if (parentTypeCount !== 1 || parentText.length >= 1500) break;
            named = named.parentElement;
            best = named;
          }
          break;
        }
      }

      if (best) {
        // Date check:
        const containerText = best.innerText || best.textContent || "";
        const timestampMatch = containerText.match(/\b\d{1,2}:\d{2}\s*(?:-|lúc)\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?)\b/u);
        const taskSelfDate = timestampMatch ? extractDate(timestampMatch[1], now) : null;

        const inDailySection = isInsideDailySection(best);
        const effectiveDate = inDailySection ? { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() } : (taskSelfDate || lastSeenDate);
        const isRunning = /đang chạy|đang thực hiện|tạm dừng/iu.test(containerText);

        // If task belongs to another date (not today), exclude it!
        if (!isRunning && effectiveDate && !isDateToday(effectiveDate, now)) {
          continue;
        }

        if (!containers.some(existing => existing === best || existing.contains(best) || best.contains(existing))) {
          containers.push(best);
        }
      }
    }
    return containers;
  }
  function parseSemanticTask(element, index, now = new Date()) {
    const text = element.innerText?.trim() || "";
    const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const ignored = /^(?:chủ\s*động|bị\s*động|hoàn\s*thành|chưa\s*hoàn\s*thành|đang\s*chạy|đang\s*thực\s*hiện|tạm\s*dừng|bắt\s*đầu|dự\s*kiến|hiện\s*tại|đã\s*chạy|chờ\s*hậu\s*kiểm|hậu\s*kiểm|chờ\s*duyệt|đã\s*duyệt|mục\s*tiêu|sắp\s*diễn\s*ra|đang\s*làm)/iu;
    let name = "";
    if (typeof extractTaskName === "function") {
      const extracted = extractTaskName(element);
      if (extracted && extracted !== "Unknown Task") {
        name = extracted;
      }
    }
    if (!name) {
      const isPureMetaLine = line => ignored.test(line) ||
        /^\d+(?:[.,]\d+)*\s*(?:đ|vnd|đồng)$/iu.test(line) ||
        /^[●•|–—\s.,:]+$/iu.test(line) ||
        /^(?:●\s*)?\d+[ \t]*(?:h|m|giờ|phút)(?:[ \t]*\d+[ \t]*(?:m|phút))?$/iu.test(line.trim()) ||
        /^\d{1,2}:\d{2}/.test(line);
      const candidateLines = lines.filter(line => !isPureMetaLine(line));
      name = candidateLines.find(line => line.includes("📄") || line.includes("-") || line.length > 5) || candidateLines[0] || "";
      if (name) {
        name = name.replace(/\s*[●•|–—].*$/u, "")
                   .replace(/\s*(?:chủ\s*động|bị\s*động).*$/iu, "")
                   .replace(/\s*(?:hoàn\s*thành|chưa\s*hoàn\s*thành).*$/iu, "")
                   .trim();
      }
    }
    const meaningfulName = name.replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
    if (!meaningfulName) return null;

    const spacedText = getSpacedElementText(element).trim();
    const explicitType = normalizeType(spacedText) || normalizeType(text);
    let type = explicitType || inferTaskTypeByName(name);
    if (!type) return null;

    const durationCandidates = [...spacedText.matchAll(/\b\d+[ \t]*h(?:[ \t]*\d+[ \t]*m)?\b|\b\d+[ \t]*m\b|\d+[ \t]*giờ(?:[ \t]*\d+[ \t]*phút)?|\d+[ \t]*phút\b|\b\d+[ \t]*s\b|\b\d{1,2}:\d{2}:\d{2}\b/giu)]
      .map(match => parseDurationFlexible(match[0]).totalMinutes)
      .filter(value => value !== null && value > 0 && value <= 1440);

    const startExplicit = spacedText.match(/bắt\s*đầu[^\d]*(\d{1,2}:\d{2})(?:\s*[-–]\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?))?/iu);
    const startRange = !startExplicit ? spacedText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–]\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?)\b/u) : null;
    const startMatch = startExplicit || startRange;
    const startedAtText = startExplicit ? startExplicit[1] : (startRange ? `${String(+startRange[1]).padStart(2, "0")}:${startRange[2]}` : null);
    const startedDate = startExplicit ? startExplicit[2] : (startRange ? startRange[3] : null);
    const startedAtDate = startedAtText ? buildLocalStartedAt(startedAtText, startedDate, spacedText, now) : null;

    const statusVal = semanticStatus(element);
    const pauseExplicit = spacedText.match(/tạm\s*dừng[^\d]*(\d{1,2}:\d{2})(?:\s*[-–]\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?))?/iu);
    let cardWorkedMinutes = durationCandidates[0] ?? 0;
    let cardPausedAtDate = null;
    let cardPausedAtText = null;
    if (pauseExplicit) {
      cardPausedAtText = pauseExplicit[1];
      const pausedDate = pauseExplicit[2] || startedDate;
      cardPausedAtDate = buildLocalStartedAt(cardPausedAtText, pausedDate, spacedText, now);
      if (statusVal === "paused" && cardWorkedMinutes === 0 && startedAtDate && cardPausedAtDate && cardPausedAtDate >= startedAtDate) {
        cardWorkedMinutes = Math.max(0, Math.floor((cardPausedAtDate - startedAtDate) / 60000));
      }
    }

    const expectedMatch = spacedText.match(/dự kiến(?:\s+hoàn thành)?[^\d]*(\d{1,2}:\d{2})(?:\s*-\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?))?/iu);

    const isRunningOrPaused = statusVal === "running" || statusVal === "paused";
    const inDailySection = isInsideDailySection(element);
    if (!isRunningOrPaused && !inDailySection && startedDate) {
      const parsedStartDate = extractDate(startedDate, now);
      if (parsedStartDate && !isDateToday(parsedStartDate, now)) {
        return null;
      }
    }

    const identifierUrls = [...element.querySelectorAll("a[href]")].map(anchor => anchor.href);
    const identifierNodes = [element, ...element.querySelectorAll("[data-form-id],[data-task-id],[data-item-id]")];
    const fromUrl = key => {
      for (const rawUrl of identifierUrls) {
        try { const value = new URL(rawUrl, location.href).searchParams.get(key); if (value) return value; }
        catch { /* Ignore malformed task links. */ }
      }
      return null;
    };
    const fromData = keys => {
      for (const node of identifierNodes) {
        for (const key of keys) {
          const value = node.getAttribute?.(key);
          if (value) return value;
        }
      }
      return null;
    };
    const formId = fromData(["data-form-id"]) || fromUrl("form_id");
    const taskId = fromData(["data-task-id", "data-item-id"]) || fromUrl("task_id") || fromUrl("item_id");
    const task = {
      id: element.dataset.taskId || element.id || `semantic-task-${index}`,
      taskId,
      formId,
      name,
      type,
      typeSource: explicitType ? "visible text" : "name-inference",
      durationMinutes: cardWorkedMinutes,
      status: statusVal,
      rawStatusText: rawSemanticStatus(element),
      startedAt: startedAtDate || startedAtText,
      startedAtText: startedAtText,
      startedDate,
      lastPausedAt: cardPausedAtDate,
      lastPausedAtText: cardPausedAtText,
      workedMinutes: cardWorkedMinutes > 0 ? cardWorkedMinutes : null,
      expectedEndAt: expectedMatch?.[1] || null,
      expectedEndDate: expectedMatch?.[2] || null,
      elapsedMinutes: null
    };
    Object.defineProperty(task, "__sourceElement", { value: element, enumerable: false });
    return task;
  }

  function debugTaskRowDom(task, index) {
    const element = task?.__sourceElement;
    if (!element) return;
    const redact = value => String(value || "")
      .replace(/([?&](?:token|token_business|access_token|authorization)=)[^&\s"']+/giu, "$1[REDACTED]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, "[REDACTED_JWT]");
    const trim = (value, limit = 3000) => { const text = redact(value); return text.length > limit ? `${text.slice(0, limit)}…[truncated ${text.length - limit}]` : text; };
    const attributesOf = node => Object.fromEntries([...node.attributes].filter(attribute => !/token|authorization|cookie|secret/iu.test(attribute.name)).map(attribute => [attribute.name, trim(attribute.value, 1000)]));
    const dataAttributesOf = node => Object.fromEntries(Object.entries(attributesOf(node)).filter(([name]) => name.startsWith("data-")));
    const nodeInfo = node => node ? { tagName: node.tagName, className: trim(typeof node.className === "string" ? node.className : "", 1500), text: trim(node.textContent?.trim(), 3000), attributes: attributesOf(node) } : null;
    const buttonInfo = button => ({ text: trim(button.textContent?.trim(), 500), title: trim(button.getAttribute("title"), 500), ariaLabel: trim(button.getAttribute("aria-label"), 500), className: trim(typeof button.className === "string" ? button.className : "", 1500), disabled: Boolean(button.disabled), attributes: attributesOf(button), html: trim(button.outerHTML, 3000) });
    const svgInfo = svg => ({ className: trim(typeof svg.className?.baseVal === "string" ? svg.className.baseVal : (typeof svg.className === "string" ? svg.className : ""), 1500), attributes: attributesOf(svg), html: trim(svg.outerHTML, 3000) });
    const scope = [element, element.parentElement, element.parentElement?.parentElement, element.parentElement?.parentElement?.parentElement].filter(Boolean);
    const signalPattern = /(data-state|aria-pressed|aria-current|disabled|animate-|pulse|running|active|playing|pause|stop|timer|bg-|border-|ring-|opacity-|play)/iu;
    const runningSignals = [];
    for (const [depth, node] of scope.entries()) {
      for (const attribute of node.attributes) {
        const evidence = `${attribute.name}=${attribute.value}`;
        if (signalPattern.test(evidence)) runningSignals.push({ depth, element: node.tagName, source: "attribute", evidence: trim(evidence, 1000) });
      }
      for (const child of node.querySelectorAll("button,svg,[title],[aria-label],[data-state]")) {
        const evidence = [child.tagName, child.textContent?.trim(), child.getAttribute("title"), child.getAttribute("aria-label"), child.getAttribute("data-state"), typeof child.className === "string" ? child.className : child.className?.baseVal].filter(Boolean).join(" | ");
        if (signalPattern.test(evidence)) runningSignals.push({ depth, element: child.tagName, source: "control", evidence: trim(evidence, 1000) });
      }
    }
    const payload = {
      index,
      parsedName: task.name,
      parsedType: task.type,
      parsedMinutes: task.durationMinutes,
      parsedStatus: task.status,
      row: {
        tagName: element.tagName,
        className: trim(typeof element.className === "string" ? element.className : "", 1500),
        text: trim(element.textContent?.trim(), 3000),
        html: trim(element.outerHTML, 3000),
        attributes: attributesOf(element),
        dataAttributes: dataAttributesOf(element)
      },
      parent1: nodeInfo(element.parentElement),
      parent2: nodeInfo(element.parentElement?.parentElement),
      parent3: nodeInfo(element.parentElement?.parentElement?.parentElement),
      buttons: [...new Set(scope.flatMap(node => [...node.querySelectorAll("button")]))].slice(0, 50).map(buttonInfo),
      svgs: [...new Set(scope.flatMap(node => [...node.querySelectorAll("svg")]))].slice(0, 80).map(svgInfo),
      runningSignals: runningSignals.slice(0, 120)
    };
    const signature = JSON.stringify(payload);
    const key = `${task.type}:${task.name}`;
    if (taskRowDebugSignatures.get(key) === signature) return;
    taskRowDebugSignatures.set(key, signature);
    exportTaskRowLog("=== TASK ROW DOM DEBUG ===", payload);
  }
  function normalizeClock(text) {
    if (!text) return null;
    const colon = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (colon) return `${String(Number(colon[1])).padStart(2, "0")}:${colon[2]}`;
    const vietnamese = text.match(/\b([01]?\d|2[0-3])\s*(?:h|giờ)\b/iu);
    return vietnamese ? `${String(Number(vietnamese[1])).padStart(2, "0")}:00` : null;
  }
  function parseTimelineEvents(text, now = new Date()) {
    if (typeof text !== "string") return [];
    let boundedText = text;
    const headingMatch = boundedText.match(/tiến độ thực hiện/iu);
    if (headingMatch && headingMatch.index !== undefined) {
      boundedText = boundedText.slice(headingMatch.index + headingMatch[0].length);
    }
    const stopMatch = boundedText.match(/\b(hoạt động|bình luận|hệ thống|lịch sử|tệp đính kèm|thảo luận)\b/iu);
    if (stopMatch && stopMatch.index !== undefined) {
      boundedText = boundedText.slice(0, stopMatch.index);
    }
    const eventPattern = /(?:^|\n)[ \t]*(Bắt đầu|Tạm dừng|Tiếp tục|Hoàn thành)\s*:?[ \t]*(?:\n?[ \t]*(?:(?:\d+\s*(?:giờ|h))?[ \t]*(?:\d+\s*(?:phút|m)))?)?[ \t\r\n]*(?:lúc\s*)?(\d{1,2}:\d{2})\s*(?:-\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?))?/gimu;
    const typeMap = { "bắt đầu": "start", "tạm dừng": "pause", "tiếp tục": "resume", "hoàn thành": "complete" };
    const events = [];
    for (const match of boundedText.matchAll(eventPattern)) {
      const at = buildLocalStartedAt(match[2], match[3], boundedText, now);
      if (!at) continue;
      events.push({ type: typeMap[match[1].toLocaleLowerCase("vi")], at, atText: normalizeClock(match[2]), dateText: match[3] || null });
    }
    return api.calculator.normalizeTimeline(events).events;
  }
  function parseTimelineText(text) {
    if (typeof text !== "string" || !/tiến độ thực hiện/iu.test(text) || !/bắt đầu/iu.test(text)) return null;
    const start = text.match(/bắt đầu\s*:?\s*((?:\d+\s*(?:giờ|h))?(?:\s+)?(?:\d+\s*(?:phút|m)))?\s*(?:lúc\s*)?(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}\/\d{1,2}))?/iu);
    const expected = text.match(/dự kiến\s+hoàn thành\s*:?(?:\s*lúc\s*)?(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}\/\d{1,2}))?/iu);
    const elapsed = text.match(/hoàn thành\s*:?[ \t\r\n]*((?:\d+\s*(?:giờ|h))?(?:[ \t]+)?(?:\d+\s*(?:phút|m)))/iu);
    if (!start) return null;
    return { startedAt: start[2] || null, startedDate: start[3] || null, expectedEndAt: expected?.[1] || null, expectedEndDate: expected?.[2] || null, elapsedMinutes: elapsed ? parseDuration(elapsed[1]) : (start[1] ? parseDuration(start[1]) : null), hasStarted: Boolean(start[2]), timeline: parseTimelineEvents(text), matchedTexts: { start: start[0], expected: expected?.[0] || null, elapsed: elapsed?.[0] || start[1] || null } };
  }
  function buildLocalStartedAt(timeText, dateText, documentText, now = new Date()) {
    const time = String(timeText || "").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const date = String(dateText || "").match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (!time || !date) return null;
    const pageYear = String(documentText || "").match(new RegExp(`\\b${Number(date[1])}\\/${Number(date[2])}\\/(\\d{4})\\b`))?.[1];
    const year = Number(date[3] || pageYear || now.getFullYear());
    const result = new Date(year, Number(date[2]) - 1, Number(date[1]), Number(time[1]), Number(time[2]), 0, 0);
    return Number.isNaN(result.getTime()) ? null : result;
  }
  function findTimelineContainer(documentRoot = document) {
    const body = documentRoot.body;
    if (!body) return null;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let progressElement = null;
    while (walker.nextNode()) {
      if (/^tiến độ thực hiện\s*:?$/iu.test(walker.currentNode.nodeValue?.trim() || "") && isVisible(walker.currentNode.parentElement)) {
        progressElement = walker.currentNode.parentElement;
        break;
      }
    }
    if (!progressElement) return null;
    let candidate = progressElement;
    let best = null;
    let bestEventCount = 0;
    for (let depth = 0; depth < 14 && candidate; depth += 1, candidate = candidate.parentElement) {
      const text = candidate.innerText?.trim() || "";
      if (text.length > 3500 || /mục\s*tiêu\s*(?:trong\s*)?ngày|sắp\s*diễn\s*ra|mục\s*tiêu\s*trong\s*tuần/iu.test(text)) break;
      const progressCount = (text.match(/tiến độ thực hiện/giu) || []).length;
      const eventCount = parseTimelineEvents(text).length;
      const hasTimestamp = /lúc\s*\d{1,2}:\d{2}/iu.test(text);
      if (progressCount === 1 && eventCount >= 1 && hasTimestamp && eventCount >= bestEventCount) {
        best = candidate;
        bestEventCount = eventCount;
      }
    }
    return best;
  }
  function inspectTimelineDom(documentRoot = document) {
    const container = findTimelineContainer(documentRoot);
    if (!container) return null;
    const containerText = container.innerText?.trim() || "";
    const timeline = parseTimelineEvents(containerText);
    const elements = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const typeMap = { "bắt đầu": "start", "tạm dừng": "pause", "tiếp tục": "resume", "hoàn thành": "complete" };
    while (walker.nextNode()) {
      const rawLabel = walker.currentNode.nodeValue?.trim() || "";
      const normalizedType = typeMap[rawLabel.toLocaleLowerCase("vi")];
      if (!normalizedType) continue;
      let scope = walker.currentNode.parentElement;
      let rawTime = "";
      for (let depth = 0; depth < 6 && scope && container.contains(scope); depth += 1, scope = scope.parentElement) {
        const scopeText = scope.innerText?.trim() || "";
        const match = scopeText.match(/lúc\s*\d{1,2}:\d{2}\s*(?:-\s*\d{1,2}\/\d{1,2}(?:\/\d{4})?)?/iu);
        if (match && scopeText.length < 800) { rawTime = match[0]; break; }
      }
      const parsed = rawTime.match(/(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?))?/u);
      elements.push({ index: elements.length, rawLabel, normalizedType, rawTime: rawTime || null, parsedTime: parsed?.[1] || null, parsedDate: parsed?.[2] || null, tagName: walker.currentNode.parentElement?.tagName || null, className: typeof walker.currentNode.parentElement?.className === "string" ? walker.currentNode.parentElement.className : "" });
    }
    return { marker: "=== TIMELINE RAW DEBUG ===", matchedContainer: `${container.tagName.toLowerCase()}${container.id ? `#${container.id}` : ""}`, containerText, elements, timeline };
  }
  function findRunningDetails(documentRoot = document) {
    const bodyText = documentRoot.body?.innerText || "";
    if (!/tiến độ thực hiện/iu.test(bodyText) || !/bắt đầu/iu.test(bodyText)) return null;
    const container = findTimelineContainer(documentRoot);
    if (!container) return null;
    const text = container.innerText || bodyText;
    const timeline = parseTimelineText(text);
    if (!timeline) return null;
    const classPart = container.className && typeof container.className === "string" ? `.${container.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
    const pauseActionVisible = [...documentRoot.querySelectorAll("*")].some(element => element.children.length === 0 && element.textContent?.trim().toLocaleLowerCase("vi") === "tạm dừng" && isVisible(element));
    const resumeActionVisible = [...documentRoot.querySelectorAll("*")].some(element => element.children.length === 0 && element.textContent?.trim().toLocaleLowerCase("vi") === "tiếp tục" && isVisible(element));
    const startedAtDate = buildLocalStartedAt(timeline.startedAt, timeline.startedDate, bodyText);
    return { ...timeline, startedAtDate, hasPauseAction: pauseActionVisible, hasResumeAction: resumeActionVisible, detailText: text, documentText: bodyText, matchedContainer: `${container.tagName.toLowerCase()}${container.id ? `#${container.id}` : ""}${classPart}` };
  }
  function countOccurrences(text, needle) {
    if (!text || !needle) return 0;
    const normalizedText = text.toLocaleLowerCase("vi");
    const normalizedNeedle = needle.toLocaleLowerCase("vi").replace(/^📄\s*/u, "").trim();
    let count = 0, offset = 0;
    while (normalizedNeedle && (offset = normalizedText.indexOf(normalizedNeedle, offset)) !== -1) { count += 1; offset += normalizedNeedle.length; }
    return count;
  }
  function stableTaskId(task) {
    const numericId = /^\d{6,}$/.test(String(task.id || "")) ? task.id : "";
    const explicit = String(task.taskId || task.formId || numericId || "").trim();
    if (explicit) return explicit;
    return task.name.match(/(?:^|\s|-)(\d{6,})\s*$/u)?.[1] || null;
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
  function matchRunningTask(tasks, details) {
    const eligible = tasks.filter(item => item.status !== "completed");
    const detailText = String(details.detailText || "");
    const detailFormId = String(details.formId || "").trim();
    const detailName = normalizeTaskName(details.openedTaskName);

    if (detailName) {
      const byExactName = eligible.filter(item => normalizeTaskName(item.name) === detailName);
      if (byExactName.length === 1) return { task: byExactName[0], matchedBy: "exactName", confidence: "high" };
    }

    if (detailFormId) {
      const byFormId = eligible.filter(item => String(item.formId || "") === detailFormId);
      if (byFormId.length === 1) return { task: byFormId[0], matchedBy: "formId", confidence: "high" };
    }

    if (detailText.length <= 2000 && !/mục\s*tiêu\s*(?:trong\s*)?ngày|sắp\s*diễn\s*ra/iu.test(detailText)) {
      const byTaskId = eligible.filter(item => {
        const id = stableTaskId(item);
        return id && detailText.includes(id);
      });
      if (byTaskId.length === 1) return { task: byTaskId[0], matchedBy: "taskId", confidence: "high" };
    }

    return null;
  }
  function mergeRunningDetails(tasks, details, nowParam = null) {
    if (!details) return tasks;
    const match = matchRunningTask(tasks, details);
    if (!match) return tasks;
    const { task, matchedBy, confidence } = match;
    const now = nowParam || details?.now || (details.startedAtDate ? new Date(details.startedAtDate.getTime() + (Number(details.elapsedMinutes) || 0) * 60000) : new Date());
    const timeline = details.timeline?.length ? details.timeline : (details.startedAtDate ? [{ type: "start", at: details.startedAtDate, atText: details.startedAt, dateText: details.startedDate }] : []);
    const normalizedTimeline = api.calculator.normalizeTimeline(timeline);
    const lastEvent = normalizedTimeline.events.at(-1) || null;
    let detectedStatus = lastEvent?.type === "pause" ? "paused"
      : (lastEvent?.type === "complete" ? "completed"
        : ((lastEvent?.type === "start" || lastEvent?.type === "resume") ? "running" : task.status));
    if (detectedStatus === "running" && (details.hasResumeAction || task.inUpcomingSection)) {
      detectedStatus = "paused";
    }
    const hasRunningEvidence = detectedStatus === "running" || detectedStatus === "paused";
    const calculatedElapsedMinutes = normalizedTimeline.events.length
      ? api.calculator.calculateWorkedMinutes(normalizedTimeline.events, now)
      : null;
    const displayedElapsedMinutes = Number.isFinite(details.elapsedMinutes) ? details.elapsedMinutes : null;
    const effectiveRunningMinutes = detectedStatus === "running"
      ? Math.max(displayedElapsedMinutes ?? 0, calculatedElapsedMinutes ?? 0)
      : (calculatedElapsedMinutes ?? displayedElapsedMinutes ?? 0);
    const reason = hasRunningEvidence
      ? `Timeline hợp lệ, event cuối là ${lastEvent.type}.`
      : "Thiếu timestamp Bắt đầu hợp lệ hoặc không thấy action Tạm dừng; giữ nguyên trạng thái card.";
    return tasks.map(item => item === task ? {
      ...item,
      inUpcomingSection: false,
      status: detectedStatus,
      startedAt: details.startedAtDate,
      startedAtText: details.startedAt,
      startedDate: details.startedDate,
      expectedEndAt: details.expectedEndAt,
      expectedEndDate: details.expectedEndDate,
      elapsedMinutes: details.elapsedMinutes,
      displayedElapsedMinutes,
      calculatedElapsedMinutes,
      effectiveRunningMinutes,
      timeline: normalizedTimeline.events,
      workedMinutes: calculatedElapsedMinutes ?? displayedElapsedMinutes ?? item.workedMinutes ?? 0,
      runtimeStatus: detectedStatus,
      lastPausedAt: [...normalizedTimeline.events].reverse().find(event => event.type === "pause")?.at || null,
      lastPausedAtText: [...normalizedTimeline.events].reverse().find(event => event.type === "pause")?.atText || null,
      lastResumedAt: [...normalizedTimeline.events].reverse().find(event => event.type === "resume")?.at || null,
      pauseCount: normalizedTimeline.events.filter(event => event.type === "pause").length,
      detailDiagnostics: { rawStatusText: item.rawStatusText, timelineText: details.detailText, detectedStatus, reason, matchedBy, confidence, hasPauseAction: details.hasPauseAction, invalidTimelineSequences: normalizedTimeline.warnings, matchedContainer: details.matchedContainer, matchedTexts: details.matchedTexts }
    } : item);
  }

  const CUSTOMER_DIAGNOSTIC = false;
  let customerDiagnosticRan = false;

  function isInsideModal(element) {
    if (!element || typeof element.closest !== "function") return false;
    return Boolean(element.closest('[role="dialog"], [role="presentation"], dialog, .modal, .drawer, [class*="modal"], [class*="drawer"], [id*="modal"], [id*="drawer"]'));
  }

  function debugUnknownTimeboxingDOM(documentRoot, durationTexts) {
    if (!CUSTOMER_DIAGNOSTIC) return;
    console.log("=== CUSTOMER DOM DIAGNOSTIC ===");
    const walker = document.createTreeWalker(documentRoot.body || documentRoot, NodeFilter.SHOW_TEXT);
    const anchors = [];
    while (walker.nextNode()) {
      const val = walker.currentNode.nodeValue.trim();
      if (val && parseDuration(val) !== null && isVisible(walker.currentNode.parentElement) && !isInsideModal(walker.currentNode.parentElement)) {
        anchors.push({ val, node: walker.currentNode.parentElement });
      }
    }
    
    anchors.slice(0, Math.min(anchors.length, 5)).forEach((anchor, index) => {
      console.log("=== CUSTOMER DURATION ANCHOR ===", { index, duration: anchor.val, tagName: anchor.node.tagName, className: anchor.node.className, text: anchor.node.innerText?.slice(0, 100), parentText1: anchor.node.parentElement?.innerText?.slice(0, 100), parentText2: anchor.node.parentElement?.parentElement?.innerText?.slice(0, 100) });
      let p = anchor.node;
      for (let i = 0; i < 6 && p; i++) {
        console.log(`PARENT LEVEL ${i}`, { tag: p.tagName, className: typeof p.className === "string" ? p.className : "", textSnippet: (p.innerText || "").slice(0, 600), childCount: p.children.length });
        p = p.parentElement;
      }
      const candidates = [];
      let parent = anchor.node;
      for (let i = 0; i < 6 && parent; i++) {
          const lines = (parent.innerText || parent.textContent || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
          candidates.push(...lines.filter(isTaskNameCandidate));
          parent = parent.parentElement;
      }
      console.log("=== CUSTOMER TASK NAME CANDIDATES ===", { duration: anchor.val, candidates: [...new Set(candidates)] });
    });

    const labels = [];
    const walker2 = document.createTreeWalker(documentRoot.body || documentRoot, NodeFilter.SHOW_TEXT);
    while (walker2.nextNode()) {
        const text = walker2.currentNode.nodeValue.trim().toLowerCase();
        if (text.includes("chủ động") || text.includes("bị động") || text.includes("chu dong") || text.includes("bi dong") || text.includes("active") || text.includes("passive")) {
            labels.push({ rawText: walker2.currentNode.nodeValue.trim(), normalizedText: text, tag: walker2.currentNode.parentElement.tagName, className: walker2.currentNode.parentElement.className, parentText: walker2.currentNode.parentElement.parentElement?.innerText?.slice(0,100) });
        }
    }
    console.log("=== CUSTOMER TYPE LABELS ===", labels);
  }

  function isTaskNameCandidate(text) {
    const t = (text || "").trim().toLowerCase();
    if (/^(?:chủ\s*động|bị\s*động|hoàn\s*thành|chưa\s*hoàn\s*thành|đang\s*chạy|đang\s*thực\s*hiện|tạm\s*dừng|bắt\s*đầu|dự\s*kiến|hiện\s*tại|đã\s*chạy|chờ\s*hậu\s*kiểm|hậu\s*kiểm|chờ\s*duyệt|đã\s*duyệt)$/iu.test(t)) return false;
    if (/^(?:mục\s*tiêu\s*(?:trong\s*)?ngày|công\s*việc\s+trong\s+ngày|sắp\s*diễn\s*ra|đang\s*làm)$/iu.test(t)) return false;
    if (/^\d+(?:[.,]\d+)*\s*(?:đ|vnd|đồng)$/iu.test(t)) return false;
    if (/^[●•|–—\s.,:]+$/iu.test(t)) return false;
    if (parseDuration(t) !== null) return false;
    if (/^\d{1,2}:\d{2}/.test(t)) return false;
    if (/^(lưu|hủy|xóa|sửa|thêm|đóng|xác nhận|tìm kiếm|chi tiết|chỉnh sửa)$/i.test(t)) return false;
    if (t.replace(/[^\p{L}\p{N}]/gu, "").length < 3) return false;
    return true;
  }

  const taskTypeIdentityCache = new Map();

  function cacheTaskType(taskName, type) {
     const normName = String(taskName || "").toLowerCase().replace(/\s+/g, " ").trim();
     if (normName && (type === "active" || type === "passive")) {
         taskTypeIdentityCache.set(normName, type);
     }
  }

  function normalizeVietnameseText(str) {
      if (!str) return "";
      return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
  }

  function inferTaskTypeByName(taskName) {
    const norm = normalizeVietnameseText(taskName || "");
    if (!norm) return null;
    if (/(?:ke hoach|check|tin nhan|rep|theo doi|bao cao|test|meeting|hop|nghiem thu|daily)/iu.test(norm)) return "active";
    if (/(?:ho tro|khach hang|ticket|bbh|bot ban hang|inbox|cskh)/iu.test(norm)) return "passive";
    return null;
  }

  function detectTaskTypeDetails(container, logDebug = false, taskName = "") {
    let detected = "unknown";
    let detectedBy = "none";
    let matchedText = "";

    const rawText = container.innerText || container.textContent || "";
    const lower = normalizeVietnameseText(rawText);

    // 1. Direct visible badge text or attributes on the task card itself
    if (lower.includes("chu dong")) { detected = "active"; detectedBy = "visible text"; matchedText = "chu dong"; }
    else if (lower.includes("bi dong")) { detected = "passive"; detectedBy = "visible text"; matchedText = "bi dong"; }
    else {
       const descendants = [];
       const classNames = [];
       const titleAttrs = [];
       const ariaLabels = [];
       const dataAttrs = [];

       for (const el of container.querySelectorAll("*")) {
          const elText = el.innerText || el.textContent || "";
          if (elText.trim() && el.children.length === 0) {
             descendants.push({ tag: el.tagName, text: elText.trim() });
          }

          const title = el.getAttribute("title") || "";
          const aria = el.getAttribute("aria-label") || el.getAttribute("aria-description") || "";
          const dt = Object.entries(el.dataset || {}).map(([k,v]) => k+"="+v).join(" ");
          const cls = typeof el.className === "string" ? el.className : "";
          
          if (title) titleAttrs.push(title);
          if (aria) ariaLabels.push(aria);
          if (dt) dataAttrs.push(dt);
          if (cls) classNames.push(cls);

          const normTitle = normalizeVietnameseText(title);
          const normAria = normalizeVietnameseText(aria);
          const normDt = normalizeVietnameseText(dt);
          
          if (normTitle.includes("chu dong") || normAria.includes("chu dong") || normDt.includes("chu dong")) { 
              detected = "active"; detectedBy = "attributes"; matchedText = "chu dong"; break; 
          }
          if (normTitle.includes("bi dong") || normAria.includes("bi dong") || normDt.includes("bi dong")) { 
              detected = "passive"; detectedBy = "attributes"; matchedText = "bi dong"; break; 
          }
          
          if (cls.includes("type-active") || cls.includes("is-active-task") || cls.includes("badge-active")) { 
              detected = "active"; detectedBy = "semantic class"; matchedText = "active class"; break; 
          }
          if (cls.includes("type-passive") || cls.includes("is-passive-task") || cls.includes("badge-passive")) { 
              detected = "passive"; detectedBy = "semantic class"; matchedText = "passive class"; break; 
          }
       }

       if (logDebug || CUSTOMER_DIAGNOSTIC) {
           console.log("=== TASK TYPE DEBUG ===", {
              taskName,
              rowText: rawText.slice(0, 200),
              rowHTMLSnippet: (container.innerHTML || "").slice(0, 500),
              classNames: [...new Set(classNames)].join(" "),
              descendantsWithText: descendants.slice(0, 20),
              ariaLabels,
              titleAttributes: titleAttrs,
              dataAttributes: dataAttrs
           });
       }
    }

    // 2. Identity Cache (from verified detail drawer)
    const normName = taskName.toLowerCase().replace(/\s+/g, " ").trim();
    if (detected === "unknown" && normName && taskTypeIdentityCache.has(normName)) {
        detected = taskTypeIdentityCache.get(normName);
        detectedBy = "identity cache";
        matchedText = "detail cache";
    }

    // 3. Task Name Inference
    if (detected === "unknown") {
       const inferred = inferTaskTypeByName(taskName);
       if (inferred) {
          detected = inferred;
          detectedBy = "name-inference";
          matchedText = "inferred";
       }
    }

    return { type: detected, source: detectedBy, matchedText };
  }

  function detectTaskType(container, logDebug = false, taskName = "") {
      return detectTaskTypeDetails(container, logDebug, taskName).type;
  }

  function detectTaskStatus(container) {
    if (!container) return "unknown";
    const status = semanticStatus(container);
    if (status !== "unknown") return status;
    const text = (container.innerText || container.textContent || "").trim();
    const cleanText = text.replace(/dự\s*kiến(?:\s+hoàn\s*thành)?/giu, "").toLowerCase();
    if (cleanText.includes("chưa hoàn thành")) return "not_completed";
    if (cleanText.includes("tạm dừng")) return "paused";
    if (cleanText.includes("đang thực hiện") || cleanText.includes("đang chạy")) return "running";
    if (cleanText.includes("hoàn thành")) return "completed";
    if (cleanText.includes("bắt đầu")) return "running";
    return "unknown";
  }

  function extractTaskName(container, durationText = null, logDebug = false) {
    const doc = container?.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc?.createTreeWalker) return "Unknown Task";
    const walker = doc.createTreeWalker(container, typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4);
    const textNodes = [];
    while (walker.nextNode()) {
        const val = walker.currentNode.nodeValue.trim();
        if (val) textNodes.push(walker.currentNode);
    }
    
    let bestName = "Unknown Task";
    let bestScore = -999;
    const allCandidates = [];

    for (const node of textNodes) {
        const text = node.nodeValue.trim();
        if (!isTaskNameCandidate(text)) continue;
        
        let score = 0;
        if (text.includes("📄")) score += 4;
        if (text.length > 12) score += 3;
        
        let p = node.parentElement;
        let isAvatar = false;
        let isHeading = false;
        while(p && p !== container) {
            const cls = (typeof p.className === "string" ? p.className : "").toLowerCase();
            const tit = (p.getAttribute("title") || "").toLowerCase();
            if (/avatar|user|assignee|owner|member|employee/i.test(cls) || /avatar|user|assignee|owner|member|employee/i.test(tit)) isAvatar = true;
            if (/heading|title|name/i.test(cls) || /^h[1-6]$/i.test(p.tagName)) isHeading = true;
            p = p.parentElement;
        }

        if (isHeading) score += 2;
        if (isAvatar) score -= 8;

        allCandidates.push({ text, score });
        if (score > bestScore) {
            bestScore = score;
            bestName = text;
        }
    }

    if (logDebug && CUSTOMER_DIAGNOSTIC) {
        console.log("=== TASK NAME DEBUG ===", {
           duration: durationText,
           allTextCandidates: allCandidates,
           selectedName: bestName
        });
    }
    return bestName;
  }

  function parseDurationFlexible(text) {
      if (!text) return { totalSeconds: 0, totalMinutes: 0 };
      const t = text.toLowerCase();
      
      const clock3Match = t.match(/\b([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)\b/);
      if (clock3Match) {
        const h = parseInt(clock3Match[1], 10);
        const m = parseInt(clock3Match[2], 10);
        const s = parseInt(clock3Match[3], 10);
        return { totalSeconds: h * 3600 + m * 60 + s, totalMinutes: h * 60 + m };
      }

      const secMatch = t.match(/(\d+)\s*s\b/);
      let seconds = secMatch ? parseInt(secMatch[1], 10) : 0;
      
      const hMatch = t.match(/(\d+)\s*(?:h|giờ)/);
      const mMatch = t.match(/(\d+)\s*(?:m|phút)/);
      
      let minutes = 0;
      if (hMatch) minutes += parseInt(hMatch[1], 10) * 60;
      if (mMatch) minutes += parseInt(mMatch[1], 10);

      // fallback
      if (!secMatch && !hMatch && !mMatch) {
          const fallback = parseDuration(text);
          if (fallback !== null) minutes = fallback;
      }
      
      const totalSeconds = minutes * 60 + seconds;
      const totalMinutes = Math.floor(totalSeconds / 60);
      
      return { totalSeconds, totalMinutes };
  }

  function findTaskContainerFromStatus(statusElement) {
    let best = null;
    let maxScore = -999;
    let candidate = statusElement;
    for (let i = 0; i < 8 && candidate; i++) {
        const text = getSpacedElementText(candidate);
        if (text.length > 2000) break;
        
        const typeCount = (text.match(/chủ\s*động|bị\s*động/giu) || []).length;
        // Nếu candidate đã nuốt sang task khác (chứa nhiều hơn 1 type badge), ngừng leo lên
        if (typeCount > 1) break;

        let score = 0;
        const taskName = extractTaskName(candidate);
        if (taskName !== "Unknown Task") score += 4;
        
        if (typeCount === 1) score += 5;
        
        const status = detectTaskStatus(candidate);
        if (status !== "unknown") score += 2;

        if (/\b\d+[ \t]*h(?:[ \t]*\d+[ \t]*m)?|\b\d+[ \t]*m\b|\d+[ \t]*(?:giờ|phút|s)\b/i.test(text)) score += 1;
        if (/\b\d{1,2}:\d{2}\b|\b\d{1,2}\/\d{1,2}\b/i.test(text)) score += 2;

        const lowerText = text.toLowerCase();
        if (lowerText.includes("nguyễn") || lowerText.includes("trần") || lowerText.includes("lê")) score += 1;

        if (text.length > 800) score -= 3;
        
        if (score > maxScore) {
            maxScore = score;
            best = candidate;
            // Nếu đã tìm thấy task card hoàn chỉnh (có tên, type badge, status, duration và chỉ 1 type),
            // và parent của nó chứa nhiều type (tức parent là list/column), thì dừng ngay!
            if (score >= 10 && typeCount === 1) {
              const pText = getSpacedElementText(candidate.parentElement);
              const pTypeCount = (pText.match(/chủ\s*động|bị\s*động/giu) || []).length;
              if (pTypeCount > 1) {
                break;
              }
            }
        }
        candidate = candidate.parentElement;
    }
    return maxScore >= 4 ? best : null;
  }

  function adaptiveRowParser(documentRoot = (typeof document !== "undefined" ? document : null), now = new Date()) {
    const body = documentRoot?.body || documentRoot;
    if (!body) return [];
    const doc = documentRoot?.ownerDocument || documentRoot || (typeof document !== "undefined" ? document : null);
    if (!doc?.createTreeWalker) return [];
    const walker = doc.createTreeWalker(body, typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4);
    const statusNodes = [];
    
    let lastSeenDate = null;
    let detectedDateHeader = null;
    let excludedOutsideSection = 0;

    while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue.trim();
        if (!text) continue;
        
        if (isDateHeader(text)) {
            const parsed = extractDate(text, now);
            if (parsed) {
                lastSeenDate = parsed;
                if (isDateToday(parsed, now) && !detectedDateHeader) {
                    detectedDateHeader = text;
                }
            }
        }

        const val = text.toLowerCase();
        if (/(hoàn thành|chưa hoàn thành|đang thực hiện|đang chạy|tạm dừng)/i.test(val) && !val.includes("dự kiến")) {
            const parentEl = walker.currentNode.parentElement;
            if (isVisible(parentEl) && !isInsideModal(parentEl)) {
                
                let taskSelfDate = null;
                let p = parentEl;
                for(let i=0; i<4 && p; i++) {
                    const t = p.textContent || "";
                    const selfDateMatch = t.match(/\b\d{1,2}:\d{2}\s*(?:-|lúc)\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?)\b/u);
                    if (selfDateMatch) {
                        taskSelfDate = extractDate(selfDateMatch[1], now);
                        break;
                    }
                    p = p.parentElement;
                }
                
                const inDailySection = isInsideDailySection(parentEl);
                const effectiveDate = inDailySection ? { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() } : (taskSelfDate || lastSeenDate);
                const isRunning = /đang chạy|đang thực hiện/iu.test(val);
                
                if (!isRunning && effectiveDate && !isDateToday(effectiveDate, now)) {
                    excludedOutsideSection++;
                    continue;
                }
                
                statusNodes.push({ node: parentEl, effectiveDate });
            }
        }
    }
    
    const tasks = [];
    const containers = new Set();
    const parsedDurations = [];
    
    for (const { node, effectiveDate } of statusNodes) {
        const container = findTaskContainerFromStatus(node);
        if (container && !containers.has(container)) {
            containers.add(container);
            
            const spacedContainerText = getSpacedElementText(container);
            const durationMatches = [...spacedContainerText.matchAll(/\b\d+[ \t]*h(?:[ \t]*\d+[ \t]*m\b)?\b|\b\d+[ \t]*m\b|\d+[ \t]*(?:giờ|phút)\b|\b\d+\s*s\b/giu)]
              .map(m => ({ raw: m[0], dur: parseDurationFlexible(m[0]) }))
              .filter(item => item.dur.totalMinutes > 0 && item.dur.totalMinutes <= 1440);
            
            const rawDur = durationMatches[0]?.raw || "";
            const parsedDur = durationMatches[0]?.dur || { totalSeconds: 0, totalMinutes: 0 };
            if (rawDur) parsedDurations.push(rawDur);
            
            const name = extractTaskName(container, rawDur, true);

            const typeInfo = detectTaskTypeDetails(container, true, name);

            const containerText = container.innerText || container.textContent || "";
            const containerDaily = isInsideDailySection(container);
            const taskEffectiveDate = containerDaily ? { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() } : effectiveDate;

            const startExplicit = containerText.match(/bắt\s*đầu[^\d]*(\d{1,2}:\d{2})(?:\s*[-–]\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?))?/iu);
            const startRange = !startExplicit ? containerText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–]\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?)\b/u) : null;
            const startMatch = startExplicit || startRange;
            const startedAtText = startExplicit ? startExplicit[1] : (startRange ? `${String(+startRange[1]).padStart(2, "0")}:${startRange[2]}` : null);
            const startedDateText = startExplicit ? (startExplicit[2] || (taskEffectiveDate ? `${taskEffectiveDate.day}/${taskEffectiveDate.month}` : null)) : (startRange ? (startRange[3] || (taskEffectiveDate ? `${taskEffectiveDate.day}/${taskEffectiveDate.month}` : null)) : null);
            const startedAtDate = startedAtText ? buildLocalStartedAt(startedAtText, startedDateText, documentRoot.body?.innerText || "", now) : null;

            const expectedMatch = containerText.match(/(?:dự\s*kiến|kết\s*thúc)[^\d]*(\d{1,2}:\d{2})(?:\s*[-–]\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{4})?))?/iu);

            const task = {
                id: `adaptive-${tasks.length}`,
                name: name,
                type: typeInfo.type,
                typeSource: typeInfo.source,
                matchedText: typeInfo.matchedText,
                durationMinutes: parsedDur.totalMinutes,
                durationSeconds: parsedDur.totalSeconds,
                status: detectTaskStatus(container),
                startedAt: startedAtDate,
                startedAtText: startedAtText,
                startedDate: startedDateText,
                expectedEndAt: expectedMatch ? expectedMatch[1] : null,
                expectedEndDate: expectedMatch ? (expectedMatch[2] || null) : null,
                elapsedMinutes: null
            };
            Object.defineProperty(task, "__sourceElement", { value: container, enumerable: false });
            tasks.push(task);
        }
    }
    
    // if (CUSTOMER_DIAGNOSTIC) {  // Commented out to ensure logs are visible
        console.log("=== CURRENT DAY PARSER ===", {
            requestedDate: `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`,
            detectedDateHeader,
            sectionFound: !!detectedDateHeader,
            rawCandidateRows: statusNodes.length,
            deduplicatedRows: containers.size,
            parsedTasks: tasks.length,
            excludedOutsideSection,
            duplicateDurations: parsedDurations
        });
        
        const activeTasks = tasks.filter(t => t.type === "active").length;
        const passiveTasks = tasks.filter(t => t.type === "passive").length;
        const unknownTasks = tasks.filter(t => t.type === "unknown").length;
        console.log("=== TYPE DETECTION RESULT ===", {
            totalTasks: tasks.length,
            active: activeTasks,
            passive: passiveTasks,
            unknown: unknownTasks,
            taskDetails: tasks.map(t => ({ name: t.name, type: t.type, typeSource: t.typeSource, matchedText: t.matchedText }))
        });
    // }
    return tasks;
  }

  function parseTasks(documentRoot = (typeof document !== "undefined" ? document : null), now = new Date()) {
    if (!documentRoot) return [];
    let tasks = SELECTORS.taskItem
      ? [...documentRoot.querySelectorAll(SELECTORS.taskItem)].map((el, i) => parseTask(el, i)).filter(Boolean)
      : findSemanticTaskContainers(documentRoot, now).map((el, i) => parseSemanticTask(el, i, now)).filter(Boolean);
      
    try {
      const adaptive = adaptiveRowParser(documentRoot, now);
      if (adaptive.length > 0) {
        tasks = [...tasks, ...adaptive];
      }
    } catch (error) {
      console.error("[parser] adaptive parser error", error);
    }

    // Double check: exclude any task whose startedDate is explicitly not today
    tasks = tasks.filter(task => {
      if (task.status === "running" || task.status === "paused") return true;
      if (task.__sourceElement && isInsideDailySection(task.__sourceElement)) return true;
      if (task.startedDate) {
        const d = extractDate(task.startedDate, now);
        if (d && !isDateToday(d, now)) return false;
      }
      return true;
    });

    const uniqueTasks = [];
    const seenElements = new Set();
    const seenIds = new Set();
    const uncompletedByName = new Map();

    const mergeTaskIntoExisting = (existing, incoming) => {
      if (incoming.inUpcomingSection) existing.inUpcomingSection = true;
      if (incoming.status === "paused") existing.status = "paused";
      if (!existing.startedAtText && incoming.startedAtText) {
        existing.startedAt = incoming.startedAt;
        existing.startedAtText = incoming.startedAtText;
        existing.startedDate = incoming.startedDate;
      }
      if ((incoming.durationMinutes || 0) > (existing.durationMinutes || 0)) {
        existing.durationMinutes = incoming.durationMinutes;
      }
      if (existing.typeSource !== "visible text" && incoming.typeSource === "visible text" && (incoming.type === "active" || incoming.type === "passive")) {
        existing.type = incoming.type;
        existing.typeSource = incoming.typeSource;
      }
    };

    for (const task of tasks) {
      if (task.__sourceElement) {
        if (seenElements.has(task.__sourceElement)) continue;
        seenElements.add(task.__sourceElement);
        if (isInsideUpcomingSection(task.__sourceElement)) {
          task.inUpcomingSection = true;
          if (task.status === "running") task.status = "not_completed";
        }
      }

      const normName = normalizeTaskName(task.name);
      const dur = task.durationMinutes || 0;
      const isUncompletedZero = dur === 0 && (task.status === "not_completed" || task.status === "paused" || task.inUpcomingSection);

      if (isUncompletedZero && normName) {
        const existingUncompleted = uncompletedByName.get(normName);
        if (existingUncompleted) {
          mergeTaskIntoExisting(existingUncompleted, task);
          continue;
        }
        uncompletedByName.set(normName, task);
      }

      // Check if an existing task in uniqueTasks is the same DOM card or same task (ignoring type differences between semantic and adaptive parser)
      const existingSameTask = uniqueTasks.find(existing => {
        const existingNormName = normalizeTaskName(existing.name);
        if (!normName || existingNormName !== normName) return false;
        if (existing.__sourceElement && task.__sourceElement && (existing.__sourceElement === task.__sourceElement || existing.__sourceElement.contains(task.__sourceElement) || task.__sourceElement.contains(existing.__sourceElement))) {
          return true;
        }
        const existingDur = existing.durationMinutes || 0;
        if (existingDur === dur) {
          if (!existing.startedAtText || !task.startedAtText || existing.startedAtText === task.startedAtText) {
            return true;
          }
        }
        return false;
      });
      if (existingSameTask) {
        mergeTaskIntoExisting(existingSameTask, task);
        continue;
      }

      const explicitId = task.taskId || task.formId;
      if (explicitId) {
        const idKey = String(explicitId);
        if (seenIds.has(idKey)) continue;
        seenIds.add(idKey);
        uniqueTasks.push(task);
        continue;
      }

      uniqueTasks.push(task);
    }

    return uniqueTasks;
  }
  function diagnose(documentRoot = (typeof document !== "undefined" ? document : null), tasks = [], now = new Date()) {
    if (!documentRoot) return {};
    const text = documentRoot.body?.textContent || "";
    const durationTexts = tasks.length > 0 
        ? tasks.map(t => {
            const el = t.__sourceElement;
            const match = (el?.textContent || "").match(/\b\d+[ \t]*h(?:[ \t]*\d+[ \t]*m)?|\b\d+[ \t]*m\b|\d+[ \t]*(?:giờ|phút)\b|\d+\s*s\b/i);
            return match ? match[0] : "";
        }).filter(Boolean)
        : (text.match(/\b\d+[ \t]*h(?:[ \t]*\d+[ \t]*m)?|\b\d+[ \t]*m\b|\d+[ \t]*(?:giờ|phút)\b|\d+\s*s\b/giu) || []).slice(0, 20);
        
    const dateSnippets = [...new Set(
      (text.match(/[^\n\r]{0,30}(?:hôm\s*(?:nay|qua)|today|yesterday|\b[0-3]?\d[\/\-][01]?\d|\b[0-3]?\d\s*(?:tháng|thg)\s*[01]?\d)[^\n\r]{0,30}/giu) || [])
      .map(s => s.trim())
      .filter(Boolean)
    )].slice(0, 15);

    return { title: documentRoot.title, bodyTextLength: text.length, activeLabels: (text.match(/chủ động/giu) || []).length, passiveLabels: (text.match(/bị động/giu) || []).length, durationTexts, semanticContainers: tasks.length, configuredSelector: SELECTORS.taskItem || null, dateSnippets };
  }
  function inspectTaskDetailDom(documentRoot = document, tasks = []) {
    const bodyText = documentRoot.body?.innerText || "";
    const detailOpen = bodyText.length > 5000 || /tiến độ thực hiện/iu.test(bodyText) || /[?&]form_id=/iu.test(location.href);
    if (!detailOpen) return null;
    const textElements = [];
    const walker = document.createTreeWalker(documentRoot.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue?.trim() || "";
      if (text) textElements.push({ text, element: walker.currentNode.parentElement });
    }
    const findLabel = pattern => textElements.find(item => pattern.test(item.text)) || null;
    const progress = findLabel(/tiến độ thực hiện/iu);
    const start = findLabel(/^bắt đầu\s*:?$/iu);
    const expected = findLabel(/^dự kiến hoàn thành\s*:?$/iu);
    const completed = findLabel(/^hoàn thành\s*:?$/iu);
    let container = progress?.element || start?.element || null;
    if (container) {
      while (container.parentElement) {
        const text = container.innerText || "";
        if (/tiến độ thực hiện/iu.test(text) && /bắt đầu/iu.test(text) && /dự kiến hoàn thành/iu.test(text)) break;
        container = container.parentElement;
      }
    }
    const compact = (value, limit = 6000) => {
      const text = String(value || "").trim();
      return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text;
    };
    const elementInfo = item => item?.element ? {
      text: item.text,
      tagName: item.element.tagName,
      className: typeof item.element.className === "string" ? item.element.className : "",
      parentText: compact(item.element.parentElement?.innerText, 2500),
      grandParentText: compact(item.element.parentElement?.parentElement?.innerText, 4000)
    } : null;
    const lines = bodyText.split(/\n/);
    const relevantIndexes = new Set();
    lines.forEach((line, index) => {
      if (/(tiến độ thực hiện|bắt đầu|dự kiến hoàn thành|hoàn thành|giờ|phút|lúc)/iu.test(line)) {
        for (let offset = -2; offset <= 2; offset += 1) if (index + offset >= 0 && index + offset < lines.length) relevantIndexes.add(index + offset);
      }
    });
    const containerText = compact(container?.innerText, 12000);
    const taskMatches = tasks.filter(task => {
      const cleanName = task.name.replace(/^📄\s*/u, "").trim();
      return cleanName && (containerText.includes(cleanName) || bodyText.split(cleanName).length > 2);
    }).map(task => ({ id: task.id, name: task.name, type: task.type, status: task.status }));
    const formId = new URL(location.href).searchParams.get("form_id");
    return {
      marker: "=== TASK DETAIL RAW DEBUG ===",
      frameUrl: `${location.origin}${location.pathname}`,
      formId,
      bodyTextLength: bodyText.length,
      containerText,
      relevantBodyText: compact([...relevantIndexes].sort((a, b) => a - b).map(index => lines[index]).join("\n"), 12000),
      elements: { progress: elementInfo(progress), start: elementInfo(start), expected: elementInfo(expected), completed: elementInfo(completed) },
      taskMatches,
      missingData: [!progress && "Tiến độ thực hiện", !start && "Bắt đầu", !expected && "Dự kiến hoàn thành"].filter(Boolean),
      endMarker: "=== END DETAIL DEBUG ==="
    };
  }
  api.taskParser = { SELECTORS, parseTasks, parseTask, parseSemanticTask, debugTaskRowDom, normalizeType, normalizeStatus, normalizeClock, parseTimelineEvents, parseTimelineText, buildLocalStartedAt, findTimelineContainer, inspectTimelineDom, findRunningDetails, matchRunningTask, mergeRunningDetails, diagnose, inspectTaskDetailDom, cacheTaskType, extractDate, isDateToday, isDateHeader, isDailyColumnHeader, isInsideDailySection, findSemanticTaskContainers, adaptiveRowParser, parseDurationFlexible, detectTaskStatus, inferTaskTypeByName, isTaskNameCandidate, extractTaskName };
  if (typeof module !== "undefined") module.exports = api.taskParser;
})(typeof globalThis !== "undefined" ? globalThis : this);
