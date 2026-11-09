# 声悦配音宣传网站

## 当前免费版（2026-11-09）

官网已切换免费版说明，移除购买导航、PayPal 表单和价格计算器。桌面、Python 引擎和 CLI 不要求激活；安装后先检查配置、下载模型，再离线创作。中英文首页、下载页和三篇指南保持同步。历史支付服务和旧订单保留，网站不再展示下单入口。当前客户安装包由 `src/release.json` 的版本与真实校验值控制。下文收费流程为历史实现说明。

独立 React / Vite 网站。融合深色声音粒子首屏、浅色角色试听和淡紫色产品展示，使用产品的真实人物素材、42 段预存音频与真实界面截图。

## 本地开发

使用 Node.js 22.12+，推荐与主项目一致的 26.9.0。

```sh
npm ci
npm run prepare:downloads
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

`prepare:downloads` 按 `src/release.json` 验证 SHA-256，从上一级项目的 `release/` 复制 Apple 芯片 Mac、Intel Mac DMG 与 Windows 安装包到 `public/downloads/`，并生成客户版校验清单。安装包不提交到 Git；缺少它们时，下载入口不可交付。只允许客户安装包进入公开目录。

```sh
npm run build
npm run test:sites
npm run test:seo
```

构建结果在 `dist/client/`，同时保留 Sites worker 与托管配置。正式部署见下文。

## SEO 与静态内容

`npm run build` 先构建浏览器资源，再用同一套 React 组件预渲染中英文首页、下载页和三篇指南，共 10 页。首页使用 hydration 恢复交互；指南和下载页无需 JavaScript。开发服务器只用于首页交互开发，完整静态页面请先构建，再运行 `npm run preview`。

`src/site-content.mjs` 管理规范域名、各页标题、摘要和指南正文；`src/guide-links.mjs` 管理首页和页脚入口。更新已发布能力时以 `src/release.json` 与真实安装包为准，实际修改内容后再更新内容日期。构建自动生成每页 canonical、Open Graph / Twitter 分享信息、JSON-LD、`robots.txt`、`sitemap.xml` 和无索引的 404 页面。安装包校验值仍来自审核后的发布元数据。

结构化数据包含品牌、网站、软件、文章与面包屑。没有添加缺乏真实依据的售价、评价或评分；因此不声称具备 Google 软件富媒体结果资格。原有 FAQ 作为可阅读的正文保留。分享图与当前品牌图标在 `public/assets/`，可选脚本 `scripts/generate-brand-assets.py` 可用 Pillow 和中文字体重新生成。

生产 Nginx 统一 HTTPS 与主域名，显式 `index.html` 301 到目录网址，不存在的页面返回真实 404；HTML 重新验证缓存，带内容哈希的脚本、样式和字体长期缓存，文本启用 gzip。安装包、原始文档与健康检查通过 `X-Robots-Tag: noindex` 避免作为搜索落地页，但不在 robots 中阻止抓取，也不影响下载和 Range 请求。不要禁止爬虫读取 CSS、JavaScript 或正文图片。

部署前 `test:seo` 会检查无需执行 JS 的正文、唯一标题与 canonical、JSON-LD、内链/锚点/素材、站点地图和下载哈希。Google Search Console 已完成 HTML 标记所有权验证，提交的 sitemap 已成功处理并发现 5 页；百度站点也已通过 HTML 标记验证。百度手动提交的人工校验已结束、表单已清空，但未保留最终成功回执；其 sitemap 配额为 0，官方推送 API 当前返回 HTTP 400 / `site init fail`，尚未确认百度接收。提交和发现网址不代表已收录。网站访问统计使用下述真实 GA4 资源，与搜索站长验证相互独立。

## Google Analytics 4（2026-10-22）

官网使用已登录 Google Analytics 账号创建的「声悦官网 · Shengyue Voice」资源（`560083542`），报告时区为中国时间，币种为美元；Web 数据流 ID 为 `16178106504`，衡量 ID 为 `G-N81S6342EF`。[打开实时报告](https://analytics.google.com/analytics/web/#/a103022441p560083542/realtime/overview)。公开配置在 `analytics.json`，所有中英文首页、下载页和指南在预渲染时共用一个统计脚本。仅 `voice.freeteam.top` 启用，localhost 开发和预览不向 Google 上报。

除页面浏览、来源与 UTM 宣传渠道外，记录 `audio_preview`（实际开始试听）、`download_options`（打开安装包选择）、`file_download`（点击六种客户安装包）、`purchase_click`（点击购买入口）、`order_created`（网站订单已保存）和 `begin_checkout`（提交前往 PayPal 付款）。下载点击不代表下载完成，前往付款或保存订单不代表已付款；不发送未经付款核验的 `purchase` 收入事件。

只允许固定事件及声音标识、公开安装包文件名等参数。不读取表单内容，不上传订单邮箱、设备码、订单号或授权信息；页面网址只保留格式受限的五项 UTM 参数，移除其他查询参数和片段，来源网址只保留来源域名。关闭 Google Signals、广告个性化和广告存储。GA4 数据流的增强型衡量应关闭，避免自动表单采集及重复下载事件。Google 脚本被网络或浏览器拦截时，网站试听、下载和下单仍正常工作。

构建后运行 `npm run test:analytics` 验证十页覆盖、六种安装包、去重、预览禁用及敏感字段排除；正式部署脚本也会运行此检查。GA4 的实时报告用于核对到达数据，常规报告需等待处理。推广链接可使用 `?utm_source=x&utm_medium=social&utm_campaign=shengyue_launch`，后续通过来源和事件分析推广效果。

首次发布为 ECS 版本 `20261022T014228Z`。2026-10-22 已核对线上十页统计标签与脚本、网站健康状态，并在真实 Chrome 中观察到 Google 对 `page_view` 和 `audio_preview` 返回 HTTP 204；GA4 实时报告随后显示 1 位测试用户、2 次页面浏览和 2 次试听。截图保存在本机 `.qa/analytics/ga4-realtime-2026-10-22.png`。这些是安装验证访问，不应当作宣传获客数据。

上线后可运行 `npm run test:seo:live`，检查真实 TLS、10 页 HTML、爬虫响应一致性、压缩与缓存、301、404 及下载 Range，结果保存在 `.qa/seo/live-report.json`。默认直连本次 ECS IP 并保持正确 TLS SNI；迁移服务器时可通过 `SEO_ADDRESS` 指定新 IP。

### 站长验证与页面更新通知

`search-verification.json` 持久保存 Google / 百度的真实 HTML 验证 token 数组及 IndexNow 的站点证明 key。Google 与百度均已配置当前账号从平台取得的真实标记，并在各自平台验证成功。正常构建部署会将这些标记写进每页原始 HTML 的 head，后续版本发布会保留；不要移除现有站长的标记。Google 使用 `https://voice.freeteam.top/` 网址前缀资源及 HTML 标记验证，无需变更 DNS。

