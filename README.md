# live2d-model

Live2D 模型库。每个模型一个独立目录，通过 jsDelivr 提供稳定直链，可直接被网页、看板娘组件、机器人项目引用。

模型清单位于 [`index.json`](./index.json)，机器可读，可直接 fetch 使用。

---

## 直链格式

```
https://cdn.jsdelivr.net/gh/Liwncy/live2d-model@main/models/<id>/<id>.model3.json
```

`<id>` 是 `models/` 下的目录名。加载入口始终是 `*.model3.json`，其余文件（moc3、贴图、动作、物理）由它内部按相对路径引用，**不用手动拼**。

jsDelivr 返回 `Access-Control-Allow-Origin: *`，浏览器里直接 fetch 不会有跨域问题。

## 在网页里加载

需要先引入 Live2D 官方的 Cubism Core。**它受专有许可约束，不能放进本仓库，必须从官方来源加载**：

```html
<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
```

然后配合任一 Live2D 加载库渲染，核心就一步 —— 把直链喂给它：

```js
import { Live2DModel } from 'pixi-live2d-display';

const model = await Live2DModel.from(
  'https://cdn.jsdelivr.net/gh/Liwncy/live2d-model@main/models/<id>/<id>.model3.json'
);
```

> 加载库的引入方式和版本请以该库自己的文档为准 —— 本仓库只负责提供模型和直链。
> 另外注意 moc3 有版本概念（Cubism 3 / 4 / 5），所选 Core 版本必须能覆盖模型版本，
> `index.json` 里每个模型的 `cubismVersion` 已经标好了。

## 读取模型清单

```js
const index = await fetch(
  'https://cdn.jsdelivr.net/gh/Liwncy/live2d-model@main/index.json'
).then((r) => r.json());

// 按标签筛选、挑体积小的、拿直链
const pick = index.models.filter((m) => m.tags.includes('看板娘'));
console.log(pick[0].url);
```

`index.json` 里每个模型带这些字段：

| 字段 | 说明 |
|---|---|
| `id` / `name` | 目录名 / 显示名 |
| `cubismVersion` | Cubism 版本，自动从 moc3 头部读出 |
| `license` / `author` / `source` | 许可、作者、来源 |
| `tags` | 检索标签 |
| `entry` / `url` | 仓库内相对路径 / CDN 直链 |
| `files` | 文件数、体积、贴图/动作/表情数量、有无物理与姿势 |

---

## 目录结构

```
.
├── index.json              # 自动生成的模型索引（提交进仓库，供外部 fetch）
├── models/
│   ├── README.md           # 添加模型的完整规范
│   └── <id>/               # 一个完整模型
│       ├── meta.json       # 元数据（可选）
│       ├── <id>.model3.json
│       ├── <id>.moc3
│       └── ...
└── tools/
    ├── build-index.mjs     # 扫描 models/ 生成 index.json
    └── meta.template.json  # meta.json 模板
```

## 添加模型

```bash
mkdir -p models/my-model                     # 1. 建目录，拷入模型文件
cp tools/meta.template.json models/my-model/meta.json   # 2. 写 meta.json
node tools/build-index.mjs                   # 3. 校验 + 生成索引
git add models/my-model index.json && git commit -m "feat: add my-model"
```

`meta.json` 为**可选**元数据文件，不写也能收录（缺省用目录名当显示名）。字段细则见 [`models/README.md`](./models/README.md)。

## 收录规则

`node tools/build-index.mjs` **不做任何门槛**：`models/` 下每个包含文件的目录都会被写进 `index.json`（空目录除外）。一切异常只打印提示，**不阻止任何模型收录**：

- 缺 `*.model3.json` 入口 → 仍收录，条目的 `entry` 为 `null`
- `model3.json` 引用的文件不存在 → 仅提示
- 单文件 > 20MB、全库 > 150MB → 仅提示（超出后 jsDelivr 直链可能失效）
- `meta.json` 缺失或损坏 → 仅提示，用目录名等默认值生成条目

`--check` 模式只校验不写盘，并额外检查 `index.json` 是否为最新，用于 CI：

```bash
node tools/build-index.mjs --check
```

## 关于 jsDelivr 的两个坑

**一、分支引用有 12 小时缓存。** 用 `@main` 引用时，覆盖同名文件后 CDN 仍会返回旧内容。要发布固定版本，打 tag 后用 `@v1.0.0` 引用（tag 和 commit 是永久缓存）。应急刷新可以访问：

```
https://purge.jsdelivr.net/gh/Liwncy/live2d-model@main/<文件路径>
```

**二、国内访问有波动。** jsDelivr 的国内节点历史上反复变动，别把它当关键基础设施。重要场景保留 GitHub raw 链接做备链：

```
https://raw.githubusercontent.com/Liwncy/live2d-model/main/models/<id>/<id>.model3.json
```

---

## 许可

- `tools/` 下的脚本以 [MIT](./LICENSE) 授权。
- **`models/` 下的模型文件不属于 MIT 许可**，各自遵循其原许可 —— 见每个模型目录的 `meta.json`（`license` / `licenseUrl` / `source`）。使用前请自行确认授权范围。
- 模型文件的权利归各自权利人所有。若你是某个模型的版权方并希望它被移除，请开 issue。

## 致谢

Live2D 与 Cubism 是 Live2D Inc. 的商标。Cubism Core 遵循 [Live2D 专有软件许可协议](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)。
