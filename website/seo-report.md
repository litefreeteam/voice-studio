# 声悦配音 SEO 优化与上线记录

完成时间：2026-10-20。正式站点：[voice.freeteam.top](https://voice.freeteam.top/)。SEO 内容首次发布目录：`/var/www/shengyue/releases/20261020T091404Z`；当前包含 Google 与百度验证标记的发布目录：`/var/www/shengyue/releases/20261020T101848Z`。

## 已完成

最主要的修复是将纯客户端页面改为构建时预渲染。原线上 HTML 为 1400 字节、正文只有空的 `root`；现在同一套 React 组件直接输出完整正文，再恢复首页交互。用户与爬虫收到相同内容，未按 User-Agent 提供不同页面。下载页和三篇指南完全无需 JavaScript。

| 页面 | 用户意图与内容 | 规范网址 |
| --- | --- | --- |
| 官网首页 | 品牌、本地 AI 配音软件、声音试听与实际功能 | [首页](https://voice.freeteam.top/) |
| 桌面版下载 | 找到正确平台安装包、设备要求、激活说明与 SHA-256 | [下载页](https://voice.freeteam.top/download/) |
| 批量课程配音 | 文稿导入、讲师定声、分段重做、混音与字幕的实际步骤 | [课程指南](https://voice.freeteam.top/guides/course-narration/) |
| 本地离线配音 | 操作系统、内存、磁盘、首次准备与离线使用范围 | [离线指南](https://voice.freeteam.top/guides/offline-tts/) |
| 智能体与 CLI | 真实入口、JSON 请求、返回路径、任务限制和错误处理 | [CLI 指南](https://voice.freeteam.top/guides/agent-cli/) |

以上是按产品能力整理的搜索意图，不是关键词搜索量或排名预测。新增内容以当前可下载的 v0.4.6 为准，明确购买激活、资源准备、电脑要求、每批文本及导出限制，没有夸大为免费生成、无限文本或自动视频制作。

每页已配置独立标题与摘要、规范网址、语言、Open Graph 与 Twitter 分享信息。新增 1200 × 630 的品牌分享图及 PNG 品牌图标。首页和页脚增加可抓取的指南与下载链接，各指南包含目录、正文锚点、相关内容和面包屑。

JSON-LD 描述品牌、网站、软件、文章与面包屑，并直接包含在原始 HTML 中。软件版本及安装包来自审核后的发布元数据。没有虚构售价、评价、评分、销售链接或公司联系方式；当前不具备可据以填写 Google 软件富媒体结果全部必填字段的真实价格和评价资料，因此不声称已获得此类展示资格。

构建自动生成 [robots.txt](https://voice.freeteam.top/robots.txt) 和 [sitemap.xml](https://voice.freeteam.top/sitemap.xml)，站点地图只包含这 5 个规范 HTML 网址，不包含锚点、查询参数或安装包。没有阻止爬虫访问渲染资源。安装包、原始文档及健康检查使用响应头 `noindex`，避免替代正式内容页成为搜索入口。

Nginx 已统一 HTTP、HTTPS 和主域名，显式 `index.html` 跳转到规范目录网址，保留路径与查询参数。不存在的页面、脚本、安装包与 API 均返回真实 404，并显示带 `noindex` 的提示页。HTML 使用重新验证缓存；带内容哈希的 JS、CSS 和字体使用长期缓存；文本启用 gzip。原有粒子声浪、减少动态效果、试听与下载弹窗保留。

## 验证结果

- 构建、5 项 SEO 自动检查和 5 项原有托管检查全部通过，`git diff --check` 通过。
- 线上 5 页的 HTML 与本地构建逐字节一致，正常验证 TLS 证书。
- 模拟 Googlebot 和 Baiduspider 请求得到相同正文。这证明服务器响应一致，不代表搜索平台已经真实抓取或收录。
- robots、站点地图、分享图、图标、带哈希的脚本/样式/字体可访问，缓存与压缩响应正常。
- 主域名、HTTPS、目录斜线与 `index.html` 跳转通过；错误路径返回 404。
- 三个客户安装包仍正常支持 HTTP 206 Range 下载；服务器已重新验证完整文件 SHA-256。
- 浏览器实测首页 hydration 后下载弹窗可操作；课程和 CLI 指南已检查桌面及手机排版。

首轮线上 HTTP 检查（本机到 ECS，2026-10-20 17:15 中国时间）测得：

| 页面 | 原始 HTML | gzip 传输量 | 首字节时间 |
| --- | ---: | ---: | ---: |
| 首页 | 60,073 B | 15,432 B | 59 ms |
| 下载页 | 9,961 B | 3,593 B | 10 ms |
| 课程指南 | 10,679 B | 4,202 B | 12 ms |
| 离线指南 | 10,527 B | 4,028 B | 14 ms |
| CLI 指南 | 11,612 B | 4,499 B | 12 ms |

这些是单次网络请求的数据，仅包含 HTML，不代表整页下载量、真实用户 Core Web Vitals 或搜索排名。Google PageSpeed Insights 公共 API 本次返回 429 日配额耗尽，未取得有效 Lighthouse 分数；没有填入推测分数。详细检查见 `.qa/seo/live-report.json`，浏览器截图见 `.qa/seo/`。

## 平台接入与后续衡量

Google Search Console 已在当前用户登录的账号中添加 `https://voice.freeteam.top/` 网址前缀资源，取得真实 HTML 标记并通过网站构建部署；平台明确显示“已完成所有权验证”。已提交 `https://voice.freeteam.top/sitemap.xml`，详情页显示“已成功处理站点地图”，发现网页数为 5。证明截图为 `.qa/seo/google-verified.png`、`.qa/seo/google-sitemap-submitted.png` 和 `.qa/seo/google-sitemap-processed.png`。搜索效果与实际索引数据仍等待平台积累，未把“发现网址”写成“已收录”。

持久化配置保存在 `search-verification.json`；后续构建自动保留实际验证标记。无需用户编辑代码、DNS 或服务器。Google 验证成功后不要移除现有 token。

用户已完成百度添加站点时的第一处安全验证。站点类别选择“信息技术”，从平台取得真实 HTML 标记并持久化部署后，百度明确显示 `https://voice.freeteam.top验证成功！`。站点 ID 为 `1431955188`，证明截图为 `.qa/seo/baidu-verified.png`。Google 原有标记及 IndexNow 证明 key 均保留。

百度普通收录页面当前显示 sitemap 的每日提交上限、余额和存量文件上限均为 0，输入框与提交按钮被禁用。已在正确站点 `https://voice.freeteam.top/` 下手动填写首页、下载页和三篇指南，共 5 个规范网址。用户完成第二处人工安全校验后，验证弹层关闭、表单清空；未观察到持续保留的成功回执，不能据此写成百度已接收。数据反馈页也没有可直接确认本次 5 页接收的即时记录。

进一步按当前站点的官方 API 配置核对推送，使用平台提供的精确站点参数 `https://voice.freeteam.top`，接口返回 HTTP 400，错误为 `site init fail`。没有将它改写成成功，也没有猜测恢复时间或诊断为账号实名/网站质量问题。该错误的具体原因尚无平台确认。错误回执在 `.qa/seo/baidu-submission.json`。根据百度页面和[官方配额公告](https://ziyuan.baidu.com/college/articleinfo?id=3531)，提交能力由平台控制；当前没有强行提交、绕过配额或填入未知备案信息。

百度推送配置以 0600 权限私密保存在本地忽略目录，不进入 Git 或公开构建。已补充 `scripts/submit-baidu.mjs` 与部署后的尝试推送：检查线上页面与构建一致，仅在明确的完整接收结果后记录成功，失败不回退网站。语法检查及 dry-run 已通过；当前失败状态不反复重试。此配置可在后续发布、平台能力恢复后继续使用，未创建定时任务或承诺后台持续重试。

IndexNow 已实际提交：首页、下载页及三篇指南，共 5 个最近更新的规范网址。官方接口 `https://api.indexnow.org/indexnow` 于 2026-10-20T09:36:35.998Z 返回 HTTP 202，表示已接收，密钥验证仍待平台处理，未确认收录。回执保存在 `.qa/seo/indexnow-submission.json`。该协议面向参与的搜索引擎，不代表 Google 或百度账号已连接。部署脚本已加入内容变动检测、去重及五分钟间隔；通知失败不影响健康网站的发布。

本次接入更新的 6 项 SEO 检查、5 项托管检查及线上核查全部通过。生产证明文件已返回正确内容，原页面、跳转、缓存、错误状态与下载 Range 仍正常。

Google 与百度的站点所有权接入均已完成，用户无需继续处理本轮验证码。Google 已处理地图并发现 5 页；百度本轮网址接收尚未确认，sitemap 和 API 当前受平台状态限制。平台处理、实际收录及排名与网站发布分别记录。

有真实搜索数据后，以品牌词和上述各类意图分别观察展示、点击、点击率与搜索落地页；再根据实际查询补充内容、调整标题与摘要。优先持续完善真实课程案例、具体问题和版本更新说明，避免批量制造相似落地页。排名与收录由搜索平台决定，不保证即时收录或指定名次。

## 维护与回退

生产内容源为 `src/site-content.mjs`，首页指南入口为 `src/guide-links.mjs`。实际修改内容后再更新日期，不要每次构建都刷新 lastmod。发布使用 `scripts/deploy-ecs.sh`，上线后可运行 `npm run test:seo:live`。

上一版本由 `/var/www/shengyue/previous` 保留。此次 Nginx 修改前的备份为 `/root/backups/shengyue-seo-20261020T091404Z/nginx-before.conf`，修改后的副本也保存在同一目录。其他域名和服务未改动。

依据：[Google JavaScript SEO 基础](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)、[站点地图规范](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[软件结构化数据要求](https://developers.google.com/search/docs/appearance/structured-data/software-app)、[PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started)、[Google 网站验证](https://support.google.com/webmasters/answer/9008080?hl=zh-Hans)、[百度网站验证](https://ziyuan.baidu.com/college/courseinfo?id=267&page=21)、[IndexNow 协议与返回状态](https://www.indexnow.org/documentation)。

## 2026-10-20 中英文与联系邮箱更新

- 新增 `/en/` 与对应下载页、三篇英文指南，网站共 10 个可抓取静态页面。保留现有中文 URL。
- 对等页面均有 self canonical、zh-CN/en/x-default hreflang、正确文档语言与分享元信息；sitemap 列出全部 10 页并包含双向语言标注。英文分享图单独生成。
- 公共联系邮箱 `freeteamlite@gmail.com` 已加入两种语言的联系模块、页脚和购买激活说明，组织结构化数据包含该邮箱。未虚构价格、付款入口或回复时限。
- 页面控件、语音卡片标签、弹窗、错误提示、FAQ 和指南翻译为英文；MP3、试听原文、波形与安装包保持原样。英文页面明确说明现有桌面软件/截图为中文，音频保留原始语言。
- 原有 Search Console/Baidu 验证与 IndexNow proof 保留。历史 Google sitemap 成功记录为 5 个已发现页面；更新后的 10 页是否已处理或收录，需要后续平台数据确认。

本次已发布版本为 `20261020T123319Z`。8 项 SEO 检查与 5 项托管检查通过；10 页线上 HTML/TLS/缓存/重定向/下载校验全部通过。服务器上 42 个 MP3 与上一发布版本逐个 SHA-256 完全一致。IndexNow 本次明确返回 HTTP 200，接收 10 个网址；百度 API 仍返回 `site init fail`，未确认接收。
