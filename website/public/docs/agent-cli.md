# Agent 与 CLI 调用

桌面端保存波形编辑后，CLI `history` 的 `paths.wav/mp3` 和 ZIP 导出使用编辑后的音频与时长。原始音频保留在作品目录，可在桌面波形窗口恢复。项目版本选择、背景音乐与混音成品从项目界面管理；CLI 逐条生成与普通 ZIP 不会自动混入背景音乐。

桌面端可在「设置与帮助 → 智能体与 CLI 接入」复制当前电脑的命令和智能体接入说明、保存 JSON 脚本示例，或打开本文档。命令自动包含实际应用路径与当前数据目录；移动软件后请重新复制。批量示例使用相对路径 `script.json` 和 `./audio`，请在脚本所在目录运行。

Codex、Claude Code、WorkBuddy 或其他具有本地命令执行能力的 Agent，都可以直接调用声悦 CLI。命令不弹窗、不等待交互，配音使用本机模型。本版本免费使用，无需激活，首次安装通过显式 `setup` 联网下载，生成不会自动下载。

## 入口

源码目录中，推荐 Agent 使用绝对路径，避免依赖当前工作目录：

```sh
node /Users/bingzhang/workspace/freeteam/local-voice-studio/cli/studio.cjs describe
node /Users/bingzhang/workspace/freeteam/local-voice-studio/cli/studio.cjs status
```

需要 Node.js 22.12+。在项目根目录也可执行 `npm run --silent cli -- status`；普通 `npm run cli` 的 npm 横幅会混入 stdout，不适合直接解析 JSON。

可选：在项目根目录执行 `npm link`，把 `shengyue` 注册到当前 Node 安装的命令目录，随后使用 `shengyue status`。Agent 的 PATH 需要包含该目录。

**v0.3.2 桌面安装包**内置无窗口 CLI，不要求安装 Node.js：

```sh
# macOS：直接调用可执行文件，不能使用 open -a
"/Applications/声悦.app/Contents/MacOS/声悦" --cli status

# Windows PowerShell：路径根据实际安装位置调整；管道等待 GUI 可执行文件完成
& "C:\实际安装目录\声悦.exe" --cli status | Out-String
```

v0.4.8 免费版安装包包含 CLI。CLI 与桌面端共用数据、模型、历史和参考声音，无需购买、设备码或激活。默认数据目录仍为 macOS 的 `~/Library/Application Support/Voice Studio` 或 Windows 的 `%APPDATA%\Voice Studio`。可用 `--data-dir /absolute/path` 或 `VOICE_STUDIO_DATA` 指定独立目录。`VOICE_STUDIO_PYTHON` 仅在源码开发版支持；发行版使用准备流程安装的本机组件。

配置检测仅检查配置、环境和资源安装状态，不下载模型或生成配音，无需试听确认。使用 `preflight --package all` 检查本机；加 `--network` 可检查资源地址连通性。`preflight prepare` 保留为环境检查别名，旧的 `preflight confirm --heard` 已移除。

## 最小调用流程

```sh
shengyue describe
shengyue preflight --package light
shengyue status
shengyue catalog

# 仅在需要且用户同意下载时执行；默认 standard
shengyue setup --package light --timeout 3600

shengyue generate --text "你好，这是 Agent 调用生成的语音。" \
  --speaker Vivian --engine light --sample-rate 24000 \
  --output /absolute/path/hello.wav --timeout 300
```

`describe` 返回命令列表、JSON Schema、输入输出约定与退出码。`catalog` 返回实际可用的音色、人物、情绪、场景和语言 ID。普通操作成功时 stdout 只有一行 JSON：

```json
{"ok":true,"command":"generate","result":{"items":[{"id":"<clip-id>","paths":{"wav":"/absolute/path/outputs/<clip-id>/voice.wav","mp3":"/absolute/path/outputs/<clip-id>/voice.mp3"},"exportPath":"/absolute/path/hello.wav"}]}}
```

上例省略了其他音频元数据。WAV 和 MP3 会同时保存在应用数据目录；`--output` 另存单条音频，`--format mp3` 选择 MP3，默认 WAV。`--output-dir` 另存批量音频，文件名使用 `音频ID-原文件名`，避免不同任务重名。导出不覆盖已有文件，返回 `OUTPUT_EXISTS`。`--output` 与 `--output-dir` 二选一。

进度以 JSON Lines 写入 stderr，后端诊断写入数据目录下的 `studio.log`。使用 `--quiet` 关闭进度。`--help` 是纯文本；`--version` 和 `describe` 返回独立 JSON 对象，不使用普通操作的 `ok/result` 包装。

## 文本与多角色脚本

