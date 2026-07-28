const knowledgeFileInput = document.getElementById("knowledgeFileInput");
const knowledgeUrlInput = document.getElementById("knowledgeUrlInput");
const knowledgeUploadBtn = document.getElementById("knowledgeUploadBtn");
const knowledgeList = document.getElementById("knowledgeList");
const knowledgeListHint = document.getElementById("knowledgeListHint");
const knowledgeDetailHeadingText = document.getElementById("knowledgeDetailHeadingText");
const knowledgeDetailTitle = document.getElementById("knowledgeDetailTitle");
const knowledgeDetailContent = document.getElementById("knowledgeDetailContent");
const knowledgeActionHint = document.getElementById("knowledgeActionHint");
const statusMessage = document.getElementById("statusMessage");
const paperSectionPanel = document.getElementById("paperSectionPanel");
const knowledgeShowBtn = document.getElementById("knowledgeShowBtn");
const knowledgeLayout = document.querySelector(".knowledge-layout");
const knowledgeUploadRow = document.querySelector(".knowledge-upload-row");
const knowledgeListBlock = document.querySelector(".knowledge-list-block");
const knowledgeDetailBlock = document.querySelector(".knowledge-detail-block");
const knowledgeDetailFields = knowledgeDetailBlock?.querySelector(".knowledge-detail-fields");

const entryTabs = Array.from(document.querySelectorAll("#knowledgeEntryTabs .entry-tab"));
const sectionTabs = Array.from(document.querySelectorAll("#paperSectionTabs .entry-tab"));

const STORAGE_KEY = "knowledge-page-state-v11";
const PENDING_IMPORT_KEY = "knowledge-page-pending-import-v1";
let activeKnowledgeRequestId = 0;

let currentEntryType = "paper";
let currentSectionType = "innovation";
let currentItems = [];

function isMeaningfulValue(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return !["未知", "暂无", "暂无内容", "暂无项目内容", "暂无年限", "未开始", "项目尚未开始", "0%", "0"].includes(text);
}

function isInvalidMeetingItem(item) {
  const mainContent = String(item?.extra?.main_content || item?.content || "").trim();
  return mainContent.includes("PDF_READ_FAILED");
}

function isInvalidProjectItem(item) {
  const extra = item?.extra || {};
  const basicInfo = String(extra.basic_info || item?.content || "").trim();
  const partnerOrgs = String(extra.partner_orgs || "").trim();
  const period = String(extra.period || "").trim();
  const progressDesc = String(extra.progress_desc || "").trim();
  const status = String(extra.status || "").trim();
  const progressPercent = String(extra.progress_percent || "").trim();

  const hasRealContent =
    isMeaningfulValue(basicInfo) ||
    isMeaningfulValue(partnerOrgs) ||
    isMeaningfulValue(period) ||
    isMeaningfulValue(progressDesc) ||
    (status && status !== "未开始") ||
    (progressPercent && progressPercent !== "0");

  return !hasRealContent;
}

function sanitizeKnowledgeItems(entryType, items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  if (entryType === "meeting") {
    return normalizedItems.filter((item) => !isInvalidMeetingItem(item));
  }
  if (entryType === "project") {
    return normalizedItems.filter((item) => !isInvalidProjectItem(item));
  }
  return normalizedItems;
}

function setText(element, value) {
  if (!element) return;
  element.textContent = value || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMultilineText(value) {
  return escapeHtml(value || "暂无内容").replace(/\n/g, "<br />");
}

function normalizeArrayText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).join("、");
  }
  return String(value || "").trim();
}

function renderDetailHtml(titleHtml, contentHtml, metaHtml) {
  if (knowledgeDetailTitle) knowledgeDetailTitle.innerHTML = titleHtml || "";
  if (knowledgeDetailContent) {
    knowledgeDetailContent.innerHTML = `${contentHtml || ""}${metaHtml || ""}`;
  }
}

