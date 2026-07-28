window.__hotspotBoot = "single-agent";

const hotspotQuestionInput = document.getElementById("hotspotQuestionInput");
const hotspotBtn = document.getElementById("hotspotBtn");
const statusMessage = document.getElementById("statusMessage");
const hotspotOverview = document.getElementById("hotspotOverview");
const hotTopics = document.getElementById("hotTopics");
const representativeResults = document.getElementById("representativeResults");
const analysisReportWrap = document.getElementById("analysisReportWrap");
const pieChartWrap = document.getElementById("pieChartWrap");
const barChartWrap = document.getElementById("barChartWrap");
const radarChartWrap = document.getElementById("radarChartWrap");
const lineChartWrap = document.getElementById("lineChartWrap");
const HOTSPOT_STATE_KEY = "hotspot-page-state-v3";
let activeHotspotRequestId = 0;

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function setHtml(element, value) {
  if (!element) return;
  element.innerHTML = value;
}

function saveHotspotState(state) {
  localStorage.setItem(HOTSPOT_STATE_KEY, JSON.stringify(state));
}

function clearHotspotState() {
  localStorage.removeItem(HOTSPOT_STATE_KEY);
}

function loadHotspotState() {
  try {
    return JSON.parse(localStorage.getItem(HOTSPOT_STATE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function setLoading(isLoading, message = "") {
  if (hotspotBtn) {
    hotspotBtn.disabled = isLoading;
    hotspotBtn.textContent = isLoading ? "监测中..." : "开始热点监测";
  }
  setText(statusMessage, message);
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
    /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    '<figure class="markdown-figure"><img src="$2" alt="$1" /><figcaption>$1</figcaption></figure>'
  );
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

  const headingNamePattern = (names) =>
    names
      .map((name) => escapeRegExp(name))
      .map((name) => `(?:[一二三四五六七八九十0-9]+[、.]\\s*)?${name}`)
      .join("|");

  const startPattern = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:${headingNamePattern(startNames)})\\s*$`,
    "m"
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) return "";

  const afterStart = source.slice(startMatch.index + startMatch[0].length).trimStart();
  let endIndex = afterStart.length;

  endNames.forEach((name) => {
    const endPattern = new RegExp(
      `^\\s*(?:#{1,6}\\s*)?(?:[一二三四五六七八九十0-9]+[、.]\\s*)?${escapeRegExp(name)}\\s*$`,
      "m"
    );
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
    if (/^(?:#{1,6}\s*)?\d+[.、]\s*/.test(line)) {
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
    `(?:^|\\n)\\s*(?:[-*]\\s*)?${escapeRegExp(label)}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:${escapedLabels})\\s*[:：]|$)`
  );
  const match = pattern.exec(block);
  return match ? match[1].trim() : "";
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s)）\]]+/);
  return match ? match[0] : "";
}

function parseMarkdownLinks(text) {
  const matches = Array.from(String(text || "").matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g));
  return matches.map((match) => ({
    title: String(match[1] || "").trim(),
    url: String(match[2] || "").trim(),
  }));
}

function stripMarkdownLinks(text) {
  return String(text || "").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1").trim();
}

