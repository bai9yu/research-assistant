const paperFileInput = document.getElementById("paperFile");
const paperUrlInput = document.getElementById("paperUrlInput");
const paperSubmitBtn = document.getElementById("paperSubmitBtn");
const paperImportBtn = document.getElementById("paperImportBtn");
const paperPreviewFrame = document.getElementById("paperPreviewFrame");
const paperTitle = document.getElementById("paperTitle");
const paperKeywords = document.getElementById("paperKeywords");
const paperAbstract = document.getElementById("paperAbstract");
const paperScoreGrid = document.getElementById("paperScoreGrid");
const paperChatMessages = document.getElementById("paperChatMessages");
const paperChatInput = document.getElementById("paperChatInput");
const paperChatSendBtn = document.getElementById("paperChatSendBtn");
const statusMessage = document.getElementById("statusMessage");
const PAPER_STATE_KEY = "paper-reading-state-v3";
const PAPER_PENDING_READ_KEY = "paper-reading-pending-v3";
const KNOWLEDGE_STATE_KEY = "knowledge-page-state-v11";
const KNOWLEDGE_PENDING_IMPORT_KEY = "knowledge-page-pending-import-v1";
let activePaperReviewRequestId = 0;
let activePaperImportRequestId = 0;

let currentObjectUrl = null;
let currentPaperContext = null;
let currentPaperFile = null;
let activeChatLoadingBubble = null;

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function setHtml(element, value) {
  if (!element) return;
  element.innerHTML = value;
}