function getPaperSectionLabel(sectionType) {
  const sectionLabelMap = {
    innovation: "创新点",
    system_model: "系统模型",
    algorithm: "算法",
    dataset: "数据集",
    related_work: "总结",
  };
  return sectionLabelMap[sectionType] || "内容";
}

function renderPaperMetaBlock(item) {
  const authorsText = normalizeArrayText(item?.extra?.authors) || "暂无作者";
  const keywordsText = normalizeArrayText(item?.extra?.keywords) || "暂无关键词";
  return `
    <div class="knowledge-detail-stack">
      <div class="knowledge-detail-section">
        <div class="knowledge-paper-title">${formatMultilineText(item?.title || "暂无标题")}</div>
      </div>
      ${renderStackSection("作者", authorsText, "暂无作者")}
      ${renderStackSection("关键词", keywordsText, "暂无关键词")}
      ${renderStackSection(getPaperSectionLabel(currentSectionType), item?.extra?.content || item?.meta || item?.content || "暂无内容")}
    </div>
  `;
}

function renderStackSection(label, value, fallback = "暂无内容") {
  return `
    <div class="knowledge-detail-section">
      <span class="knowledge-detail-label">${escapeHtml(label)}</span>
      <div>${formatMultilineText(value || fallback)}</div>
    </div>
  `;
}

function setStatus(message, isError = false) {
  if (!statusMessage) return;
  statusMessage.textContent = message || "";
  statusMessage.classList.toggle("error", Boolean(isError));
}

function getEntryTypeLabel(entryType) {
  if (entryType === "meeting") return "组会";
  if (entryType === "project") return "项目";
  return "论文";
}

function persistState() {
  const payload = {
    currentEntryType,
    currentSectionType,
    currentItems,
    showPaperSections: !paperSectionPanel?.classList.contains("hidden"),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function clearKnowledgeState() {
  localStorage.removeItem(STORAGE_KEY);
}

function getDefaultStatusMessage(entryType) {
  if (entryType === "meeting") {
    return "已切换到组会库模式，可以直接查看组会库内容，也可以补充上传新的组会文件";
  }
  if (entryType === "project") {
    return "已切换到项目库模式，可以直接查看项目库内容，也可以补充上传新的项目文件";
  }
  return "知识库页面已就绪：请先上传论文，或点击上方五类按钮查看论文库内容";
}

function hydrateState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") return false;

    currentEntryType = "paper";
    currentSectionType = payload.currentSectionType || "innovation";
    currentItems = Array.isArray(payload.currentItems) && payload.currentEntryType === "paper"
      ? payload.currentItems
      : [];

    setEntryType(currentEntryType, false);
    if (currentEntryType === "paper" && currentItems.length) {
      setSectionType(currentSectionType, false);
    } else {
      clearSectionTabHighlight();
    }
    togglePaperSections(currentEntryType === "paper");
    renderKnowledgeList(currentItems);
    setStatus(getDefaultStatusMessage(currentEntryType));
    return true;
  } catch (error) {
    console.error("Failed to hydrate knowledge state", error);
    return false;
  }
}

function loadPendingImportState() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_IMPORT_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function clearPendingImportState() {
  localStorage.removeItem(PENDING_IMPORT_KEY);
}

function togglePaperSections(visible) {
  paperSectionPanel?.classList.toggle("hidden", !visible);
}

function setKnowledgeLayoutMode(entryType) {
  knowledgeLayout?.classList.add("knowledge-layout-single");
  knowledgeListBlock?.classList.add("hidden");
  knowledgeDetailBlock?.classList.add("knowledge-detail-block-wide", "knowledge-detail-block-immersive");
  knowledgeDetailFields?.classList.remove("hidden");
}

