const paperSearchDirectionInput = document.getElementById("paperSearchDirectionInput");
const paperSearchBtn = document.getElementById("paperSearchBtn");
const paperSearchOverview = document.getElementById("paperSearchOverview");
const recommendedPaperList = document.getElementById("recommendedPaperList");
const paperSearchStatus = document.getElementById("statusMessage");
const PAPER_SEARCH_STATE_KEY = "paper-search-state-v3";
const PAPER_PENDING_READ_KEY = "paper-reading-pending-v3";
let activePaperSearchRequestId = 0;

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function setLoading(isLoading, message = "") {
  if (paperSearchBtn) {
    paperSearchBtn.disabled = isLoading;
    paperSearchBtn.textContent = isLoading ? "检索中..." : "开始论文检索";
  }
  setText(paperSearchStatus, message);
}

function savePaperSearchState(state) {
  localStorage.setItem(PAPER_SEARCH_STATE_KEY, JSON.stringify(state));
}

function clearPaperSearchState() {
  localStorage.removeItem(PAPER_SEARCH_STATE_KEY);
}

function loadPaperSearchState() {
  try {
    return JSON.parse(localStorage.getItem(PAPER_SEARCH_STATE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function startPaperReading(paper, index) {
  const researchDirection = paperSearchDirectionInput?.value.trim() || "";
  const paperUrl = paper.url || paper.pdf_url || "";
  const rank = paper.rank || index + 1;
  const title = paper.title || "未命名论文";
  const prompt = paperUrl
    ? `帮我阅读第${rank}篇论文《${title}》，论文链接是：${paperUrl}`
    : `帮我阅读第${rank}篇论文《${title}》`;
  localStorage.setItem(
    PAPER_PENDING_READ_KEY,
    JSON.stringify({
      rank,
      research_direction: researchDirection,
      paper_url: paperUrl,
      title,
      prompt,
      auto_start: true,
      source: "paper-search",
      created_at: Date.now(),
    })
  );
  const params = new URLSearchParams({
    autostart: "1",
    rank: String(rank),
    title,
    prompt,
  });
  if (paperUrl) params.set("paper_url", paperUrl);
  window.location.assign(`/paper?${params.toString()}`);
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

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  html = html.replace(/\n/g, "<br>");
  return html;
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

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s)）\]]+/);
  return match ? match[0] : "";
}

function firstValue(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function formatScore100(value) {
  if (value === null || value === undefined || value === "") return "-";
  const raw = String(value).trim();
  if (!raw) return "-";
  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(numeric)) return raw;
  return String(Math.round(numeric));
}

function getImportanceScoreClass(value) {
  const score = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (Number.isNaN(score)) return "score-mid";
  if (score >= 95) return "score-top";
  if (score >= 90) return "score-high";
  if (score >= 80) return "score-mid";
  return "score-low";
}

function parsePaperSearchText(text) {
  const source = normalizeText(text);
  const overview = extractSection(source, ["检索概述"], ["推荐论文", "推荐总结"]);
  const papersSection = extractSection(source, ["推荐论文"], ["推荐总结"]);
  const labels = ["相关性评分", "重要性评分", "发布时间", "中文摘要", "推荐理由", "论文链接"];

  const papers = splitNumberedBlocks(papersSection).map((block, index) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const title = (lines[0] || `推荐论文 ${index + 1}`).replace(/^\d+[.、]\s*/, "");
    const linkText = parseLabeledValue(block, "论文链接", labels);
    return {
      title,
      relevance_score: parseLabeledValue(block, "相关性评分", labels),
      importance_score: parseLabeledValue(block, "重要性评分", labels),
      published_at: parseLabeledValue(block, "发布时间", labels),
      summary_cn: parseLabeledValue(block, "中文摘要", labels),
      recommendation_reason: parseLabeledValue(block, "推荐理由", labels),
      url: extractFirstUrl(linkText || block),
      link_text: linkText || "",
    };
  });

  return {
    overview,
    papers,
  };
}

function normalizePapers(data, parsed) {
  const rawPapers =
    Array.isArray(data?.["推荐论文"]) && data["推荐论文"].length
      ? data["推荐论文"]
      : Array.isArray(data?.papers) && data.papers.length
        ? data.papers
        : parsed.papers;
  return rawPapers.map((paper, index) => ({
    rank: Number(firstValue(paper, ["rank", "序号"])) || index + 1,
    title: firstValue(paper, ["title", "paper_title", "name"]) || "未命名论文",
    relevance_score: firstValue(paper, ["relevance_score", "relevance", "related_score", "相关性评分"]),
    importance_score: firstValue(paper, ["importance_score", "importance", "value_score", "重要性评分"]),
    published_at: firstValue(paper, ["published_at", "published", "published_date", "time", "date", "发布时间"]),
    summary_cn: firstValue(paper, ["summary_cn", "summary", "abstract_cn", "abstract", "中文摘要"]),
    recommendation_reason: firstValue(paper, [
      "recommendation_reason",
      "reason",
      "recommended_reason",
      "推荐理由",
    ]),
    url: firstValue(paper, ["pdf_url", "url", "link", "paper_url", "论文链接"]) || extractFirstUrl(JSON.stringify(paper)),
    link_text: firstValue(paper, ["link_text", "论文链接"]),
  }));
}

