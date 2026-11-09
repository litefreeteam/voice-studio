## 2026-10-10 — Selected particle sound-wave reference

- User rejected the cloud toy and selected the attached full-hero image, preserved at design/selected-particle-wave.png. Replaced mascot geometry with 25,800 independent WebGL points across blue, lavender and white ribbons, a clear core, airy veil, sparse accents and a faint halo pass. No portrait or image texture is rendered.
- Kept the wide wave, restrained slow flow, original copy proportions and restored original audition caption. Wave shape gently breathes around its reference silhouette, rather than drifting into a different composition.
- Audition verified: MP3 playing at 0.213 seconds, RMS-driven level 0.523. Motion pause held frame 18 between observations; resume worked. Pointer interaction reached 0.634. Reduced-motion and offscreen/hidden-tab suspension retained.
- Visually inspected CSS widths 1707, 1280, 820 and 391. Horizontal fitting preserves faded wave ends; mobile art is capped at viewport width. No mobile horizontal overflow. Browser warning/error logs empty after final reload.
- Final build and all four Sites tests passed. Hosting integration files unchanged.
- Proof: design/particle-wave-final.jpg; responsive captures: design/particle-wave-tablet.jpg and design/particle-wave-mobile.jpg (before final subtle halo pass).

## 2026-10-10 — Talking female particle portrait

- Original fictional female particle portrait generated with built-in ImageGen. Asset: `public/assets/voice-muse.png`; full prompt: `design/voice-muse-prompt.md`.
- WebGL preserves fine image detail; local deformation animates lips/lower jaw from the actual audition RMS, with restrained breathing, blinking and pointer following. Amplitude-driven expression, not phoneme-accurate lip sync.
- Live 7.488-second MP3 verified: level 0.524 at 0.265 seconds, 0.146 at 4.704 seconds. Mouth visibly opens during speech and returns closed after pause.
- Motion pause held frame 1483 between observations, level 0.000; resume works. Pointer interaction reached 0.621. Existing reduced-motion and visibility lifecycle retained.
- Inspected desktop 1707px, tablet 820px, mobile 391px. No portrait/copy/control overlap. No desktop horizontal overflow. Browser warnings/errors empty.
- Build and all 4 Sites tests passed. Hosting integration files unchanged.
- Proof: `design/talking-portrait-final.jpg`, `design/talking-portrait-speaking.jpg`, `design/talking-portrait-tablet.jpg`, `design/talking-portrait-mobile.jpg`.

# 声悦配音宣传网站设计验收

final result: passed

## 本轮更新：首屏文字与粒子视觉的比例

本轮仅审看并调整首屏。原桌面标题为 80px，首行额外放大至 96px；说明文字 26px、主按钮 68px 高，左侧明显重于细小、轻柔的声音粒子。保留文案和五簇雾状声波，收小标题、说明和按钮，并对齐左右视觉中心。

1. **桌面首屏：比例已改善。** `design/hero-proportion-before.jpg` 与 `design/hero-proportion-after.jpg` 为同尺寸的本轮实测截图，均已打开对照。标题两行统一，最大 60px、字重 700；说明 19px、主按钮 54px 高。首屏高度由 650px 收到 600px，声波上移 44px，左右操作区域的下缘更接近。
2. **笔记本与平板：布局正常。** 实测 1280px 宽时标题为 52.48px，没有横向溢出；820px 平板截图为 `design/hero-proportion-tablet.jpg`，文字、声波和各自操作按钮没有重叠。
3. **手机首屏：布局正常。** `design/hero-proportion-mobile.jpg` 为 391px 宽实测截图，保持上下结构，没有横向溢出。

说明文字使用浅灰紫、标题强调色改为柔和淡紫，主按钮仍清晰可辨。英文装饰文字和粒子提示字号较小，仅作辅助信息；本轮仅核对视觉和布局，没有进行完整无障碍或全站流程审计。粒子运动、试听逻辑和其他页面内容未修改。浏览器 error/warn 日志为空。

## 历史更新：声音萤火粒子动画

用户明确确认替换右侧大幅无限环，希望改成粒子声音跳动或富有创意、温馨的动画。采用暖金、珊瑚粉、淡紫色的原生粒子云团，中央声带缓缓流动，周围萤火柔和闪烁；首屏就地试听“温宁”，粒子按照真实 MP3 的 RMS 波形及当前播放位置起伏。该轮是用户明确要求的程序粒子动画，无需以生成静态图片替代。

