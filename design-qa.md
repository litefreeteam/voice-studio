# 2026-10-10：首页专业版卡片

final result: passed

本节为当前任务验收；下方激活页与录音区记录保留为历史记录，企微二维码待办仍独立保留。

## 目标、状态与证据

- 视觉目标：用户图 1，副本 `.test-data/pro-card/reference.png`，620 × 540；卡片内容裁切范围为 `(13, 20, 614, 528)`，601 × 508。
- 实现：现有工作台首页左下角的 `#account-shortcut`；已激活、空白文稿状态。复用现有项目，未新建页面。
- 页面证据：应用内浏览器 `.test-data/pro-card/final-full.jpg`，1493 × 986 像素；读取的 CSS 视口为 1493 × 987，devicePixelRatio 1.5。截图 API 输出接近 CSS 像素尺寸，未按 DPR 再缩放。
- 卡片 CSS 尺寸约 173.33 × 146.75；从完整截图按 CSS 坐标归一裁出 `.test-data/pro-card/final-card.png`，173 × 147 像素。避免截图 API 局部裁切时存在的缩放偏移。
- 实际显示尺寸并排对照：`.test-data/pro-card/comparison-native.png`。参考图下采样至 173 × 147，与实际卡片同尺寸。
- 放大细节对照：`.test-data/pro-card/comparison-final.png`。两侧内容均归一至 520 × 440；实际截图放大后存在 JPEG 与低分辨率捕获的模糊，不代表资产编码损失。
- 较小窗口：读取并确认 CSS 视口 1120 × 740、卡片约 147.33 × 124.74，卡片底部 y=694、含版本号区域底部 y=722，均完整可见；导航末尾 y=545，与卡片无重叠。证据为 `compact-full.jpg` 与 `compact-metrics.json`。

## 发现与五项保真核对

- 无待修复 P0/P1/P2。首轮对照未发现需要改动的布局问题，最终证据复核通过。皇冠和徽标使用用户拆分素材，形状与参考效果图有素材本身的细微差异。
- 字体：沿用项目系统中文字体。真实 HTML 标题约 11 px / 750，说明 8.5 px / 500，权益标题 8 px / 600，辅助文案 7.5 px / 400；按现有侧栏尺寸缩放，以最小字号约束避免窄栏进一步缩小。单行标题与三列权益均无裁切。
- 间距：按参考图的 600:508 比例实现，徽标位于左上、皇冠位于右上、三项权益位于下方；低于 820 px 高度时收紧侧栏空白，使最小桌面窗口内卡片与版本信息可见。
- 颜色：直接使用提供的浅色折光背景、金色皇冠和徽标、紫色权益图标；正文深色、说明灰紫。没有以 CSS 绘图或图标近似替代提供的素材。
- 图像：背景、皇冠、徽标及三枚图标均成功加载；六张本地 WebP 全部通过精确解码像素与透明度检查，0 错误、0 需复核文件。合计由原始四张素材 3,210,561 字节降至 1,624,496 字节（包含外围空白裁切），减少 49.40%。
- 文案：已激活显示“已激活 · 终身使用”，保留“解锁全部功能，你的创作不受限。”和六条权益文案；“永久可用”保留在原徽标素材内。授权状态仍由 `renderLicense()` 更新。

## 功能与验证

- `node --check ui/app.js`：通过。
- 浏览器点击整卡可进入设置与帮助；返回首页正常。
- 从设置与帮助导航按 Tab 可聚焦卡片，显示实线焦点框；Enter 可打开权益页面。卡片有可访问名称“查看专业版权益”，授权状态通过 `aria-describedby` 提供。
- 检查浏览器错误与警告日志：空。六张图像均已完成加载且具有非零自然尺寸。
- 验证使用原有本地预览桥接数据；未运行配音引擎、打包或测试完整授权流程，本次没有修改这些逻辑。临时视口已重置。
- 本地预览保留于 `http://127.0.0.1:4176/`。

## 实施清单

- [x] 使用用户提供的素材，裁切空白并无损压缩。
- [x] 替换专业版卡片，保留真实授权状态与账户导航。
- [x] 核对原始尺寸及放大对照、较小窗口、素材加载和键盘操作。

---

# 历史：激活页面视觉与交互核对

final result: blocked

