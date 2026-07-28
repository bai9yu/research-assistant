import os
import json
from dotenv import load_dotenv
from cozepy import COZE_CN_BASE_URL, Coze, Message, TokenAuth

load_dotenv()

COZE_API_TOKEN = os.getenv("COZE_API_TOKEN")
COZE_BOT_ID = os.getenv("COZE_BOT_ID", "7651593616867721270")

if not COZE_API_TOKEN:
    raise ValueError("未读取到 COZE_API_TOKEN，请先在 .env 中配置")

coze = Coze(
    auth=TokenAuth(token=COZE_API_TOKEN),
    base_url=COZE_CN_BASE_URL,
)

prompt = "请根据学号 2026001 生成一份科研画像，并仅返回 JSON。"

try:
    result = coze.chat.create_and_poll(
        bot_id=COZE_BOT_ID,
        user_id="local-test-user",
        additional_messages=[Message.build_user_question_text(prompt)],
    )

    messages = getattr(result, "messages", None) or []
    answer_text = ""
    for message in messages:
        if getattr(message, "role", "") == "assistant" and getattr(message, "content", ""):
            answer_text = message.content

    print("bot raw answer type:", type(answer_text))
    print("bot raw answer:", answer_text)

    data = answer_text
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            data = {"output": data}

    print("parsed data:")
    print(json.dumps(data, ensure_ascii=False, indent=2))

except Exception as e:
    print("Coze 智能体调用失败：")
    print(type(e).__name__)
    print(str(e))
