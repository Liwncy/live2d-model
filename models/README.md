# models/

每个子目录是一个 Live2D 模型。目录名就是模型 `id`，用小写字母和连字符。

放进来的模型都会进 `index.json`。这是自己的模型库，用来存放或收录，没有额外门槛。

## 目录里通常有这些文件

```
models/<id>/
├── meta.json              # 可选，显示名、标签、备注
├── <id>.model3.json       # 加载入口
├── <id>.moc3              # 模型数据
├── <id>.physics3.json     # 物理（头发、衣服摆动）
├── <id>.pose3.json        # 姿势
├── <id>.cdi3.json         # 参数显示名
├── <id>.userdata3.json    # 参数范围
├── textures/              # 贴图，目录名按 model3.json 里的路径保留
├── motions/*.motion3.json
├── expressions/*.exp3.json
└── sounds/
```

贴图目录保持导出时的名字。`model3.json` 里写的是相对路径，改了目录模型就加载不到。

## meta.json

不写也能收录，显示名用目录名。可以照 `../tools/meta.template.json` 改，字段都可选：

| 字段 | 说明 |
|---|---|
| `name` | 显示名 |
| `order` | 清单顺序，数字越小越靠前；不写就排在后面 |
| `cubismVersion` | 一般不用写；moc3 会读头部自动识别，Cubism 2 的 `.moc` 要手写 |
| `tags` | 检索标签 |

## 添加

```bash
mkdir -p models/my-model
# 把模型文件拷进来

cp tools/meta.template.json models/my-model/meta.json   # 可选

node tools/build-index.mjs
```