function setEntryType(nextType, persist = true) {
  currentEntryType = nextType;
  entryTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.entryType === nextType);
  });

  const typeHintMap = {
    paper: "✦ 当前模式：论文入库。上传后会先写入论文库，再开启五类内容查看。",
    meeting: "✦ 当前模式：组会库。你可以直接查看组会库内容，也可以补充上传新的组会文件。",
    project: "✦ 当前模式：项目库。你可以直接查看项目库内容，也可以补充上传新的项目文件。",
  };
  setText(knowledgeActionHint, typeHintMap[nextType] || "请选择知识库类型");

  togglePaperSections(nextType === "paper");
  if (knowledgeFileInput) {
    knowledgeFileInput.value = "";
  }
  if (knowledgeUrlInput) {
    knowledgeUrlInput.value = "";
  }
  setKnowledgeLayoutMode(nextType);
  if (knowledgeShowBtn) {
    const shouldShow = nextType === "meeting" || nextType === "project";
    knowledgeShowBtn.classList.toggle("hidden", !shouldShow);
    knowledgeShowBtn.textContent = nextType === "meeting" ? "显示组会库内容" : nextType === "project" ? "显示项目库内容" : "直接显示库内容";
  }
  knowledgeUploadRow?.classList.toggle("url-hidden", nextType === "meeting" || nextType === "project");
  if (knowledgeUploadBtn) {
    knowledgeUploadBtn.textContent =
      nextType === "paper"
        ? "上传并写入知识库"
        : nextType === "meeting"
          ? "上传组会库"
          : "上传项目库";
  }
  if (!currentItems.length) {
    renderKnowledgeList([]);
  }
  if (persist) persistState();
}

function setSectionType(nextType, persist = true) {
  currentSectionType = nextType;
  sectionTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.sectionType === nextType);
  });
  if (persist) persistState();
}

function clearSectionTabHighlight() {
  sectionTabs.forEach((tab) => tab.classList.remove("active"));
}

function renderKnowledgeDetail(item) {
  if (!item) {
    if (knowledgeDetailHeadingText) knowledgeDetailHeadingText.textContent = "内容详情";
    setText(knowledgeDetailTitle, "");
    setText(
      knowledgeDetailContent,
      currentEntryType === "paper"
        ? "请先完成上传，或点击上方分区按钮查看论文库内容"
        : currentEntryType === "meeting"
          ? "请点击“显示组会库内容”或上传新的组会文件"
          : "请点击“显示项目库内容”或上传新的项目文件",
    );
    persistState();
    return;
  }
  if (knowledgeDetailHeadingText) knowledgeDetailHeadingText.textContent = "";
  setText(knowledgeDetailTitle, "");
  setText(knowledgeDetailContent, "");
  persistState();
}