输入方式三选一：`--text`、`--text-file`、`--input`。文本文件 UTF-8 编码，`--batch` 按非空行生成。JSON 文件使用 `--input script.json`，或 `--input -` 从标准输入读取，适合 Agent 通过进程 API 传入内容，避免 shell 转义问题。文本标准输入也可用 `--text-file -`。

```sh
shengyue generate --text-file /absolute/path/lines.txt --batch \
  --speaker Serena --output-dir /absolute/path/audio --timeout 600

shengyue generate --input /absolute/path/script.json \
  --output-dir /absolute/path/audio --timeout 600
```

`script.json` 示例：

```json
{
  "engine": "standard",
  "language": "Chinese",
  "sampleRate": 48000,
  "project": "故事对白",
  "rows": [
    {"text": "我们终于到了！", "speaker": "Vivian", "emotion": "happy", "filename": "girl-01"},
    {"text": "大家先休息一下。", "speaker": "Uncle_Fu", "emotion": "natural", "filename": "male-01"}
  ]
}
```

每行参数覆盖顶层默认值，显式 CLI 参数覆盖 JSON 顶层参数。JSON 字段使用 camelCase，如 `sampleRate`、`voiceDescription`、`referenceId`；命令参数使用 `--sample-rate`、`--voice-description`、`--reference-id`。每批最多 100 条、5000 字，每条最多 600 字，输入文件或 stdin 最多 2 MB。桌面保存的 `shengyue-project-1` 文件包含界面状态，不能直接用作 CLI 请求；需转换为上述请求对象。

## 课程文稿批量调用

适合网课、企业培训和操作教程。将 UTF-8 文稿整理为每行一个课程片段，复用同一讲师声音批量生成：

```sh
shengyue generate --text-file /absolute/path/course-01.txt --batch \
  --speaker Uncle_Fu --language Chinese --scene course \
  --project "课程第一章" --prefix lesson-01 \
  --output-dir /absolute/path/course-audio --format mp3 --timeout 1800
```

MP3 另存到指定目录，原始 WAV / MP3 与记录同时保存在本机。需要按课时命名时，使用 JSON `rows`，为每段设置 `filename`（如 `lesson-01-001`）；需要复用已保存的讲师参考声音时，改用 `--mode clone --reference-id <reference-id>`。

CLI 每批最多 5000 字、100 段，每段最多 600 字；长课程先拆段，再分批调用。生成按顺序进行，超时时间可按设备速度调整。根据返回的音频 ID 可继续调用 `export` 打包 ZIP；桌面端也能在「我的作品」按课程项目筛选、试听与打包保存。

## 人物创作与声音克隆

```sh
shengyue setup --package character
shengyue setup --package reference
shengyue generate --text "今天一起去公园吧！" --mode design --character girl-clear

# 自定义声线描述
shengyue generate --text "欢迎收听今天的故事。" --mode design \
  --voice-description "成年男性，温暖沉稳，清晰自然的故事旁白。"

# 导入有权使用的 3–30 秒清晰参考人声；--consent 是明确确认
shengyue references import --file /absolute/path/reference.wav \
  --text "参考音频中准确的台词。" --name "我的旁白" --consent
shengyue references list

# 也可以把历史作品存为参考声音
shengyue references capture --id <clip-id> --name "我的人物"

shengyue setup --package reference
shengyue generate --text "接下来，让我们继续出发。" --mode clone \
  --reference-id <reference-id>
```

人物声音默认定声，需要人物创作包和声音克隆包。首次生成先保存完整样本，随后所有台词、单句重做和失败续做均复用该样本；跨进程或重启不会重新设计。JSON 可设置 `voiceScopeId`（作品 ID）、`voiceId`（角色 ID）、`voiceRevision`（定声版本），命令行对应 `--voice-scope-id`、`--voice-id`、`--voice-revision`。没有指定身份时，相同人物／描述在本机默认共享样本。作品名称、文件名与台词不参与声音身份；描述或语言变化会产生新的样本。

```sh
shengyue generate --mode design --character meditation-female \
  --voice-scope-id story-01 --voice-id narrator --text-file /absolute/path/chapter-01.txt --batch
# 下一批、单句重做和失败续做保持同一身份与版本
shengyue generate --mode design --character meditation-female \
  --voice-scope-id story-01 --voice-id narrator --text "接下来，我们继续讲故事。"
# 明确换一个声音时更改版本
shengyue generate --mode design --character meditation-female \
  --voice-scope-id story-01 --voice-id narrator --voice-revision new-choice --text "这是新确定的声音。"
```

