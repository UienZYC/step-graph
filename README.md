# STEP Graph

这是一个 STEP 文件知识提取与可视化项目。后端把 STEP Part 21 文件解析为 `graph.json`，前端第一版使用 React UI 读取静态 `public/graph.json` 并浏览 STEP / B-Rep 结构。

## 当前阶段

- `backend` 将 STEP Part 21 文件解析为 `graph.json`。
- `frontend` 读取 `graph.json` 并展示 STEP / B-Rep 结构。
- 当前暂不做 3D 可视化。
- 当前暂不做孔、圆角、倒角识别。
- 当前暂不恢复建模历史。

## 推荐项目结构

```text
project-root/
├─ backend/
│  ├─ pyproject.toml
│  ├─ step_entity_graph.py
│  ├─ examples/
│  │  └─ example.step
│  └─ outputs/
│     └─ graph.json
│
├─ frontend/
│  ├─ package.json
│  ├─ index.html
│  ├─ public/
│  │  └─ graph.json
│  └─ src/
│     ├─ main.tsx
│     ├─ App.tsx
│     └─ App.css
│
├─ README.md
└─ .gitignore
```

当前仓库已经整理出 `backend/`。如果还没有 `frontend/`，请手动用 Vite 创建，不要用 `uv` 管理前端。

## 环境要求

- Python 3.12+
- uv
- Node.js 22 LTS 推荐
- npm

`uv` 只管理 `backend` 的 Python 环境；`npm` 只管理 `frontend` 的前端依赖。两者不要混用。

## 后端运行

在 Windows PowerShell 中：

```powershell
cd backend
uv run python step_entity_graph.py examples/example.step -o outputs/graph.json
```

## 前端运行

如果 `frontend/` 还不存在，请在项目根目录执行：

```powershell
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm run dev
```

如果 `frontend/` 已经存在：

```powershell
cd frontend
npm install
npm run dev
```

## 数据流

```text
backend/examples/example.step
→ backend/outputs/graph.json
→ frontend/public/graph.json
→ React UI fetch("/graph.json")
```

生成后端数据后，把输出复制到前端静态目录：

```powershell
Copy-Item .\backend\outputs\graph.json .\frontend\public\graph.json -Force
```

如果当前终端已经在 `backend/` 目录：

```powershell
Copy-Item .\outputs\graph.json ..\frontend\public\graph.json -Force
```

然后启动前端并打开浏览器地址，例如：

```powershell
cd frontend
npm run dev
```

```text
http://localhost:5173
```

## 前端第一版 UI 要求

第一版前端只读取静态文件 `frontend/public/graph.json`。建议最小 UI 做到：

- `fetch("/graph.json")`
- 显示 loading / error
- 显示 summary
- 显示 `brep_tree` 的 Solid / Shell / Face 树
- 点击节点后显示 entity detail
- 显示 `entity.raw`
- 显示 `entity.fields`
- 显示 references 和 referenced by
- 如果是 `ADVANCED_FACE`，显示 face neighbors

不要引入 Tailwind、three.js、d3 或复杂 UI 组件库。

## 用户需要手动执行

1. 检查 Node.js 和 npm：

```powershell
node -v
npm -v
```

如果 `node` 命令不存在，请安装 Node.js 22 LTS。

2. 如果 `frontend/` 还不存在，在项目根目录执行：

```powershell
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm run dev
```

3. 如果 `frontend/` 已经存在：

```powershell
cd frontend
npm install
npm run dev
```

4. 生成后端 `graph.json`：

```powershell
cd backend
uv run python step_entity_graph.py examples/example.step -o outputs/graph.json
```

5. 从项目根目录复制后端输出到前端：

```powershell
Copy-Item .\backend\outputs\graph.json .\frontend\public\graph.json -Force
```

如果当前终端已经在 `backend/` 目录：

```powershell
Copy-Item .\outputs\graph.json ..\frontend\public\graph.json -Force
```

6. 启动前端：

```powershell
cd frontend
npm run dev
```

打开浏览器中的地址，例如 `http://localhost:5173`。

## 常见问题

- `node` 命令不存在：需要安装 Node.js。
- `npm run dev` 报 Node 版本过低：升级到 Node.js 22 LTS。
- 页面显示 `graph.json` 加载失败：确认 `frontend/public/graph.json` 是否存在。
- 页面有数据但树为空：确认 `graph.json` 是否包含 `brep_tree`。
- 面邻接为空：确认 `graph.json` 是否包含 `face_adjacency_graph`。

## 版本管理说明

`backend/outputs/` 和旧根目录 `outputs/` 是生成结果，默认忽略。`backend/examples/` 不忽略，测试 STEP 文件可以纳入版本管理。第一版前端可以提交一个小的 `frontend/public/graph.json` 方便 UI 调试，所以 `.gitignore` 没有忽略它。

本项目按应用项目处理，建议提交 `backend/uv.lock` 以保证后端环境可复现。如果未来改成库项目，可再决定是否忽略 `uv.lock`。