激活页布局、动效与配色已通过核对；新增的“联系客服”企微弹窗与关闭交互已完成，实际二维码展示与扫码核对等待用户提供真实图片。

## 目标与证据

- 目标：用户提供的声悦激活页截图。原图保存于 `.test-data/activation/reference.png`，尺寸为 1620 × 971。
- 实现：实际 Electron 渲染页面，截图 `.test-data/activation/activation.png`，通过视口设定以 1620 × 971、截图比例 1 保存。比较内容区域，不仿制原生窗口按钮。
- 同图对照：`.test-data/activation/comparison.png`。
- 授权卡片细节对照：`.test-data/activation/comparison-card.png`。
- 品牌与粒子区域细节对照：`.test-data/activation/comparison-intro.png`。
- 成功状态：`.test-data/activation/activation-success.png`。
- 额外视口：1420 × 855、1120 × 740、390 × 844；截图以 `activation-{width}.png` 保存。

## 迭代记录

第一轮对照保存于 `.test-data/activation/comparison-initial.png`，发现并修复：

1. P2：原应用平面标识与参考图光泽标识存在明显差异。已直接提取用户提供的品牌素材，限定在激活页使用。
2. P2：声浪振幅过大、色彩偏重。已调整为更细、更浅的蓝紫白色粒子，降低振幅并校正中心位置。
3. P2：默认窗口高度下页面过高。已加入高度断点，收紧品牌、卡片和表单间距，确保最小桌面窗口内激活按钮可见。
4. P2：打开帮助后进入成功状态，帮助内容会撑高卡片并改变滚动位置。成功时收起帮助、恢复顶部，并隐藏残留的复制提示。

修复后重新捕获并打开完整对照与卡片细节对照，以上问题已解决，无剩余 P0/P1/P2。

## 五项保真核对

| 项目 | 结果 |
| --- | --- |
| 字体与层级 | 使用系统中文字体；保留黑色与蓝紫色双行标题、说明文字、表单标签及细小辅助文字的层级。 |
| 布局与间距 | 还原左右分栏、圆角授权卡片、设备码与复制按钮、三项链接及底部授权说明；窄屏改为纵向布局，无横向溢出。 |
| 颜色与状态 | 浅蓝紫背景、白色卡片、紫色渐变按钮及金色授权标识；加载、错误、复制完成、成功状态清晰可辨。 |
| 素材与图标 | 品牌素材来自参考图；图标使用 Phosphor 的原始矢量资产并附许可证；声浪使用真实粒子渲染，保留 WebGL 不可用时的 Canvas 静态降级。 |
| 文案与内容 | 主要文案按图实现；按用户最新要求移除激活页右上角版本号；离线说明明确为安装完成后可用，避免暗示声音包无需首次下载。 |

P3 可继续微调：背景右缘折光纹理较参考图简化，部分卡片边距存在数像素差异。粒子相位随时间变化，不要求静态逐点重合。

## 功能与可访问性

- `npm run test:activation`：通过。覆盖真实 Electron 授权、原生剪贴板反馈、帮助入口、无效/旧版/设备不匹配激活码、成功动效、工作台切换、重启、失效后重新激活。
- 同一测试覆盖动态帧推进、暂停、系统减少动态效果设置、隐藏后停止绘制、WebGL 上下文丢失后的静态降级，以及工作台初始化失败后的恢复与重试。
- `npm test`：通过。原有授权、后端、CLI 和工作台逻辑回归无失败。
- `npm run test:ui`：通过。原有下拉选择、声音弹窗、实际试听、草稿、历史管理及后台任务交互正常。
- 表单保留真实标签、必填约束、状态播报、键盘焦点与错误标识；成功状态期间表单设为 inert，避免重复操作。
- 动效遵循 `prefers-reduced-motion`；粒子可手动暂停，页面不可见时停止绘制，进入工作台后销毁渲染资源。

## 实现范围

激活页样式与动效分别放在 `ui/activation.css`、`ui/activation.js`、`ui/activation-wave.js`；沿用现有官网粒子渲染公式，并适配浅色、横向声浪布局。授权验证规则保持原逻辑。未创建发布安装包。

## 粒子配色修订

按用户后续“粒子的颜色与画面有点不搭配”的要求，以最新的配色修订覆盖原图中的粒子颜色，保留页面布局与声浪运动。

