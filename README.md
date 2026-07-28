# 科研画像助手

## About

科研画像助手是一个面向科研全过程的 AI 辅助工作台原型。项目希望把科研中常见的分散任务串成一条连续链路：先理解个人科研状态，再辅助论文检索、论文阅读、知识沉淀、热点观察、方向分析和学者追踪。

项目采用 FastAPI + Jinja2 + 原生 JavaScript 实现，后端通过服务层对 Coze 智能体返回内容进行归一化处理，前端负责页面流程、跨页面状态衔接和可视化展示。

## 项目链接

- 项目展示页：`https://bai9yu.github.io/research-assistant/`
- 代码仓库：`https://github.com/bai9yu/research-assistant`

## 功能模块

- 科研画像：根据科研阶段、方向、论文阅读和项目推进情况生成状态概览与行动建议。
- 论文检索：围绕研究方向生成候选论文、推荐理由和检索概述。
- 论文阅读：支持论文上传、基础信息提取、五维评价、原文预览和 AI 伴读问答。
- 知识库：将论文、组会和项目材料沉淀为结构化知识条目。
- 热点监测：生成方向热点概况、主题划分、关键发现和外部代表性链接。
- 研究方向：分析方向发展阶段、关键问题和可能的创新切入点。
- 学者追踪：围绕学者整理论文成果与研究线索。

## 工程结构

```text
.
├── main.py                 # FastAPI 应用入口与路由
├── services/               # 智能体调用、字段解析和业务封装
├── templates/              # Jinja2 页面模板
├── static/                 # 页面脚本、样式和项目资源
├── docs/                   # 前后端对接说明与演示脚本
├── index.html              # GitHub Pages 静态展示页
├── portfolio.css           # 展示页样式
├── requirements.txt        # Python 依赖
└── .env.example            # 环境变量模板
```

## 启动

```bash
python -m venv agent
source agent/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

打开 [http://127.0.0.1:8000](http://127.0.0.1:8000)

## 页面入口

- `/profile`：科研画像
- `/hotspot`：热点监测
- `/hotspot-report`：热点智能体完整输出调试页
- `/direction`：研究方向
- `/paper`：论文评审
- `/knowledge`：知识库
- `/scholar`：学者追踪

## Coze 配置

复制环境变量模板：

```bash
cp .env.example .env
```

在 `.env` 中填写统一的 Coze 令牌，以及当前统一使用的智能体 ID。

```bash
COZE_API_TOKEN=你的通用Coze令牌
COZE_BOT_ID=7651593616867721270
```

## 学者追踪接口

`POST /api/scholar-tracking`

输入：

```json
{
  "scholar_name": "Huiqiang Xie",
  "research_direction": "Semantic Communication"
}
```

输出会被规范化为：

```json
{
  "success": true,
  "data": {
    "scholar_name": "Huiqiang Xie",
    "research_direction": "Semantic Communication",
    "total_count": 11,
    "papers": [],
    "formatted_result": "..."
  }
}
```
