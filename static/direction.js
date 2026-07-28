const questionInput = document.getElementById("questionInput");
const directionBtn = document.getElementById("directionBtn");
const statusMessage = document.getElementById("statusMessage");
const directionOverview = document.getElementById("directionOverview");
const directionStage = document.getElementById("directionStage");
const innovationList = document.getElementById("innovationList");
const mindmapWrap = document.getElementById("mindmapWrap");
const mindmapLink = document.getElementById("mindmapLink");
const mindmapEmpty = document.getElementById("mindmapEmpty");
const directionReportWrap = document.getElementById("directionReportWrap");
const directionReportLink = document.getElementById("directionReportLink");
const directionReportEmpty = document.getElementById("directionReportEmpty");
const DIRECTION_STATE_KEY = "direction-page-state-v1";
let activeDirectionRequestId = 0;

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(text, startNames, endNames = []) {
  const source = normalizeText(text);
  if (!source) return "";

  const startPattern = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(${startNames.map(escapeRegExp).join("|")})\\s*$`,
    "m"
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) return "";

  const afterStart = source.slice(startMatch.index + startMatch[0].length).trimStart();
  let endIndex = afterStart.length;

  endNames.forEach((name) => {
    const endPattern = new RegExp(`^\\s*(?:#{1,6}\\s*)?${escapeRegExp(name)}\\s*$`, "m");
    const endMatch = endPattern.exec(afterStart);
    if (endMatch && endMatch.index < endIndex) {
      endIndex = endMatch.index;
    }
  });

  return afterStart.slice(0, endIndex).trim();
}

function splitNumberedBlocks(sectionText) {
  const lines = normalizeText(sectionText).split("\n");
  const blocks = [];
  let current = [];

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (/^\d+[.、]\s*/.test(line)) {
      if (current.length) blocks.push(current.join("\n").trim());
      current = [line];
      return;
    }
    if (current.length || line) current.push(rawLine);
  });

  if (current.length) blocks.push(current.join("\n").trim());
  return blocks.filter(Boolean);
}

function parseLabeledValue(block, label, labels) {
  const escapedLabels = labels.map(escapeRegExp).join("|");
  const pattern = new RegExp(
    `${escapeRegExp(label)}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${escapedLabels})\\s*[:：]|$)`
  );
  const match = pattern.exec(block);
  return match ? match[1].trim() : "";
}

function firstValue(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function saveDirectionState(state) {
  localStorage.setItem(DIRECTION_STATE_KEY, JSON.stringify(state));
}

function clearDirectionState() {
  localStorage.removeItem(DIRECTION_STATE_KEY);
}

function loadDirectionState() {
  try {
    return JSON.parse(localStorage.getItem(DIRECTION_STATE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch (error) {
      return trimmed
        .split(/\n+/)
        .map((line) => line.replace(/^[-*、\d.\s]+/, "").trim())
        .filter(Boolean);
    }
  }
  if (typeof value === "object") return [value];
  return [];
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s)）\]]+/);
  return match ? match[0] : "";
}

function parseDirectionText(text) {
  const source = normalizeText(text);
  const overview = extractSection(source, ["方向概况"], ["当前发展阶段", "创新点建议", "可视化与文档"]);
  const stage = extractSection(source, ["当前发展阶段"], ["创新点建议", "可视化与文档"]);
  const innovationSection = extractSection(source, ["创新点建议"], ["可视化与文档", "研究方向思维导图", "完整分析报告"]);
  const docSection = extractSection(source, ["可视化与文档"], []);
  const labels = ["针对问题", "核心想法", "依据", "可行性", "潜在价值"];

  const innovations = splitNumberedBlocks(innovationSection).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = (lines[0] || `创新点建议 ${index + 1}`).replace(/^\d+[.、]\s*/, "");
    return {
      title,
      target_problem: parseLabeledValue(block, "针对问题", labels),
      core_idea: parseLabeledValue(block, "核心想法", labels),
      evidence: parseLabeledValue(block, "依据", labels),
      feasibility: parseLabeledValue(block, "可行性", labels),
      potential_value: parseLabeledValue(block, "潜在价值", labels),
    };
  });

  const mindmapText = extractSection(docSection || source, ["研究方向思维导图"], ["完整分析报告"]);
  const reportText = extractSection(docSection || source, ["完整分析报告"], []);

  return {
    overview,
    stage,
    innovations,
    mindmapUrl: extractFirstUrl(mindmapText),
    reportUrl: extractFirstUrl(reportText),
    reportText: reportText && !extractFirstUrl(reportText) ? reportText : "",
  };
}

function renderLink(wrap, link, empty, url, fallbackText = "") {
  if (!wrap || !link) return;
  if (url) {
    link.href = url;
    wrap.classList.remove("hidden");
    empty?.classList.add("hidden");
  } else {
    link.href = "#";
    wrap.classList.add("hidden");
    empty?.classList.remove("hidden");
    if (empty && fallbackText) empty.textContent = fallbackText;
  }
}

