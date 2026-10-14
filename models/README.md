# models/

每个子目录 = 一个完整的 Live2D 模型。目录名即模型 `id`，用小写字母 + 连字符。

## 标准目录结构

```
models/<id>/
├── meta.json              # 必填 —— 本仓库的元数据与许可声明
├── <id>.model3.json       # 必填 —— 加载入口，运行时从这个文件开始读
├── <id>.moc3              # 必填 —— 模型二进制数据
├── <id>.physics3.json     # 物理演算（头发 / 裙摆摆动）
├── <id>.pose3.json        # 姿势（手臂是否交叉等）
├── <id>.cdi3.json         # 参数显示名（Cubism 4+）
├── <id>.userdata3.json    # 参数调整范围
├── textures/              # 贴图 PNG（也可能导出为 <id>.2048/ 之类，按实际保留）
├── motions/*.motion3.json # 动作
├── expressions/*.exp3.json# 表情
└── sounds/                # 语音（可选）
```

贴图目录名不必强改 —— 脚本按 `model3.json` 里 `FileReferences` 的实际路径校验，
改目录反而会让模型加载失败。

## meta.json

照抄 `../tools/meta.template.json` 改。字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `redistributable` | **是** | 必须显式写 `true`。写 `false` 或漏写，脚本直接拒绝收录 |
| `license` | 是 | 许可名称，如 `CC BY 4.0` / `MIT` / 作者自定条款名 |
| `licenseUrl` | 否 | 许可全文链接，有就填 |
| `source` | 是 | 从哪拿到的，尽量给原始链接 |
| `author` | 否 | 原作者 / 版权方 |
| `name` | 否 | 显示名，缺省用目录名 |
| `cubismVersion` | 否 | 不填则脚本自动读 moc3 头部识别；识别不出再手填 |
| `tags` | 否 | 检索标签 |
| `notes` | 否 | 授权范围、修改说明等备注 |

## 添加一个模型

```bash
# 1. 建目录、放文件
mkdir -p models/my-model
# 把 Live2D 导出的模型文件整个拷进来

# 2. 写 meta.json
cp tools/meta.template.json models/my-model/meta.json
# 编辑它，把 redistributable 改成 true，填上 license / source / author

# 3. 生成索引（会校验引用完整性、体积上限、许可字段）
node tools/build-index.mjs

# 4. 提交
git add models/my-model index.json
git commit -m "feat: add my-model"
```

## 硬性红线

- **`redistributable: false` 一律不收**。官方示例模型、游戏拆包模型、来源不明的模型都过不了这一关。
- **单文件不得超过 20MB**，**全库模型总体积不得超过 150MB**。超了 jsDelivr 不服务，直链直接失效。
- 模型里不能有任何私密信息（真实姓名、内网地址、token 之类）—— 这个仓库是公开的，任何人拿到 URL 就能访问。
