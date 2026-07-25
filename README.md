# STEP Graph

用来查看 STEP Part 21 文件里的 entity、引用关系和 B-Rep 拓扑。

[打开示例](https://uienzyc.github.io/step-graph/)

仓库里有两条数据生成链路：

```text
STEP ── step_entity_graph.py ──> graph.json
  └──── generate_model_mesh.py ─> model_mesh.json
```

`graph.json` 保存 STEP 语义，`model_mesh.json` 保存 three.js 需要的三角面、边采样点和顶点。前端只读取这两个静态文件，不直接解析 STEP。

## 运行示例

`frontend/public` 已经放入 `backend/examples/example.step` 的生成结果。查看它只需要启动前端：

```powershell
cd frontend
npm ci
npm run dev
```

页面由三部分组成：

- 左侧：Solid、Shell、Face、Loop、Edge 和 Vertex 的树；
- 中间：当前 STEP entity 的字段、几何属性、引用、映射依据和原始语句；
- 右侧：three.js 模型，可按 Face、Edge、Vertex 或 Auto 模式拾取。

树节点、详情和三维对象都通过 `#12` 这种 STEP id 联动。

## 处理其他 STEP 文件

后端使用 Python 3.12 和 `uv`。在仓库根目录执行：

```powershell
cd backend
uv sync

uv run python step_entity_graph.py examples/example.step -o outputs/graph.json
uv run python generate_model_mesh.py examples/example.step `
  -g outputs/graph.json `
  -o outputs/model_mesh.json

cd ..
Copy-Item .\backend\outputs\graph.json .\frontend\public\graph.json -Force
Copy-Item .\backend\outputs\model_mesh.json .\frontend\public\model_mesh.json -Force
```

将两条命令中的 `examples/example.step` 换成实际文件路径即可。`generate_model_mesh.py` 还接受：

```text
--linear-deflection  0.1
--angular-deflection 0.5
--edge-samples       24
```

以上是代码中的默认值。

## 两个输出文件

### `graph.json`

`step_entity_graph.py` 读取 HEADER 和 DATA section，按分号拆分 entity 语句。输出中主要使用这些字段：

- `entities`：以 STEP id 为键的 entity；
- `edges`、`semantic_edges`：普通引用和带字段角色的引用；
- `type_index`：entity 类型到 id 的索引；
- `geometry_attributes`：坐标、方向、半径、端点和表面信息；
- `brep_tree`：从 `MANIFOLD_SOLID_BREP` 展开的拓扑树；
- `face_adjacency_graph`：共享边、边界边和非流形边；
- `source`、`summary`：输入文件哈希和数量统计。

已在 `ROLE_SCHEMAS` 中定义的类型会得到命名字段。未定义的参数写成 `arg_0`、`arg_1`；复合 entity 保留原文和 `complex_types`，不拆命名字段。

### `model_mesh.json`

`generate_model_mesh.py` 使用 OCP 三角化 STEP shape。输出包含 `faces`、`edges`、`vertices` 和 `mapping_quality`。

OCP shape 没有 STEP entity id，因此映射是后算的：

- Vertex 按坐标匹配；
- Edge 按端点和曲线类型匹配；
- Face 优先比较边界 `EDGE_CURVE` 集合。

候选不唯一时，后端保留空的 `step_id`，并把原因写进 `mapping_quality.notes`。前端还有两种兜底匹配，界面会将其标为 `frontend_fallback`，不要把它当成后端确认结果。

两份 JSON 都记录输入 STEP 的 SHA-256。哈希不一致时，前端会显示来源警告。

## 代码位置

```text
backend/
├─ step_entity_graph.py       STEP 文本解析、B-Rep 树和面邻接
├─ generate_model_mesh.py     OCP 网格生成及 entity 映射
├─ test.py                    示例 graph.json 的断言
└─ examples/example.step

frontend/
├─ src/App.tsx                页面和 three.js viewer
├─ src/tooltips.ts            字段说明
├─ src/components/Tooltip.tsx 悬停帮助
└─ public/
   ├─ graph.json
   └─ model_mesh.json
```

## 检查

`backend/test.py` 依赖刚生成的 `backend/outputs/graph.json`：

```powershell
cd backend
uv run python step_entity_graph.py examples/example.step -o outputs/graph.json
uv run python test.py
```

它检查 entity 数量、语义边、B-Rep、面邻接和部分几何属性。当前没有针对 `model_mesh.json` 的自动化测试。

前端：

```powershell
cd frontend
npm ci
npm run lint
npm run build
```

## 使用时要注意

- 解析器不是 EXPRESS schema 校验器；它只按当前代码支持的 Part 21 文本结构提取数据。
- `brep_tree` 只从 `MANIFOLD_SOLID_BREP` 开始构建。其他表示仍会进入 `entities`，但不一定出现在树里。
- `model_mesh.json` 的 `units` 目前固定为 `unknown`，生成脚本不做单位推断或换算。
- 当前没有孔、圆角、倒角识别，也不恢复 CAD 建模历史。
- 前端没有上传入口。更换模型后要重新生成 JSON，并复制到 `frontend/public`。
- `vite.config.ts` 的部署路径固定为 `/step-graph/`。仓库改名或换部署子路径时需要同时修改 `base`。