构建同时生成 IndexNow 的根目录证明文件；该 key 按协议供搜索引擎从网站读取，不是 Google / 百度账号的密码或授权。部署后自动运行 `npm run seo:submit`：先检查线上证明文件和实际 HTML，只提交有文字、标题或摘要变动的规范页面。通知状态保存在 `.qa/seo/indexnow-state.json`，五分钟内不重复发送同一页面的变化，未变页面不重复提交。提交失败不会回退已健康发布的网站，可查看输出后重试。

IndexNow 接口及提交记录在 `.qa/seo/indexnow-submission.json`。HTTP 200 表示已接收，202 表示已接收但密钥验证待处理；两者都不代表已收录或有排名。IndexNow 供支持此协议的搜索引擎使用，不能替代 Google Search Console 或百度搜索资源平台的账号验证与提交。

百度专用 API 配置保存在 `.qa/seo/baidu-auth.json`，权限为 0600，已由 `.gitignore` 排除，不能放入 `public/`、`src/` 或网页元信息。`npm run seo:submit:baidu -- --dry-run` 检查已发布页面并预览推送清单；`npm run seo:submit:baidu` 按百度页面提供的接口和精确站点参数推送。只有接口明确返回全部网址成功、且无无效或跨站网址时才记录成功状态。后续部署会尝试推送；接口错误不会回退健康网站，也不会写成提交成功。缺少私有配置时跳过。回执为 `.qa/seo/baidu-submission.json`，成功去重状态为 `.qa/seo/baidu-state.json`。当前接口初始化失败，尚未启用成功状态或承诺自动收录。

## ECS 正式部署

主站为 https://voice.freeteam.top/，https://freeteam.top/ 及两个域名的 HTTP 请求均跳转到主站。服务器通过 `ssh freeteam-ecs` 访问，地址为 `139.224.83.72`。网站页面保持纯静态构建；PayPal 通知由独立 Node.js 服务提供，见 [通知服务部署与配置](paypal/README.md)。

首次部署沿用现有宝塔安装的 Nginx，其他域名继续按原配置运行。站点配置为 `/www/server/panel/vhost/nginx/shengyue.conf`，来源为 `deploy/nginx.conf`。证书位于 `/etc/ssl/shengyue/`，acme.sh 每天通过 `/etc/cron.d/shengyue-acme` 检查续期，更新证书后自动检查并重新加载 Nginx。

在本机使用 Node.js 22.12+ 安装锁定依赖后更新网站：

```sh
npm ci
bash scripts/deploy-ecs.sh
```

脚本先验证安装包 SHA-256、准备下载文件、构建并运行托管测试，再上传到 `/var/www/shengyue/releases/<UTC 时间>/`，最后原子切换 `current` 链接。下载文件存放在 `/var/www/shengyue/shared/downloads/`，支持断点续传和 HTTP Range 请求。公开目录只包含网站及客户安装包；不上传源代码、密钥或销售签发工具。

发布版本和安装包的审核后 SHA-256 记录在 `src/release.json`，页面版本及下载地址共用这一份元数据。当前 v0.4.7 同时提供两种 Mac 芯片的 DMG / ZIP 以及 Windows Setup / ZIP，共六个客户包；页面和准备脚本共用全部六个 SHA-256。Windows 安装包校验报告为 windows-validation-0.4.7.json。

