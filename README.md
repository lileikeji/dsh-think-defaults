# dsh-think-defaults

**自动补全模型思考等级 · Auto-fill reasoning efforts for DSH**

> DeepSeek Harness 插件：自动给 `llm-pi-ai.providers` 下所有缺思考等级字段的模型补默认值，之后接入任何新模型都不用手动配置，UI 直接可选思考等级（off/high/max）。

## 解决的问题

DSH 接入 OpenAI 兼容网关后，模型若缺 `reasoningEfforts` / `compat` / `maxTokens` 字段，UI 上思考等级不可选。本插件自动补齐（参照已验证的 aijws 配置模式），无需每次手动编辑 settings.yaml。

## 功能

| 缺的字段 | 自动补入 |
|---|---|
| `reasoningEfforts` | `{ off: null, high: high, max: max }` |
| `compat` | `{ thinkingFormat: deepseek, supportsReasoningEffort: false }` |
| `maxTokens` | `384000` |

- **幂等**：只补缺失字段，绝不覆盖已有配置；补完后再次扫描无变化则不写回
- **自动**：启动后延迟扫描 + 20s 轮询兜底，新增/修改模型自动补全
- **可开关**：`enabled: false` 即停用
- **安全**：通过 dsh settings 服务写回（持久化到 settings.yaml），不直接改文件

## 安装

```bash
# 克隆
git clone https://github.com/lileikeji/dsh-think-defaults.git
cd dsh-think-defaults

# 拷贝到 DSH profile 的 plugins 目录
mkdir -p ~/.dsh/profiles/web/plugins/dsh-think-defaults
cp -r lib package.json cordis.patch.yml ~/.dsh/profiles/web/plugins/dsh-think-defaults/
```

在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 声明后重启 DSH。

## 配置（cordis.patch.yml）

```yaml
- insert:
    - id: dsh-think-defaults
      name: dsh-think-defaults
      inject: [settings, webServer]
      config:
        enabled: true
        defaultReasoningEfforts:
          off: null
          high: high
          max: max
        defaultCompat:
          thinkingFormat: deepseek
          supportsReasoningEffort: false
        defaultMaxTokens: 384000
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `defaultReasoningEfforts` | off/high/max | 补入的思考档位 |
| `defaultCompat` | deepseek + supportsReasoningEffort:false | 补入的兼容配置（网关不认 reasoning_effort 时置 false，避免 400/工具全红） |
| `defaultMaxTokens` | `384000` | 补入的单次最大输出 |

## 诊断

`GET /dsh-think-defaults/status` 返回最近扫描状态：

```json
{ "lastScan": "2026-08-20T21:02:01Z", "patched": 1, "providersSeen": 4, "lastError": null }
```

## 已知限制

- `supportsReasoningEffort: false` 会关闭 `reasoning_effort` 参数透传——若你的网关确实支持该参数，请自行在模型上显式配置覆盖。
- 轮询间隔 20s：新增模型后最多 20s 内补全。

## License

MIT