同一人物定声后继承样本的表达，后续逐句 `emotion`／`pace`／`instruction` 不会重新定声。需要改变定声表达时，使用新版本并指定所需表演参数。一稿多配的不同表达候选应使用不同 `voiceId`。结果的 `voiceAnchorId` 与 `synthesisMode: "clone"` 可核对样本复用；可选 `--voice-anchor-id` 校验指定样本，需同时保持原声音设置、身份与版本。重新定声时不要同时提交旧的 `voiceAnchorId`。缺少声音克隆包、定声样本缺失或损坏会报错，不会静默换声。

显式 `--free-voice` 或 JSON `lockVoice: false` 可恢复逐句自由设计，音色可能变化。轻量音色仅支持自然配音；标准音色和自由设计支持情绪与表演指令。声音克隆默认继承参考声音的表达。需单独调情绪时，先明确执行 `setup --package expressive` 安装可选 VoxCPM2 包，再在 `--mode clone` 中指定 `--reference-style expressive`（JSON 为 `referenceStyle: "expressive"`），即可使用 `--emotion`、`--intensity`、`--pace` 和 `--instruction`。生成命令从不自动下载；未安装会报缺少可选资源。`--reference-style original` 或省略该参数沿用原路径。参考台词默认使用导入时保存的文本，也可用 `--reference-text` 指定。

段内标记拼接功能已撤回。`text` 不再接受此前的 `<#0.5#>`、`[[emotion:happy]]文字[[/emotion]]` 和 `[[cue:laugh]]` 控制标记，遇到这些标记会在推理前报错。请使用普通文字及整句 `emotion` / `instruction`。旧文稿通过桌面打开时清理这些标记，并在本机数据库保留完整原稿备份；历史音频 `sourceText` 仅作为原稿记录，重做使用 `text`。

## 历史、ZIP 与版本状态

```sh
shengyue history
shengyue export --ids <id1>,<id2> --format wav --output /absolute/path/voices.zip
shengyue license status

```

ZIP 附带 manifest 和 SHA-256。`license status` 为兼容旧工作流保留，返回免费版状态和 `activationRequired: false`，无需读取设备标识或激活文件。缺失、过期格式或损坏的旧激活文件不会拦截免费版功能。

## 错误、并发与取消

失败时 stdout 仍为 JSON，进程以非零状态退出：

```json
{"ok":false,"command":"generate","error":{"code":"BUSY","message":"桌面端或其他 CLI 正在操作此数据目录，请稍后重试"}}
```

| 退出码 | 含义 | Agent 处理 |
| --- | --- | --- |
| 0 | 成功 | 解析 result |
| 1 | 后端、输入文件或导出错误 | 查看 error.code/message，必要时查看 studio.log |
| 2 | 参数或 CLI 请求格式错误 | 修正输入后重试 |
| 3 | BUSY，共享数据目录正忙 | 等待后有限次重试 |
| 4 | RUNTIME_NOT_READY | 需要显式 setup |
| 5 | LICENSE_REQUIRED | 保留的历史错误码；免费版不要求激活 |
| 124 | 超过 --timeout 秒数 | 查询 history 找回已完成条目 |
| 130 / 143 | SIGINT / SIGTERM 取消 | 查询 history 找回已完成条目 |

桌面与 CLI 通过数据目录任务锁防止同时生成、下载和修改记录。不要通过增加并行 Agent 来提高同一目录的推理吞吐。CLI 每次调用启动后端并在完成后退出，批量 `rows` 可以在一次调用中复用模型。取消会终止当前后端；原有音频和历史保留。正常退出自动释放锁，异常退出后的残留锁在确认所属进程已结束后恢复。Windows 建议使用 `--timeout` 取消；直接强杀应用与正常取消的行为不同。

本次已经验证 macOS 源码 CLI、真实本地推理与 Electron 无窗口入口；Windows 需在实机验证。

## 给 Agent 的项目指令

可以把下面的文字加入使用该工具的 Agent 项目说明或自定义指令；将入口替换为本机绝对路径：

> 需要本地语音时，调用 `node /absolute/path/local-voice-studio/cli/studio.cjs`。先执行 `describe` 获取协议、`status` 检查组件与模型、`catalog` 获取声音 ID。通过命令执行工具以参数数组调用，复杂台词用 JSON 文件或 stdin 传入 `generate --input`。只解析 stdout JSON；stderr 是进度。成功时从 `result.items[].paths.wav/mp3` 或 `exportPath` 读取文件。使用合理的 `--timeout`。遇到 BUSY 等待后重试；失败或取消后先查询 history，避免盲目重复整批任务。不要自行下载大模型、激活授权或导入参考人声，除非用户明确要求或已授权。CLI 不需要桌面窗口开启。

这依赖 Agent 的本地命令执行能力，不需要专用 MCP 服务或分别维护三个工具适配器。