function sanitizeUserVisibleText(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const cleaned = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return !/(初始化解析失败|初始化失败|PDF_READ_FAILED|未读取到有效PDF文本|解析失败)/i.test(line);
    })
    .join("\n")
    .trim();

  if (!cleaned) return fallback;
  if (/(初始化解析失败|初始化失败|PDF_READ_FAILED|未读取到有效PDF文本|解析失败)/i.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function savePaperState(state) {
  localStorage.setItem(PAPER_STATE_KEY, JSON.stringify(state));
}

function clearSavedPaperState() {
  localStorage.removeItem(PAPER_STATE_KEY);
}

function clearPendingReadState() {
  localStorage.removeItem(PAPER_PENDING_READ_KEY);
}

function markKnowledgeNeedsRefresh(payload = {}) {
  localStorage.removeItem(KNOWLEDGE_STATE_KEY);
  localStorage.setItem(
    KNOWLEDGE_PENDING_IMPORT_KEY,
    JSON.stringify({
      entry_type: "paper",
      section_type: "innovation",
      auto_display: true,
      created_at: Date.now(),
      ...payload,
    })
  );
}

function setPaperFlow(fileName, flowStatus, agentStatus) {
  return { fileName, flowStatus, agentStatus };
}

function loadPaperState() {
  try {
    return JSON.parse(localStorage.getItem(PAPER_STATE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function loadPendingReadState() {
  try {
    return JSON.parse(localStorage.getItem(PAPER_PENDING_READ_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function loadPendingReadFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("autostart") !== "1") return null;
  const prompt = params.get("prompt") || "";
  const paperUrl = params.get("paper_url") || "";
  const title = params.get("title") || "";
  const rank = Number(params.get("rank") || "0");
  if (!prompt && !paperUrl && !title) return null;
  return {
    rank: Number.isFinite(rank) && rank > 0 ? rank : 1,
    paper_url: paperUrl,
    title,
    prompt,
    auto_start: true,
    source: "paper-search-query",
    created_at: Date.now(),
  };
}

function clearPaperDisplay() {
  setText(paperTitle, "暂无标题");
  renderKeywords([]);
  setText(paperAbstract, "上传论文后将展示摘要内容");
  renderScores({
    innovation: 0,
    logic: 0,
    dataReliability: 0,
    conclusion: 0,
    improvement: 0,
  });
  resetChat();
  if (paperChatInput) {
    paperChatInput.value = "";
  }
}

function resetPaperWorkspace(message = "") {
  currentPaperContext = null;
  hideChatLoading();
  clearPaperDisplay();
  clearSavedPaperState();
  clearPendingReadState();
  if (message) {
    setText(statusMessage, message);
  }
}

function revokePreview() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function normalizePreviewUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\/arxiv\.org\/abs\//i.test(raw)) {
    return raw.replace("/abs/", "/pdf/");
  }
  return raw;
}

function renderPreviewSource({ file = null, url = "" } = {}) {
  revokePreview();
  const normalizedUrl = normalizePreviewUrl(url);
  if (!file && !normalizedUrl) {
    paperPreviewFrame.innerHTML = "上传 PDF 后可在此滚动预览论文内容";
    paperPreviewFrame.className = "paper-preview-empty";
    return;
  }

  if (file) {
    currentObjectUrl = URL.createObjectURL(file);
  }
  paperPreviewFrame.className = "paper-preview-frame";
  const previewSrc = file ? currentObjectUrl : normalizedUrl;
  paperPreviewFrame.innerHTML = `
    <object data="${escapeHtml(previewSrc)}" type="application/pdf" class="paper-preview-object">
      <embed src="${escapeHtml(previewSrc)}" type="application/pdf" class="paper-preview-embed" />
      <div class="paper-preview-fallback">
        <p>当前环境暂时没有直接展开 PDF 预览，我们先给你保留原文入口。</p>
        <a class="mindmap-link" href="${escapeHtml(previewSrc)}" target="_blank" rel="noopener noreferrer">打开论文原文</a>
      </div>
    </object>
  `;
}

function normalizeScore(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
}

function renderStars(score) {
  const normalized = normalizeScore(score);
  return "★".repeat(normalized) + "☆".repeat(5 - normalized);
}

function extractLineValue(text, label) {
  const regex = new RegExp(`${label}[：:]\\s*(.+)`);
  const match = String(text || "").match(regex);
  return match ? match[1].trim() : "";
}

function extractBlockValue(text, labels) {
  const source = String(text || "");
  const joined = Array.isArray(labels) ? labels.join("|") : labels;
  const regex = new RegExp(`(?:${joined})[：:]?\\s*([\\s\\S]*?)(?=\\n(?:[一二三四五六七八九十]+[、.]|\\d+[、.]|${joined}|标题|关键词|摘要|创新性|逻辑性|数据可靠性|结论合理性|改进意见)[：:]?|$)`);
  const match = source.match(regex);
  return match ? match[1].trim() : "";
}

function extractKeywords(text) {
  const raw = extractLineValue(text, "关键词");
  if (!raw) return [];
  return raw
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[、,，;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function extractMarkdownSectionScore(text, sectionTitle) {
  const source = String(text || "");
  if (!source) return 0;

  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(
    `##\\s*\\d+\\.\\s*${escapedTitle}[\\s\\S]*?(?=\\n##\\s*\\d+\\.|$)`,
    "i"
  );
  const sectionMatch = source.match(sectionPattern);
  if (!sectionMatch) return 0;

  const scoreMatch = sectionMatch[0].match(/\*{0,2}\s*评分\s*\*{0,2}[：:]\s*(\d)/);
  return scoreMatch ? normalizeScore(scoreMatch[1]) : 0;
}

function extractScore(text, label) {
  const patterns = [
    new RegExp(`\\*{0,2}\\s*${label}\\s*\\*{0,2}[：:]\\s*(\\d)\\s*/\\s*5`),
    new RegExp(`\\*{0,2}\\s*${label}\\s*\\*{0,2}[：:]\\s*(\\d)\\s*分`),
    new RegExp(`\\*{0,2}\\s*${label}\\s*\\*{0,2}[：:]\\s*(\\d)`),
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return normalizeScore(match[1]);
  }
  return 0;
}

function extractMarkdownSection(text, sectionTitle) {
  const source = String(text || "");
  if (!source) return "";

  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(
    `##\\s*\\d+\\.\\s*${escapedTitle}[\\s\\S]*?(?=\\n##\\s*\\d+\\.|$)`,
    "i"
  );
  const sectionMatch = source.match(sectionPattern);
  return sectionMatch ? sectionMatch[0].trim() : "";
}

function cleanupMarkdownText(text) {
  return String(text || "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\*\s+/gm, "• ")
    .replace(/^- /gm, "• ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function maybeParseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "").trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractJsonLikeText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1).trim();
  }

  const listStart = text.indexOf("[");
  const listEnd = text.lastIndexOf("]");
  if (listStart >= 0 && listEnd > listStart) {
    return text.slice(listStart, listEnd + 1).trim();
  }

  return text;
}

function unwrapPaperQaAnswer(raw) {
  if (raw && typeof raw === "object") {
    const nestedAnswer =
      raw?.data?.answer ??
      raw?.answer ??
      raw?.output ??
      raw?.message ??
      "";
    return String(nestedAnswer || "").trim();
  }

  const text = String(raw || "").trim();
  const parsed = maybeParseJson(text);
  if (parsed) return unwrapPaperQaAnswer(parsed);
  const extractedJson = extractJsonLikeText(text);
  if (extractedJson && extractedJson !== text) {
    const extractedParsed = maybeParseJson(extractedJson);
    if (extractedParsed) return unwrapPaperQaAnswer(extractedParsed);
  }
  return text;
}

function extractScoreFromSectionBlock(text, sectionTitle) {
  const block = extractMarkdownSection(text, sectionTitle);
  if (!block) return 0;

  const patterns = [
    /\*{0,2}\s*评分\s*\*{0,2}[：:]\s*([1-5])/,
    /\*{0,2}\s*综合评分\s*\*{0,2}[：:]\s*([1-5])/,
    /\*{0,2}\s*评分\s*\*{0,2}\s*[（(]?\s*([1-5])\s*[）)]?/,
    /评分[^\n：:]*[：:]\s*([1-5])/,
    /评分[^\n0-9]*([1-5])\s*分/,
  ];

  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match) return normalizeScore(match[1]);
  }

  return 0;
}

function parsePaperPayload(data) {
  const basicInfo = data?.["论文基本信息"] && typeof data["论文基本信息"] === "object" ? data["论文基本信息"] : {};
  const scoreInfo = data?.["论文五维评价"] && typeof data["论文五维评价"] === "object" ? data["论文五维评价"] : {};
  const rawComments = String(data?.paper_comments || "").trim();
  const rawKnowledge = String(data?.paper_knowledge || "").trim();
  const combined = [rawKnowledge, rawComments].filter(Boolean).join("\n\n");

  const title =
    basicInfo?.["标题"] ||
    data?.paper_title ||
    data?.title ||
    extractLineValue(combined, "标题") ||
    extractLineValue(combined, "论文标题") ||
    "暂无标题";

  const keywords = normalizeKeywords(basicInfo?.["关键词"] || data?.paper_keywords || data?.keywords);
  const finalKeywords = keywords.length ? keywords : extractKeywords(combined);

  const abstract =
    basicInfo?.["摘要"] ||
    data?.paper_abstract ||
    data?.abstract ||
    extractBlockValue(combined, ["摘要", "论文摘要", "Abstract"]) ||
    "上传论文后将展示摘要内容";

  const resolveScore = (...candidates) => {
    for (const candidate of candidates) {
      const normalized = normalizeScore(candidate);
      if (normalized > 0) return normalized;
    }
    return 0;
  };

  const scores = {
    innovation: resolveScore(
      scoreInfo?.["创新性"],
      data?.innovation_score,
      extractMarkdownSectionScore(combined, "创新性评价"),
      extractScoreFromSectionBlock(combined, "创新性评价"),
      extractScore(combined, "创新性")
    ),
    logic: resolveScore(
      scoreInfo?.["逻辑性"],
      data?.logic_score,
      extractMarkdownSectionScore(combined, "逻辑性评价"),
      extractScoreFromSectionBlock(combined, "逻辑性评价"),
      extractScore(combined, "逻辑性")
    ),
    dataReliability: resolveScore(
      scoreInfo?.["数据可靠性"],
      data?.data_reliability_score,
      extractMarkdownSectionScore(combined, "数据可靠性评价"),
      extractScoreFromSectionBlock(combined, "数据可靠性评价"),
      extractScore(combined, "数据可靠性")
    ),
    conclusion: resolveScore(
      scoreInfo?.["结论合理性"],
      data?.conclusion_score,
      extractMarkdownSectionScore(combined, "结论合理性评价"),
      extractScoreFromSectionBlock(combined, "结论合理性评价"),
      extractScore(combined, "结论合理性")
    ),
    improvement: resolveScore(
      scoreInfo?.["改进意见"],
      scoreInfo?.["改进建议"],
      data?.improvement_score,
      extractMarkdownSectionScore(combined, "改进建议"),
      extractScoreFromSectionBlock(combined, "改进建议"),
      extractScore(combined, "改进意见"),
      extractScore(combined, "改进建议")
    ),
  };

  const improvementAdvice =
    data?.["改进建议"] ||
    data?.improvement_advice ||
    extractBlockValue(combined, ["改进意见", "改进建议", "建议"]) ||
    "";

  const reviewSections = {
    innovation: cleanupMarkdownText(extractMarkdownSection(combined, "创新性评价")),
    logic: cleanupMarkdownText(extractMarkdownSection(combined, "逻辑性评价")),
    dataReliability: cleanupMarkdownText(extractMarkdownSection(combined, "数据可靠性评价")),
    conclusion: cleanupMarkdownText(extractMarkdownSection(combined, "结论合理性评价")),
    improvement: cleanupMarkdownText(extractMarkdownSection(combined, "改进建议")),
    comprehensive: cleanupMarkdownText(extractMarkdownSection(combined, "综合评价")),
  };

  return {
    title,
    keywords: finalKeywords,
    abstract,
    scores,
    improvementAdvice,
    detailedReview: rawComments || rawKnowledge || "暂无论文分析",
    rawKnowledge,
    reviewSections,
  };
}

function renderKeywords(keywords) {
  if (!paperKeywords) return;
  const normalized = Array.isArray(keywords) ? keywords.filter(Boolean) : [];
  if (!normalized.length) {
    setHtml(paperKeywords, '<span class="topic-pill topic-pill-empty">暂无关键词</span>');
    return;
  }

  setHtml(
    paperKeywords,
    normalized.map((item) => `<span class="topic-pill">${escapeHtml(item)}</span>`).join("")
  );
}

function renderScores(scores) {
  if (!paperScoreGrid) return;
  const scoreItems = [
    { label: "创新性", value: scores.innovation },
    { label: "逻辑性", value: scores.logic },
    { label: "数据可靠性", value: scores.dataReliability },
    { label: "结论合理性", value: scores.conclusion },
    { label: "改进意见", value: scores.improvement },
  ];

  setHtml(
    paperScoreGrid,
    scoreItems
      .map(
        (item) => `
          <div class="score-card">
            <span class="score-card-label">${item.label}</span>
            <div class="score-stars">${renderStars(item.value)}</div>
          </div>
        `
      )
      .join("")
  );
}

function appendChatMessage(role, content) {
  if (!paperChatMessages) return;
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`;
  const safeContent =
    role === "assistant"
      ? sanitizeUserVisibleText(content, "这部分返回我先帮你收起来了，我们继续看论文本身。")
      : String(content || "");
  if (!safeContent.trim()) return;
  bubble.textContent = safeContent;
  paperChatMessages.appendChild(bubble);
  paperChatMessages.scrollTop = paperChatMessages.scrollHeight;
}

function showChatLoading(message = "研途喵正在思考中...") {
  if (!paperChatMessages) return;
  hideChatLoading();
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble-assistant chat-bubble-loading";
  bubble.textContent = sanitizeUserVisibleText(message, "研途喵正在思考中...");
  paperChatMessages.appendChild(bubble);
  paperChatMessages.scrollTop = paperChatMessages.scrollHeight;
  activeChatLoadingBubble = bubble;
}

function hideChatLoading() {
  if (activeChatLoadingBubble?.parentNode) {
    activeChatLoadingBubble.parentNode.removeChild(activeChatLoadingBubble);
  }
  activeChatLoadingBubble = null;
}

function captureChatHistory() {
  if (!paperChatMessages) return [];
  return Array.from(paperChatMessages.querySelectorAll(".chat-bubble")).map((node) => ({
    role: node.classList.contains("chat-bubble-user") ? "user" : "assistant",
    content: node.textContent || "",
  }));
}

function restoreChatHistory(history) {
  if (!paperChatMessages) return;
  paperChatMessages.innerHTML = "";
  if (!Array.isArray(history) || !history.length) {
    resetChat();
    return;
  }
  history.forEach((item) => appendChatMessage(item.role, item.content));
}

function resetChat() {
  if (!paperChatMessages) return;
  hideChatLoading();
  paperChatMessages.innerHTML =
    '<div class="chat-bubble chat-bubble-assistant">论文已经接住啦。我们慢慢看，不着急；哪里想深挖，就直接喊我。</div>';
}

function buildReviewDigest(context) {
  if (!context) return "";

  const sections = [
    { label: "创新性评价", score: context.scores?.innovation, body: context.reviewSections?.innovation },
    { label: "逻辑性评价", score: context.scores?.logic, body: context.reviewSections?.logic },
    { label: "数据可靠性评价", score: context.scores?.dataReliability, body: context.reviewSections?.dataReliability },
    { label: "结论合理性评价", score: context.scores?.conclusion, body: context.reviewSections?.conclusion },
    { label: "改进建议", score: context.scores?.improvement, body: context.reviewSections?.improvement || context.improvementAdvice },
  ];

  const parts = sections
    .map((section) => {
      const body = String(section.body || "").trim();
      if (!body) return "";
      return `${section.label}（${normalizeScore(section.score)}分 / ${renderStars(section.score)}）\n${body}`;
    })
    .filter(Boolean);

  if (context.reviewSections?.comprehensive) {
    parts.push(`综合评价\n${context.reviewSections.comprehensive}`);
  }

  return parts.join("\n\n");
}

function buildCompanionAnswer(question, context) {
  const q = String(question || "").trim().toLowerCase();
  if (!context) {
    return "先把论文递给我，我们再一起慢慢读下去。";
  }

  if (q.includes("标题")) {
    return `这篇论文的标题是：${context.title}`;
  }
  if (q.includes("关键词")) {
    return context.keywords.length
      ? `当前提取到的关键词包括：${context.keywords.join("、")}。`
      : "当前结果里还没有稳定提取到关键词。";
  }
  if (q.includes("摘要") || q.includes("主要内容") || q.includes("讲了什么")) {
    return context.abstract || "当前结果里还没有稳定提取到摘要。";
  }
  if (q.includes("创新")) {
    return `创新性评分为 ${normalizeScore(context.scores.innovation)} 分，对应 ${renderStars(context.scores.innovation)}。`;
  }
  if (q.includes("逻辑")) {
    return `逻辑性评分为 ${normalizeScore(context.scores.logic)} 分，对应 ${renderStars(context.scores.logic)}。`;
  }
  if (q.includes("数据")) {
    return `数据可靠性评分为 ${normalizeScore(context.scores.dataReliability)} 分，对应 ${renderStars(context.scores.dataReliability)}。`;
  }
  if (q.includes("结论")) {
    return `结论合理性评分为 ${normalizeScore(context.scores.conclusion)} 分，对应 ${renderStars(context.scores.conclusion)}。`;
  }
  if (q.includes("改进") || q.includes("建议")) {
    return context.improvementAdvice
      ? `当前提取到的改进建议是：${context.improvementAdvice}`
      : `改进意见评分为 ${normalizeScore(context.scores.improvement)} 分，对应 ${renderStars(context.scores.improvement)}。`;
  }

  const summaryParts = [
    context.title ? `标题：${context.title}` : "",
    context.abstract ? `摘要：${context.abstract}` : "",
    context.improvementAdvice ? `建议：${context.improvementAdvice}` : "",
  ].filter(Boolean);

  return summaryParts.length
    ? summaryParts.join("\n")
    : "你可以继续问我这篇论文最值得先抓哪一部分、哪里最难懂，或者我们一起把思路慢慢理顺。";
}

function renderPaperAnalysis(data) {
  const parsed = parsePaperPayload(data);
  currentPaperContext = parsed;

  setText(paperTitle, parsed.title);
  renderKeywords(parsed.keywords);
  setText(
    paperAbstract,
    sanitizeUserVisibleText(parsed.abstract, "上传论文后将展示摘要内容")
  );
  renderScores(parsed.scores);
  resetChat();
  appendChatMessage("assistant", "已经先陪你把这篇论文顺了一遍。你想抓重点、抠细节，还是边读边聊，我们都可以继续。");
  const reviewDigest = buildReviewDigest(parsed);
  if (reviewDigest) {
    appendChatMessage("assistant", reviewDigest);
  }
  savePaperState({
    paper_url: paperUrlInput?.value.trim() || "",
    analysis: data,
    chat_history: captureChatHistory(),
    preview_url: paperUrlInput?.value.trim() || "",
  });
}

async function submitPaperReview() {
  const requestId = ++activePaperReviewRequestId;
  const file = paperFileInput.files?.[0];
  const pendingRead = loadPendingReadState();
  const paperUrl = paperUrlInput?.value.trim() || pendingRead?.paper_url || "";
  const readingPrompt = pendingRead?.prompt || "";

  if (!file && !paperUrl && !readingPrompt) {
    setText(statusMessage, "请先上传 PDF 文件、填写论文 URL，或从论文检索页进入阅读");
    return;
  }

  currentPaperFile = file;
  renderPreviewSource({ file, url: paperUrl });
  clearSavedPaperState();
  const formData = new FormData();
  if (file) formData.append("paper_pdf", file);
  formData.append("paper_url", paperUrl);
  formData.append("paper_id", paperUrl);
  formData.append("reading_prompt", readingPrompt);

  paperSubmitBtn.disabled = true;
  setText(paperSubmitBtn, "生成中...");
  setText(statusMessage, "正在生成论文分析...");
  setPaperFlow(
    file?.name || paperUrl || pendingRead?.title || "待分析论文",
    "文件已提交到后端，正在请求智能体",
    "等待智能体返回"
  );

  try {
    const response = await fetch("/api/paper-review", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    if (requestId !== activePaperReviewRequestId) return;
    if (!response.ok || !result.success) {
      throw new Error(result.detail || result.message || "论文分析生成失败");
    }

    renderPaperAnalysis(result.data || {});
    setText(statusMessage, "论文分析已生成");
    localStorage.removeItem(PAPER_PENDING_READ_KEY);
  } catch (error) {
    if (requestId !== activePaperReviewRequestId) return;
    setPaperFlow(
      file?.name || paperUrl || pendingRead?.title || "待分析论文",
      "后端处理失败",
      "智能体结果未成功落库到页面"
    );
    setText(statusMessage, error.message || "论文分析生成失败，请稍后重试");
  } finally {
    if (requestId !== activePaperReviewRequestId) return;
    paperSubmitBtn.disabled = false;
    setText(paperSubmitBtn, "生成论文分析");
  }
}

async function importPaperToKnowledge() {
  const requestId = ++activePaperImportRequestId;
  const file = paperFileInput.files?.[0];
  const paperUrl = paperUrlInput?.value.trim() || "";

  if (!file && !paperUrl) {
    setText(statusMessage, "请先上传论文文件或填写论文链接，再写入知识库");
    return;
  }

  const formData = new FormData();
  formData.append("entry_type", "paper");
  formData.append("action", "import");
  if (file) formData.append("knowledge_file", file);
  if (paperUrl) formData.append("knowledge_url", paperUrl);

  paperImportBtn.disabled = true;
  setText(paperImportBtn, "写入中...");
  setText(statusMessage, "正在把这篇论文写入知识库...");

  try {
    localStorage.removeItem(KNOWLEDGE_STATE_KEY);
    const response = await fetch("/api/knowledge", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    if (requestId !== activePaperImportRequestId) return;
    if (!response.ok || !result.success) {
      throw new Error(result.detail || result.message || "论文写入知识库失败");
    }
    markKnowledgeNeedsRefresh({
      source: file ? "file" : "url",
      paper_url: paperUrl,
    });
    setText(statusMessage, result.data?.message || "论文已写入知识库");
  } catch (error) {
    if (requestId !== activePaperImportRequestId) return;
    setText(statusMessage, error.message || "论文写入知识库失败");
  } finally {
    if (requestId !== activePaperImportRequestId) return;
    paperImportBtn.disabled = false;
    setText(paperImportBtn, "上传到知识库");
  }
}

function buildSummaryContext(context) {
  if (!context) return "";
  return [
    `标题：${context.title || ""}`,
    `关键词：${Array.isArray(context.keywords) ? context.keywords.join("、") : ""}`,
    `摘要：${context.abstract || ""}`,
    `创新性：${normalizeScore(context.scores?.innovation)}`,
    `逻辑性：${normalizeScore(context.scores?.logic)}`,
    `数据可靠性：${normalizeScore(context.scores?.dataReliability)}`,
    `结论合理性：${normalizeScore(context.scores?.conclusion)}`,
    `改进意见：${normalizeScore(context.scores?.improvement)}`,
    context.improvementAdvice ? `改进建议：${context.improvementAdvice}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendChatQuestion() {
  const question = paperChatInput?.value.trim() || "";
  if (!question) return;

  if (!currentPaperFile && !(paperUrlInput?.value.trim()) && !currentPaperContext) {
    appendChatMessage("assistant", "先把论文交给我，我们再一起慢慢往下读。");
    return;
  }

  appendChatMessage("user", question);
  paperChatInput.value = "";
  paperChatSendBtn.disabled = true;
  showChatLoading("正在调用智能体回答这个问题...");

  try {
    const formData = new FormData();
    if (currentPaperFile) formData.append("paper_pdf", currentPaperFile);
    formData.append("paper_url", paperUrlInput?.value.trim() || "");
    formData.append("question", question);
    formData.append("summary_context", buildSummaryContext(currentPaperContext));

    const response = await fetch("/api/paper-chat", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.detail || result.message || "论文伴读回答失败");
    }

    const answer =
      sanitizeUserVisibleText(
        unwrapPaperQaAnswer(result.data?.answer || result.data),
        buildCompanionAnswer(question, currentPaperContext)
      ) || buildCompanionAnswer(question, currentPaperContext);
    hideChatLoading();
    appendChatMessage("assistant", answer);
    savePaperState({
      paper_url: paperUrlInput?.value.trim() || "",
      analysis: currentPaperContext ? {
        paper_title: currentPaperContext.title,
        paper_keywords: currentPaperContext.keywords,
        paper_abstract: currentPaperContext.abstract,
      } : {},
      chat_history: captureChatHistory(),
    });
  } catch (error) {
    hideChatLoading();
    const fallback = buildCompanionAnswer(question, currentPaperContext);
    appendChatMessage(
      "assistant",
      sanitizeUserVisibleText(
        `${error.message || "论文伴读回答失败，已使用当前页面上下文为你生成参考回答。"}\n\n${fallback}`,
        fallback
      )
    );
  } finally {
    hideChatLoading();
    paperChatSendBtn.disabled = false;
  }
}

paperFileInput.addEventListener("change", () => {
  const file = paperFileInput.files?.[0];
  currentPaperFile = file || null;
  if (file && paperUrlInput) {
    paperUrlInput.value = "";
  }
  resetPaperWorkspace(file ? "已切换到新论文文件，请重新生成论文分析" : "已清空论文文件");
  renderPreviewSource({ file, url: "" });
});

paperUrlInput?.addEventListener("input", () => {
  const nextUrl = paperUrlInput.value.trim();
  if (nextUrl && paperFileInput) {
    paperFileInput.value = "";
    currentPaperFile = null;
  }
  resetPaperWorkspace(nextUrl ? "已切换到新论文链接，请重新生成论文分析" : "已清空论文链接");
  renderPreviewSource({ url: nextUrl });
});

paperSubmitBtn.addEventListener("click", submitPaperReview);
paperImportBtn?.addEventListener("click", importPaperToKnowledge);
paperChatSendBtn?.addEventListener("click", sendChatQuestion);
paperChatInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendChatQuestion();
  }
});

window.addEventListener("beforeunload", revokePreview);

const paperSavedState = loadPaperState();
if (paperSavedState) {
  if (paperUrlInput && paperSavedState.paper_url) paperUrlInput.value = paperSavedState.paper_url;
  if (paperSavedState.analysis) {
    renderPaperAnalysis(paperSavedState.analysis);
  }
  if (paperSavedState.preview_url || paperSavedState.paper_url) {
    renderPreviewSource({ url: paperSavedState.preview_url || paperSavedState.paper_url });
  }
}

const pendingRead = loadPendingReadState() || loadPendingReadFromQuery();
if (pendingRead) {
  if (paperUrlInput && pendingRead.paper_url) {
    paperUrlInput.value = pendingRead.paper_url;
  }
  localStorage.setItem(PAPER_PENDING_READ_KEY, JSON.stringify(pendingRead));
  currentPaperContext = null;
  clearPaperDisplay();
  setText(statusMessage, `已接收第${pendingRead.rank}篇论文，正在准备阅读`);
  renderPreviewSource({ url: pendingRead.paper_url || "" });
  window.setTimeout(() => {
    submitPaperReview();
  }, 120);
}
