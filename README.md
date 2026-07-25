# STEP Graph

STEP Graph 是一个 STEP Part 21 / B-Rep 结构提取与交互式可视化工具。后端将 STEP 文件转换为语义图和显示网格，前端使用 React 与 three.js 浏览实体关系、拓扑层级和三维模型。

[在线 Demo](https://uienzyc.github.io/step-graph/)（展示仓库内预生成的示例模型）

## 功能

- 解析 STEP 实体、字段及引用关系
- 构建 Solid → Shell → Face → Loop → Edge → Vertex 的 B-Rep 树
- 提取几何属性并计算面邻接关系
- 将面、边和顶点映射回 STEP entity
- 联动查看实体详情、原始 STEP、关系和三维高亮
- 检查语义图与显示网格的来源一致性

## 技术栈

| 模块 | 技术 | 作用 |
| --- | --- | --- |
| `backend` | Python 3.12、OCP | 解析 STEP，生成语义图和三维显示数据 |
| `frontend` | React、TypeScript、Vite、three.js | 展示 B-Rep 结构并提供三维交互 |

后端生成两份数据：

- `graph.json`：STEP 实体、语义关系、B-Rep 树、几何属性和面邻接
- `model_mesh.json`：three.js 可渲染的面、边和顶点，以及对应的 STEP entity 映射证据

`model_mesh.json` 是显示层，不替代 STEP/B-Rep 语义数据。

## 本地运行

环境要求：

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Node.js 22+
- npm

启动前端：

```powershell
cd frontend
npm ci
npm run dev
```

打开终端显示的地址，默认通常为 `http://localhost:5173`。前端会读取 `frontend/public/graph.json` 和 `frontend/public/model_mesh.json`，因此查看现有示例不需要启动后端。

## 生成示例数据

在项目根目录执行：

```powershell
cd backend
uv sync
uv run python step_entity_graph.py examples/example.step -o outputs/graph.json
uv run python generate_model_mesh.py examples/example.step -g outputs/graph.json -o outputs/model_mesh.json
cd ..
Copy-Item .\backend\outputs\graph.json .\frontend\public\graph.json -Force
Copy-Item .\backend\outputs\model_mesh.json .\frontend\public\model_mesh.json -Force
```

数据流：

```text
STEP 文件
├─ step_entity_graph.py   → graph.json
└─ generate_model_mesh.py → model_mesh.json
                              ↓
                    React + three.js Viewer
```

## 验证

后端示例数据检查：

```powershell
cd backend
uv run python test.py
```

前端检查与构建：

```powershell
cd frontend
npm run lint
npm run build
```

## 项目结构

```text
step-graph/
├─ backend/
│  ├─ examples/example.step
│  ├─ step_entity_graph.py
│  ├─ generate_model_mesh.py
│  └─ test.py
├─ frontend/
│  ├─ public/
│  │  ├─ graph.json
│  │  └─ model_mesh.json
│  └─ src/
└─ .github/workflows/deploy-pages.yml
```

## 当前限制

- GitHub Pages Demo 使用预生成数据，不支持在线上传或解析新的 STEP 文件
- 暂不识别孔、圆角、倒角等制造特征
- 暂不恢复 CAD 建模历史
- 网格到 STEP entity 的映射采用保守匹配；无法唯一确认时会保留为未映射
