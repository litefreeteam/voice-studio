import { englishHome, englishDownload, englishGuidePages } from "./site-content.en.mjs";
import { guides } from "./guide-links.mjs";

export const origin = "https://voice.freeteam.top";
export const updated = "2026-11-09";
export const home = {
  path: "/",
  title: "声悦配音官网｜本地 AI 配音软件、批量课程配音与文字转语音",
  description: "声悦配音是 Mac / Windows 本地 AI 配音软件，提供 42 个声音与 20 套场景模板，支持批量课程配音、多角色脚本、DOCX/PPTX 导入及 WAV/MP3/SRT 导出。首次资源准备完成后可离线使用，本版本免费使用，无需激活。",
};

const articles = [
  {
    title: "AI 批量课程配音教程：文稿导入、讲师定声与字幕导出｜声悦配音",
    heading: "AI 批量课程配音：从文稿到分章节成品",
    description: "用声悦配音制作网课、企业培训和操作教程旁白：导入 DOCX/PPTX 文稿、按章节整理、复用讲师声音、逐段重做，导出 WAV、MP3 与 SRT。了解实际文本限制和字幕边界。",
    intro: "课程会反复改稿，配音也需要能跟着修改。声悦配音将课程文稿、讲师声音和每段音频放在本地项目中管理，适合网课、企业培训与操作教程。先试听并确定一段讲师样本，再分段生成；修改其中一段时，可以保留其他已经满意的音频。",
    sections: [
      { id: "prepare", heading: "1. 安装并确认电脑适合配音", paragraphs: ["本版本免费使用，无需购买、设备码或激活。安装后先检查电脑配置，选择模型并下载运行组件；完成后即可离线创作。"] },
      { id: "import", heading: "2. 导入讲义，保留清楚的章节与段落", paragraphs: ["在桌面端新建配音项目，导入 TXT、CSV、TSV、DOCX 或 PPTX。DOCX 提取正文与表格；PPTX 按页优先读取备注，页面没有备注时再读取页面文字。图片中的文字不会被识别，也不支持 PDF 导入。", "建议把公式、缩写和编号改为希望读出的表达，并为每一章设置清楚的标题。例如，课件上写的“长 × 宽”，可以在讲师文稿中改成“长乘以宽”。导入之后先核对顺序、读法和缺漏，再生成音频。"] },
      { id: "voice", heading: "3. 先确定讲师声音，再处理整门课程", paragraphs: ["可先听沐言等课程声音示例，选择适合课程节奏的声线。42 个声音选择包含 9 款固定音色和 33 个人物声音设计预设，人物预设需要对应资源。人物声音默认先确定样本，再复用到后续台词；重新定声或自由设计可能改变声线。网页示例与实际生成结果不保证完全相同。", "也可以导入有权使用的 3–30 秒清晰人声并准确填写录音原话，建立参考声音。定声和参考声音在当前安装包中继承样本表达；标准日常音色支持逐句语气，轻量音色仅支持自然配音。建议先生成一小段实际课程文稿，确认术语、停顿和语速后再继续。"] },
      { id: "batch", heading: "4. 分段生成，只重做改动的内容", paragraphs: ["配音项目支持最多 1 万条台词、50 万字，可按章节和角色组织，并将长台词自动拆成短段依次处理。这是项目保存与组织的上限，不代表一次同时推理全部文稿。生成速度取决于电脑和所选模式。", "快速配音与 CLI 单批最多 5000 字、100 段；CLI 每段最多 600 字，需要自行拆段。长课程建议分章节生成，逐段听取结果，对改稿、读音或表达不满意的段落单独重做，比较历史版本后保留合适的那一版。"] },
      { id: "export", heading: "5. 编辑声音，导出音频与字幕", paragraphs: ["桌面项目可以裁剪波形、调整音量和淡入淡出，原始音频仍保留。需要背景音乐时，可导入本地音乐、设置循环与说话时压低音乐，并先试听成品前 30 秒，再导出合并 WAV、MP3、SRT 和 ZIP。请同时确认音乐的使用权。", "单次成品导出最多 5000 个音频段、6 小时，较长课程应按章节导出。SRT 按生成片段的时长排布，不是逐字识别，也不会自动与课件动画或现有视频对齐。把音频和字幕放入视频编辑软件后，仍需核对画面、翻页和字幕时间。"] },
      { id: "check", heading: "课程交付前的检查", list: ["抽听专有名词、数字、公式、外语和段落交界。", "确认同一讲师使用相同的定声样本，单句重做没有意外换声。", "逐章检查音量与背景音乐，避免音乐盖过讲解。", "在最终课件或视频中核对字幕、画面与停顿，再交付成品。"] },
    ],
  },
  {
    title: "本地离线文字转语音指南：Mac/Windows 配置与资源准备｜声悦配音",
    heading: "本地离线配音：电脑要求与首次准备",
    description: "声悦配音离线文字转语音使用指南：macOS 14+、Windows x64、8/16 GB 内存、声音包磁盘要求、首次配置检查与模型下载，帮助你开始免费离线创作。",
    intro: "本地文字转语音由自己的电脑完成生成。声悦配音首次需要联网准备运行组件与声音包；资源完整后，文稿生成与声音克隆可以离线完成。本版本免费使用，首次启动先检查系统、内存和磁盘，再选择并下载模型。",
    sections: [
      { id: "systems", heading: "选择与电脑匹配的安装包", table: { headers: ["平台", "系统要求", "当前推理方式"], rows: [["Apple 芯片 Mac", "macOS 14+，M 系列芯片", "通过本机检测选择可用模式"], ["Intel Mac", "macOS 14+，Intel x64", "CPU；完整功能仍需 Intel 实机验收"], ["Windows", "Windows 10 2004 / 19041 及以上，推荐 Windows 11，x64", "CPU；安装与推理仍待 Windows 实机验收"]] }, paragraphs: ["当前不提供 Linux 或 Windows ARM 安装包。Intel Mac 与 Windows 安装包不包含 CUDA 加速。Mac 安装包未经 Apple 公证，首次打开可能需要在系统设置的“隐私与安全性”中确认。请使用与芯片架构对应的安装包。"] },
      { id: "resources", heading: "内存与磁盘要预留多少？", paragraphs: ["轻量配音最低需要 8 GB 内存；标准配音、人物创作和声音克隆至少需要 16 GB，并须通过本机检测。其他正在运行的软件也会占用内存，最低配置不等于任何任务都能稳定或快速完成。", "首次准备标准功能，Apple 芯片 Mac 建议预留至少 13 GB，Intel Mac 与 Windows 等 CPU 平台建议预留至少 17 GB。准备全部四个基础资源包约需预留 25 GB / 41 GB。实际空间还取决于已有下载、临时文件和作品数量，以软件配置检测显示的结果为准。", "参考录音的本地辅助转写资源约 486 MB，可按需要另行准备。转写用于辅助填写原话，结果仍需人工核对；配音并不要求所有人都安装这一项资源。"] },
      { id: "setup", heading: "首次使用的建议顺序", steps: ["下载与系统和芯片匹配的免费版安装包，安装并启动。", "首次启动自动检查系统、内存、磁盘和资源状态。", "选择模型和保存位置；8 GB 内存可选轻量配音，标准配音至少需 16 GB。", "联网下载运行组件与模型，支持暂停与继续；其他功能可在设置中按需补齐。", "用一小段实际文稿测试，再开始长项目。准备完成后可以离线创作。"] },
      { id: "offline", heading: "离线可以做什么，哪些步骤仍需要联网？", paragraphs: ["本机已安装完整的运行组件与所需资源后，配音、人物定声和声音克隆均在本机处理，无需激活。声悦自身不会上传台词、参考录音和作品。新增声音包、修复缺失组件或获取更新时，则需要联网完成相应下载。", "如果你通过外部 AI 智能体写稿或调用 CLI，智能体自身如何处理文本、是否连接云端，取决于它的设置与工作流。本地配音不会自动使外部写作或推理服务变成离线服务。"] },
      { id: "license", heading: "免费使用与功能边界", paragraphs: ["本版本的配音、项目和 CLI 均免费，无需购买或设备激活，不按生成次数扣额度。文本长度、每批段数、导出时长和设备性能仍有上限。", "换电脑后安装免费版并下载所需模型即可。安装、下载或使用问题，可通过官网“联系我们”扫码咨询。"] },
    ],
  },
  {
    title: "AI 配音 CLI 接入教程：智能体调用与 JSON 批量脚本｜声悦配音",
    heading: "用 CLI 把本地 AI 配音接入智能体工作流",
    description: "声悦配音 CLI 教程：安装包自带命令入口，支持 Codex、Claude Code 等本地智能体通过 JSON 脚本批量生成音频。说明配置检查、输入限制、JSON 输出、定声复用与离线边界。",
    intro: "具备本地命令执行能力的智能体可以调用声悦配音 CLI：智能体准备脚本，本机模型生成声音，最后返回音频文件路径。适用于课程、旁白和多角色台词工作流。安装包已包含 CLI，无需另装 Node.js，也不必先打开桌面窗口。",
    sections: [
      { id: "entry", heading: "1. 找到入口，读取当前协议", paragraphs: ["macOS 直接调用应用内部可执行文件；Windows PowerShell 使用实际安装路径。桌面安装不会自动注册 shengyue 命令。下面两组分别适用于 macOS 和 Windows。"], code: '"/Applications/声悦.app/Contents/MacOS/声悦" --cli describe\n"/Applications/声悦.app/Contents/MacOS/声悦" --cli status\n\n# Windows PowerShell：替换为实际安装路径\n& "C:\\实际安装目录\\声悦.exe" --cli describe | Out-String\n& "C:\\实际安装目录\\声悦.exe" --cli status | Out-String' },
      { id: "activation", heading: "2. 检查配置，再准备所需资源", paragraphs: ["CLI 免费使用。通过 preflight 检查配置与环境，通过 status 查看资源状态，使用 catalog 获取声音 ID，无需设备码。", "资源缺失时，说明下载内容并获得用户同意后显式执行 setup。生成命令不会自动下载模型。完整命令与错误处理见下方 CLI 文档。"] },
      { id: "script", heading: "3. 用 JSON 表达多角色脚本", paragraphs: ["使用 catalog 获取本机可用的声音 ID。将以下内容保存为 UTF-8 的 script.json；顶层设置默认值，每行可以指定自己的声音与文件名。"], code: JSON.stringify({ engine: "standard", language: "Chinese", sampleRate: 48000, project: "课程开场", rows: [{ text: "先观察图形的长和宽，再列出面积算式。", speaker: "Vivian", emotion: "natural", filename: "lesson-01" }, { text: "接下来，请完成这道练习。", speaker: "Uncle_Fu", emotion: "natural", filename: "lesson-02" }] }, null, 2) },
      { id: "generate", heading: "4. 调用生成，解析本地文件路径", code: '"/Applications/声悦.app/Contents/MacOS/声悦" --cli generate --input script.json --output-dir ./audio', paragraphs: ["普通生成成功时，stdout 返回一行带 ok / result 的 JSON，从 result.items[].paths.wav 或 paths.mp3 获取本地文件路径；stderr 为进度信息。describe 和 version 使用独立 JSON，help 为纯文本，不能都当成同一种返回格式处理。", "单批最多 5000 字、100 条，每条最多 600 字；输入文件或 stdin 最多 2 MB。CLI 不会自动拆分长台词，也不会解析 DOCX、PPTX 或 PDF。Office 文稿可先从桌面配音项目导入，CLI 请求则要转换成规定的 JSON 或纯文本格式。"] },
      { id: "consistency", heading: "5. 长任务保持声音一致，逐批处理", paragraphs: ["人物声音默认先确定样本，再复用于台词。跨批次与单句重做时，保持 voiceScopeId、voiceId、voiceRevision 以及声音设置一致；需要换声时再使用新的 voiceRevision。当前安装包中，定声和参考声音沿用样本表达，逐句情绪指令不会重新定声。", "同一数据目录由桌面端与 CLI 共用锁，不应并行启动多个生成、下载或修改操作。收到 BUSY 时等待并有限次重试；任务超时或取消后先查询历史，避免把已经完成的片段全部重复生成。"] },
      { id: "boundaries", heading: "导出、隐私与智能体费用", paragraphs: ["CLI 普通 ZIP 只打包分段音频，不会自动进行项目混音、合并音频或生成字幕。历史版本选择、波形编辑、背景音乐与合并 WAV / MP3 / SRT 从桌面项目管理。", "准备好资源后，声悦的生成在本机完成。外部智能体的写作、推理、联网和文本处理仍由其设置决定，服务费用按其规则计算。当前通过本地 CLI 接入，没有专用 MCP 服务，也不承诺固定的 token 节省比例。"] },
    ],
    links: [{ href: "/docs/agent-cli.md", label: "下载完整 CLI 文档（Markdown）" }, { href: "/docs/example-script.json", label: "下载可编辑的 JSON 脚本示例" }],
  },
];

export const guidePages = guides.map((guide, index) => ({ ...guide, ...articles[index] }));
export const downloadPage = {
  path: "/download/",
  title: "声悦配音下载｜Mac Apple 芯片、Intel 与 Windows x64 安装包",
  heading: "下载声悦配音桌面版",
  description: "下载声悦配音 Mac Apple 芯片、Intel Mac 与 Windows x64 安装包，查看系统要求和 SHA-256 校验值。本版本免费使用，安装后先检查配置并下载模型，无需激活。",
};
export const chinesePages = [home, downloadPage, ...guidePages].map(page => ({ ...page, locale: "zh-CN", sourcePath: page.path }));
export const englishPages = [englishHome, englishDownload, ...englishGuidePages].map(page => ({ ...page, locale: "en", sourcePath: page.path.replace(/^\/en/, "") || "/" }));
export const pages = [...chinesePages, ...englishPages];