function renderPaperSearchCards(papers) {
  if (!recommendedPaperList) return;
  if (!Array.isArray(papers) || !papers.length) {
    recommendedPaperList.innerHTML = '<div class="result-empty">暂无推荐论文，请先输入研究方向并发起检索</div>';
    return;
  }

  recommendedPaperList.innerHTML = papers
    .map(
      (paper, index) => `
        <article class="planning-block scholar-paper-card">
          <div class="scholar-paper-head">
            <span class="topic-index">${paper.rank || index + 1}</span>
            <div class="scholar-paper-meta">
              <div class="scholar-paper-title-row">
                <strong>${escapeHtml(paper.title || "未命名论文")}</strong>
                <span class="topic-pill topic-pill-score ${getImportanceScoreClass(paper.importance_score)}">${escapeHtml(formatScore100(paper.importance_score))}</span>
              </div>
              <div class="topic-cloud scholar-paper-tags">
                <span class="topic-pill">相关性 ${escapeHtml(formatScore100(paper.relevance_score))}</span>
                <span class="topic-pill">${escapeHtml(paper.published_at || "时间未知")}</span>
              </div>
            </div>
          </div>
          <div class="result-fields">
            <div class="result-row">
              <span>中文摘要</span>
              <strong>${escapeHtml(paper.summary_cn || "暂无摘要")}</strong>
            </div>
            <div class="result-row">
              <span>推荐理由</span>
              <strong>${escapeHtml(paper.recommendation_reason || "暂无推荐理由")}</strong>
            </div>
          </div>
          <div class="scholar-paper-link-row">
            <button type="button" class="mindmap-link secondary-action" data-read-rank="${paper.rank || index + 1}">阅读</button>
            ${
              paper.url
                ? `<a class="mindmap-link" href="${escapeHtml(paper.url)}" target="_blank" rel="noopener noreferrer">打开论文链接</a>`
                : `<span class="topic-pill topic-pill-empty">${escapeHtml(paper.link_text || "暂无论文链接")}</span>`
            }
          </div>
        </article>
      `
    )
    .join("");

  recommendedPaperList.querySelectorAll("[data-read-rank]").forEach((button) => {
    button.addEventListener("click", () => {
      const rank = Number(button.getAttribute("data-read-rank"));
      const paper = papers.find((item) => Number(item.rank) === rank) || papers[rank - 1];
      if (paper) startPaperReading(paper, rank - 1);
    });
  });
}

function renderPaperSearch(data) {
  const output = firstValue(data, ["formatted_result", "output", "agent_output", "report", "answer"]);
  const parsed = parsePaperSearchText(output);
  const overview = firstValue(data, ["检索概述", "overview", "search_overview", "summary"]) || parsed.overview;
  const papers = normalizePapers(data, parsed);

  paperSearchOverview.innerHTML = overview ? inlineMarkdown(overview) : "暂无检索概述";
  renderPaperSearchCards(papers);
  return { overview, papers };
}

async function queryPaperSearch() {
  const requestId = ++activePaperSearchRequestId;
  const researchDirection = paperSearchDirectionInput?.value.trim() || "";
  if (!researchDirection) {
    setText(paperSearchStatus, "请先输入研究方向");
    return;
  }

  setLoading(true, "正在调用智能体进行论文检索...");
  clearPaperSearchState();
  try {
    const response = await fetch("/api/paper-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ research_direction: researchDirection }),
    });
    const result = await response.json();
    if (requestId !== activePaperSearchRequestId) return;
    if (!response.ok || !result.success) {
      throw new Error(result.detail || result.message || "论文检索失败");
    }
    const rendered = renderPaperSearch(result.data || {});
    const state = {
      research_direction: researchDirection,
      data: result.data || {},
      rendered,
      status: "论文检索完成",
    };
    savePaperSearchState(state);
    setText(paperSearchStatus, state.status);
  } catch (error) {
    if (requestId !== activePaperSearchRequestId) return;
    setText(paperSearchStatus, error.message || "论文检索失败");
  } finally {
    if (requestId !== activePaperSearchRequestId) return;
    setLoading(false, paperSearchStatus?.textContent || "");
  }
}

paperSearchBtn?.addEventListener("click", queryPaperSearch);
paperSearchDirectionInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    queryPaperSearch();
  }
});

const paperSearchSavedState = loadPaperSearchState();
if (paperSearchSavedState) {
  if (paperSearchDirectionInput && paperSearchSavedState.research_direction) {
    paperSearchDirectionInput.value = paperSearchSavedState.research_direction;
  }
  renderPaperSearch(paperSearchSavedState.data || {});
  setText(paperSearchStatus, paperSearchSavedState.status || "");
} else {
  setText(paperSearchStatus, "");
}
