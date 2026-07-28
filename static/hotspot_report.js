const latestDirection = document.getElementById("latestDirection");
const latestQuestion = document.getElementById("latestQuestion");
const latestTimeRange = document.getElementById("latestTimeRange");
const latestOutputFormat = document.getElementById("latestOutputFormat");
const hotspotAgentOutput = document.getElementById("hotspotAgentOutput");
const latestReportLink = document.getElementById("latestReportLink");
const hotspotReportStatus = document.getElementById("statusMessage");

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function extractReportLink(data) {
  if (data.report && /^https?:\/\//i.test(data.report)) {
    return data.report;
  }

  const rawText = String(data.agent_output || "");
  const reportSectionMatch = rawText.match(/##\s*完整报告[\s\S]*?(https?:\/\/[^\s)]+)/);
  if (reportSectionMatch?.[1]) {
    return reportSectionMatch[1];
  }

  return "";
}

async function loadLatestHotspotReport() {
  setText(hotspotReportStatus, "正在读取最近一次热点监测结果...");

  try {
    const response = await fetch("/api/hotspot-monitoring/latest");
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.detail || result.message || "暂无最近一次热点监测结果");
    }

    const data = result.data || {};
    setText(latestDirection, data.research_direction || "-");
    setText(latestQuestion, data.hotspot_question || "-");
    setText(latestTimeRange, data.time_range || "-");
    setText(latestOutputFormat, data.output_format || "-");
    setText(hotspotAgentOutput, data.agent_output || "暂无智能体原始输出");

    const reportLink = extractReportLink(data);

    if (reportLink) {
      latestReportLink.href = reportLink;
      latestReportLink.classList.remove("hidden");
    } else {
      latestReportLink.href = "#";
      latestReportLink.classList.add("hidden");
    }

    setText(hotspotReportStatus, "已加载最近一次热点监测完整输出");
  } catch (error) {
    setText(latestDirection, "-");
    setText(latestQuestion, "-");
    setText(latestTimeRange, "-");
    setText(latestOutputFormat, "-");
    setText(hotspotAgentOutput, "暂无最近一次热点监测结果");
    latestReportLink.href = "#";
    latestReportLink.classList.add("hidden");
    setText(hotspotReportStatus, error.message || "读取热点监测结果失败");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadLatestHotspotReport, { once: true });
} else {
  loadLatestHotspotReport();
}