- 统一为柔紫 `#8175e7`、淡薰衣草紫 `#a79aee`、雾蓝紫 `#bab9ee` 和珍珠白 `#f7f4ff`，接近页面按钮、品牌与功能图标的色系。
- 使用预乘透明度混合，消除叠加发光带来的青粉杂色与过曝；压低外围散点和光晕，声浪中心保留柔白高光。
- WebGL 与 Canvas 静态降级从相同 CSS 配色变量取色。
- 已打开 `.test-data/activation/palette-comparison.png` 对照调整前后，并重新捕获完整页面和卡片细节；无新增 P0/P1/P2。
- `npm run test:activation` 再次通过，涵盖动态帧、暂停、减少动态效果、静态降级、成功过渡及激活失败恢复。日志：`.test-data/activation/palette-run.log`。
- 最新完整效果：`.test-data/activation/palette-after.png`。

## 联系客服企微弹窗

- 按用户最新要求保留“联系客服”入口，独立打开企业微信弹窗；购买与激活帮助继续使用原流程说明。
- 弹窗包含说明文案、真实二维码图片位置和扫码说明。用户尚未提供企微二维码，图片来源留空，不生成或使用示意二维码。
- 缺少图片或图片加载失败时，显示“暂时无法显示二维码，请通过原购买渠道联系。”；二维码与扫码说明在真实图片加载完成后显示。
- 原生弹窗支持关闭按钮、Escape、点击遮罩关闭，并在关闭后恢复入口焦点。
- `npm run test:activation` 已通过，新增弹窗开关、焦点恢复和购买帮助独立性检查。截图：`.test-data/activation/contact-pending-qr.png`。
- 待完成：接入用户提供的企微二维码，核对实际展示与扫码。

## 2026-10-10：直接录音弹窗局部修改

本轮只调整录音区与底部操作按钮；上方标题、引导说明、原话输入框和示例文案保持原实现。此前激活页二维码的待办仍独立保留，不属于本轮验收范围。

### 视觉证据

- 参考图：`.test-data/recording-ui/reference.png`，920 × 572 px。
- 最终完整截图：`.test-data/recording-ui/final-full.png`，917 × 1007 px；浏览器 CSS 视口 917 × 1007，报告 devicePixelRatio 为 1.5，截图 API 输出为 CSS 像素尺寸。
- 弹窗截图：`.test-data/recording-ui/final-dialog.png`，560 × 645 px。
- 局部截图：`.test-data/recording-ui/final-region.png`，503 × 311 px。
- 初轮并排对照：`.test-data/recording-ui/comparison.png`。
- 最终并排对照：`.test-data/recording-ui/comparison-final.png`。左侧为参考图，右侧为最终下半部分；按内容宽度归一化，裁剪终点不同带来少量纵向差异，以上方完整弹窗截图核对实际间距。
- 录音与试听状态：`.test-data/recording-ui/recording.png`、`.test-data/recording-ui/ready.png`。
- 实际核对 1120 × 740 CSS 视口：弹窗宽 560、高约 646，全部初始操作按钮完整可见；核对后已恢复默认窗口。
- 状态：初始未录制。补充检查录音中、30 秒自动停止、试听、手动停止、重录、保存和取消。

### 迭代与五项保真核对

- 初轮 P2：标题下方与底部按钮区的间距略大，保存按钮宽度略宽。已减少标题上间距，并将保存按钮横向 padding 从 20 px 调为 15 px；最终并排图为修复后的证据。
- 字体：沿用应用系统中文字体；录音主提示 19 px / 650，辅助说明 13 px，底部按钮 14 px。保留参考图的紫色主提示和灰紫色说明层级。
- 布局：居中麦克风、柔紫光环与两侧声波，下方提示，再到分隔线与右对齐按钮组。录制前隐藏计时，录制中及录制后显示计时。
- 颜色：采用参考图中的紫色主提示、浅紫灰说明、描边取消按钮、渐变保存按钮；禁用保存仍由真实 disabled 属性约束。
- 素材：从用户参考图中直接提取不含文字的麦克风和声波区域，保存为无损 WebP；没有将表单、文字或按钮截图作为界面。停止录音使用项目已有图标资产。录音动效遵守减少动态效果设置。
- 文案：初始提示为“点击开始录音”“录制 3–30 秒，30 秒时自动停止”；保留取消、保存并使用这个声音及各录音状态文案。
- 焦点与操作：麦克风和文字提示均可启动录音；录制满 3.2 秒后可停止；真实按钮保留键盘与可见焦点，状态通过 aria-live 播报。

