# 科研画像助手

## 面试官访问入口

- 作品集网页：`https://bai9yu.github.io/fcl/`
- GitHub 代码仓库：`https://github.com/bai9yu/fcl`

> 如果作品集网页暂时打不开，请在 GitHub 仓库的 `Settings → Pages` 中选择 `Deploy from a branch`，分支选择 `main`，目录选择 `/root`。

## 启动

```bash
source agent/bin/activate
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
