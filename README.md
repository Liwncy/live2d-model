# live2d-model

自己的 Live2D 模型存放处，也可以用来收录别人的模型。每个模型一个目录，用 jsDelivr 直链给网页、看板娘或机器人加载。

模型清单位于 [`index.json`](./index.json)，可直接 fetch。

---

## 直链格式

```
https://cdn.jsdelivr.net/gh/Liwncy/live2d-model@main/models/<id>/<id>.model3.json
```

`<id>` 是 `models/` 下的目录名。加载入口是 `*.model3.json`，贴图、动作、物理由它按相对路径引用。

jsDelivr 带 `Access-Control-Allow-Origin: *`，浏览器里可以直接 fetch。

## 在网页里加载

先加载 Cubism Core，版本要能覆盖模型的 `cubismVersion`：

```html
<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
```

然后把直链交给加载库：

```js
import { Live2DModel } from 'pixi-live2d-display';

const model = await Live2DModel.from(
  'https://cdn.jsdelivr.net/gh/Liwncy/live2d-model@main/models/<id>/<id>.model3.json'
);
```

## 读取模型清单

```js
const index = await fetch(
  'https://cdn.jsdelivr.net/gh/Liwncy/live2d-model@main/index.json'
).then((r) => r.json());

const pick = index.models.filter((m) => m.tags.includes('看板娘'));
console.log(pick[0].url);
```

| 字段 | 说明 |
|---|---|
| `id` / `name` / `order` | 目录名 / 显示名 / 顺序（小的在前） |
| `cubismVersion` | Cubism 版本，从 moc3 头部读出 |
| `author` / `source` / `license` | 作者、来源、许可，写了才有 |
| `tags` | 检索标签 |
| `entry` / `url` | 仓库内路径 / CDN 直链 |
| `files` | 文件数、体积、贴图 / 动作 / 表情数量 |

---

## 目录结构

```
.
├── index.json              # 模型索引，由脚本生成
├── models/
│   ├── README.md
│   └── <id>/
│       ├── meta.json       # 可选
│       ├── <id>.model3.json
│       ├── <id>.moc3
│       └── ...
└── tools/
    ├── build-index.mjs
    └── meta.template.json
```

## 添加模型

```bash
mkdir -p models/my-model
cp tools/meta.template.json models/my-model/meta.json   # 可选
node tools/build-index.mjs
git add models/my-model index.json && git commit -m "feat: add my-model"
```

把导出的模型文件放进 `models/<id>/` 即可。`meta.json` 不写也能进清单，显示名会用目录名。字段见 [`models/README.md`](./models/README.md)。

`node tools/build-index.mjs --check` 只核对 `index.json` 是否和 `models/` 一致，不写文件。

## jsDelivr

`@main` 大约缓存 12 小时，同名文件更新后不会马上变。要固定版本就打 tag，用 `@v1.0.0` 或提交号引用。要清缓存可以打开：

```
https://purge.jsdelivr.net/gh/Liwncy/live2d-model@main/<文件路径>
```

单文件大约 20MB、整个仓库大约 150MB 之后，jsDelivr 可能不再提供直链。国内访问也不稳定时，可以用 GitHub raw 做备链：

```
https://raw.githubusercontent.com/Liwncy/live2d-model/main/models/<id>/<id>.model3.json
```

`tools/` 下的脚本按 [MIT](./LICENSE) 使用。