### 验证

- `node --check ui/app.js`：通过。
- `node --test tests/recording.test.cjs`：5 项通过，覆盖 WAV、资源释放、取消、权限与短录音错误、保存校验。
- `npm run test:ui`：通过，现有下拉、声音弹窗、试听、草稿、历史、后台任务、场景模板均无回归。
- 应用内浏览器：使用合成音频输入运行真实 Recorder，验证开始、停止、自动停止、试听播放/暂停、重录与保存后选中声音。预览 API 与数据仅存在于被忽略的 `.test-data` 中，不接入用户数据。
- 预览初始化时的测试脚本 catalog 命名冲突已修复，修复后未出现新增控制台错误。
- 无剩余 P0/P1/P2。P3：系统字体与截图缩放带来少量字形、抗锯齿与纵向裁剪差异。

本轮 final result: passed

### 后续修改：默认文案与随机文案

- 按用户要求移除录音输入框上方“这段录音里说了什么？”，输入框保留无障碍名称“录音文案”。
- 每次打开弹窗自动填入一段可编辑文案；“用一段示例文案”改为“随机文案”。
- 内置 10 段不同的自然中文文案，每段 51–59 字；随机切换时排除当前内容，避免连续两次出现同一段。
- `node --check ui/app.js` 通过；核对文案数量及去重数量均为 10；应用内浏览器确认默认填入、标签移除、新按钮文字，连续 5 次点击均切换到不同于当前的文案。
- 最新截图：`.test-data/recording-ui/random-scripts-dialog.png`。

本轮 final result: passed

### 后续修改：录制时的呼吸光波

- 将此前整张图片的轻微透明度变化，改为麦克风按钮周围两层交替向外扩散的紫色光波，周期 2.4 秒、错开 1.2 秒；按钮同步轻微缩放并增强光晕。
- 光波不接收点击事件，按钮保留原有停止录音操作和焦点样式；仅 recording 状态播放，停止、整理、试听和关闭后停止。减少动态效果模式下保留静态光晕。
- 应用内浏览器使用合成音频检查：两个录制时点的按钮缩放分别为 1.05367、1.04788，光波缩放分别为 1.74563、1.60981，确认动画帧实际推进；录音结束进入 ready 后按钮与光波 animationName 均为 none，光波 opacity 为 0。
- 活跃录制截图：`.test-data/recording-ui/breathing-dialog.png`。
- `node --test tests/recording.test.cjs` 5 项通过，`node --check ui/app.js` 通过。

本轮 final result: passed

### 后续修改：实时音量反馈与安静状态

- 复用 Recorder 每 100 ms 采集的真实 RMS 音量，控制两侧声波高度、颜色以及光波幅度；无须更改音频录制与保存逻辑。
- 安静状态：两侧缩成浅色短点，麦克风以 3.6 秒周期轻缓呼吸；听到声音：切换为 1.6 秒周期的扩散光波，声波随音量变高，显示“听到你的声音了，请继续自然朗读。”。
- 使用不同的进入/退出音量阈值、300 ms 短暂停顿缓冲和音量平滑，减少说话间隙的闪动。停止、错误、取消和重新录制时清理视觉音量与缓冲状态。
- 录制前和录制后的参考图样式保留；录制中以柔边遮罩保留中央麦克风，替换两侧静态声波为音量驱动的可视化。遮罩光圈和声波不接收点击事件。
- 减少动态效果模式保留音量状态、声波高度及静态明暗差异，关闭循环呼吸与扩散动画。
- 应用内浏览器通过真实合成音频流依次检查正常音量、轻声、静音、再次出声和停止：声波峰值分别约 54 px、23.6 px、4 px；静音时无扩散光波，重新出声后恢复；停止后动画结束、音量归零。
- 对照截图：`.test-data/recording-ui/signal-quiet-and-speaking.png`，左侧安静、右侧有声。测试用音量切换入口仅存在于被忽略的本地预览脚本的专用查询参数下。
- `node --check ui/app.js`、5 项录音测试、`npm run test:ui` 全部通过。

本轮 final result: passed

### 后续修改：消除中央按钮的方形图片边缘

