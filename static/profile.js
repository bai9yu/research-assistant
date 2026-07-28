const studentNoInput = document.getElementById("studentNoInput");
const nameInput = document.getElementById("nameInput");
const stageInput = document.getElementById("stageInput");
const directionInput = document.getElementById("directionInput");
const nameGroup = document.getElementById("nameGroup");
const stageGroup = document.getElementById("stageGroup");
const directionGroup = document.getElementById("directionGroup");
const searchTip = document.getElementById("searchTip");
const promptBanner = document.getElementById("promptBanner");
const queryBtn = document.getElementById("queryBtn");
const statusMessage = document.getElementById("statusMessage");
const PROFILE_STATE_KEY = "profile-page-state-v1";
let activeProfileRequestId = 0;

const dom = {
  readCount: document.getElementById("readCount"),
  collectCount: document.getElementById("collectCount"),
  activeProjectCount: document.getElementById("activeProjectCount"),
  meetingCount: document.getElementById("meetingCount"),
  statusSummary: document.getElementById("statusSummary"),
  mainProblems: document.getElementById("mainProblems"),
  actionPlan: document.getElementById("actionPlan"),
  recommendedTopics: document.getElementById("recommendedTopics"),
};

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function saveProfileState(state) {
  localStorage.setItem(PROFILE_STATE_KEY, JSON.stringify(state));
}

function clearProfileState() {
  localStorage.removeItem(PROFILE_STATE_KEY);
}

function loadProfileState() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STATE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function setLoading(isLoading, message = "") {
  queryBtn.disabled = isLoading;
  const hasProfileValues = Boolean(
    nameInput.value.trim() || stageInput.value.trim() || directionInput.value.trim()
  );
  const idleText = hasProfileValues ? "提交并生成画像" : "重新生成科研画像";
  const loadingText = hasProfileValues ? "提交并生成中..." : "查询处理中...";
  setText(queryBtn, isLoading ? loadingText : idleText);
  setText(statusMessage, message);
}

function toggleProfileFields(visible) {
  if (promptBanner) {
    promptBanner.classList.toggle("hidden", !visible);
  }
  if (searchTip) {
    searchTip.textContent = visible
      ? ""
      : "";
  }
  const hasProfileValues = Boolean(
    nameInput.value.trim() || stageInput.value.trim() || directionInput.value.trim()
  );
  setText(queryBtn, visible || hasProfileValues ? "提交并生成画像" : "重新生成科研画像");
}

function renderList(element, items, ordered = false) {
  if (!element) return;
  element.innerHTML = "";
  const normalized = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!normalized.length) {
    const empty = document.createElement("li");
    empty.textContent = "暂无内容";
    element.appendChild(empty);
    return;
  }

  normalized.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    element.appendChild(li);
  });
}

function renderActionPlan(container, plans) {
  if (!container) return;
  container.innerHTML = "";

  const normalized = Array.isArray(plans) ? plans.filter(Boolean) : [];
  if (!normalized.length) {
    const empty = document.createElement("div");
    empty.className = "priority-item priority-medium";
    empty.innerHTML = "<span>中</span><p>暂无行动建议</p>";
    container.appendChild(empty);
    return;
  }

  const priorityMap = {
    high: { label: "高", className: "priority-high" },
    medium: { label: "中", className: "priority-medium" },
    low: { label: "低", className: "priority-low" },
  };

  normalized.forEach((plan) => {
    const priorityKey = String(plan.priority || "medium").toLowerCase();
    const meta = priorityMap[priorityKey] || priorityMap.medium;
    const item = document.createElement("div");
    item.className = `priority-item ${meta.className}`;

    const badge = document.createElement("span");
    badge.textContent = meta.label;

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = plan.title || "未命名行动";
    const detail = document.createElement("p");
    detail.textContent = plan.detail || "暂无具体说明";

    copy.appendChild(title);
    copy.appendChild(detail);
    item.appendChild(badge);
    item.appendChild(copy);
    container.appendChild(item);
  });
}

function renderTopics(container, topics) {
  if (!container) return;
  container.innerHTML = "";
  const normalized = Array.isArray(topics) ? topics.filter(Boolean) : [];
  if (!normalized.length) {
    const empty = document.createElement("span");
    empty.className = "topic-pill topic-pill-empty";
    empty.textContent = "暂无推荐方向";
    container.appendChild(empty);
    return;
  }

  normalized.forEach((topic) => {
    const pill = document.createElement("span");
    pill.className = "topic-pill";
    pill.textContent = topic;
    container.appendChild(pill);
  });
}