- **完整与局部对照：** `.qa/voice-bloom-comparison-final.jpg` 将上一轮首屏与本轮首屏放在同一画面比较，两侧同为 1440 × 889 内容、等比缩至 720 px；`.qa/voice-bloom-detail-final.jpg` 对照右侧主视觉。均已打开查看。整体字体、导航、左侧文案、CTA 和价值区域保持原有层次。
- **最终证据：** `.qa/voice-bloom-desktop-final.jpg` 为 1440 × 889；`.qa/voice-bloom-tablet-final.jpg` 为 768 × 950；`.qa/voice-bloom-mobile-final.jpg` 为 391 × 1060。浏览器视口仍为前述 CSS 尺寸，按实际 DOM 边界裁去 IAB 全页导出的空白，不拉伸画面。三种视口均无横向溢出。
- **色彩与构图：** 由紫色玻璃无限环改为蜂蜜色高光、珊瑚粉中间层、浅紫下缘的声音云团。粒子沿有层次的流线分布，中央声带端部逐渐散开，避免硬切边。正文与主 CTA 保持足够对比，暖色试听控件作为次级入口。
- **[P2，已修复] 初版粒子偏暗、散乱：** `.qa/voice-bloom-desktop-initial.jpg` 亮度不足，右侧显得空。调整粒子点尺寸、透明度、柔光衰减与流线分布，最终云团轮廓和声带清晰，保留黑色背景留白。
- **[P2，已修复] 小屏文案与粒子下缘重叠：** 初版平板和手机中，下方说明靠近云团下缘。将绘制区域与说明留出独立间距，并调整平板说明位置；最终手机、平板均已打开逐一检查，试听与暂停按钮位于页面范围内且不遮挡正文。
- **真实声音响应：** 桌面试听读取 `Serena.mp3`，播放时间 0.158 秒、粒子强度 0.538；手机播放时间 0.178 秒、粒子强度 0.541。`.qa/voice-bloom-response-final.jpg` 并排展示实际空闲与声音响应帧，已打开查看。读取现有音频的 RMS 与播放时钟，不改动原有音频链路。试听按钮可正常暂停，声音与动画的暂停操作独立。
- **暂停与离屏：** 键盘 Enter 暂停后帧数保持 2275，构建与工具检查期间未增加；再次 Enter 恢复。通过手机导航离开首屏后，canvas 底边为 -4218 px，连续两次检查帧数保持 6046。手机菜单能打开，导航后自动关闭。
- **性能与可访问性：** 22560 个原生 WebGL 粒子、30 FPS 上限、最高 1.5 倍像素密度，无额外三维框架。绘制画布桌面为 780 × 577，平板为 430 × 302，手机为 460 × 325。提供可聚焦的独立动效按钮与描述性标签；代码遵循系统减少动画偏好、后台暂停，并提供同源粒子的 Canvas 2D 静态降级。系统偏好、后台与 GPU 降级经代码检查，本轮未强制修改系统或 GPU 状态。
- **验证：** 最终 `npm run build` 成功，`npm run test:sites` 四项通过，浏览器 error/warn 日志为空。仅修改网站，未改变父项目应用或下载包。

本轮无待处理 P0/P1/P2。以下保留上一轮验收记录，用于追踪设计来源。

## 上一轮更新：品牌标识与动态光圈

用户要求左上标识更有成品感，并让右侧光圈动态运行。布局继续以前一版为基准；标识的新视觉目标是 `public/assets/brand-mark.webp`，由内置图像生成工具制作，提示词见 `design/brand-mark-prompt.txt`。

- **完整对照：** `.qa/brand-motion-comparison-final.jpg` 把改前与改后首屏放在同一画面比较；两侧为同一 1440 × 1000 CSS px 视口的首屏 1440 × 889 内容，等比缩至各 720 px。已打开查看。
- **局部对照：** `.qa/brand-comparison-final.jpg` 对照页头标识，检查轮廓、中文字号层次、英文副标与对齐；`.qa/motion-frames.jpg` 对照实际浏览器输出的两帧，确认高光位置和折射变化。不同帧光圈区域的 RGB 平均差约为 6/255，随后提高了流光可见度。
- **最终证据：** `.qa/brand-motion-final.jpg` 为桌面首屏 1440 × 889；`.qa/brand-motion-mobile-final.jpg` 为手机 391 × 1050 内容。截图仍按前述 IAB 导出边界去除空白，不改变实际内容比例。浏览器 DPR 为 0.75，WebGL 最终使用至少 1 倍画布像素，桌面 canvas 为 780 × 613，手机为 460 × 361。
- **[P2，已修复] 动画画布在缩放浏览器中偏软：** 初次按 DPR 0.75 建立 585 × 460 / 345 × 271 画布，截图中的玻璃纹理比原图柔软。改为最少 1 倍、最多 1.5 倍像素密度，重新加载底层渲染器后确认实际尺寸，并重拍最终截图。未仅凭 HMR 状态判断修复成功。
- **字体与排版：** “声悦”作为主字标，“配音”作为较小的产品类别，英文副标独立排布。保留原导航和主标题字号；手机标识未挤压菜单与下载按钮。
- **间距与布局：** 独立声带标记取消方形底板、描边与发光框。首屏与三项价值区域高度一致，暂停按钮位于视觉右下空白处；手机按钮 x=287.6–366.3，位于 391 px 页面范围内，无横向溢出。
- **色彩与图片：** 新标识保留紫色/浅紫色与真实透明通道；玻璃图仍是完整原始 raster 纹理，没有用代码重画无限环。流动高光仅作用于图像材质，文字对比度与其余配色未变。最终纹理清晰，没有矩形背景边界。
- **文案：** 保留既有产品能力及授权说明，仅新增“暂停动效 / 播放动效”操作。没有把技术实现细节作为营销卖点。
- **交互：** 实际渲染器为 WebGL，帧数持续增加；点击暂停后计数保持 6 不变，恢复后重新绘制。离开首屏后 canvas 底边为 -2838 px，帧数保持 21，回到首屏恢复。手机菜单开关正常，手机 WebGL 正常运行。
- **性能与降级：** 30 FPS 上限，离屏与后台暂停，支持手动暂停；系统减少动态效果通过 matchMedia 默认暂停，WebGL 不可用时保留原图和轻微呼吸。系统偏好及 WebGL 不可用场景经代码检查，本轮未修改系统偏好或强制关闭 GPU。
- **构建：** 最新 `npm run build` 成功，`npm run test:sites` 四项通过；浏览器 error/warn 日志为空。