function firstValue(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function parseHotspotText(text) {
  const source = normalizeText(text);
  const overview = extractSection(source, ["热点概况", "执行摘要"], ["数据概况", "当前热点主题", "可视化图表", "代表性检索结果", "分析报告"]);
  const topicsSection = extractSection(source, ["当前热点主题"], ["可视化图表", "代表性检索结果", "分析报告"]);
  const resultsSection = extractSection(source, ["代表性检索结果"], ["分析报告"]);
  const reportSection = extractSection(source, ["分析报告"], []);
  const topicLabels = ["热度依据", "主要内容", "主要发现", "代表性依据", "代表性证据", "相关检索结果"];
  const resultLabels = ["来源", "发布时间", "摘要", "链接"];

  const topics = splitNumberedBlocks(topicsSection).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const rawTitle = (lines[0] || `热点主题 ${index + 1}`)
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\d+[.、]\s*/, "");
    const heatMatch = rawTitle.match(/（热度[:：]\s*([^）]+)）/);
    const title = rawTitle.replace(/（热度[:：]\s*[^）]+）/, "").trim();
    const evidenceText =
      parseLabeledValue(block, "代表性依据", topicLabels) ||
      parseLabeledValue(block, "代表性证据", topicLabels);
    const heatBasis = parseLabeledValue(block, "热度依据", topicLabels);
    const relatedText = parseLabeledValue(block, "相关检索结果", topicLabels);
    const relatedResults = [];
    const explicitLinks = parseMarkdownLinks(relatedText);
    const evidenceLinks = parseMarkdownLinks(evidenceText);

    if (explicitLinks.length) {
      relatedResults.push(...explicitLinks);
    } else if (evidenceLinks.length) {
      relatedResults.push(...evidenceLinks);
    } else {
      const fallbackText = relatedText || evidenceText;
      fallbackText
        .split("\n")
        .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+[.、]\s*/, "").trim())
        .filter(Boolean)
        .forEach((line) => {
          relatedResults.push({ title: line, url: extractFirstUrl(line) });
        });
    }
    return {
      title,
      heat: heatMatch ? heatMatch[1].trim() : "",
      heat_basis: heatBasis,
      main_content:
        parseLabeledValue(block, "主要内容", topicLabels) ||
        parseLabeledValue(block, "主要发现", topicLabels),
      evidence: stripMarkdownLinks(evidenceText),
      related_results: relatedResults,
    };
  });

  const representative = splitNumberedBlocks(resultsSection).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = (lines[0] || `检索结果 ${index + 1}`).replace(/^\d+[.、]\s*/, "");
    const linkText = parseLabeledValue(block, "链接", resultLabels);
    return {
      title,
      source: parseLabeledValue(block, "来源", resultLabels),
      published_at: parseLabeledValue(block, "发布时间", resultLabels),
      summary: parseLabeledValue(block, "摘要", resultLabels),
      url: extractFirstUrl(linkText || block),
      link_text: linkText,
    };
  });

  return {
    overview,
    topics,
    representative,
    reportText: reportSection,
    reportUrl: extractFirstUrl(reportSection),
  };
}