- 发现原中央图片使用横向渐变遮罩，纵向边缘仍形成矩形；改为与按钮同心、按圆形比例设置的径向柔边遮罩，初始图片也在外围渐隐。
- 收紧录制中遮罩外径，保留圆形麦克风与光晕，去掉静态声波的残留；有声扩散光波、安静呼吸、实时声波仍由原逻辑控制。
- 在应用内浏览器检查初始、安静录制、有声录制状态，安静与有声的声波高度仍分别为 4 px / 54 px。
- 优化前后对照：`.test-data/recording-ui/rounded-comparison.png`，左侧优化前、右侧优化后；有声状态：`.test-data/recording-ui/rounded-sound-region.png`。
- 本轮仅改两条图片遮罩样式，通过实际渲染核对，不重复运行与本次视觉改动无关的测试。

本轮 final result: passed

### 后续修改：增大朗读文字与明确操作提示

- 录音文案输入框字号由 13 px 调整为 16 px，行高改为 1.8，方便录制时阅读。
- 麦克风下方初始操作提示改为“点击开始录音，朗读上方文案”，同步静态页面和状态渲染文案。
- `node --check ui/app.js` 通过；应用内浏览器确认实际字号为 16 px、行高为 28.8 px，输入框内容完整显示，弹窗无溢出。
- 效果截图：`.test-data/recording-ui/larger-copy-dialog.png`。

本轮 final result: passed

### 创作首页与场景入口（2026-10-11）

- 激活后默认打开创作首页，展示全部 20 个场景；6 张插画主卡配合 14 个紧凑入口，支持用途分类、组合关键词搜索、空结果重置、离线试听和继续快捷稿。双人播客同时出现在视频播客和角色对白分类。
- 背景及六张场景图由内置 image_gen 分别生成，延续淡紫、奶油与柔和立体插画。WebP 成品在 `ui/assets/home/`，提示词在同目录 `prompts.json`，源图保留于 `docs/artwork-source/home/`，不随客户端打包。
- 开始场景创建独立项目，先保存当前项目，带入完整角色、语言、语速、语气与分段，不覆盖快捷稿，不自动推理。补充验证保存失败恢复和连点防重。
- 修复场景角色改名或改语气后丢失场景参数的问题；换声线时更新声音身份、语言与引擎，保留场景设置。
- 已检查 1360 / 1080 窗口图片、布局、导航和横向溢出；分类按钮保留键盘焦点。首次进入预览：`.test-data/home/home-new-1360.png`、`home-new-1080.png`；完整场景与已有稿件布局：`home-1360.png`、`home-1080.png`。
- 44 项 consumer 测试、首页浏览器测试、原有 UI 测试、真实 Electron 会话/项目/激活回归通过。首页测试覆盖全部 20 场景生成参数及真实角色表单编辑；项目回归的合成使用确定性测试 worker，未声称验证新预设的真实推理听感。

本轮 final result: passed

### 更多实用场景配图（2026-10-12）

- 内置 image_gen 分别生成 14 幅纸黏土水彩插画，覆盖全部更多实用场景。商业、学习、内容和故事使用暖杏、薄荷、淡紫与柔粉配色；每个场景使用独立物件组合。
- 更多场景改为上图下文卡片；图片和创作按钮进入同一场景，图片按钮保留键盘标签、焦点和重复点击保护，非首屏图片延迟加载。
- 运行时图片为 14 张 640 × 427 WebP，总计 283,388 字节。源 PNG 和完整提示词保存在 `docs/artwork-source/home/more-scenes/`，运行时来源记录为 `ui/assets/home/more-scenes-prompts.json`。
- `npm run test:home` 通过，确认首页共 20 幅独立场景图加 1 张横幅，全部图片正常解码，图片点击创建场景、分类搜索、草稿保护及 1360 / 1080 布局均通过。JavaScript 语法检查通过。
- 已检查 14 张图片总览及两种窗口宽度截图。独立场景预览隐藏固定标题栏和状态栏，避免长截图中的覆盖条：`.test-data/home/more-scenes-1360.png`、`more-scenes-1080.png`；图片总览：`more-scenes-artwork.jpg`。
- 按后续要求缩小更多场景卡片：1360 窗口每行 5 张，1080 窗口每行 4 张；图片比例改为 16:9，内容内边距改为 10 × 11 px，标题改为 12 px，卡片间距缩至 9 px。主场景卡片保持原尺寸。重新运行首页测试通过，并检查两种窗口下的图片主体、文字和按钮均完整显示。

