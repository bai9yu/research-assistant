# 研途喵前端与 Coze 对接说明

## 1. 整体架构

前端采用原生 HTML + CSS + JavaScript，后端采用 FastAPI。页面不会直接请求 Coze，而是统一走本地后端接口，由后端完成参数组装、工作流调用、结果归一化与兼容兜底。

整体链路如下：

1. 用户在前端页面输入文本、上传文件或点击按钮
2. 页面脚本通过 `fetch` 调用本地 `/api/*` 接口
3. FastAPI 服务层把请求转成 Coze 工作流需要的格式
4. Coze 返回结果后，后端先做字段解包和结构清洗
5. 前端再把标准化结果渲染到页面

## 2. 页面与脚本对应关系

- `templates/profile.html` + `static/profile.js`
  - 科研画像页
- `templates/paper_search.html` + `static/paper_search.js`
  - 论文检索页
- `templates/paper.html` + `static/paper.js`
  - 论文阅读页
- `templates/knowledge.html` + `static/knowledge.js`
  - 科研知识库页
- `templates/hotspot.html` + `static/hotspot.js`
  - 热点监测页
- `templates/direction.html` + `static/direction.js`
  - 研究方向页
- `templates/scholar.html` + `static/scholar.js`
  - 学者追踪页

所有页面共享一份总样式文件：

- `static/style.css`

## 3. 前端是怎么和 Coze 接口衔接的

### 3.1 本地接口层

前端目前主要调用这些本地接口：

- `/api/profile`
- `/api/paper-search`
- `/api/paper-review`
- `/api/paper-chat`
- `/api/knowledge`
- `/api/hotspot-monitoring`
- `/api/research-direction`
- `/api/scholar`
- `/api/knowledge-debug`

这些接口的作用不是简单转发，而是做“前端友好层”：

- 屏蔽 Coze 返回格式差异
- 兼容不同工作流的字段命名
- 处理文件上传与 URL 输入
- 给前端输出稳定结构

### 3.2 为什么需要后端归一化

Coze 返回常见情况包括：

- 数据在顶层
- 数据嵌在 `data`
- 数据被包成 `output`
- 返回的是 Markdown
- 返回的是 JSON 字符串

所以服务层会做：

- 递归解包
- JSON 解析
- Markdown 提取
- 同义字段兜底

例如科研画像页这次修复的重点，就是把 `decoded_payload.data` 里的 `read_paper_count`、`collect_paper_count` 等字段正确提取出来，避免前端显示旧值或 0。

## 4. 页面状态如何保留

每个页面都使用 `localStorage` 保存最近一次结果，以便切换页面后仍保留显示内容。例如：

- `profile-page-state-v1`
- `paper-search-state-v3`
- `paper-reading-state-v3`
- `paper-reading-pending-v3`
- `knowledge-page-state-v11`
- `knowledge-page-pending-import-v1`
- `scholar-page-state-v1`
- `direction-page-state-v1`
- `hotspot-page-state-v3`

这样可以实现：

- 页间切换不丢内容
- 返回原页面时继续展示上次结果
- 只有重新点击按钮时，才用新结果覆盖旧结果

## 5. 一键清空是怎么做的

新增了一个统一脚本：

- `static/app_shell.js`

它会在所有页面的左下角渲染“一键清空”入口，点击后清空上述本地状态键，并刷新当前页面。

这个功能适合：

- 回到初始界面重新演示
- 避免旧缓存干扰当前调试
- 清空跨页面残留状态

## 6. 界面是怎么搭建出来的

当前界面没有使用 React/Vue 之类前端框架，而是走一套统一的原生组件化命名：

- 侧边导航：`side-nav`
- 品牌区：`brand-block`
- 页面头图区域：`hero`
- 主卡片：`card`, `warm-card`, `soft-panel`
- 区块头：`section-head`
- 标签按钮：`entry-tab`
- 指标卡片：`metric`
- 列表记录卡：`representative-result-card`, `scholar-paper-card`

好处是：

- 调整像素级对齐时很直接
- 不需要额外构建工具链
- 页面间视觉统一容易维护

## 7. 论文阅读页的特殊处理

论文阅读页有两条并行链路：

1. 智能体分析链路
   - 走 `/api/paper-review`
   - 输出标题、关键词、摘要、评分、伴读内容

2. 本地文件预览链路
   - 由前端自己渲染 PDF
   - 不依赖 Coze 返回 PDF 内容

也就是说：

- Coze 负责“理解论文”
- 前端负责“展示论文”

这就是为什么页面即便智能体不返回 PDF 正文，也仍然可以预览上传的论文文件。

## 8. 论文检索、论文阅读、知识库之间是怎么串起来的

### 8.1 论文检索 → 论文阅读

在论文检索页点击“阅读”时：

- 会把论文标题、链接、排序和自动阅读提示写入待处理状态
- 跳转到 `/paper`
- 阅读页检测到待处理状态后自动发起初始化分析

### 8.2 论文阅读 → 知识库

在论文阅读页点击“上传到知识库”时：

- 前端会把当前文件或当前 URL 重新打包给 `/api/knowledge`
- 知识库页会通过 `knowledge-page-pending-import-v1` 接收到刷新提示
- 打开知识库页后自动按论文模式刷新内容

这次还修正了一个关键点：

- 论文阅读页之前还在清理旧版 `knowledge-page-state-v10`
- 现在已经改为清理 `knowledge-page-state-v11`

这样知识库刷新才会稳定覆盖旧状态。

## 9. 当前没有依赖哪些“插件”

前端运行时没有依赖浏览器插件，也没有使用重量级 UI 组件库。

当前主要使用的是：

- 原生 DOM API
- `fetch`
- `localStorage`
- FastAPI 模板渲染
- Coze 工作流作为智能体后端

在开发验证阶段，使用了 Codex 的 in-app browser 来做：

- 页面联调
- 点击测试
- 标注反馈
- 样式精调

## 10. 如果继续扩展，建议这样维护

建议把“Coze 原始结果”和“前端渲染数据”始终分离：

1. 后端只负责把 Coze 输出转成统一 DTO
2. 前端只负责消费 DTO，不直接兼容多种 Coze 原始结构
3. 新增工作流时，优先改服务层映射，而不是到前端到处补判断

这样后续无论继续扩展知识库、增加更多工作流，还是继续微调界面，都能保持结构清晰。