function renderProfile(data) {
  toggleProfileFields(false);
  if (studentNoInput && data.student_no) studentNoInput.value = data.student_no;
  if (nameInput) nameInput.value = data.name || "";
  if (stageInput) stageInput.value = data.explicit_stage || "";
  if (directionInput) directionInput.value = data.research_direction || "";
  setText(dom.readCount, data.read_paper_count ?? 0);
  setText(dom.collectCount, data.collect_paper_count ?? 0);
  setText(dom.activeProjectCount, data.active_project_count ?? 0);
  setText(dom.meetingCount, data.meeting_count ?? 0);
  setText(dom.statusSummary, data.research_status_summ || data.research_status || "暂无状态总结");
  renderList(dom.mainProblems, data.main_problems);
  renderActionPlan(dom.actionPlan, data.action_plan);
  renderTopics(dom.recommendedTopics, data.recommended_topics);
  saveProfileState({
    inputs: {
      student_no: studentNoInput?.value.trim() || "",
      name: nameInput?.value.trim() || "",
      explicit_stage: stageInput?.value.trim() || "",
      research_direction: directionInput?.value.trim() || "",
    },
    data,
    status: statusMessage?.textContent || "",
    fieldsVisible: false,
  });
}

async function queryProfile() {
  const requestId = ++activeProfileRequestId;
  const student_no = studentNoInput.value.trim();
  const name = nameInput.value.trim();
  const explicit_stage = stageInput.value.trim();
  const research_direction = directionInput.value.trim();

  if (!student_no) {
    setText(statusMessage, "请先填写学号");
    return;
  }

  const hasProfileValues = Boolean(name || explicit_stage || research_direction);
  if (hasProfileValues && (!name || !explicit_stage || !research_direction)) {
    setText(statusMessage, "若要补充基础信息，请同时填写姓名、当前阶段和研究方向");
    return;
  }

  setLoading(true, hasProfileValues ? "正在补充档案并生成科研画像，请稍等..." : "正在按学号查询档案，请稍等...");
  clearProfileState();
  try {
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_no,
        name: hasProfileValues ? name : "",
        explicit_stage: hasProfileValues ? explicit_stage : "",
        research_direction: hasProfileValues ? research_direction : "",
      }),
    });
    const result = await response.json();
    if (requestId !== activeProfileRequestId) return;
    if (!response.ok || !result.success) {
      const message = result.detail || result.message || "查询失败";
      const shouldExpand =
        !hasProfileValues &&
        (
          message.includes("未找到用户") ||
          message.includes("未查到用户") ||
          message.includes("未返回数据") ||
          message.includes("未返回有效身份信息")
        );

      if (shouldExpand) {
        toggleProfileFields(true);
        setText(statusMessage, "未查到该学号对应用户，请补充姓名、当前阶段和研究方向后再次生成");
        saveProfileState({
          inputs: {
            student_no,
            name: "",
            explicit_stage: "",
            research_direction: "",
          },
          data: null,
          status: statusMessage?.textContent || "",
          fieldsVisible: true,
        });
        return;
      }

      throw new Error(message);
    }

    if (!result.data?.name) {
      toggleProfileFields(true);
      setText(statusMessage, "未查到完整用户档案，请补充基础信息后再次生成");
      saveProfileState({
        inputs: {
          student_no,
          name,
          explicit_stage,
          research_direction,
        },
        data: null,
        status: statusMessage?.textContent || "",
        fieldsVisible: true,
      });
      return;
    }

    renderProfile(result.data);
    setText(statusMessage, "科研画像已生成");
    saveProfileState({
      inputs: {
        student_no: studentNoInput?.value.trim() || "",
        name: nameInput?.value.trim() || "",
        explicit_stage: stageInput?.value.trim() || "",
        research_direction: directionInput?.value.trim() || "",
      },
      data: result.data,
      status: "科研画像已生成",
      fieldsVisible: false,
    });
  } catch (error) {
    if (requestId !== activeProfileRequestId) return;
    setText(statusMessage, error.message || "生成失败，请稍后重试");
    saveProfileState({
      inputs: {
        student_no,
        name,
        explicit_stage,
        research_direction,
      },
      data: null,
      status: statusMessage?.textContent || "",
      fieldsVisible: Boolean(name || explicit_stage || research_direction),
    });
  } finally {
    if (requestId !== activeProfileRequestId) return;
    setLoading(false, statusMessage?.textContent || "");
  }
}

queryBtn.addEventListener("click", queryProfile);
[studentNoInput, nameInput, stageInput, directionInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      queryProfile();
    }
  });
});

const savedProfileState = loadProfileState();
if (savedProfileState?.inputs) {
  if (studentNoInput && savedProfileState.inputs.student_no !== undefined) {
    studentNoInput.value = savedProfileState.inputs.student_no || "";
  }
  if (nameInput && savedProfileState.inputs.name !== undefined) {
    nameInput.value = savedProfileState.inputs.name || "";
  }
  if (stageInput && savedProfileState.inputs.explicit_stage !== undefined) {
    stageInput.value = savedProfileState.inputs.explicit_stage || "";
  }
  if (directionInput && savedProfileState.inputs.research_direction !== undefined) {
    directionInput.value = savedProfileState.inputs.research_direction || "";
  }
}
toggleProfileFields(Boolean(savedProfileState?.fieldsVisible));
if (savedProfileState?.data) {
  renderProfile(savedProfileState.data);
}
setText(statusMessage, savedProfileState?.status || "");