function normalizeTopics(data, parsed) {
  const allRepresentativeResults = normalizeRepresentativeResults(data, parsed);
  const topics =
    Array.isArray(data?.["当前热点主题"]) && data["当前热点主题"].length
      ? data["当前热点主题"]
      : Array.isArray(data?.hot_topics) && data.hot_topics.length
        ? data.hot_topics
        : parsed.topics;
  const parsedTopics = Array.isArray(parsed?.topics) ? parsed.topics : [];
  return topics.map((topic, index) => {
    const parsedTopic = parsedTopics[index] || {};
    if (typeof topic === "string") {
      return {
        title: topic || parsedTopic.title || `热点主题 ${index + 1}`,
        heat: parsedTopic.heat || "",
        main_content: parsedTopic.main_content || "",
        key_findings: [],
        related_results: Array.isArray(parsedTopic.related_results) ? parsedTopic.related_results : [],
      };
    }
    const keyFindings = Array.isArray(topic.key_findings)
      ? topic.key_findings.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const markdownKeyFindings = Array.isArray(topic["主要发现"])
      ? topic["主要发现"].map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const explicitRelatedResults = Array.isArray(topic["相关检索结果"])
      ? topic["相关检索结果"]
      : Array.isArray(topic.related_results)
        ? topic.related_results
        : Array.isArray(topic.references)
          ? topic.references
          : [];
    const fallbackRelatedResults = (() => {
      if (explicitRelatedResults.length) return explicitRelatedResults;
      if (Array.isArray(parsedTopic.related_results) && parsedTopic.related_results.length) {
        return parsedTopic.related_results;
      }
      const titleText = String(firstValue(topic, ["title", "topic", "name"]) || parsedTopic.title || "");
      const bodyText = [
        titleText,
        ...keyFindings,
        String(firstValue(topic, ["summary", "main_content", "content"]) || ""),
      ].join(" ");
      const keywordCandidates = bodyText
        .split(/[，。；：、（）()\-\s/]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 16)
        .filter(
          (item) =>
            !["语义通信", "研究", "技术", "方向", "核心", "当前", "基础", "领域", "发展", "推进"].includes(item)
        );
      const scored = allRepresentativeResults
        .map((result) => {
          const haystack = `${result.title || ""} ${result.summary || ""} ${result.source || ""}`;
          const score = keywordCandidates.reduce((acc, keyword) => {
            return acc + (haystack.includes(keyword) || titleText.includes(keyword) ? 1 : 0);
          }, 0);
          return { result, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((item) => ({ title: item.result.title, url: item.result.url }));
      if (scored.length) return scored;
      return allRepresentativeResults.slice(0, 2).map((item) => ({ title: item.title, url: item.url }));
    })();
    return {
      title: firstValue(topic, ["title", "topic", "name"]) || parsedTopic.title || `热点主题 ${index + 1}`,
      heat:
        firstValue(topic, ["热度", "heat", "level", "hotness", "heat_level"]) ||
        (topic.evidence_count ? `证据数 ${topic.evidence_count}` : "") ||
        parsedTopic.heat ||
        "",
      main_content:
        firstValue(topic, ["主要内容", "main_content", "content", "summary", "core"]) ||
        (keyFindings.length ? keyFindings.join("；") : "") ||
        (markdownKeyFindings.length ? markdownKeyFindings.join("；") : "") ||
        (Array.isArray(topic.key_findings) ? topic.key_findings.join("；") : "") ||
        parsedTopic.main_content ||
        "",
      key_findings:
        keyFindings.length
          ? keyFindings
          : markdownKeyFindings.length
            ? markdownKeyFindings
            : parsedTopic.main_content
              ? String(parsedTopic.main_content).split("；").map((item) => item.trim()).filter(Boolean)
              : [],
      related_results: fallbackRelatedResults,
    };
  });
}

function normalizeRelatedResultItem(item) {
  if (!item) return null;
  if (typeof item === "string") {
    const extractedUrl = extractFirstUrl(item);
    const plainText = item.replace(/https?:\/\/[^\s)）\]]+/g, "").trim();
    return {
      title: plainText || extractedUrl || "",
      url: extractedUrl || "",
    };
  }
  return {
    title: firstValue(item, ["title", "name", "text"]) || "",
    url: firstValue(item, ["url", "link"]) || "",
  };
}

function normalizeRepresentativeResults(data, parsed) {
  const results =
    Array.isArray(data?.["代表性检索结果"]) && data["代表性检索结果"].length
      ? data["代表性检索结果"]
      : Array.isArray(data?.representative_results) && data.representative_results.length
      ? data.representative_results
      : Array.isArray(data?.clean_results) && data.clean_results.length
        ? data.clean_results
      : parsed.representative;

  return results.map((item, index) => {
    if (typeof item === "string") {
      return { title: item || `检索结果 ${index + 1}` };
    }
    return {
      title: firstValue(item, ["title", "name"]) || `检索结果 ${index + 1}`,
      source: firstValue(item, ["来源", "source", "channel", "site"]),
      published_at: firstValue(item, ["发布时间", "published_at", "published", "published_date", "date", "time"]),
      summary: firstValue(item, ["摘要", "summary", "abstract", "description", "content"]),
      url: firstValue(item, ["链接", "url", "link"]) || extractFirstUrl(JSON.stringify(item)),
      link_text: firstValue(item, ["link_text", "链接"]),
    };
  });
}

function parseEvidenceLines(evidenceText) {
  return String(evidenceText || "")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+[.、]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const markdownLinks = parseMarkdownLinks(line);
      if (markdownLinks.length) {
        return markdownLinks.map((item) => ({
          title: item.title,
          url: item.url,
        }));
      }
      const extractedUrl = extractFirstUrl(line);
      return {
        title: line.replace(/https?:\/\/[^\s)）\]]+/g, "").trim() || extractedUrl || "",
        url: extractedUrl || "",
      };
    })
    .flat();
}