function renderKnowledgeList(items) {
  currentItems = sanitizeKnowledgeItems(currentEntryType, items);

  if (!knowledgeDetailContent) return;
  if (!currentItems.length) {
    if (knowledgeDetailHeadingText) knowledgeDetailHeadingText.textContent = "内容详情";
    knowledgeDetailContent.innerHTML = `<div class="result-empty">${
      currentEntryType === "paper"
        ? "暂无知识记录，请先上传论文或点击下方五类按钮查看论文库内容"
        : currentEntryType === "meeting"
          ? "暂无组会内容，请点击“显示组会库内容”或上传新的组会文件"
          : "暂无项目内容，请点击“显示项目库内容”或上传新的项目文件"
    }</div>`;
    renderKnowledgeDetail(null);
    return;
  }

  const cardsHtml = currentItems.map((item) => {
    if (currentEntryType === "meeting") {
      return `
        <article class="representative-result-card knowledge-detail-card">
          <div class="knowledge-detail-stack">
            ${renderStackSection("组会时间", item.extra?.zuhui_time || item.title, "暂无组会时间")}
            ${renderStackSection("主要内容", item.extra?.main_content || item.content, "暂无主要内容")}
            ${renderStackSection("老师建议", item.extra?.advice || item.extra?.teacher_advice, "暂无老师建议")}
            ${renderStackSection("下一步方向", item.extra?.plan || item.extra?.next_plan, "暂无下一步方向")}
          </div>
        </article>
      `;
    }

    if (currentEntryType === "project") {
      return `
        <article class="representative-result-card knowledge-detail-card">
          <div class="knowledge-detail-stack">
            ${renderStackSection("项目名称", item.title || "未命名项目")}
            ${renderStackSection("基础信息", item.extra?.basic_info || item.content, "暂无基础信息")}
            ${renderStackSection("合作单位", item.extra?.partner_orgs, "暂无合作单位")}
            ${renderStackSection("年限", item.extra?.period, "暂无年限")}
            ${renderStackSection("过程描述", item.extra?.progress_desc, "暂无过程描述")}
            ${renderStackSection("状态", item.extra?.status, "暂无状态")}
            ${renderStackSection("完成度", item.extra?.progress_percent ? `${item.extra.progress_percent}%` : "", "暂无完成度")}
          </div>
        </article>
      `;
    }

    const extra = item.extra || {};
    const authorsText = normalizeArrayText(extra.authors) || "暂无作者";
    const keywordsText = normalizeArrayText(extra.keywords) || "暂无关键词";
    return `
      <article class="representative-result-card knowledge-detail-card">
        <div class="knowledge-detail-stack">
          <div class="knowledge-detail-section">
            <div class="knowledge-paper-title">${formatMultilineText(item.title || "暂无标题")}</div>
          </div>
          ${renderStackSection("作者", authorsText, "暂无作者")}
          ${renderStackSection("关键词", keywordsText, "暂无关键词")}
          ${renderStackSection(getPaperSectionLabel(currentSectionType), extra.content || item.meta || item.content || "暂无内容")}
        </div>
      </article>
    `;
  }).join("");

  if (knowledgeDetailHeadingText) knowledgeDetailHeadingText.textContent = "";
  setText(knowledgeDetailTitle, "");
  knowledgeDetailContent.innerHTML = cardsHtml;
  persistState();
}

async function callKnowledgeApi({ action, sectionType = "" }) {
  const formData = new FormData();
  formData.append("entry_type", currentEntryType);
  formData.append("action", action);
  if (sectionType) formData.append("section_type", sectionType);

  if (action === "import") {
    const file = knowledgeFileInput?.files?.[0];
    const url = knowledgeUrlInput?.value.trim() || "";
    if (!file && !url) {
      setStatus("请先上传文件或填写链接", true);
      return null;
    }
    if (file) formData.append("knowledge_file", file);
    if (url) formData.append("knowledge_url", url);
  }

  const response = await fetch("/api/knowledge", {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "知识库处理失败");
  }
  return result.data || {};
}

async function importKnowledge() {
  const requestId = ++activeKnowledgeRequestId;
  try {
    setStatus(
      currentEntryType === "paper"
        ? "正在写入论文库..."
        : currentEntryType === "meeting"
          ? "正在写入组会库..."
          : "正在写入项目库...",
    );
    knowledgeUploadBtn.disabled = true;
    if (knowledgeShowBtn) knowledgeShowBtn.disabled = true;
    clearKnowledgeState();
    const data = await callKnowledgeApi({ action: "import" });
    if (requestId !== activeKnowledgeRequestId) return;
    if (!data) return;

    togglePaperSections(Boolean(data.show_sections));
    renderKnowledgeList(data.items || []);
    setStatus(data.message || "知识库写入成功");

    if (currentEntryType === "paper") {
      renderDetailHtml(
        "论文已入库",
        `
          <div class="knowledge-detail-stack">
            <div class="knowledge-detail-section">
              <span class="knowledge-detail-label">当前状态</span>
              <div>论文已经顺利入库啦，下面会自动打开当前论文库里的“创新点”内容。</div>
            </div>
          </div>
        `,
        "",
      );
      persistState();
      await displayKnowledge({ sectionType: currentSectionType || "innovation" });
    } else {
      const importedItems = Array.isArray(data.items) ? data.items : [];
      if (!importedItems.length) {
        await displayKnowledge();
      } else {
        persistState();
      }
    }
  } catch (error) {
    if (requestId !== activeKnowledgeRequestId) return;
    console.error(error);
    setStatus(error.message || "知识库处理失败", true);
  } finally {
    if (requestId !== activeKnowledgeRequestId) return;
    knowledgeUploadBtn.disabled = false;
    if (knowledgeShowBtn) knowledgeShowBtn.disabled = false;
  }
}