本轮 final result: passed

---

## 2026-10-12 设置与帮助合并

**Final result: passed**

- Source visual truth: `.test-data/settings-preview/reference.png` (user-provided reference, copied from `/var/folders/ny/tq8f5cjx23q8pwc2r80hx3z40000gn/T/codex-clipboard-9e6c3509-e004-4936-9382-ba24af921e93.png`).
- Implementation: `http://127.0.0.1:4191/`, real UI HTML/CSS/JS with a disposable browser bridge fixture. Hardware, license and download responses in this preview are test data; production IPC and download services are unchanged.
- Final screenshot: `.test-data/settings-preview/settings-final.png`; content-only comparison: `.test-data/settings-preview/final-normalized.png`.
- Source: 1312 × 1072 px. Implementation CSS viewport: 1519 × 1115 px. In-app browser reports devicePixelRatio 0.75; its screenshot API returned a 2024 × 1485 canvas with the CSS-sized app in the upper-left. Cropped the actual app rectangle to 1519 × 1115, then removed existing app sidebar/titlebar at x=206/y=42 to compare 1312 × 1072. No scaling was applied to either comparison image. Existing persistent app footer is retained.
- State: activated; standard/light/character installed; reference resource collapsed; FAQ collapsed; no download active.
- Full-view comparison, source on left: `.test-data/settings-preview/comparison-final.jpg`.
- Focused comparisons, source on left: `.test-data/settings-preview/comparison-resources.jpg`, `comparison-account.jpg`, `comparison-hero.jpg`.

**Findings and comparison history**

1. Initial comparison (`comparison-baseline.jpg`): [P2] headline, resource text and form typography too small; header 27 px shorter than source, reducing the page's vertical rhythm. Increased desktop header to 215 px, headline to 42 px, section headings to 22 px, and resource card height to 166 px; adjusted margins, padding and form control heights.
2. Revised comparison (`comparison-revised.jpg`): [P2] first resource description wrapped and made its card taller. Set compact desktop resource description to 13 px without wrapping. Final four card heights all measured 166 px. Increased and repositioned the supplied-style generated laptop artwork to match the reference header composition. Post-fix evidence: `comparison-final.jpg`, `comparison-resources.jpg`.
3. Narrow viewport (`settings-narrow.png`, 1080 × 740 CSS): [P2] flex layout squeezed the device description into a narrow column even though the page had no horizontal overflow. Switched the device card to a two-column grid at ≤1180 px, with metrics in the following row. Post-fix description width: 393.5 px; device card height: 144.5 px; document has no horizontal overflow. Evidence: `settings-narrow-fixed.png`, `narrow-fixed-full.png`.
4. Final comparison: no remaining actionable P0/P1/P2 findings.

**Required fidelity surfaces**

- Fonts/typography: existing system Chinese font stack retained; bold display headline, 22 px section headings, 20 px resource titles, subdued secondary labels. Compact descriptions stay on one line at the reference desktop width. Device description wraps naturally in the narrow layout.
- Spacing/layout rhythm: two overview cards at 2:1, four resource cards, bottom authorization/FAQ at 1.18:1; 14–15 px section gaps, 18 px outer radii and 15 px resource radii. At 1080 px resource cards form two columns; metrics move below device copy. No horizontal overflow at either checked width.
- Colors/tokens: pale lavender page, translucent white cards, subtle lavender borders, violet primary controls and links, green installed/activated badges, warm gold lifetime symbol. Small differences in illustration shading and font rasterization remain P3.
- Image quality/asset fidelity: real generated transparent raster artwork in `ui/assets/settings/hero.png` and `device.png`; all page images loaded with nonzero intrinsic size. Existing project icon library reused; ellipsis and layout-grid added from the same Lucide library. No CSS drawings or inline SVG substitutes for the illustrations.
- Copy/content: user reference headings, device summary, resource descriptions, licensing labels, all five FAQ questions and footer retained/adapted. AI batch is an existing built-in capability, so it shows “已内置 · 按需准备声音” and a working “使用” button instead of claiming a fictional 1.1 GB download. Original “我的专属声音” package remains under “更多声音资源”. “更换设备” opens existing purchase-channel instructions rather than implying automatic license transfer.

