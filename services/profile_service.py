from __future__ import annotations

import csv
import json
import logging
import os
import re
import traceback
from pathlib import Path
from typing import Dict, List, Optional

import httpx
from fastapi import UploadFile
from cozepy import COZE_CN_BASE_URL, Coze, Message, MessageObjectString, TokenAuth
from cozepy.request import SyncHTTPClient

logger = logging.getLogger(__name__)


class ResearchProfileService:
    def __init__(self, profile_csv_path: str, snapshot_csv_path: str) -> None:
        self.profile_csv_path = Path(profile_csv_path)
        self.snapshot_csv_path = Path(snapshot_csv_path)
        self.coze_bot_id = os.getenv("COZE_BOT_ID") or "7651593616867721270"
        self.coze_api_token = os.getenv("COZE_API_TOKEN")
        self.default_timeout_seconds = 600.0
        self.default_connect_timeout_seconds = 30.0
        self.hotspot_timeout_seconds = 1800.0
        self.hotspot_connect_timeout_seconds = 60.0
        self.coze_client = None
        self.latest_hotspot_result: Optional[Dict] = None
        self.latest_knowledge_debug: Dict[str, Dict] = {}
        if self.coze_api_token:
            self.coze_client = self._create_coze_client(
                total_timeout=self.hotspot_timeout_seconds,
                connect_timeout=self.hotspot_connect_timeout_seconds,
            )

    def _create_coze_client(
        self,
        total_timeout: float = 600.0,
        connect_timeout: float = 30.0,
        token: Optional[str] = None,
    ) -> Coze:
        timeout = httpx.Timeout(timeout=total_timeout, connect=connect_timeout)
        http_client = SyncHTTPClient(timeout=timeout, trust_env=False)
        return Coze(
            auth=TokenAuth(token=token or self.coze_api_token),
            base_url=COZE_CN_BASE_URL,
            http_client=http_client,
        )

    def _is_timeout_like_error(self, exc: Exception) -> bool:
        if isinstance(exc, httpx.TimeoutException):
            return True

        message = str(exc).lower()
        timeout_markers = [
            "timed out",
            "timeout",
            "operation timed out",
            "read timed out",
            "connect timed out",
        ]
        return any(marker in message for marker in timeout_markers)

    def _load_csv(self, path: Path) -> List[Dict]:
        with path.open("r", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    def _to_int(self, value: str) -> int:
        return int(value) if value else 0

    def _snapshot_int(self, snapshot: Dict, field_name: str) -> int:
        return self._to_int(snapshot.get(field_name, "0"))

    def generate_suggestion(self, data: dict) -> str:
        stage = data["explicit_stage"]
        direction = data["research_direction"]
        goal = data["current_goal"]
        read_count = data["read_paper_count"]
        collect_count = data["collect_paper_count"]
        active_projects = data["active_project_count"]
        frontier_count = data["frontier_paper_count"]
        review_count = data["review_paper_count"]
        research_stage_count = data["research_stage_count"]
        experiment_stage_count = data["experiment_stage_count"]

        return (
            "当前状态总结：\n"
            f"{data['name']}当前处于{stage}阶段，研究方向为{direction}，当前目标是{goal}。"
            f"近30天已阅读{read_count}篇论文、收藏{collect_count}篇文献，并同时推进{active_projects}个项目，"
            f"说明已经形成一定的科研输入与执行节奏。当前前沿论文{frontier_count}篇高于综述论文{review_count}篇，"
            f"同时调研阶段项目{research_stage_count}个、实验阶段项目{experiment_stage_count}个，整体状态更适合继续收敛问题并推进验证。\n\n"
            "下一步建议：\n"
            "1. 从最近阅读的论文中整理出2到3个与你当前目标最相关的核心问题，形成一页问题清单。\n"
            "2. 针对正在推进的项目，优先选1个最有希望的方向做最小实验验证，减少同时铺开的任务数量。\n"
            "3. 将已收藏文献按“综述、方法、实验”分类整理，优先补齐与你研究方向最相关的经典综述与高引用论文。"
        )

    def get_profile_payload(
        self,
        student_no: str,
        name: str,
        explicit_stage: str = "",
        research_direction: str = "",
    ) -> dict:
        if not self.coze_client:
            return self._build_error_payload(
                "未配置科研画像 Coze 调用凭证",
                {
                    "source": "coze_profile_not_configured",
                    "bot_id": self.coze_bot_id,
                    "input_student_no": student_no,
                    "input_name": name,
                },
            )
        return self._get_profile_from_bot(
            student_no=student_no,
            name=name,
            explicit_stage=explicit_stage,
            research_direction=research_direction,
        )

    def _coze_value_to_int(self, value) -> int:
        try:
            if value is None or value == "":
                return 0
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    def _infer_count_from_text(self, text: str, keywords: List[str]) -> int:
        source = str(text or "")
        if not source.strip():
            return 0

        keyword_pattern = "|".join(re.escape(keyword) for keyword in keywords if keyword)
        patterns = [
            rf"(近30天|最近(?:一个月|30天))[^。\n]*?(?:{keyword_pattern})[^。\n]*?(\d+)\s*篇",
            rf"(?:{keyword_pattern})[^。\n]*?(\d+)\s*篇",
            rf"(\d+)\s*篇[^。\n]*?(?:{keyword_pattern})",
        ]
        for pattern in patterns:
            match = re.search(pattern, source, re.IGNORECASE)
            if match:
                groups = [group for group in match.groups() if group and str(group).isdigit()]
                if groups:
                    return self._coze_value_to_int(groups[-1])
        return 0

    def _parse_json_field(self, value, expected_type):
        if isinstance(value, expected_type):
            return value
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return expected_type()
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, expected_type):
                    return parsed
            except json.JSONDecodeError:
                return expected_type()
        return expected_type()

    def _clean_markdown_value(self, value) -> str:
        text = str(value or "").strip()
        text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
        text = re.sub(r"`([^`]*)`", r"\1", text)
        return text.strip().strip("：:").strip()

    def _is_missing_agent_value(self, value) -> bool:
        text = self._clean_markdown_value(value)
        return not text or text in {"未统计到", "未填写", "未知", "暂无", "无", "-", "null", "None"}

    def _extract_markdown_scalar(self, text: str, key: str) -> str:
        pattern = (
            rf"(?m)^\s*(?:[-*]\s*)?"
            rf"(?:\*\*)?{re.escape(key)}(?:（[^）]*）|\([^)]*\))?(?:\*\*)?\s*[：:]\s*(.+?)\s*$"
        )
        match = re.search(pattern, text)
        if not match:
            return ""
        return self._clean_markdown_value(match.group(1))

    def _extract_markdown_section(self, text: str, key: str, following_keys: List[str]) -> str:
        heading = (
            rf"^\s*(?:[-*]\s*)?"
            rf"(?:\*\*)?{re.escape(key)}(?:（[^）]*）|\([^)]*\))?(?:\*\*)?\s*[：:]\s*"
        )
        match = re.search(heading, text, re.MULTILINE)
        if not match:
            return ""

        start = match.end()
        next_positions = []
        for following_key in following_keys:
            next_heading = (
                rf"^\s*(?:[-*]\s*)?"
                rf"(?:\*\*)?{re.escape(following_key)}(?:（[^）]*）|\([^)]*\))?(?:\*\*)?\s*[：:]"
            )
            next_match = re.search(next_heading, text[start:], re.MULTILINE)
            if next_match:
                next_positions.append(start + next_match.start())

        end = min(next_positions) if next_positions else len(text)
        return text[start:end].strip()

    def _parse_markdown_list(self, section: str) -> List[str]:
        items: List[str] = []
        for line in section.splitlines():
            cleaned = self._clean_markdown_value(line)
            cleaned = re.sub(r"^\s*(?:[-*•]|\d+[.、])\s*", "", cleaned).strip()
            if cleaned:
                items.append(cleaned)
        return items

    def _normalize_priority(self, value: str) -> str:
        text = self._clean_markdown_value(value).lower()
        if "高" in text or "high" in text:
            return "high"
        if "低" in text or "low" in text:
            return "low"
        return "medium"

    def _parse_markdown_action_plan(self, section: str) -> List[Dict]:
        plans: List[Dict] = []
        current: Dict[str, str] = {}
        current_field = ""

        def flush_current() -> None:
            nonlocal current
            if current:
                plans.append(
                    {
                        "title": current.get("title", "").strip() or "行动建议",
                        "priority": self._normalize_priority(current.get("priority", "medium")),
                        "detail": current.get("detail", "").strip(),
                    }
                )
                current = {}

        for raw_line in section.splitlines():
            line = self._clean_markdown_value(raw_line)
            line = re.sub(r"^\s*\d+[.、]\s*", "", line).strip()
            if not line:
                continue

            title_match = re.match(r"^标题\s*[：:]\s*(.+)$", line)
            priority_match = re.match(r"^优先级\s*[：:]\s*(.+)$", line)
            detail_match = re.match(r"^详情\s*[：:]\s*(.+)$", line)
            bracket_match = re.match(r"^\[(高|中|低|high|medium|low)优先级?\]\s*(.+?)(?:[：:]\s*(.+))?$", line, re.IGNORECASE)

            if title_match:
                if current.get("title"):
                    flush_current()
                current["title"] = title_match.group(1).strip()
                current_field = "title"
            elif priority_match:
                current["priority"] = priority_match.group(1).strip()
                current_field = "priority"
            elif detail_match:
                current["detail"] = detail_match.group(1).strip()
                current_field = "detail"
            elif bracket_match:
                flush_current()
                current["priority"] = bracket_match.group(1).strip()
                current["title"] = bracket_match.group(2).strip()
                current["detail"] = (bracket_match.group(3) or "").strip()
                current_field = "detail"
            elif current_field == "detail" and current:
                current["detail"] = f"{current.get('detail', '')}{line}".strip()
            elif current:
                current["detail"] = f"{current.get('detail', '')}{line}".strip()
                current_field = "detail"
            else:
                current["title"] = line
                current_field = "title"

        flush_current()
        return plans

    def _parse_profile_markdown(self, text: str) -> Dict:
        raw_text = text or ""
        if not raw_text.strip():
            return {}

        section_keys = [
            "student_no",
            "name",
            "explicit_stage",
            "research_direction",
            "read_paper_count",
            "collect_paper_count",
            "active_project_count",
            "meeting_count",
            "research_status_summ",
            "research_status",
            "main_problems",
            "action_plan",
            "recommended_topics",
        ]

        payload = {
            "student_no": self._extract_markdown_scalar(raw_text, "student_no"),
            "name": self._extract_markdown_scalar(raw_text, "name"),
            "explicit_stage": self._extract_markdown_scalar(raw_text, "explicit_stage"),
            "research_direction": self._extract_markdown_scalar(raw_text, "research_direction"),
            "read_paper_count": self._extract_markdown_scalar(raw_text, "read_paper_count"),
            "collect_paper_count": self._extract_markdown_scalar(raw_text, "collect_paper_count"),
            "active_project_count": self._extract_markdown_scalar(raw_text, "active_project_count"),
            "meeting_count": self._extract_markdown_scalar(raw_text, "meeting_count"),
            "research_status_summ": self._extract_markdown_scalar(raw_text, "research_status_summ")
            or self._extract_markdown_scalar(raw_text, "research_status"),
        }

        main_problems = self._extract_markdown_section(raw_text, "main_problems", section_keys)
        action_plan = self._extract_markdown_section(raw_text, "action_plan", section_keys)
        recommended_topics = self._extract_markdown_section(raw_text, "recommended_topics", section_keys)

        payload["main_problems"] = self._parse_markdown_list(main_problems)
        payload["action_plan"] = self._parse_markdown_action_plan(action_plan)
        payload["recommended_topics"] = self._parse_markdown_list(recommended_topics)
        return payload

    def _decode_agent_payload(self, payload_data, fallback_key: str = "output") -> Dict:
        current = payload_data
        for _ in range(3):
            if isinstance(current, str):
                raw_text = current.strip()
                if not raw_text:
                    return {}
                try:
                    current = json.loads(raw_text)
                    continue
                except json.JSONDecodeError:
                    return {fallback_key: raw_text}
            break

        if isinstance(current, dict):
            return self._unwrap_agent_envelope(current, fallback_key=fallback_key)
        if current is None:
            return {}
        if isinstance(current, list):
            return {fallback_key: json.dumps(current, ensure_ascii=False)}
        return {fallback_key: str(current)}

    def _unwrap_agent_envelope(self, payload: Dict, fallback_key: str = "output") -> Dict:
        if not isinstance(payload, dict):
            return {}

        current = payload
        for _ in range(3):
            if not isinstance(current, dict) or "data" not in current:
                break

            data = current.get("data")
            meta = {
                "_agent_success": current.get("success"),
                "_agent_intent": current.get("intent", ""),
                "_agent_workflow": current.get("workflow", ""),
                "_agent_message": current.get("message", ""),
                "_agent_error": current.get("error"),
            }

            if isinstance(data, dict):
                current = {**meta, **data}
                continue

            if isinstance(data, str):
                raw_text = data.strip()
                if not raw_text:
                    current = meta
                    break
                try:
                    parsed = json.loads(raw_text)
                    if isinstance(parsed, dict):
                        current = {**meta, **parsed}
                        continue
                    current = {**meta, fallback_key: raw_text}
                    break
                except json.JSONDecodeError:
                    current = {**meta, fallback_key: raw_text}
                    break

            if isinstance(data, list):
                current = {**meta, fallback_key: json.dumps(data, ensure_ascii=False), "items": data}
                break

            current = meta
            break

        return current if isinstance(current, dict) else {}

    def _normalize_coze_data(self, payload_data) -> Dict:
        decoded_payload = self._decode_agent_payload(payload_data, fallback_key="output")

        if isinstance(decoded_payload, str):
            raw_text = decoded_payload.strip()
            markdown_payload = self._parse_profile_markdown(raw_text)
            if markdown_payload and (markdown_payload.get("student_no") or markdown_payload.get("name")):
                decoded_payload = markdown_payload
            else:
                try:
                    parsed = json.loads(raw_text)
                    if isinstance(parsed, dict):
                        decoded_payload = self._decode_agent_payload(parsed, fallback_key="output")
                    else:
                        decoded_payload = {"output": raw_text}
                except json.JSONDecodeError:
                    decoded_payload = {"output": raw_text}

        if not isinstance(decoded_payload, dict):
            decoded_payload = {"output": str(decoded_payload)}

        nested_data = decoded_payload.get("data")
        if isinstance(nested_data, dict):
            decoded_payload = {
                **decoded_payload,
                **nested_data,
            }

        if decoded_payload.get("output") and not (decoded_payload.get("student_no") or decoded_payload.get("name")):
            markdown_payload = self._parse_profile_markdown(str(decoded_payload.get("output", "")))
            if markdown_payload and (markdown_payload.get("student_no") or markdown_payload.get("name")):
                decoded_payload = {**decoded_payload, **markdown_payload}

        status_summary = (
            decoded_payload.get("research_status_summ", "")
            or decoded_payload.get("research_status", "")
            or decoded_payload.get("output", "")
        )
        read_paper_count = self._coze_value_to_int(decoded_payload.get("read_paper_count"))
        collect_paper_count = self._coze_value_to_int(decoded_payload.get("collect_paper_count"))
        active_project_count = self._coze_value_to_int(decoded_payload.get("active_project_count"))
        meeting_count = self._coze_value_to_int(decoded_payload.get("meeting_count"))

        if read_paper_count <= 0:
            read_paper_count = self._infer_count_from_text(
                status_summary,
                ["阅读论文", "已阅读", "读过论文", "论文阅读"],
            )
        if collect_paper_count <= 0:
            collect_paper_count = self._infer_count_from_text(
                status_summary,
                ["收藏文献", "已收藏", "收藏论文", "文献收藏"],
            )
        if active_project_count <= 0:
            active_project_count = self._infer_count_from_text(
                status_summary,
                ["项目", "进行中项目", "在研项目"],
            )
        if meeting_count <= 0:
            meeting_count = self._infer_count_from_text(
                status_summary,
                ["组会", "组会记录"],
            )

        return {
            "student_no": "" if self._is_missing_agent_value(decoded_payload.get("student_no", "")) else decoded_payload.get("student_no", ""),
            "name": "" if self._is_missing_agent_value(decoded_payload.get("name", "")) else decoded_payload.get("name", ""),
            "explicit_stage": ""
            if self._is_missing_agent_value(decoded_payload.get("explicit_stage", ""))
            else decoded_payload.get("explicit_stage", ""),
            "research_direction": ""
            if self._is_missing_agent_value(decoded_payload.get("research_direction", ""))
            else decoded_payload.get("research_direction", ""),
            "read_paper_count": read_paper_count,
            "collect_paper_count": collect_paper_count,
            "active_project_count": active_project_count,
            "meeting_count": meeting_count,
            "research_status_summ": ""
            if self._is_missing_agent_value(
                decoded_payload.get("research_status_summ", "")
                or decoded_payload.get("research_status", "")
            )
            else (
                decoded_payload.get("research_status_summ", "")
                or decoded_payload.get("research_status", "")
            ),
            "main_problems": self._parse_json_field(decoded_payload.get("main_problems", []), list),
            "action_plan": self._parse_json_field(decoded_payload.get("action_plan", []), list),
            "recommended_topics": self._parse_json_field(decoded_payload.get("recommended_topics", []), list),
        }

    def _build_error_payload(self, message: str, debug: Optional[Dict] = None) -> Dict:
        payload = {"success": False, "message": message}
        if debug:
            payload["debug"] = debug
        return payload

    def _build_profile_view_data(self, normalized: Dict) -> Dict:
        return {
            "student_no": normalized.get("student_no", ""),
            "name": normalized.get("name", ""),
            "explicit_stage": normalized.get("explicit_stage", ""),
            "research_direction": normalized.get("research_direction", ""),
            "read_paper_count": normalized.get("read_paper_count", 0),
            "collect_paper_count": normalized.get("collect_paper_count", 0),
            "active_project_count": normalized.get("active_project_count", 0),
            "meeting_count": normalized.get("meeting_count", 0),
            "research_status_summ": normalized.get("research_status_summ", ""),
            "main_problems": normalized.get("main_problems", []),
            "action_plan": normalized.get("action_plan", []),
            "recommended_topics": normalized.get("recommended_topics", []),
        }

    def _normalize_hotspot_data(
        self,
        payload_data,
        research_direction: str,
        hotspot_question: str,
        time_range: str,
        output_format: str,
    ) -> Dict:
        payload = self._decode_agent_payload(payload_data, fallback_key="report")
        charts = payload.get("charts", {}) if isinstance(payload.get("charts"), dict) else {}

        pie = payload.get("pie", "") or charts.get("pie", "")
        bar = payload.get("bar", "") or charts.get("bar", "")
        line = payload.get("line", "") or charts.get("line", "")
        radar = payload.get("radar", "") or payload.get("rader", "") or charts.get("radar", "") or charts.get("rader", "")
        rader = radar

        return {
            "research_direction": payload.get("research_direction", research_direction),
            "hotspot_question": payload.get("hotspot_question", hotspot_question),
            "time_range": payload.get("time_range", time_range),
            "output_format": payload.get("output_format", output_format),
            "pie": pie,
            "bar": bar,
            "line": line,
            "radar": radar,
            "rader": rader,
            "hotspot_overview": payload.get("hotspot_overview", "")
            or payload.get("overview", "")
            or payload.get("summary", "")
            or payload.get("trend_summary", ""),
            "report": payload.get("report", "")
            or payload.get("analysis_report", "")
            or payload.get("formatted_result", "")
            or payload.get("output", ""),
            "report_url": payload.get("report_url", "")
            or payload.get("document_url", "")
            or payload.get("markdown_url", "")
            or payload.get("analysis_report_url", ""),
            "document_url": payload.get("document_url", "")
            or payload.get("report_url", "")
            or payload.get("markdown_url", "")
            or payload.get("analysis_report_url", ""),
            "hot_topics": self._parse_json_field(
                payload.get("hot_topics", [])
                or payload.get("current_hot_topics", [])
                or payload.get("topics", []),
                list,
            ),
            "trend_summary": payload.get("trend_summary", ""),
            "representative_results": self._parse_json_field(
                payload.get("representative_results", [])
                or payload.get("search_results", [])
                or payload.get("results", []),
                list,
            ),
            "clean_results": self._parse_json_field(payload.get("clean_results", []), list),
            "classified_results": self._parse_json_field(payload.get("classified_results", []), list),
            "outputList": self._parse_json_field(payload.get("outputList", []), list),
        }

    def _build_hotspot_agent_prompt(
        self,
        research_direction: str,
        hotspot_question: str,
        time_range: str,
        output_format: str,
    ) -> str:
        question_text = hotspot_question or research_direction or "语义通信"
        return f"请帮我监测并分析这个方向的科研热点：{question_text}"

    def _extract_chat_answer(self, messages: Optional[List]) -> str:
        if not messages:
            return ""

        assistant_answers: List[str] = []
        assistant_fallbacks: List[str] = []

        for message in messages:
            role = getattr(message, "role", "")
            content = getattr(message, "content", "") or ""
            message_type = getattr(message, "type", "")
            if role != "assistant" or not content:
                continue
            assistant_fallbacks.append(content)
            if message_type == "answer":
                assistant_answers.append(content)

        if assistant_answers:
            return assistant_answers[-1]
        if assistant_fallbacks:
            return assistant_fallbacks[-1]
        return ""

    def _extract_json_from_text(self, text: str) -> Dict:
        raw_text = (text or "").strip()
        if not raw_text:
            return {}

        candidates = [raw_text]
        fenced_match = raw_text.strip().strip("`")
        if fenced_match != raw_text:
            candidates.append(fenced_match)

        code_block_match = None
        try:
            import re

            code_block_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text, re.IGNORECASE)
        except Exception:
            code_block_match = None
        if code_block_match:
            candidates.append(code_block_match.group(1).strip())

        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidates.append(raw_text[start : end + 1])

        for candidate in candidates:
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue
        return {}

    def _call_bot_text(
        self,
        *,
        prompt: str,
        page: str,
        user_id: str,
        timeout_seconds: Optional[float] = None,
        connect_timeout_seconds: Optional[float] = None,
        poll_timeout_seconds: Optional[int] = None,
    ) -> str:
        if not self.coze_client:
            raise RuntimeError("未配置 Coze 调用凭证")
        if not self.coze_bot_id:
            raise RuntimeError("未配置 Coze 智能体 ID")

        if timeout_seconds or connect_timeout_seconds:
            self.coze_client = self._create_coze_client(
                total_timeout=timeout_seconds or self.default_timeout_seconds,
                connect_timeout=connect_timeout_seconds or self.default_connect_timeout_seconds,
            )

        result = self.coze_client.chat.create_and_poll(
            bot_id=self.coze_bot_id,
            user_id=user_id,
            additional_messages=[Message.build_user_question_text(prompt)],
            meta_data={"page": page},
            poll_timeout=poll_timeout_seconds or int(self.default_timeout_seconds),
        )
        return self._extract_chat_answer(getattr(result, "messages", None))

    def _call_bot_with_file(
        self,
        *,
        prompt: str,
        upload: UploadFile,
        user_id: str,
        page: str,
        poll_timeout_seconds: Optional[int] = None,
    ) -> Dict:
        if not self.coze_client:
            raise RuntimeError("未配置 Coze 调用凭证")
        if not self.coze_bot_id:
            raise RuntimeError("未配置 Coze 智能体 ID")
        file_bytes = upload.file.read()
        upload.file.seek(0)
        if not file_bytes:
            raise RuntimeError("上传文件为空，无法传递给智能体")

        prompt_with_file_context = (
            f"{prompt}\n\n"
            f"我已经上传了一个文件，请务必基于这个文件的实际内容完成任务，不要忽略文件。\n"
            f"文件名：{upload.filename or '未命名文件'}"
        )
        logger.info(
            "Uploading file to Coze before bot call: filename=%s size=%s page=%s",
            upload.filename or "",
            len(file_bytes),
            page,
        )
        uploaded_file = self.coze_client.files.upload(
            file=(
                upload.filename,
                file_bytes,
                upload.content_type or "application/octet-stream",
            )
        )
        message = Message.build_user_question_objects(
            objects=[
                MessageObjectString.build_file(file_id=uploaded_file.id),
                MessageObjectString.build_text(prompt_with_file_context),
            ],
            meta_data={"page": page},
        )
        result = self.coze_client.chat.create_and_poll(
            bot_id=self.coze_bot_id,
            user_id=user_id,
            additional_messages=[message],
            meta_data={"page": page},
            poll_timeout=poll_timeout_seconds or int(self.default_timeout_seconds),
        )
        return {
            "answer_text": self._extract_chat_answer(getattr(result, "messages", None)),
            "file_id": uploaded_file.id,
        }

    def _build_profile_agent_prompt(
        self,
        *,
        student_no: str,
        name: str,
        explicit_stage: str,
        research_direction: str,
    ) -> str:
        parts = [f"学号：{student_no or '未提供'}"]
        if name:
            parts.append(f"姓名：{name}")
        if explicit_stage:
            parts.append(f"当前阶段：{explicit_stage}")
        if research_direction:
            parts.append(f"研究方向：{research_direction}")
        return "请帮我生成这个学生的科研画像。" + " ".join(parts)

    def _build_direction_agent_prompt(self, *, question: str) -> str:
        topic = question.strip()
        if "研究方向" in topic and ("帮我调研一下" in topic or "请帮我调研一下" in topic):
            return topic
        return f"请帮我调研一下{topic}的研究方向，并给出创新点建议。"

    def _build_paper_search_agent_prompt(self, *, research_direction: str) -> str:
        return f"请帮我检索并推荐这个研究方向值得阅读的论文：{research_direction}"

    def _build_scholar_agent_prompt(self, *, scholar_name: str, research_direction: str) -> str:
        return f"请帮我搜索 {scholar_name} 学者的论文。"

    def _build_paper_reading_prompt(self, *, paper_url: str = "") -> str:
        url_text = f" 论文链接：{paper_url}" if paper_url else ""
        return f"请帮我阅读这篇论文，并按系统约定返回论文初始化解析结果。{url_text}"

    def _build_paper_chat_prompt(
        self,
        *,
        question: str,
        summary_context: str = "",
    ) -> str:
        context_text = f"\n当前页面已有上下文：\n{summary_context}" if summary_context else ""
        return f"请基于我上传的这篇论文回答我的问题：{question}{context_text}"

    def _build_knowledge_import_prompt(self, *, entry_type: str) -> str:
        prompt_map = {
            "paper": "请帮我把这个文件放到论文库里，并返回论文入库结果。",
            "meeting": "请帮我把这个文件放到组会库里，并返回组会入库结果。",
            "project": "请帮我把这个文件放到项目库里，并返回项目入库结果。",
        }
        return prompt_map.get(entry_type, "请帮我把这个文件放到知识库里，并返回入库结果。")

    def _build_knowledge_display_prompt(self, *, entry_type: str, section_type: str = "") -> str:
        if entry_type == "meeting":
            return "我想看组会库里的内容。"
        if entry_type == "project":
            return "我想看项目库里的内容。"

        section_label_map = {
            "innovation": "创新点",
            "system_model": "系统模型",
            "algorithm": "算法",
            "dataset": "数据集",
            "related_work": "总结",
        }
        label = section_label_map.get(section_type, section_type or "论文内容")
        return f"我想看论文库里的{label}。"

    def _build_hotspot_response_data(
        self,
        agent_output: str,
        research_direction: str,
        hotspot_question: str,
        time_range: str,
        output_format: str,
    ) -> Dict:
        normalized = {
            "research_direction": research_direction,
            "hotspot_question": hotspot_question,
            "time_range": time_range,
            "output_format": output_format,
            "agent_output": agent_output,
            "pie": "",
            "bar": "",
            "line": "",
            "radar": "",
            "rader": "",
            "hotspot_overview": "",
            "report": "",
            "report_url": "",
            "document_url": "",
            "hot_topics": [],
            "trend_summary": "",
            "representative_results": [],
            "clean_results": [],
            "classified_results": [],
            "outputList": [],
        }

        raw_text = (agent_output or "").strip()
        if not raw_text:
            return normalized

        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError:
            return normalized

        if not isinstance(parsed, dict):
            return normalized

        structured = self._normalize_hotspot_data(
            payload_data=parsed,
            research_direction=research_direction,
            hotspot_question=hotspot_question,
            time_range=time_range,
            output_format=output_format,
        )
        structured["agent_output"] = agent_output
        return structured

    def _normalize_knowledge_paper_section_items(self, items, *, section_type: str) -> List[Dict]:
        parsed_items = self._parse_json_field(items, list)
        normalized: List[Dict] = []
        for index, item in enumerate(parsed_items, start=1):
            if not isinstance(item, dict):
                normalized.append(
                    {
                        "id": f"{section_type}-{index}",
                        "title": str(item or f"{section_type}-{index}"),
                        "content": str(item or ""),
                        "meta": "",
                        "extra": {},
                    }
                )
                continue

            def pick(*keys: str) -> str:
                for key in keys:
                    value = item.get(key, "")
                    if value is None:
                        continue
                    if isinstance(value, list):
                        joined = "、".join(str(v).strip() for v in value if str(v).strip())
                        if joined:
                            return joined
                    text = str(value).strip()
                    if text:
                        return text
                return ""

            def next_field_after_content() -> Dict[str, str]:
                skip_keys = {
                    "paper_title",
                    "title",
                    "authors",
                    "keywords",
                }
                found_content = False
                for raw_key, raw_value in item.items():
                    if raw_key in skip_keys:
                        continue
                    if raw_key == "content":
                        found_content = True
                        continue
                    if not found_content:
                        continue

                    if raw_value is None:
                        continue
                    if isinstance(raw_value, list):
                        text_value = "、".join(str(v).strip() for v in raw_value if str(v).strip())
                    else:
                        text_value = str(raw_value).strip()
                    if not text_value:
                        continue

                    return {
                        "label": str(raw_key).strip(),
                        "value": text_value,
                    }
                return {"label": "", "value": ""}

            next_field = next_field_after_content()

            title = (
                item.get("paper_title")
                or item.get("title")
                or item.get("innovation_point")
                or item.get("model_name")
                or item.get("algorithm_name")
                or item.get("dataset_name")
                or item.get("related_work_title")
                or f"{section_type}-{index}"
            )
            keywords = item.get("keywords", [])

            if isinstance(keywords, list):
                normalized_keywords = [str(k).strip() for k in keywords if str(k).strip()]
            elif isinstance(keywords, str) and keywords.strip():
                normalized_keywords = [k.strip() for k in re.split(r"[、,，;；]", keywords) if k.strip()]
            else:
                normalized_keywords = []

            if section_type == "innovation":
                content = str(
                    pick("innovation_point", "创新点", "innovation", "核心创新点")
                    or "暂无创新点"
                )
                meta = str(pick("content", "内容", "detail", "details", "说明") or "暂无内容")
                extra = {
                    "authors": item.get("authors", []),
                    "keywords": normalized_keywords,
                    "innovation_point": pick("innovation_point", "创新点", "innovation", "核心创新点"),
                    "content": pick("content", "内容", "detail", "details", "说明"),
                    "problem_solved": (
                        pick(
                            "problem_solved",
                            "problemSolved",
                            "solved_problem",
                            "problem",
                            "problem_description",
                            "problemDescription",
                            "problem_statement",
                            "解决的问题",
                            "解决问题",
                            "针对问题",
                            "problemSolvedDescription",
                        )
                    ),
                    "next_field_label": next_field.get("label", ""),
                    "next_field_value": next_field.get("value", ""),
                }
            elif section_type == "system_model":
                content = str(
                    pick("model_name", "system_model", "模型名称", "系统模型", "model", "name")
                    or "暂无模型名称"
                )
                meta = str(pick("content", "内容", "detail", "details", "说明") or "暂无内容")
                extra = {
                    "authors": item.get("authors", []),
                    "keywords": normalized_keywords,
                    "model_name": pick("model_name", "system_model", "模型名称", "系统模型", "model", "name"),
                    "content": pick("content", "内容", "detail", "details", "说明"),
                    "evaluation": (
                        pick(
                            "evaluation",
                            "comment",
                            "summary",
                            "assessment",
                            "analysis",
                            "description",
                            "评价",
                            "系统评价",
                            "模型评价",
                            "评估",
                        )
                    ),
                    "next_field_label": next_field.get("label", ""),
                    "next_field_value": next_field.get("value", ""),
                }
            elif section_type == "algorithm":
                content = str(
                    pick("algorithm_name", "algorithm", "算法名称", "算法", "name")
                    or "暂无算法名称"
                )
                meta = str(pick("content", "内容", "detail", "details", "说明") or "暂无内容")
                extra = {
                    "authors": item.get("authors", []),
                    "keywords": normalized_keywords,
                    "algorithm_name": pick("algorithm_name", "algorithm", "算法名称", "算法", "name"),
                    "content": pick("content", "内容", "detail", "details", "说明"),
                    "steps": (
                        pick(
                            "steps",
                            "procedure",
                            "process",
                            "step",
                            "workflow",
                            "algorithm_steps",
                            "步骤",
                            "算法步骤",
                            "具体步骤",
                            "流程",
                            "过程",
                            "step_by_step",
                        )
                    ),
                    "next_field_label": next_field.get("label", ""),
                    "next_field_value": next_field.get("value", ""),
                }
            elif section_type == "dataset":
                content = str(
                    pick("dataset_name", "dataset", "数据集名称", "数据集", "name")
                    or "暂无数据集名称"
                )
                meta = str(pick("content", "内容", "detail", "details", "说明") or "暂无内容")
                extra = {
                    "authors": item.get("authors", []),
                    "keywords": normalized_keywords,
                    "dataset_name": pick("dataset_name", "dataset", "数据集名称", "数据集", "name"),
                    "content": pick("content", "内容", "detail", "details", "说明"),
                    "experiment_setup": (
                        pick(
                            "experiment_setup",
                            "setup",
                            "setting",
                            "settings",
                            "config",
                            "experiment",
                            "experiment_settings",
                            "实验设置",
                            "设置",
                            "配置",
                            "实验配置",
                            "实验条件",
                        )
                    ),
                    "next_field_label": next_field.get("label", ""),
                    "next_field_value": next_field.get("value", ""),
                }
            else:
                content = str(
                    pick("related_work_title", "related_work", "总结名称", "总结", "related_summary", "name")
                    or "暂无相关工作名称"
                )
                meta = str(pick("content", "内容", "detail", "details", "说明") or "暂无内容")
                extra = {
                    "authors": item.get("authors", []),
                    "keywords": normalized_keywords,
                    "related_work_title": pick("related_work_title", "related_work", "总结名称", "总结", "related_summary", "name"),
                    "content": pick("content", "内容", "detail", "details", "说明"),
                    "evaluation": (
                        pick(
                            "evaluation",
                            "evidence",
                            "summary",
                            "description",
                            "comment",
                            "总结说明",
                            "总结评价",
                            "评价",
                            "说明",
                        )
                    ),
                    "next_field_label": next_field.get("label", ""),
                    "next_field_value": next_field.get("value", ""),
                }

            normalized.append(
                {
                    "id": f"{section_type}-{index}",
                    "title": str(title),
                    "content": str(content),
                    "meta": str(meta),
                    "problem_solved": extra.get("problem_solved", ""),
                    "evaluation": extra.get("evaluation", ""),
                    "steps": extra.get("steps", ""),
                    "experiment_setup": extra.get("experiment_setup", ""),
                    "next_field_label": extra.get("next_field_label", ""),
                    "next_field_value": extra.get("next_field_value", ""),
                    "extra": extra,
                }
            )
        return normalized

    def _normalize_knowledge_meeting_data(self, payload: Dict) -> Dict:
        nested_data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
        meeting_summary = self._parse_json_field(
            payload.get("meeting_summary", [])
            or payload.get("meetings", [])
            or payload.get("items", [])
            or nested_data.get("meeting_summary", [])
            or nested_data.get("meetings", [])
            or nested_data.get("items", []),
            list,
        )
        teacher_suggestions = self._parse_json_field(
            payload.get("teacher_suggestions", []) or nested_data.get("teacher_suggestions", []),
            list,
        )
        next_plan = self._parse_json_field(
            payload.get("next_plan", []) or nested_data.get("next_plan", []),
            list,
        )

        suggestion_map = {}
        for item in teacher_suggestions:
            if not isinstance(item, dict):
                continue
            suggestion_map[str(item.get("zuhui_time", "")).strip()] = (
                str(item.get("advice", "") or item.get("teacher_advice", "")).strip()
            )
        plan_map = {}
        for item in next_plan:
            if not isinstance(item, dict):
                continue
            plan_map[str(item.get("zuhui_time", "")).strip()] = (
                str(item.get("plan", "") or item.get("next_plan", "")).strip()
            )

        items = []
        for index, item in enumerate(meeting_summary, start=1):
            if not isinstance(item, dict):
                continue
            meeting_time = str(item.get("zuhui_time", "")).strip()
            advice = str(item.get("teacher_advice", "")).strip() or suggestion_map.get(meeting_time, "")
            plan = str(item.get("next_plan", "")).strip() or plan_map.get(meeting_time, "")
            items.append(
                {
                    "id": f"meeting-{index}",
                    "title": meeting_time or f"组会记录 {index}",
                    "content": str(item.get("main_content", "")).strip() or "暂无组会内容",
                    "meta": "",
                    "extra": {
                        "zuhui_time": meeting_time,
                        "main_content": str(item.get("main_content", "")).strip(),
                        "advice": advice,
                        "plan": plan,
                    },
                }
            )

        return {"entry_type": "meeting", "items": items}

    def _normalize_knowledge_project_data(self, payload: Dict) -> Dict:
        nested_data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
        projects = self._parse_json_field(
            payload.get("projects", [])
            or payload.get("items", []),
            list,
        )
        if not projects:
            projects = self._parse_json_field(
                nested_data.get("projects", [])
                or nested_data.get("items", []),
            list,
            )
        items = []
        for index, item in enumerate(projects, start=1):
            if not isinstance(item, dict):
                continue
            partner_orgs = item.get("partner_orgs", [])
            if isinstance(partner_orgs, list):
                normalized_partner_orgs = "、".join(str(v).strip() for v in partner_orgs if str(v).strip())
            else:
                normalized_partner_orgs = str(partner_orgs or "").strip()

            items.append(
                {
                    "id": f"project-{index}",
                    "title": str(item.get("project_name", "") or item.get("title", "")).strip() or f"项目 {index}",
                    "content": str(
                        item.get("basic_info", "")
                        or item.get("research_content", "")
                        or "暂无项目内容"
                    ).strip(),
                    "meta": "",
                    "extra": {
                        "basic_info": str(item.get("basic_info", "") or item.get("research_content", "")).strip(),
                        "partner_orgs": normalized_partner_orgs,
                        "period": str(item.get("period", "") or item.get("project_period", "")).strip(),
                        "progress_desc": str(item.get("progress_desc", "") or item.get("summary", "")).strip(),
                        "status": str(item.get("status", "")).strip(),
                        "progress_percent": str(
                            item.get("progress_percent", "")
                            or item.get("project_progress", "")
                        ).strip(),
                    },
                }
            )

        return {"entry_type": "project", "items": items}

    def _normalize_knowledge_display_data(self, payload: Dict, *, section_type: str) -> Dict:
        section_key_map = {
            "innovation": "innovations",
            "system_model": "system_models",
            "algorithm": "algorithms",
            "dataset": "datasets",
            "related_work": "related_works",
        }
        key = section_key_map.get(section_type, "innovations")
        items = self._normalize_knowledge_paper_section_items(payload.get(key, []), section_type=section_type)
        return {"entry_type": "paper", "section_type": section_type, "items": items}

    def _normalize_scholar_paper(self, paper) -> Dict:
        if not isinstance(paper, dict):
            return {
                "title": str(paper or ""),
                "authors": [],
                "year": "",
                "venue": "",
                "source": "",
                "abstract": "",
                "url": "",
            }

        authors = paper.get("authors", [])
        if isinstance(authors, str):
            normalized_authors = [item.strip() for item in authors.replace("、", ",").split(",") if item.strip()]
        elif isinstance(authors, list):
            normalized_authors = [str(item).strip() for item in authors if str(item).strip()]
        else:
            normalized_authors = []

        venue = (
            paper.get("venue")
            or paper.get("journal")
            or paper.get("conference")
            or paper.get("source")
            or ""
        )
        abstract = paper.get("abstract") or paper.get("summary") or paper.get("description") or ""

        return {
            "title": paper.get("title", ""),
            "authors": normalized_authors,
            "year": str(paper.get("year", "") or ""),
            "venue": str(venue or ""),
            "source": str(paper.get("source", "") or ""),
            "abstract": str(abstract or ""),
            "url": str(paper.get("url", "") or ""),
        }

    def _normalize_scholar_data(
        self,
        payload_data,
        scholar_name: str,
        research_direction: str,
    ) -> Dict:
        payload = self._decode_agent_payload(payload_data, fallback_key="formatted_result")
        papers = self._parse_json_field(payload.get("papers", []), list)
        normalized_papers = [self._normalize_scholar_paper(item) for item in papers]
        total_count = self._coze_value_to_int(payload.get("total_count"))

        return {
            "scholar_name": payload.get("scholar_name", "") or scholar_name,
            "research_direction": payload.get("research_direction", "") or research_direction,
            "total_count": total_count or len(normalized_papers),
            "papers": normalized_papers,
            "formatted_result": payload.get("formatted_result", "") or payload.get("output", "") or payload.get("message", ""),
        }

    def _normalize_paper_search_paper(self, paper) -> Dict:
        if not isinstance(paper, dict):
            return {
                "title": str(paper or ""),
                "relevance_score": "",
                "importance_score": "",
                "published_at": "",
                "summary_cn": "",
                "recommendation_reason": "",
                "url": "",
            }

        return {
            "title": str(paper.get("title", "") or paper.get("paper_title", "") or ""),
            "relevance_score": str(
                paper.get("relevance_score", "")
                or paper.get("relevance", "")
                or paper.get("related_score", "")
                or ""
            ),
            "importance_score": str(
                paper.get("importance_score", "")
                or paper.get("importance", "")
                or paper.get("value_score", "")
                or ""
            ),
            "published_at": str(
                paper.get("published_at", "")
                or paper.get("published", "")
                or paper.get("publish_time", "")
                or paper.get("published_date", "")
                or paper.get("date", "")
                or ""
            ),
            "summary_cn": str(
                paper.get("summary_cn", "")
                or paper.get("chinese_summary", "")
                or paper.get("summary", "")
                or paper.get("abstract", "")
                or ""
            ),
            "recommendation_reason": str(
                paper.get("recommendation_reason", "")
                or paper.get("reason", "")
                or paper.get("why", "")
                or paper.get("recommended_reason", "")
                or ""
            ),
            "url": str(
                paper.get("url", "")
                or paper.get("pdf_url", "")
                or paper.get("paper_url", "")
                or paper.get("link", "")
                or ""
            ),
        }

    def _normalize_paper_search_data(
        self,
        payload_data,
        research_direction: str,
        answer_text: str,
    ) -> Dict:
        payload = self._decode_agent_payload(payload_data, fallback_key="formatted_result")
        papers = self._parse_json_field(
            payload.get("papers", [])
            or payload.get("recommended_papers", [])
            or payload.get("paper_recommendations", []),
            list,
        )
        normalized_papers = [self._normalize_paper_search_paper(item) for item in papers]

        formatted_result = (
            payload.get("formatted_result", "")
            or payload.get("output", "")
            or payload.get("report", "")
            or payload.get("answer", "")
            or answer_text
        )

        return {
            "research_direction": payload.get("research_direction", "") or research_direction,
            "search_overview": payload.get("search_overview", "")
            or payload.get("overview", "")
            or payload.get("summary", "")
            or payload.get("retrieval_overview", ""),
            "papers": normalized_papers,
            "recommendation_summary": payload.get("recommendation_summary", "")
            or payload.get("recommend_summary", "")
            or payload.get("summary_text", "")
            or payload.get("paper_summary", ""),
            "formatted_result": formatted_result,
        }

    def _get_profile_from_bot(
        self,
        student_no: str,
        name: str,
        explicit_stage: str = "",
        research_direction: str = "",
    ) -> dict:
        prompt = self._build_profile_agent_prompt(
            student_no=student_no,
            name=name,
            explicit_stage=explicit_stage,
            research_direction=research_direction,
        )
        try:
            answer_text = self._call_bot_text(
                prompt=prompt,
                page="profile",
                user_id=f"profile-{student_no or name or 'user'}",
                poll_timeout_seconds=int(self.default_timeout_seconds),
            )
        except Exception as exc:
            debug = {
                "source": "coze_bot_exception",
                "bot_id": self.coze_bot_id,
                "input_student_no": student_no,
                "input_name": name,
                "exception_type": type(exc).__name__,
                "exception_repr": repr(exc),
                "traceback": traceback.format_exc(),
            }
            logger.exception("Coze profile bot call failed")
            return self._build_error_payload(f"Coze 智能体调用失败: {exc}", debug)

        if not answer_text:
            debug = {
                "source": "coze_empty_data",
                "bot_id": self.coze_bot_id,
                "input_name": name,
                "input_student_no": student_no,
            }
            logger.error("Coze bot returned empty data: %s", debug)
            return self._build_error_payload("Coze 智能体未返回数据", debug)

        logger.info(
            "Coze bot raw data received: bot_id=%s input_name=%s data_preview=%s",
            self.coze_bot_id,
            name,
            repr(answer_text)[:500],
        )
        payload_data = self._extract_json_from_text(answer_text) or {"output": answer_text}
        normalized = self._normalize_coze_data(payload_data)
        if self._is_missing_agent_value(normalized.get("student_no")) and student_no:
            normalized["student_no"] = student_no
        if self._is_missing_agent_value(normalized.get("name")) and name:
            normalized["name"] = name
        if self._is_missing_agent_value(normalized.get("explicit_stage")) and explicit_stage:
            normalized["explicit_stage"] = explicit_stage
        if self._is_missing_agent_value(normalized.get("research_direction")) and research_direction:
            normalized["research_direction"] = research_direction
        if not normalized["student_no"] and not normalized["name"]:
            fallback_message = "未找到该用户，或智能体未返回有效身份信息"
            debug = {
                "source": "coze_missing_name",
                "bot_id": self.coze_bot_id,
                "input_student_no": student_no,
                "input_name": name,
                "agent_output": answer_text,
                "normalized_data": normalized,
            }
            logger.error("Coze bot returned data without identity fields: %s", debug)
            return self._build_error_payload(fallback_message, debug)
        return {"success": True, "data": self._build_profile_view_data(normalized)}

    def get_direction_payload_by_question(self, question: str) -> dict:
        if not self.coze_client:
            return {"success": False, "message": "未配置研究方向调用凭证"}

        prompt = self._build_direction_agent_prompt(question=question)
        try:
            answer_text = self._call_bot_text(
                prompt=prompt,
                page="direction",
                user_id="direction-user",
                poll_timeout_seconds=int(self.default_timeout_seconds),
            )
        except Exception as exc:
            debug = {
                "source": "coze_direction_bot_exception",
                "bot_id": self.coze_bot_id,
                "input_question": question,
                "exception_type": type(exc).__name__,
                "exception_repr": repr(exc),
                "traceback": traceback.format_exc(),
            }
            logger.exception("Coze direction bot call failed")
            return self._build_error_payload(f"Coze 研究方向智能体调用失败: {exc}", debug)

        if not answer_text:
            debug = {
                "source": "coze_direction_empty_data",
                "bot_id": self.coze_bot_id,
                "input_question": question,
            }
            logger.error("Coze direction bot returned empty data: %s", debug)
            return self._build_error_payload("Coze 研究方向智能体未返回数据", debug)

        logger.info(
            "Coze direction bot raw data received: bot_id=%s input_question=%s data_preview=%s",
            self.coze_bot_id,
            question,
            repr(answer_text)[:500],
        )

        payload_data = self._extract_json_from_text(answer_text) or {"output": answer_text}
        payload = self._decode_agent_payload(payload_data, fallback_key="output")

        data = {
            "question": question,
            "output": payload.get("output", "")
            or payload.get("answer", "")
            or payload.get("formatted_result", "")
            or payload.get("report", "")
            or answer_text,
            "direction_overview": payload.get("direction_overview", "")
            or payload.get("direction_summary", "")
            or payload.get("overview", "")
            or payload.get("summary", ""),
            "current_stage": payload.get("current_stage", "")
            or payload.get("development_stage", "")
            or payload.get("stage_summary", ""),
            "innovation_suggestions": self._parse_json_field(
                payload.get("innovation_suggestions", [])
                or payload.get("innovation_ideas", [])
                or payload.get("innovation_points", [])
                or payload.get("innovations", []),
                list,
            ),
            "jump_link": payload.get("jump_link", "")
            or payload.get("mindmap_url", "")
            or payload.get("mindmap_link", ""),
            "reasoning_content": payload.get("reasoning_content", ""),
            "report_url": payload.get("report_url", "")
            or payload.get("document_url", "")
            or payload.get("markdown_url", ""),
        }

        if not data["output"] and not data["jump_link"]:
            debug = {
                "source": "coze_direction_invalid_payload",
                "bot_id": self.coze_bot_id,
                "input_question": question,
                "agent_output": answer_text,
            }
            logger.error("Coze direction bot returned invalid payload: %s", debug)
            return self._build_error_payload("研究方向返回内容为空", debug)

        return {"success": True, "data": data}

    def get_paper_search_payload(self, research_direction: str) -> dict:
        if not self.coze_client:
            return self._build_error_payload(
                "未配置论文检索 Coze 调用凭证",
                {
                    "source": "coze_paper_search_not_configured",
                    "bot_id": self.coze_bot_id,
                    "input_research_direction": research_direction,
                },
            )

        prompt = self._build_paper_search_agent_prompt(research_direction=research_direction)
        try:
            answer_text = self._call_bot_text(
                prompt=prompt,
                page="paper_search",
                user_id=f"paper-search-{research_direction or 'topic'}",
                poll_timeout_seconds=int(self.default_timeout_seconds),
            )
        except Exception as exc:
            debug = {
                "source": "coze_paper_search_bot_exception",
                "bot_id": self.coze_bot_id,
                "input_research_direction": research_direction,
                "exception_type": type(exc).__name__,
                "exception_repr": repr(exc),
                "traceback": traceback.format_exc(),
            }
            logger.exception("Coze paper search bot call failed")
            return self._build_error_payload(f"Coze 论文检索智能体调用失败: {exc}", debug)

        if not answer_text:
            debug = {
                "source": "coze_paper_search_empty_data",
                "bot_id": self.coze_bot_id,
                "input_research_direction": research_direction,
            }
            logger.error("Coze paper search bot returned empty data: %s", debug)
            return self._build_error_payload("Coze 论文检索智能体未返回数据", debug)

        logger.info(
            "Coze paper search bot raw data received: bot_id=%s input_direction=%s data_preview=%s",
            self.coze_bot_id,
            research_direction,
            repr(answer_text)[:500],
        )

        normalized = self._normalize_paper_search_data(
            payload_data=self._extract_json_from_text(answer_text) or {"formatted_result": answer_text},
            research_direction=research_direction,
            answer_text=answer_text,
        )

        if not normalized["papers"] and not normalized["formatted_result"]:
            debug = {
                "source": "coze_paper_search_invalid_payload",
                "bot_id": self.coze_bot_id,
                "input_research_direction": research_direction,
                "agent_output": answer_text,
                "normalized_data": normalized,
            }
            logger.error("Coze paper search bot returned invalid payload: %s", debug)
            return self._build_error_payload("论文检索返回内容为空", debug)

        return {"success": True, "data": normalized}

    def get_hotspot_payload(
        self,
        research_direction: str,
        hotspot_question: str,
        time_range: str = "",
        output_format: str = "",
    ) -> dict:
        if not self.coze_client:
            return self._build_error_payload(
                "未配置热点监测 Coze 调用凭证",
                {
                    "source": "coze_hotspot_not_configured",
                    "bot_id": self.coze_bot_id,
                    "input_research_direction": research_direction,
                    "input_hotspot_question": hotspot_question,
                },
            )

        if not self.coze_bot_id:
            return self._build_error_payload(
                "未配置热点监测 Coze 智能体 ID",
                {
                    "source": "coze_hotspot_missing_bot_id",
                    "input_research_direction": research_direction,
                    "input_hotspot_question": hotspot_question,
                },
            )

        normalized_question = hotspot_question or (
            "请分析该研究方向的当前热点、新兴主题、发展趋势、代表性成果和主要挑战。"
        )
        normalized_time_range = time_range or "近期"
        normalized_output_format = output_format or "完整报告"
        normalized_question = hotspot_question or (
            "请分析该研究方向的当前热点、新兴主题、发展趋势、代表性成果和主要挑战。"
        )
        user_prompt = self._build_hotspot_agent_prompt(
            research_direction=research_direction,
            hotspot_question=normalized_question,
            time_range=normalized_time_range,
            output_format=normalized_output_format,
        )

        result = None
        last_exc: Optional[Exception] = None
        last_traceback = ""

        for attempt in range(1, 3):
            try:
                if attempt > 1:
                    self.coze_client = self._create_coze_client(
                        total_timeout=self.hotspot_timeout_seconds,
                        connect_timeout=self.hotspot_connect_timeout_seconds,
                    )
                result = self.coze_client.chat.create_and_poll(
                    bot_id=self.coze_bot_id,
                    user_id="local-hotspot-user",
                    additional_messages=[Message.build_user_question_text(user_prompt)],
                    meta_data={"page": "hotspot", "attempt": str(attempt)},
                    poll_timeout=int(self.hotspot_timeout_seconds),
                )
                break
            except Exception as exc:
                last_exc = exc
                last_traceback = traceback.format_exc()
                if attempt == 1 and self._is_timeout_like_error(exc):
                    logger.warning(
                        "Coze hotspot bot timed out on attempt %s, retrying once: %s",
                        attempt,
                        exc,
                    )
                    continue
                debug = {
                    "source": "coze_hotspot_bot_sdk_exception",
                    "bot_id": self.coze_bot_id,
                    "input_research_direction": research_direction,
                    "input_hotspot_question": normalized_question,
                    "attempt": attempt,
                    "timeout_seconds": self.hotspot_timeout_seconds,
                    "connect_timeout_seconds": self.hotspot_connect_timeout_seconds,
                    "exception_type": type(exc).__name__,
                    "exception_repr": repr(exc),
                    "traceback": last_traceback,
                }
                logger.exception("Coze hotspot bot SDK call failed")
                return self._build_error_payload(f"Coze 热点监测智能体调用失败: {exc}", debug)

        if result is None:
            debug = {
                "source": "coze_hotspot_bot_retry_exhausted",
                "bot_id": self.coze_bot_id,
                "input_research_direction": research_direction,
                "input_hotspot_question": normalized_question,
                "timeout_seconds": self.hotspot_timeout_seconds,
                "connect_timeout_seconds": self.hotspot_connect_timeout_seconds,
                "exception_type": type(last_exc).__name__ if last_exc else "",
                "exception_repr": repr(last_exc) if last_exc else "",
                "traceback": last_traceback,
            }
            return self._build_error_payload("Coze 热点监测智能体调用失败：请求超时，请稍后重试", debug)

        answer_text = self._extract_chat_answer(getattr(result, "messages", None))
        if not answer_text:
            debug = {
                "source": "coze_hotspot_empty_answer",
                "bot_id": self.coze_bot_id,
                "input_research_direction": research_direction,
                "input_hotspot_question": normalized_question,
                "result_type": type(result).__name__,
                "result_repr": repr(result),
            }
            logger.error("Coze hotspot bot returned empty answer: %s", debug)
            return self._build_error_payload("Coze 热点监测智能体未返回内容", debug)

        logger.info(
            "Coze hotspot bot raw data received: bot_id=%s input_direction=%s answer_preview=%s",
            self.coze_bot_id,
            research_direction,
            repr(answer_text)[:500],
        )

        normalized = self._build_hotspot_response_data(
            agent_output=answer_text,
            research_direction=research_direction,
            hotspot_question=normalized_question,
            time_range=normalized_time_range,
            output_format=normalized_output_format,
        )
        self.latest_hotspot_result = normalized

        return {"success": True, "data": normalized}

    def get_latest_hotspot_payload(self) -> dict:
        if not self.latest_hotspot_result:
            return self._build_error_payload("暂无最近一次热点监测结果")
        return {"success": True, "data": self.latest_hotspot_result}

    def get_latest_knowledge_debug(
        self,
        *,
        entry_type: str = "",
        action: str = "",
        section_type: str = "",
    ) -> dict:
        normalized_entry_type = (entry_type or "").strip().lower()
        normalized_action = (action or "").strip().lower()
        normalized_section_type = (section_type or "").strip().lower()

        if normalized_entry_type or normalized_action or normalized_section_type:
            key = f"{normalized_entry_type}:{normalized_action}:{normalized_section_type}"
            payload = self.latest_knowledge_debug.get(key)
            if not payload:
                return self._build_error_payload("暂无对应知识库调试结果")
            return {"success": True, "data": payload}

        if not self.latest_knowledge_debug:
            return self._build_error_payload("暂无最近一次知识库调试结果")
        return {"success": True, "data": self.latest_knowledge_debug}

    def get_scholar_payload(
        self,
        scholar_name: str,
        research_direction: str,
    ) -> dict:
        if not self.coze_client:
            return self._build_error_payload(
                "未配置学者追踪 Coze 调用凭证",
                {
                    "source": "coze_scholar_not_configured",
                    "bot_id": self.coze_bot_id,
                    "input_scholar_name": scholar_name,
                    "input_research_direction": research_direction,
                },
            )

        prompt = self._build_scholar_agent_prompt(
            scholar_name=scholar_name,
            research_direction=research_direction,
        )
        try:
            answer_text = self._call_bot_text(
                prompt=prompt,
                page="scholar",
                user_id=f"scholar-{scholar_name}",
                poll_timeout_seconds=int(self.default_timeout_seconds),
            )
        except Exception as exc:
            debug = {
                "source": "coze_scholar_bot_exception",
                "bot_id": self.coze_bot_id,
                "input_scholar_name": scholar_name,
                "input_research_direction": research_direction,
                "exception_type": type(exc).__name__,
                "exception_repr": repr(exc),
                "traceback": traceback.format_exc(),
            }
            logger.exception("Coze scholar bot call failed")
            return self._build_error_payload(
                f"Coze 学者追踪智能体调用失败: {exc}",
                debug,
            )

        if not answer_text:
            debug = {
                "source": "coze_scholar_empty_data",
                "bot_id": self.coze_bot_id,
                "input_scholar_name": scholar_name,
                "input_research_direction": research_direction,
            }
            logger.error("Coze scholar bot returned empty data: %s", debug)
            return self._build_error_payload("Coze 学者追踪智能体未返回数据", debug)

        logger.info(
            "Coze scholar bot raw data received: bot_id=%s input_scholar_name=%s data_preview=%s",
            self.coze_bot_id,
            scholar_name,
            repr(answer_text)[:500],
        )

        normalized = self._normalize_scholar_data(
            payload_data=self._extract_json_from_text(answer_text) or {"formatted_result": answer_text},
            scholar_name=scholar_name,
            research_direction=research_direction,
        )

        if not normalized["papers"] and not normalized["formatted_result"]:
            debug = {
                "source": "coze_scholar_invalid_payload",
                "bot_id": self.coze_bot_id,
                "input_scholar_name": scholar_name,
                "input_research_direction": research_direction,
                "agent_output": answer_text,
                "normalized_data": normalized,
            }
            logger.error("Coze scholar bot returned invalid payload: %s", debug)
            return self._build_error_payload("学者追踪返回内容为空", debug)

        return {"success": True, "data": normalized}

    async def handle_knowledge_action(
        self,
        *,
        entry_type: str,
        action: str,
        upload: Optional[UploadFile] = None,
        section_type: str = "",
        knowledge_url: str = "",
    ) -> dict:
        if not self.coze_client:
            return self._build_error_payload(
                "未配置知识库 Coze 调用凭证",
                {
                    "source": "coze_knowledge_not_configured",
                    "bot_id": self.coze_bot_id,
                    "entry_type": entry_type,
                    "action": action,
                    "section_type": section_type,
                },
            )

        normalized_entry_type = (entry_type or "").strip().lower()
        normalized_action = (action or "").strip().lower()
        normalized_section_type = (section_type or "").strip().lower()
        normalized_knowledge_url = (knowledge_url or "").strip()

        try:
            if normalized_action == "import":
                if not upload and not normalized_knowledge_url:
                    return self._build_error_payload("请先上传文件或填写链接")

                prompt = self._build_knowledge_import_prompt(entry_type=normalized_entry_type)
                if normalized_knowledge_url:
                    prompt = f"{prompt}\n\n链接：{normalized_knowledge_url}"
                    answer_text = self._call_bot_text(
                        prompt=prompt,
                        page="knowledge",
                        user_id=f"knowledge-{normalized_entry_type}-link",
                        poll_timeout_seconds=int(self.default_timeout_seconds),
                    )
                else:
                    bot_result = self._call_bot_with_file(
                        prompt=prompt,
                        upload=upload,
                        user_id=f"knowledge-{normalized_entry_type}-{upload.filename}",
                        page="knowledge",
                        poll_timeout_seconds=int(self.default_timeout_seconds),
                    )
                    answer_text = bot_result.get("answer_text", "")
            else:
                prompt = self._build_knowledge_display_prompt(
                    entry_type=normalized_entry_type,
                    section_type=normalized_section_type,
                )
                answer_text = self._call_bot_text(
                    prompt=prompt,
                    page="knowledge",
                    user_id=f"knowledge-{normalized_entry_type}-{normalized_section_type or 'section'}",
                    poll_timeout_seconds=int(self.default_timeout_seconds),
                )
        except Exception as exc:
            debug = {
                "source": "coze_knowledge_exception",
                "bot_id": self.coze_bot_id,
                "entry_type": normalized_entry_type,
                "action": normalized_action,
                "section_type": normalized_section_type,
                "filename": upload.filename if upload else "",
                "knowledge_url": normalized_knowledge_url,
                "exception_type": type(exc).__name__,
                "exception_repr": repr(exc),
                "traceback": traceback.format_exc(),
            }
            logger.exception("Coze knowledge bot call failed")
            return self._build_error_payload(f"Coze 知识库智能体调用失败: {exc}", debug)

        if not answer_text:
            return self._build_error_payload("Coze 知识库智能体未返回数据")

        logger.info(
            "Coze knowledge bot raw data received: bot_id=%s entry_type=%s action=%s section_type=%s data_preview=%s",
            self.coze_bot_id,
            normalized_entry_type,
            normalized_action,
            normalized_section_type,
            repr(answer_text)[:500],
        )

        payload = self._decode_agent_payload(
            self._extract_json_from_text(answer_text) or {"output": answer_text},
            fallback_key="output",
        )
        debug_key = f"{normalized_entry_type}:{normalized_action}:{normalized_section_type}"
        self.latest_knowledge_debug[debug_key] = {
            "entry_type": normalized_entry_type,
            "action": normalized_action,
            "section_type": normalized_section_type,
            "prompt": prompt,
            "raw_answer_text": answer_text,
            "decoded_payload": payload,
            "knowledge_url": normalized_knowledge_url,
        }

        if normalized_action == "import":
            if normalized_entry_type == "paper":
                return {
                    "success": True,
                    "data": {
                        "entry_type": "paper",
                        "action": "import",
                        "message": payload.get("_agent_message", "") or payload.get("message", "") or "论文入库成功",
                        "show_sections": True,
                        "items": [],
                    },
                }

            if normalized_entry_type == "meeting":
                normalized = self._normalize_knowledge_meeting_data(payload)
            else:
                normalized = self._normalize_knowledge_project_data(payload)
            normalized.update(
                {
                    "action": "import",
                    "message": payload.get("_agent_message", "") or payload.get("message", "") or "导入成功",
                    "show_sections": False,
                }
            )
            return {"success": True, "data": normalized}

        if normalized_entry_type == "meeting":
            normalized = self._normalize_knowledge_meeting_data(payload)
            normalized.update(
                {
                    "action": "display",
                    "message": payload.get("_agent_message", "") or payload.get("message", "") or "组会知识库展示完成",
                    "show_sections": False,
                }
            )
            return {"success": True, "data": normalized}

        if normalized_entry_type == "project":
            normalized = self._normalize_knowledge_project_data(payload)
            normalized.update(
                {
                    "action": "display",
                    "message": payload.get("_agent_message", "") or payload.get("message", "") or "项目知识库展示完成",
                    "show_sections": False,
                }
            )
            return {"success": True, "data": normalized}

        normalized = self._normalize_knowledge_display_data(payload, section_type=normalized_section_type)
        normalized.update(
            {
                "action": "display",
                "message": payload.get("_agent_message", "") or payload.get("message", "") or "论文知识库展示完成",
                "show_sections": True,
            }
        )
        return {"success": True, "data": normalized}

    async def review_paper_with_agent(
        self,
        upload: Optional[UploadFile],
        paper_id: str,
        reading_prompt: str = "",
    ) -> dict:
        if not self.coze_client:
            return self._build_error_payload(
                "未配置论文阅读调用凭证",
                {
                    "source": "coze_paper_not_configured",
                    "bot_id": self.coze_bot_id,
                    "input_filename": upload.filename if upload else "",
                },
            )

        prompt = reading_prompt.strip() or self._build_paper_reading_prompt(paper_url=paper_id)
        try:
            if upload and upload.filename:
                bot_result = self._call_bot_with_file(
                    prompt=prompt,
                    upload=upload,
                    user_id=f"paper-{upload.filename or 'upload'}",
                    page="paper_reading",
                    poll_timeout_seconds=int(self.default_timeout_seconds),
                )
            else:
                answer_text = self._call_bot_text(
                    prompt=prompt,
                    page="paper_reading",
                    user_id=f"paper-url-{paper_id or 'remote'}",
                    poll_timeout_seconds=int(self.default_timeout_seconds),
                )
                bot_result = {"answer_text": answer_text, "file_id": ""}
        except Exception as exc:
            debug = {
                "source": "coze_paper_bot_exception",
                "bot_id": self.coze_bot_id,
                "input_filename": upload.filename if upload else "",
                "input_paper_id": paper_id,
                "input_reading_prompt": reading_prompt,
                "exception_type": type(exc).__name__,
                "exception_repr": repr(exc),
                "traceback": traceback.format_exc(),
            }
            logger.exception("Coze paper bot call failed")
            return self._build_error_payload(f"Coze 论文阅读智能体调用失败: {exc}", debug)

        answer_text = bot_result.get("answer_text", "")
        if not answer_text:
            debug = {
                "source": "coze_paper_empty_data",
                "bot_id": self.coze_bot_id,
                "input_filename": upload.filename if upload else "",
                "input_paper_id": paper_id,
            }
            logger.error("Coze paper bot returned empty data: %s", debug)
            return self._build_error_payload("Coze 论文阅读智能体未返回数据", debug)

        logger.info(
            "Coze paper bot raw data received: bot_id=%s input_filename=%s data_preview=%s",
            self.coze_bot_id,
            upload.filename if upload else "",
            repr(answer_text)[:500],
        )

        payload_data = self._extract_json_from_text(answer_text)
        if not payload_data:
            payload_data = {"paper_comments": answer_text, "paper_knowledge": answer_text}
        payload = self._decode_agent_payload(payload_data, fallback_key="paper_comments")

        data = {
            "paper_id": payload.get("paper_id", "") or paper_id,
            "paper_comments": payload.get("paper_comments", "")
            or payload.get("output", "")
            or payload.get("paper_knowledge", "")
            or payload.get("review_text", ""),
            "paper_knowledge": payload.get("paper_knowledge", "")
            or payload.get("knowledge", "")
            or payload.get("structured_reading", ""),
            "file_name": upload.filename if upload and upload.filename else "",
            "file_id": bot_result.get("file_id", ""),
            "title": payload.get("title", "") or payload.get("paper_title", ""),
            "keywords": self._parse_json_field(
                payload.get("keywords", []) or payload.get("paper_keywords", []),
                list,
            ),
            "abstract": payload.get("abstract", "")
            or payload.get("paper_abstract", "")
            or payload.get("summary", ""),
            "innovation_score": payload.get("innovation_score", 0) or payload.get("innovation", 0),
            "logic_score": payload.get("logic_score", 0) or payload.get("logic", 0),
            "data_reliability_score": payload.get("data_reliability_score", 0)
            or payload.get("data_reliability", 0),
            "conclusion_score": payload.get("conclusion_score", 0) or payload.get("conclusion", 0),
            "improvement_score": payload.get("improvement_score", 0) or payload.get("improvement", 0),
            "improvement_advice": payload.get("improvement_advice", "")
            or payload.get("improvement_suggestion", "")
            or payload.get("advice", ""),
        }

        if not data["paper_comments"]:
            debug = {
                "source": "coze_paper_invalid_payload",
                "bot_id": self.coze_bot_id,
                "input_filename": upload.filename if upload else "",
                "input_paper_id": paper_id,
                "agent_output": answer_text,
            }
            logger.error("Coze paper bot returned invalid payload: %s", debug)
            return self._build_error_payload("论文分析返回内容为空", debug)

        return {"success": True, "data": data}

    async def ask_paper_followup(
        self,
        upload: Optional[UploadFile],
        question: str,
        summary_context: str = "",
        paper_url: str = "",
    ) -> dict:
        if not self.coze_client:
            return self._build_error_payload("未配置论文伴读调用凭证")

        prompt = self._build_paper_chat_prompt(
            question=question,
            summary_context=summary_context,
        )
        try:
            if upload and upload.filename:
                bot_result = self._call_bot_with_file(
                    prompt=prompt,
                    upload=upload,
                    user_id=f"paper-chat-{upload.filename or 'upload'}",
                    page="paper_chat",
                    poll_timeout_seconds=int(self.default_timeout_seconds),
                )
            else:
                answer_text = self._call_bot_text(
                    prompt=prompt,
                    page="paper_chat",
                    user_id=f"paper-chat-url-{paper_url or 'remote'}",
                    poll_timeout_seconds=int(self.default_timeout_seconds),
                )
                bot_result = {"answer_text": answer_text, "file_id": ""}
        except Exception as exc:
            debug = {
                "source": "coze_paper_chat_bot_exception",
                "bot_id": self.coze_bot_id,
                "input_filename": upload.filename if upload else "",
                "input_paper_url": paper_url,
                "input_question": question,
                "exception_type": type(exc).__name__,
                "exception_repr": repr(exc),
                "traceback": traceback.format_exc(),
            }
            logger.exception("Coze paper chat bot call failed")
            return self._build_error_payload(f"Coze 论文伴读智能体调用失败: {exc}", debug)

        answer_text = bot_result.get("answer_text", "").strip()
        if not answer_text:
            return self._build_error_payload("论文伴读未返回内容")
        payload_data = self._extract_json_from_text(answer_text) or {}
        payload = self._decode_agent_payload(payload_data, fallback_key="answer")
        normalized_answer = (
            str(payload.get("answer", "")).strip()
            or str(payload.get("data", {}).get("answer", "")).strip()
            if isinstance(payload.get("data"), dict)
            else ""
        )
        if not normalized_answer:
            normalized_answer = answer_text
        return {
            "success": True,
            "data": {
                "answer": normalized_answer,
                "file_id": bot_result.get("file_id", ""),
            },
        }