function renderInnovationList(items) {
  if (!innovationList) return;
  innovationList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "result-empty";
    empty.textContent = "暂无创新点建议";
    innovationList.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "direction-innovation-card";

    if (typeof item === "string") {
      card.innerHTML = `
        <div class="direction-innovation-index">${index + 1}</div>
        <div>
          <h5>创新点建议 ${index + 1}</h5>
          <p>${escapeHtml(item)}</p>
        </div>
      `;
      innovationList.appendChild(card);
      return;
    }

    const title = item.title || item.name || `创新点建议 ${index + 1}`;
    const rows = [
      ["针对问题", item.target_problem || item.problem || item.question],
      ["核心想法", item.core_idea || item.idea || item.method],
      ["依据", item.evidence || item.basis || item.reason],
      ["可行性", item.feasibility],
      ["潜在价值", item.potential_value || item.value],
    ].filter(([, value]) => value);

    card.innerHTML = `
      <div class="direction-innovation-index">${index + 1}</div>
      <div>
        <h5>${escapeHtml(title)}</h5>
        ${
          rows.length
            ? rows
                .map(
                  ([label, value]) => `
                    <div class="direction-innovation-row">
                      <span>${escapeHtml(label)}</span>
                      <p>${escapeHtml(value)}</p>
                    </div>
                  `
                )
                .join("")
            : `<p>${escapeHtml(JSON.stringify(item))}</p>`
        }
      </div>
    `;
    innovationList.appendChild(card);
  });
}

function renderDirection(data) {
  const outputText = firstValue(data, ["output", "formatted_result", "report", "answer"]);
  const parsed = parseDirectionText(outputText);
  const overview =
    firstValue(data, ["方向概况", "direction_overview", "direction_summary", "overview", "summary"]) || parsed.overview;
  const stage =
    firstValue(data, ["当前发展阶段", "current_stage", "development_stage", "stage_summary", "stage"]) || parsed.stage;
  const innovationItems =
    normalizeList(
      firstValue(data, [
        "创新点建议",
        "innovation_suggestions",
        "innovation_ideas",
        "innovation_points",
        "innovations",
        "suggestions",
        "ideas",
      ])
    ) ||
    [];
  const finalInnovations = innovationItems.length ? innovationItems : parsed.innovations;
  const mindmapUrl =
    firstValue(data, ["研究方向思维导图", "mindmap_url", "mindmap_link", "jump_link", "map_url"]) || parsed.mindmapUrl;
  const reportUrl =
    firstValue(data, ["完整分析报告", "report_url", "document_url", "markdown_url", "analysis_report_url"]) ||
    parsed.reportUrl;

  setText(directionOverview, overview || "暂无方向概况");
  setText(directionStage, stage || "暂无发展阶段");
  renderInnovationList(finalInnovations);
  renderLink(mindmapWrap, mindmapLink, mindmapEmpty, mindmapUrl, "暂无脑图链接");
  renderLink(directionReportWrap, directionReportLink, directionReportEmpty, reportUrl, parsed.reportText || "暂无报告链接");
}

async function queryDirection() {
  const requestId = ++activeDirectionRequestId;
  const keyword = questionInput.value.trim();
  if (!keyword) {
    setText(statusMessage, "请输入研究主题关键词后再生成方向分析");
    return;
  }

  const prompt = `帮我调研一下${keyword}的研究方向`;

  directionBtn.disabled = true;
  setText(directionBtn, "生成中...");
  setText(statusMessage, "正在生成研究方向分析...");
  clearDirectionState();

  try {
    const response = await fetch("/api/research-direction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: prompt, keyword }),
    });
    const result = await response.json();
    if (requestId !== activeDirectionRequestId) return;
    if (!response.ok || !result.success) {
      throw new Error(result.detail || result.message || "生成方向分析失败");
    }
    renderDirection(result.data);
    const state = {
      question: keyword,
      data: result.data,
      status: "研究方向分析已生成",
    };
    saveDirectionState(state);
    setText(statusMessage, state.status);
  } catch (error) {
    if (requestId !== activeDirectionRequestId) return;
    setText(statusMessage, error.message || "生成方向分析失败，请稍后重试");
  } finally {
    if (requestId !== activeDirectionRequestId) return;
    directionBtn.disabled = false;
    setText(directionBtn, "生成方向分析");
  }
}

directionBtn?.addEventListener("click", queryDirection);
questionInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") queryDirection();
});

const directionSavedState = loadDirectionState();
if (directionSavedState) {
  if (questionInput && directionSavedState.question) questionInput.value = directionSavedState.question;
  if (directionSavedState.data) renderDirection(directionSavedState.data);
  setText(statusMessage, directionSavedState.status || "");
}