**Interaction and regression verification**

- Sidebar has one “设置与帮助” menu entry; all former `navigate('downloads')` callers route there, with correct active navigation.
- Missing reference package automatically expands “更多声音资源”; covered by a new consumer regression test.
- Browser: expand/collapse extra resources; begin/pause/resume fixture download; progress remains after editor/settings navigation; installed resource menu opens and its “挑选声音” action navigates correctly.
- Browser: more-help and device-change FAQ expand; invalid activation displays an error; valid fixture activation clears the input and displays success; device copy displays confirmation; batch CTA opens the editor with batch checkbox enabled.
- Browser: with no installed packages, “先准备声音” opens the merged settings page and shows real package install controls, without losing editor text.
- Browser logs: no warning/error entries in checked sessions. No broken settings images.
- `node --check ui/app.js` passed. `node --test tests/consumer.test.cjs tests/downloads.test.cjs`: 19 passed, 0 failed. This includes two new navigation tests and existing download/source/service tests. Existing Electron download-progress script selectors updated to the merged menu; that full desktop script was not rerun in this request.

**Implementation checklist**

- [x] Merge sidebar menus and page contents.
- [x] Match reference layout, art, resource cards and authorization/FAQ sections.
- [x] Preserve real downloads and resource requirements.
- [x] Verify navigation, fixture UI interactions, primary states and responsive layout.
- [x] Compare final full-view and focused screenshots.

**Follow-up polish**

- P3: generated laptop perspective and gold icon shading differ slightly from the supplied raster mockup; Chinese font rendering depends on the host OS.

final result: passed

---

## 2026-10-12 功能与资源仅保留下载和更新

**Final result: passed**

- Latest source of truth: user's correction that this section only downloads/updates resources, and all update effects stay on the resource card. This supersedes the earlier resource-menu, batch shortcut and expanded-resource decisions above. The supplied screenshot remains the layout reference for the rest of Settings & Help.
- Removed the installed-card dropdown and “挑选声音” action, the “AI 批量配音 / 使用” shortcut, and the separate “更多声音资源” expansion. All four real packages now appear directly in the same grid.
- Installed cards expose “检查更新” directly. Checking uses a spinning refresh icon, violet border and an indeterminate bottom-edge progress bar. Download/update percentage and transferred bytes replace existing card text. Pause/resume/retry remain on the same card; completion shows a green check, “已是最新” and green bottom-edge bar. No additional visible panel is inserted.
- Verification uses the actual UI at `http://127.0.0.1:4191/` with the existing disposable hardware/license/download bridge. Browser download responses are fixture data; production services are unchanged.
- Desktop screenshot evidence: `.test-data/settings-preview/resources-final-checking.png`, `resources-final.png`; resource-focused checking evidence: `resources-final-checking-cards.png`. Full raw browser captures have the `-full.png` suffix. Same screenshot-canvas crop method as the preceding QA section; no resizing.
- Browser verified initial install, checking an installed package, transfer progress, pause, resume, returning from the editor during a download, and update completion. Four cards remained 166 px tall at 1519 × 1115 CSS during initial/checking/completion states. Final DOM has zero resource dropdowns, extra-resource sections or feature shortcuts.
- Responsive checks: at 1264 × 960 CSS, four cards were 166 px tall with 207 px footer content fitting within 207 px; at 1080 × 740 CSS, cards formed two columns and stayed 150 px tall during download. All checked document widths had no horizontal overflow. Evidence: `resources-compact-full.png`, `resources-narrow-resumed-viewport.png`; full-page narrow captures are also saved, but fixed app chrome appears at its scrolled position in those full-page browser captures.
- Final fonts, colors, spacing and artwork remain consistent with the preceding reference comparison. Checked the resource section in checking/completed states and the narrow download layout; no actionable P0/P1/P2 findings remain.
- Browser warning/error logs: empty. `node --check ui/app.js` passed. `node --test tests/consumer.test.cjs tests/downloads.test.cjs`: 20 passed, 0 failed, including direct resource actions and checking/transfer/pause/failure/completion feedback. Failure/retry feedback was verified in the VM regression test. The desktop download-progress script now also asserts unchanged card height; that full Electron script was not rerun.

final result: passed
