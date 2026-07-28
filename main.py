import logging
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from dotenv import load_dotenv

from services.profile_service import ResearchProfileService

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

app = FastAPI(title="Research Profile Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

service = ResearchProfileService(
    profile_csv_path="outputs/user_profile_test.csv",
    snapshot_csv_path="outputs/research_snapshot_test.csv",
)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return RedirectResponse(url="/profile", status_code=302)


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("profile.html", {"request": request})


@app.get("/api/profile")
async def profile_api_redirect() -> RedirectResponse:
    return RedirectResponse(url="/profile", status_code=302)


@app.get("/direction", response_class=HTMLResponse)
async def direction_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("direction.html", {"request": request})


@app.get("/hotspot", response_class=HTMLResponse)
async def hotspot_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("hotspot.html", {"request": request})


@app.get("/hotspot-report", response_class=HTMLResponse)
async def hotspot_report_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("hotspot_report.html", {"request": request})


@app.get("/paper", response_class=HTMLResponse)
async def paper_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("paper.html", {"request": request})


@app.get("/paper-search", response_class=HTMLResponse)
async def paper_search_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("paper_search.html", {"request": request})


@app.get("/knowledge", response_class=HTMLResponse)
async def knowledge_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("knowledge.html", {"request": request})


@app.get("/scholar", response_class=HTMLResponse)
async def scholar_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("scholar.html", {"request": request})


@app.post("/api/profile")
async def get_profile(payload: dict) -> dict:
    student_no = (payload.get("student_no") or "").strip()
    name = (payload.get("name") or "").strip()
    explicit_stage = (payload.get("explicit_stage") or "").strip()
    research_direction = (payload.get("research_direction") or "").strip()

    if not student_no:
        raise HTTPException(status_code=400, detail="学号不能为空")

    logger.info(
        "Received /api/profile request for student_no=%s name=%s stage=%s direction=%s",
        student_no,
        name,
        explicit_stage,
        research_direction,
    )
    result = service.get_profile_payload(
        student_no=student_no,
        name=name,
        explicit_stage=explicit_stage,
        research_direction=research_direction,
    )
    if not result.get("success"):
        logger.error(
            "Profile query failed for student_no=%s name=%s detail=%s",
            student_no,
            name,
            result,
        )
    return result


@app.post("/api/research-direction")
async def get_research_direction(payload: dict) -> dict:
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="研究问题不能为空")
    logger.info("Received /api/research-direction request for question=%s", question)
    result = service.get_direction_payload_by_question(question)
    if not result.get("success"):
        logger.error("Direction query failed for question=%s, detail=%s", question, result)
    return result


@app.post("/api/scholar-tracking")
async def get_scholar_tracking(payload: dict) -> dict:
    scholar_name = (payload.get("scholar_name") or "").strip()

    if not scholar_name:
        raise HTTPException(status_code=400, detail="学者姓名不能为空")

    logger.info(
        "Received /api/scholar-tracking request for scholar_name=%s",
        scholar_name,
    )
    result = service.get_scholar_payload(
        scholar_name=scholar_name,
        research_direction="",
    )
    if not result.get("success"):
        logger.error(
            "Scholar tracking failed for scholar_name=%s detail=%s",
            scholar_name,
            result,
        )
    return result


@app.post("/api/hotspot-monitoring")
async def get_hotspot_monitoring(payload: dict) -> dict:
    research_direction = (payload.get("research_direction") or "").strip()
    hotspot_question = (payload.get("hotspot_question") or "").strip()
    time_range = (payload.get("time_range") or "").strip()
    output_format = (payload.get("output_format") or "").strip()

    if not research_direction and not hotspot_question:
        raise HTTPException(status_code=400, detail="研究方向和热点问题至少填写一项")

    logger.info(
        "Received /api/hotspot-monitoring request for direction=%s question=%s time_range=%s output_format=%s",
        research_direction,
        hotspot_question,
        time_range,
        output_format,
    )
    result = service.get_hotspot_payload(
        research_direction=research_direction,
        hotspot_question=hotspot_question,
        time_range=time_range,
        output_format=output_format,
    )
    if not result.get("success"):
        logger.error(
            "Hotspot monitoring failed for direction=%s question=%s detail=%s",
            research_direction,
            hotspot_question,
            result,
        )
    return result


@app.get("/api/hotspot-monitoring/latest")
async def get_latest_hotspot_monitoring() -> dict:
    result = service.get_latest_hotspot_payload()
    if not result.get("success"):
        logger.info("No latest hotspot result available")
    return result


