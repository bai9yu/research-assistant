const scholarNameInput = document.getElementById("scholarNameInput");
const scholarDirectionInput = document.getElementById("scholarDirectionInput");
const scholarSearchBtn = document.getElementById("scholarSearchBtn");
const scholarPaperList = document.getElementById("scholarPaperList");
const scholarStatusMessage = document.getElementById("statusMessage");
const SCHOLAR_STATE_KEY = "scholar-page-state-v1";
let activeScholarRequestId = 0;

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

function setLoading(isLoading, message = "") {
  if (scholarSearchBtn) {
    scholarSearchBtn.disabled = isLoading;
    scholarSearchBtn.textContent = isLoading ? "查询中..." : "查询学者论文";
  }
  setText(scholarStatusMessage, message);
}

function saveScholarState(state) {
  localStorage.setItem(SCHOLAR_STATE_KEY, JSON.stringify(state));
}

function clearScholarState() {
  localStorage.removeItem(SCHOLAR_STATE_KEY);
}

function loadScholarState() {
  try {
    return JSON.parse(localStorage.getItem(SCHOLAR_STATE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function renderScholarPapers(papers) {
  if (!scholarPaperList) return;
  if (!Array.isArray(papers) || !papers.length) {
    scholarPaperList.innerHTML = '<div class="result-empty">暂无论文列表</div>';
    return;
  }

  scholarPaperList.innerHTML = papers
    .map((paper, index) => {
      const authors = Array.isArray(paper.authors)
        ? paper.authors.filter(Boolean).map((item) => escapeHtml(item)).join("、")
        : escapeHtml(paper.authors || "");
      const venue = paper.venue || paper.source || "";
      const abstract = paper.abstract || "";
      const url = paper.url || "";

      return `
        <article class="planning-block scholar-paper-card">
          <div class="scholar-paper-head">
            <span class="topic-index">${index + 1}</span>
            <div class="scholar-paper-meta">
              <strong>${escapeHtml(paper.title || "未命名论文")}</strong>
              <div class="topic-cloud scholar-paper-tags">
                <span class="topic-pill">${escapeHtml(paper.year || "年份未知")}</span>
                <span class="topic-pill">${escapeHtml(venue || "来源待补充")}</span>
              </div>
            </div>
          </div>
          ${
            authors
              ? `
                <div class="result-row scholar-paper-row">
                  <span>作者</span>
                  <strong>${authors}</strong>
                </div>
              `
              : ""
          }
          <p class="scholar-paper-summary">${escapeHtml(abstract || "暂无摘要信息")}</p>
          <div class="scholar-paper-link-row">
            ${
              url
                ? `<a class="mindmap-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开论文链接</a>`
                : '<span class="topic-pill topic-pill-empty">暂无论文链接</span>'
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderScholarData(data) {
  const papers = Array.isArray(data?.papers) ? data.papers : [];
  renderScholarPapers(papers);
}

async function fetchScholarTracking() {
  const requestId = ++activeScholarRequestId;
  const scholarName = scholarNameInput?.value.trim() || "";
  const researchDirection = scholarDirectionInput?.value.trim() || "";

  if (!scholarName) {
    setText(scholarStatusMessage, "请先输入学者姓名");
    return;
  }

  setLoading(true, "正在查询学者论文...");
  clearScholarState();

  try {
    const response = await fetch("/api/scholar-tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scholar_name: scholarName,
      }),
    });

    const payload = await response.json();
    if (requestId !== activeScholarRequestId) return;
    if (!response.ok) {
      throw new Error(payload?.detail || "学者追踪请求失败");
    }

    if (!payload?.success) {
      throw new Error(payload?.message || "学者追踪返回失败");
    }

    const state = {
      scholar_name: scholarName,
      research_direction: researchDirection,
      data: payload.data || {},
      status: "学者追踪结果已更新",
    };
    renderScholarData(state.data);
    setText(scholarStatusMessage, state.status);
    saveScholarState(state);
  } catch (error) {
    if (requestId !== activeScholarRequestId) return;
    setText(scholarStatusMessage, error.message || "学者追踪请求失败");
    renderScholarPapers([]);
  } finally {
    if (requestId !== activeScholarRequestId) return;
    setLoading(false);
  }
}

scholarSearchBtn?.addEventListener("click", fetchScholarTracking);

[scholarNameInput, scholarDirectionInput].forEach((input) => {
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      fetchScholarTracking();
    }
  });
});

const scholarSavedState = loadScholarState();
if (scholarSavedState) {
  if (scholarNameInput && scholarSavedState.scholar_name) scholarNameInput.value = scholarSavedState.scholar_name;
  if (scholarDirectionInput && scholarSavedState.research_direction !== undefined) {
    scholarDirectionInput.value = scholarSavedState.research_direction;
  }
  renderScholarData(scholarSavedState.data || {});
  setText(scholarStatusMessage, scholarSavedState.status || "");
} else {
  setText(scholarStatusMessage, "");
}