本轮无待处理 P0/P1/P2。未改变父项目应用标识或发布安装包。以下为前一版网站验收记录，保留以追踪整体设计来源。

## 对照目标与证据

- 视觉目标：`design/selected-hybrid.png`，1015 × 1549 px。用户选择深色无限环与浅色创作者方向的融合。
- 实现地址：`http://127.0.0.1:4173/`，初始状态、精选试听、未播放音频、macOS 指令、计算器默认参数、弹窗关闭。
- 桌面：1440 × 1000 CSS px，完整页面 1440 × 6462；平板：768 × 1024，完整页面 768 × 6951；手机：391 × 844，完整页面 391 × 8093。
- 浏览器 DPR 为 0.75。IAB 全页导出带右侧和底部空白，原始文件分别为 1920 × 8616、1024 × 9267、520 × 10789。按实际 DOM 页面边界裁去空白，保留内容本身的 1:1 像素；比较时将桌面内容统一缩至目标宽度 1015 px。
- 完整实现：`.qa/desktop-final.jpg`、`.qa/tablet-final.jpg`、`.qa/mobile-final.jpg`。源图只覆盖前三个区域，因此完整设计对照使用实现的前 2318 CSS px。
- 同一画面并排对照：`.qa/comparison-final.jpg`。细节并排对照：`.qa/comparison-hero-final.jpg`、`.qa/comparison-voices-final.jpg`、`.qa/comparison-product-final.jpg`。已打开查看这些图片后判断。

## 发现与修复历史

1. **[P2，已修复] 主视觉矩形背景边缘。** 初版 `.qa/desktop-1440-initial.png` 的黑底 raster 与页面产生矩形边界。改用真实透明无限环 WebP，移除 screen 混合模式；最终首屏对照中边缘自然融入背景。
2. **[P2，已修复] 桌面字号和试听卡密度偏小。** `.qa/comparison-initial.jpg` 显示标题、按钮和人物图片小于目标。扩大标题至最高 80 px、首行 96 px，调整导航、按钮、卡片字号及图片高度，容器扩大至 1328 px；压缩试听区多余留白。最终对照恢复两行标题、三列试听及原有区域顺序与比例。
3. **[P2，已修复] 平板无限环裁切过多。** `.qa/tablet-upper.jpg` 中右环大半被裁去。768 px 断点改用 430 × 338 px 素材槽；`.qa/tablet-hero-final.jpg` 中完整主体可辨，未压住正文或操作按钮。
4. **[P2，已修复] CLI 与安装包能力不同。** 源码已有 CLI，但当前下载包早于该功能。检查 Mac ZIP 内的 ASAR 和 Windows ASAR，均没有 CLI 目录。Agent 区、FAQ、下载说明和公共文档明确要求源码版或包含 CLI 的新构建；不把旧安装包描述为已支持 CLI。

## 五项必检表面