function renderHotTopics(topics) {
  if (!hotTopics) return;
  if (!Array.isArray(topics) || !topics.length) {
    hotTopics.innerHTML = '<div class="result-empty">暂无热点主题</div>';
    return;
  }

  const heatClassName = (heat) => {
    const text = String(heat || "").trim();
    if (!text) return "topic-meta";
    if (/(极高|最高|very high|high)/i.test(text)) return "topic-meta topic-meta-high";
    if (/(较高|中高|medium)/i.test(text)) return "topic-meta topic-meta-medium";
    if (/(低|较低|low)/i.test(text)) return "topic-meta topic-meta-low";
    return "topic-meta";
  };

  hotTopics.innerHTML = topics
    .map(
      (topic, index) => `
        <article class="hotspot-topic-card">
          <div class="topic-index">${index + 1}</div>
          <div class="topic-body">
            <div class="hotspot-topic-title-row">
              <strong>${escapeHtml(topic.title || `热点主题 ${index + 1}`)}</strong>
              ${topic.heat ? `<span class="${heatClassName(topic.heat)}">热度：${escapeHtml(topic.heat)}</span>` : ""}
            </div>
            <div class="hotspot-topic-section">
              <span>主要内容</span>
              <p>${escapeHtml(topic.main_content || "暂无主要内容")}</p>
            </div>
            <div class="hotspot-topic-section">
              <span>关键发现</span>
              ${
                Array.isArray(topic.key_findings) && topic.key_findings.length
                  ? `<ul>${topic.key_findings.map((item) => `<li><span>${escapeHtml(item)}</span></li>`).join("")}</ul>`
                  : `<p>${escapeHtml(topic.main_content || "暂无关键发现")}</p>`
              }
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRepresentativeResults(items) {
  if (!representativeResults) return;
  if (!Array.isArray(items) || !items.length) {
    representativeResults.innerHTML = '<div class="result-empty">暂无代表性检索结果</div>';
    return;
  }

  representativeResults.innerHTML = items
    .map(
      (item, index) => `
        <article class="representative-result-card">
          <div class="representative-result-head">
            <span class="topic-index">${index + 1}</span>
            <div>
              <strong>
                ${escapeHtml(item.title || "未命名结果")}
              </strong>
              <div class="topic-cloud">
                ${item.source ? `<span class="topic-pill">${escapeHtml(item.source)}</span>` : ""}
                ${item.published_at ? `<span class="topic-pill">${escapeHtml(item.published_at)}</span>` : ""}
              </div>
            </div>
          </div>
          <p>${escapeHtml(item.summary || "暂无摘要")}</p>
          ${
            item.url
              ? `<div class="scholar-paper-link-row"><a class="mindmap-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">查看链接</a></div>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

function renderChart(container, chartData, emptyText) {
  if (!container) return;
  const value = chartData || "";
  const imageUrl = typeof value === "string" ? extractFirstUrl(value) || value.trim() : firstValue(value, ["url", "image", "src", "data"]);
  if (!imageUrl) {
    container.className = "chart-embed-empty";
    container.innerHTML = escapeHtml(emptyText);
    return;
  }
  container.className = "chart-embed";
  container.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(emptyText)}" />`;
}

function renderReport(data, parsed) {
  const reportUrl = firstValue(data, ["分析报告", "report_url", "document_url", "markdown_url"]) || parsed.reportUrl;
  const reportText = firstValue(data, ["report_title", "report_name", "分析报告"]) || parsed.reportText || "";
  if (!analysisReportWrap) return;
  if (reportUrl) {
    analysisReportWrap.innerHTML = `<a class="mindmap-link" href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener noreferrer">${
      escapeHtml(reportText.replace(/\n/g, " ").trim() || "打开完整分析报告")
    }</a>`;
    return;
  }
  if (reportText) {
    analysisReportWrap.innerHTML = `<span class="topic-pill">${escapeHtml(reportText.replace(/\n/g, " ").trim())}</span>`;
    return;
  }
  analysisReportWrap.innerHTML = '<span class="topic-pill topic-pill-empty">尚未生成报告链接</span>';
}

function renderHotspot(data) {
  const output = firstValue(data, ["agent_output", "formatted_result", "output", "report", "answer"]);
  const parsed = parseHotspotText(output);
  const overview =
    firstValue(data, ["热点概况", "hotspot_overview", "overview", "summary", "trend_summary"]) ||
    parsed.overview ||
    firstValue(data, ["trend_summary"]);
  const topics = normalizeTopics(data, parsed);
  const results = normalizeRepresentativeResults(data, parsed);

  hotspotOverview.innerHTML = overview ? inlineMarkdown(overview) : "暂无热点概况";
  renderHotTopics(topics);
  renderRepresentativeResults(results);
  renderChart(pieChartWrap, firstValue(data, ["来源分布饼图", "pie", "pie_chart"]), "暂无来源分布图");
  renderChart(barChartWrap, firstValue(data, ["热点主题柱状图", "bar", "bar_chart"]), "暂无热点主题分布图");
  renderChart(radarChartWrap, firstValue(data, ["热点主题雷达图", "radar", "rader", "radar_chart"]), "暂无热点主题雷达图");
  renderChart(lineChartWrap, firstValue(data, ["发布时间趋势图", "line", "line_chart"]), "暂无发布时间趋势图");
  renderReport(data, parsed);
  saveHotspotState({
    hotspot_question: hotspotQuestionInput?.value.trim() || "",
    data,
    status: "热点监测完成",
  });
}

async function queryHotspot() {
  const requestId = ++activeHotspotRequestId;
  const hotspotQuestion = hotspotQuestionInput?.value.trim() || "";
  if (!hotspotQuestion) {
    setText(statusMessage, "请先输入热点问题");
    return;
  }

  setLoading(true, "正在调用智能体进行热点监测...");
  clearHotspotState();
  try {
    const response = await fetch("/api/hotspot-monitoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotspot_question: hotspotQuestion }),
    });
    const result = await response.json();
    if (requestId !== activeHotspotRequestId) return;
    if (!response.ok || !result.success) {
      throw new Error(result.detail || result.message || "热点监测失败");
    }
    renderHotspot(result.data || {});
    const state = {
      hotspot_question: hotspotQuestion,
      data: result.data || {},
      status: "热点监测完成",
    };
    saveHotspotState(state);
    setText(statusMessage, state.status);
  } catch (error) {
    if (requestId !== activeHotspotRequestId) return;
    setText(statusMessage, error.message || "热点监测失败");
  } finally {
    if (requestId !== activeHotspotRequestId) return;
    setLoading(false, statusMessage?.textContent || "");
  }
}

hotspotBtn?.addEventListener("click", queryHotspot);
hotspotQuestionInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    queryHotspot();
  }
});

const hotspotSavedState = loadHotspotState();
if (hotspotSavedState) {
  if (hotspotQuestionInput && hotspotSavedState.hotspot_question) {
    hotspotQuestionInput.value = hotspotSavedState.hotspot_question;
  }
  renderHotspot(hotspotSavedState.data || {});
  setText(statusMessage, hotspotSavedState.status || "");
} else {
  setText(statusMessage, "");
}