上一版保留在 `previous` 链接中，可在服务器上回退：

```sh
test -L /var/www/shengyue/previous
ln -s "$(readlink /var/www/shengyue/previous)" /var/www/shengyue/rollback.next
mv -Tf /var/www/shengyue/rollback.next /var/www/shengyue/current
```

首次部署前的 Nginx 配置和证书备份在 `/root/backups/shengyue-20261020T081900Z/nginx-before.tar.gz`。访问日志、错误日志及续期日志位于 `/var/log/nginx/shengyue*.log`，每天轮转并保留 14 份。健康检查为 `https://voice.freeteam.top/healthz`。

## 内容与交互

- 真实音频播放、暂停、波形与键盘可操作的进度条；切换声音会停止上一段。
- 五类试听筛选、五类创作场景、真实产品截图放大查看。
- macOS / Windows / 已注册 CLI 指令切换、复制与脚本示例下载。
- 可修改字数、云端单价及授权报价的语音服务费用估算。
- Mac / Windows 下载选择、设备要求、常见问题、手机导航。

客户能力以当前可下载的 v0.4.7 安装包为准。创作需购买授权并激活，激活后不限生成数量；未激活时仅可做购前检测和配置与环境检测，不可自由编辑或导出。首次资源准备完成后可离线生成。Intel / Windows 使用 CPU，完整功能仍待对应实机验收。官网支持创建订单并通过 PayPal 托管按钮购买专业版永久授权，价格为用户确认的 USD 19.00。订单绑定邮箱与设备码，付款后需通过公开邮箱人工核对付款和检测报告、领取激活码；当前未实现自动到账确认和自动发码。订单服务与私有存储见 [PayPal 服务说明](paypal/README.md)。原销售渠道的售后入口继续保留。

## 素材与设计验证

`design/selected-particle-wave.png` 是当前首屏目标，保留选定的整体布局。人物和预存 MP3 来自主项目，品牌使用独立声波标记 `brand-wave.svg`。图标使用 Phosphor，拉丁字体使用 Manrope，中文使用系统字体。`src/waveforms.json` 是实际 MP3 的归一化 RMS 波形。网页部分试听文稿比 v0.4.6 内置示例更新，页面已注明示例与实际定声效果的区别。

`design-qa.md` 记录桌面与手机的视觉对照、交互验证及限制；`.qa/` 保存本地验证截图，不提交 Git。

## 品牌与首屏动效

品牌为无外框的声波标记，中文副标固定为“好声音，让表达更动人”。右侧是冰蓝、淡紫和白色的独立 WebGL 粒子声浪，缓慢流动并响应指针。“听见声音的心跳”播放温宁的真实 MP3，粒子按实际 RMS 波形与播放时间起伏，拖动进度和切换声音保持同步。

提供独立暂停/播放动画按钮，默认遵循系统减少动态效果偏好。离开可视区域或切到后台停止绘制；帧率上限 30 FPS，像素密度最高 1.5。无需三维框架或额外网络资源。WebGL 不可用或丢失时，使用同一组粒子的 Canvas 2D 静态构图，保留声音试听。历史无限环素材仍保留用于设计追踪，页面不再加载。

## 中英文与联系邮箱

中文保留现有地址，英文使用 `/en/`、`/en/download/` 和 `/en/guides/…/`。导航使用地球图标下拉选择中文或 English，当前语言有勾选标记，并切换到当前页面的对应语言版本。菜单支持原生键盘操作，点击外部或 Esc 可收起。两种语言共享安装包、音频、试听原文、插图、截图和波形；截图及当前桌面软件仍是中文，英文页有明确说明。网站元素和无障碍提示由 `src/i18n.mjs`、`src/locales/en.json` 管理；英文指南正文在 `src/site-content.en.mjs`。英文 JSON 示例为 `public/docs/example-script.en.json`；完整 CLI Markdown 仍为中文，入口已标明。

所有页面有独立标题、描述、语言和 canonical，中英文对等页在 HTML 与 sitemap 中互相标注 hreflang，并设置中文为 x-default。英文首页与中文首页使用相同组件和交互，分别静态渲染并按 URL 恢复交互。已有 Google/Baidu HTML 验证标记保持不变；搜索平台之前显示发现 5 页的记录是历史状态，新 sitemap 包含 10 页，实际处理与收录以平台为准。

公开邮箱为 `freeteamlite@gmail.com`，在首页联系模块、导航、页脚与购买激活说明中提供。点击邮件入口调用访客的邮件客户端；首页另有复制邮箱按钮。官网购买区现已提供订单表单与 PayPal 托管付款入口；当前不发送邮件、自动回复或自动发码。

下载上传先进入服务器的 `staging/<release_id>`，从已有安装包复制传输基底并通过 rsync 校验与增量更新。六个文件全部通过 SHA-256 校验后才移动到公开下载目录，再原子切换网站版本。中断的上传不会作为新版本公开；旧包继续保留以支持历史链接和回滚。