@app.post("/api/paper-search")
async def get_paper_search(payload: dict) -> dict:
    research_direction = (payload.get("research_direction") or "").strip()
    if not research_direction:
        raise HTTPException(status_code=400, detail="研究方向不能为空")

    logger.info(
        "Received /api/paper-search request for research_direction=%s",
        research_direction,
    )
    result = service.get_paper_search_payload(research_direction)
    if not result.get("success"):
        logger.error(
            "Paper search failed for research_direction=%s detail=%s",
            research_direction,
            result,
        )
    return result


@app.post("/api/paper-review")
async def review_paper(
    paper_pdf: Optional[UploadFile] = File(None),
    paper_id: str = Form(""),
    paper_url: str = Form(""),
    reading_prompt: str = Form(""),
) -> dict:
    has_file = bool(paper_pdf and paper_pdf.filename)
    normalized_reference = paper_url.strip() or paper_id.strip()
    normalized_prompt = reading_prompt.strip()
    if not has_file and not normalized_reference and not normalized_prompt:
        raise HTTPException(status_code=400, detail="请先上传论文文件或填写论文 URL")
    logger.info(
        "Received /api/paper-review request for filename=%s paper_reference=%s reading_prompt=%s",
        paper_pdf.filename if paper_pdf else "",
        normalized_reference,
        normalized_prompt,
    )
    result = await service.review_paper_with_agent(
        upload=paper_pdf,
        paper_id=normalized_reference,
        reading_prompt=normalized_prompt,
    )
    if not result.get("success"):
        logger.error(
            "Paper review failed for filename=%s paper_reference=%s reading_prompt=%s detail=%s",
            paper_pdf.filename if paper_pdf else "",
            normalized_reference,
            normalized_prompt,
            result,
        )
    return result


@app.post("/api/paper-chat")
async def paper_chat(
    paper_pdf: Optional[UploadFile] = File(None),
    question: str = Form(...),
    summary_context: str = Form(""),
    paper_url: str = Form(""),
) -> dict:
    if not question.strip():
        raise HTTPException(status_code=400, detail="请输入提问内容")
    if not (paper_pdf and paper_pdf.filename) and not paper_url.strip():
        raise HTTPException(status_code=400, detail="请先上传论文文件或填写论文 URL")

    logger.info(
        "Received /api/paper-chat request for filename=%s paper_url=%s question=%s",
        paper_pdf.filename if paper_pdf else "",
        paper_url.strip(),
        question.strip(),
    )
    result = await service.ask_paper_followup(
        upload=paper_pdf,
        question=question.strip(),
        summary_context=summary_context.strip(),
        paper_url=paper_url.strip(),
    )
    if not result.get("success"):
        logger.error(
            "Paper chat failed for filename=%s paper_url=%s question=%s detail=%s",
            paper_pdf.filename if paper_pdf else "",
            paper_url.strip(),
            question.strip(),
            result,
        )
    return result


@app.post("/api/knowledge")
async def knowledge_action(
    entry_type: str = Form(...),
    action: str = Form(...),
    section_type: str = Form(""),
    knowledge_file: Optional[UploadFile] = File(None),
    knowledge_url: str = Form(""),
) -> dict:
    normalized_entry_type = (entry_type or "").strip().lower()
    normalized_action = (action or "").strip().lower()

    if normalized_entry_type not in {"paper", "meeting", "project"}:
        raise HTTPException(status_code=400, detail="知识库类型不合法")
    if normalized_action not in {"import", "display"}:
        raise HTTPException(status_code=400, detail="知识库操作不合法")

    logger.info(
        "Received /api/knowledge request for entry_type=%s action=%s section_type=%s filename=%s",
        normalized_entry_type,
        normalized_action,
        section_type,
        knowledge_file.filename if knowledge_file else "",
    )
    result = await service.handle_knowledge_action(
        entry_type=normalized_entry_type,
        action=normalized_action,
        upload=knowledge_file,
        section_type=section_type,
        knowledge_url=knowledge_url,
    )
    if not result.get("success"):
        logger.error(
            "Knowledge action failed for entry_type=%s action=%s section_type=%s detail=%s",
            normalized_entry_type,
            normalized_action,
            section_type,
            result,
        )
    return result


@app.get("/api/knowledge-debug")
async def get_knowledge_debug(
    entry_type: str = "",
    action: str = "",
    section_type: str = "",
) -> dict:
    result = service.get_latest_knowledge_debug(
        entry_type=entry_type,
        action=action,
        section_type=section_type,
    )
    if not result.get("success"):
        logger.info(
            "No knowledge debug result for entry_type=%s action=%s section_type=%s",
            entry_type,
            action,
            section_type,
        )
    return result