async function displayKnowledge({ sectionType = "" } = {}) {
  const requestId = ++activeKnowledgeRequestId;
  try {
    const loadingText =
      currentEntryType === "paper"
        ? "正在加载论文库内容..."
        : currentEntryType === "meeting"
          ? "正在加载组会库内容..."
          : "正在加载项目库内容...";
    setStatus(loadingText);
    if (knowledgeShowBtn) knowledgeShowBtn.disabled = true;
    knowledgeUploadBtn.disabled = true;
    clearKnowledgeState();
    const data = await callKnowledgeApi({ action: "display", sectionType });
    if (requestId !== activeKnowledgeRequestId) return;
    if (!data) return;

    if (currentEntryType === "paper") {
      setSectionType(sectionType);
    }
    togglePaperSections(Boolean(data.show_sections));
    renderKnowledgeList(data.items || []);
    setStatus(
      data.message ||
        (currentEntryType === "paper"
          ? "论文知识内容加载完成"
          : currentEntryType === "meeting"
            ? "组会库内容加载完成"
            : "项目库内容加载完成"),
    );
  } catch (error) {
    if (requestId !== activeKnowledgeRequestId) return;
    console.error(error);
    setStatus(error.message || "知识库内容加载失败", true);
  } finally {
    if (requestId !== activeKnowledgeRequestId) return;
    if (knowledgeShowBtn) knowledgeShowBtn.disabled = false;
    knowledgeUploadBtn.disabled = false;
  }
}

entryTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setEntryType(tab.dataset.entryType || "paper");
    renderKnowledgeList([]);
    if (currentEntryType === "paper") {
      setStatus("已切换到论文库模式，请上传论文文件，或继续点击五类内容按钮查看论文库");
    } else if (currentEntryType === "meeting") {
      setStatus("已切换到组会库模式，可以直接查看组会库内容，也可以补充上传新的组会文件");
    } else {
      setStatus("已切换到项目库模式，可以直接查看项目库内容，也可以补充上传新的项目文件");
    }
  });
});

sectionTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const sectionType = tab.dataset.sectionType || "innovation";
    displayKnowledge({ sectionType });
  });
});

knowledgeUploadBtn?.addEventListener("click", importKnowledge);
knowledgeShowBtn?.addEventListener("click", () => displayKnowledge());
knowledgeFileInput?.addEventListener("change", () => {
  const file = knowledgeFileInput.files?.[0];
  if (file && knowledgeUrlInput) {
    knowledgeUrlInput.value = "";
  }
});
knowledgeUrlInput?.addEventListener("input", () => {
  if (!knowledgeUrlInput.value.trim()) return;
  if (knowledgeFileInput) {
    knowledgeFileInput.value = "";
  }
});

if (!hydrateState()) {
  setEntryType("paper", false);
  setSectionType("innovation", false);
  clearSectionTabHighlight();
  togglePaperSections(true);
  setKnowledgeLayoutMode("paper");
  renderKnowledgeList([]);
  setStatus(getDefaultStatusMessage("paper"));
  persistState();
}

const pendingImportState = loadPendingImportState();
if (pendingImportState?.auto_display && pendingImportState?.entry_type === "paper") {
  clearPendingImportState();
  setEntryType("paper", false);
  setSectionType(pendingImportState.section_type || "innovation", false);
  togglePaperSections(true);
  setStatus("检测到论文页刚完成入库，正在为你加载最新论文库内容...");
  displayKnowledge({ sectionType: pendingImportState.section_type || "innovation" });
}