- **字体与排版：** Manrope 用于拉丁字符，中文采用系统中文字体；主标题、正文、标签层次清晰。桌面保持原文两行标题，手机缩放后不截字。导航、音色标题与费用数字可读；小字和下载说明的灰紫色已加深。
- **间距与布局：** 深色首屏、三项价值、米白试听、淡紫工作台的顺序一致。试听图片与卡片比例接近目标。桌面三列，手机单列；三种视口均无页面横向溢出。手机场景栏可独立横向滚动。
- **色彩与状态：** 使用深黑 `#090912`、主紫 `#7050ed`、浅紫 `#b99bff`、米白 `#f7f6f2` 与淡紫 `#efecfa`。筛选、播放和终端标签有选中状态，键盘有可见焦点，弹窗背景与内容层次清楚。
- **图片与图标：** 使用真实产品 logo、21 张既有原创人物插画、真实桌面截图、生成的无限环 raster；图标为 Phosphor。图片无拉伸，透明图无可见硬边。波形来自实际 MP3 的 RMS 数据。没有 CSS/SVG 绘制的替代插画。
- **文案与内容：** 30 条免费成功生成、专业版不限次数、初次在线安装后离线使用、9 款音色/12 个人物/10 种语言均对应项目。价格使用用户输入，不编造售价、客户评价或 token 节省比例。试听时长采用真实资源数据。当前 Windows 构建的实机验收状态已说明。

## 可接受的差异

- 角色和工作台使用产品当前真实素材，因此与生成稿中的幻想人物、深色侧栏不同；保留相同卡片结构和位置。
- 无限环保留紫色玻璃、反射和发光方向，使用独立生成素材；未复制概念图中的手写装饰与内环音柱。
- “全部声音”调整为“精选试听”，以准确表示默认展示三个代表声音；增加多语言筛选、试听说明和实际控件。
- 产品区增加导入、角色分配、导出与真实截图预览入口。场景、Agent、费用估算、FAQ 和下载位于生成稿之外，依照同一视觉系统扩展。
- 未声称逐像素复制生成稿；以上差异服务于用户要求的产品价值表达与真实能力展示。

## 交互与构建验证

- 真实 MP3 播放成功；暂停、切换声音、切换筛选正确。进度条 Home / End / ArrowRight 实际改变 audio.currentTime；自动化 fill 对 range 不派发对应变化，使用真实键盘操作完成验证。
- 五类场景切换、五类声音筛选正常；手机菜单展开、导航后收起。
- macOS / Windows / 已注册 CLI 指令切换正常；复制 toast 与实际剪贴板文本一致。
- 工作台预览可打开、切换到声音库、关闭。
- 默认 5 万字/月、5 元/万字显示 300 元/年；改为 10 元/万字、授权 100 元显示 600 元/年、约 2 个月；增加字数至 6 万显示 720 元/年。验证后恢复初始状态。
- 下载弹窗可选择两平台，Mac 与 Windows 文件地址正确并返回 HTTP 200，长度分别为 170097269 与 139020945 bytes。手机弹窗宽 352.7 px、高 554.2 px，适配视口；Escape 关闭后焦点回到触发按钮。
- FAQ 可展开；主要控件语义标签、图片替代文字、可见焦点和减少动画样式已检查。
- 浏览器 error/warn 日志为空。没有破损图片。
- `npm run build` 成功；`npm run test:sites` 四项全部通过。未运行安装包，Windows 安装与推理未在本次任务验收。未部署网站。

## 实施清单与后续微调

- [x] 首屏融合、真实试听、产品展示与价值场景完成。
- [x] 主要交互、三种视口和构建验证完成。
- [x] 修复所有已发现的 P0/P1/P2 问题，重新截图并并排比较。
- [x] 本地预览持续运行，临时视口覆盖已恢复。
- [P3] 如需继续贴近概念稿，可在下一轮微调图标粗细和首屏装饰。上线前由产品发布流程更新包含 CLI 的安装包与真实授权报价；当前页面已准确说明现状。


## 强制激活版同步（2026-10-10）

- 按用户要求删除 30 条体验、下载体验版等文案，主入口改为下载安装；强调购买授权后激活、不限生成次数。保留购买前的真实网页声音样本试听。
- 下载弹窗指向 Shengyue-0.3.0-mac-arm64.dmg / Shengyue-0.3.0-windows-setup.exe，说明安装包包含 CLI。购买与售后只使用销售渠道流程说明，不编造价格、链接或客服信息。
- 产品截图更新为已激活的真实 Electron 工作台和声音库，侧栏显示专业版已激活。产品布局及原有首屏视觉保持既定设计。
- 本地浏览器验证桌面 1440px 和手机 390px：免费体验文案不存在，下载弹窗平台切换与路径正确，无 JavaScript 错误。截图在主项目 .test-data/activation/website-*.png。
- 0.3.0 下载包已复制到 public/downloads，删除网站中的旧体验版副本，原始旧包继续保存在主项目 release 中。网站构建与托管路由测试通过。


## v0.3.1 短激活码（2026-10-10）

下载链接和 CLI 文档更新到 v0.3.1；产品截图来自本轮原生激活测试。付费激活政策不变。桌面 / 手机文案、下载弹窗和 CLI 说明检查通过；页面无 JavaScript 异常。
