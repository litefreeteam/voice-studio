# PayPal 通知服务

入口：`https://voice.freeteam.top/api/paypal/webhook`。健康检查：`https://voice.freeteam.top/api/paypal/healthz`。

使用 Node.js 和锁定版本的 Nodemailer。Nginx 负责 HTTPS，服务仅监听 `127.0.0.1:3087`，由 `shengyue-paypal.service` 开机启动、异常重启。静态网站继续按原方式发布，无需重新构建页面。

## 验签与通知记录

`PAYPAL_WEBHOOK_ID` 留空时，REST JSON 通知仅保存为 `unverified`，不会发码。表单 IPN 独立向 PayPal 验证，不依赖 REST Webhook ID。

在 PayPal 对应应用中添加入口，订阅 `PAYMENT.CAPTURE.COMPLETED`，取得 Webhook ID 后，在服务器的 `/etc/shengyue-paypal.env` 配置 `PAYPAL_WEBHOOK_ID`，然后 `systemctl restart shengyue-paypal`。这不是 Client ID，不需要提供 Client Secret。测试应用使用 `PAYPAL_ENV=sandbox`，正式应用使用 `live`。PayPal 模拟器使用专用 `WEBHOOK_ID`，只允许在 sandbox 模式使用，切勿将其用于正式收款。

配置 Webhook ID 后，按照 [PayPal 官方自验签流程](https://developer.paypal.com/api/rest/webhooks/rest/) 对原始请求体做 CRC32，并验证 RSA-SHA256 签名。证书仅从对应环境的 PayPal HTTPS 域名指定路径下载，拒绝跳转并短时缓存。签名错误返回 401，证书下载失败返回 503，保存失败返回 500，使 PayPal 可以重试。

通知保存到 `/var/lib/shengyue-paypal/<live|sandbox>/<verified|unverified>/<事件 ID 的 SHA-256>.json`，包含原始请求体、事件与必要签名头。文件只允许服务用户读取，不在网站目录，也没有公开查询接口。完整落盘后才返回成功；同一环境、验证状态下按事件 ID 去重。接收状态与验证状态分开保存，以便后续审查未验证记录。验证成功的完成付款通知还会匹配订单及收款信息，然后进入自动发码队列。

## 部署与维护

从 `website/` 运行：

```sh
npm run test:paypal
npm run deploy:paypal
```

部署脚本需要服务器先安装 `/opt/shengyue-node/bin/node`（Node.js 22+）。当前 CentOS 7 / glibc 2.17 使用 Node.js 项目 [unofficial-builds](https://github.com/nodejs/unofficial-builds) 的兼容构建 `v22.23.3`，归档为 `node-v22.23.3-linux-x64-glibc-217.tar.xz`，SHA-256：

```text
5473ba6774b3c631201a1d29fd4f1809fd927d2266894c544ca47f301eec15bf
```

脚本测试后上传独立版本到 `/opt/shengyue-paypal/releases/`，通过 `current` 切换；保留 `previous`。环境配置与数据不会被覆盖。每次部署备份站点配置与服务单元到 `/root/backups/shengyue-paypal-<UTC 时间>/`，Nginx 校验通过后才平滑重载。不会调用静态网站的构建或发布脚本。

订单校验或发码逻辑变化时，必须单独运行 `npm run deploy:paypal`；`scripts/deploy-ecs.sh` 只发布静态网站，不更新订单服务。健康检查成功只说明服务可用，发布后还应使用测试邮箱和设备码、不带兼容性字段，验证创建订单返回 201、同一 key 重试返回 200 且订单号相同、Bearer 查询能够恢复订单。验证止于待付款订单，不提交付款或测试邮件。2026-10-21 的拒单故障就是静态页面已取消检测报告、线上独立服务仍运行旧校验导致。

服务器维护：

```sh
systemctl status shengyue-paypal
journalctl -u shengyue-paypal -n 50 --no-pager
curl http://127.0.0.1:3087/api/paypal/healthz
```

服务日志仅含事件 ID、事件类型、验证结果、重复状态、订单号或错误码，不输出原始支付信息、邮箱或设备码。请求限制为 256 KiB；除通知、健康检查和订单入口外均返回 404。生产数据需要纳入服务器的私有备份与保留策略。

回退程序版本（环境配置与通知记录保持不变）：

```sh
test -L /opt/shengyue-paypal/previous
ln -s "$(readlink /opt/shengyue-paypal/previous)" /opt/shengyue-paypal/rollback.next
mv -Tf /opt/shengyue-paypal/rollback.next /opt/shengyue-paypal/current
systemctl restart shengyue-paypal
```

## 托管按钮的网站订单

用户确认的商品为声悦专业版永久设备授权，USD 19.00；正式托管按钮 ID 为 `9CXPDVNDNZXJ2`。网站和订单服务共用 `product.json`，将价格、币种与按钮快照保存到每张订单。不要接受浏览器提交价格、付款状态、按钮 ID 或订单号。

`POST /api/paypal/orders` 接收 `productId`、`email`、`machineCode` 与 `locale`。购前检测为自愿检查，不要求勾选确认或提交检测报告。兼容旧客户端提交的 `compatibilityConfirmed`、`compatibilityReport` 字段，但不将它们作为下单或发码条件。请求必须使用 JSON，Origin 必须与 `PAYPAL_SITE_ORIGIN`（默认 `https://voice.freeteam.top`）一致，`Idempotency-Key` 必须为浏览器生成的 UUID v4。同一 key 与同一内容只产生一张订单；修改内容返回 409。每个客户端 15 分钟最多创建 20 张新订单，已有订单的重试不受此限制。

网站在当前标签页的 sessionStorage 保存待购信息和 key，用于恢复及重试；浏览器禁用存储时仍可在当前页面使用。订单保存到 `/var/lib/shengyue-paypal/<live|sandbox>/orders/<请求 key 的 SHA-256>.json`，文件权限 0600。用独占临时文件、同步落盘与硬链接发布，避免部分文件或并发重复；只有成功保存后才返回订单号与付款参数。`GET /api/paypal/orders` 要求 `Authorization: Bearer <原请求 key>` 才能恢复订单，不支持公开按订单号查询客户资料。订单初始为 `pending_payment`；购买表单只收集邮箱和设备码。保留旧客户端请求的字段与顺序，保证已有订单幂等重试。

网站使用原始托管表单 POST 到 PayPal，将本次订单号同时放入 `invoice` 和 `custom`。金额仍由 PayPal 已保存的按钮控制。`return` 与 `cancel_return` 只用于返回页面，均不改变付款状态。新订单在验证真实付款后，自动邮件发送激活码，无需检测报告。

`/api/paypal/webhook` 现同时接收 REST JSON 和表单 IPN，按 Content-Type 分流；托管付款表单通过 `notify_url` 指定这一地址。IPN 必须向固定 PayPal HTTPS 端点验证原始字节。开发预览时将 `PAYPAL_SITE_ORIGIN` 设置为预览源（如 `http://127.0.0.1:4173`），Vite 会将 `/api/paypal` 转发到本机 3087 端口。

## 自动发码与邮件

仅对完成付款、收款邮箱或商户 ID 匹配、订单存在且金额/币种/数量一致的通知创建发码任务。配置 `PAYPAL_RECEIVER_EMAIL` 或 `PAYPAL_MERCHANT_ID`；测试环境不签发正式授权。REST JSON 未验签时只保存，不会发码。

新购和补发均不校验兼容性报告。历史上已通过付款验证、仅因 `compatibility_report_required` 暂停的任务会恢复发码；其他人工核实原因与测试环境限制仍保留。报告校验模块仅供自愿检测工具使用。

原始 Ed25519 私钥保存在 `/etc/shengyue-paypal/signing-key.pem`，root 所有、服务组只读，目录 750、文件 440。启动时检查它与客户端公钥一致。发布程序只复制现用 `desktop/license.cjs`、报告校验模块和公开验签公钥；禁止把私钥放进源码、版本目录或公开网站。

SMTP 复用用户指定的 JobWin 阿里云邮件推送，保存在 `/etc/shengyue-paypal-mail.env`，权限 600，由 systemd 读取。变量为 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SSL`、`SMTP_USERNAME`、`SMTP_PASSWORD`、`SMTP_FROM`，强制 TLS 和证书验证。沿用已验证的发信地址，显示名称和正文为声悦，回复地址为 `freeteamlite@gmail.com`。不得提交凭据。

私有队列为 `live/fulfillment/`。交易 ID 不可用于多个订单，同一订单去重。每 15 秒处理待发任务；失败指数退避，最多 10 次后转人工核实。重启可恢复，已完成任务不重复发送。每次重试使用相同激活码和 Message-ID。SMTP 接受与完成状态落盘之间的崩溃仍可能造成重复邮件，但不会生成另一份授权。`delivered` 仅表示 SMTP 接受，不能保证进入收件箱。

健康检查 `fulfillment: ready` 表示签发器、收款核对和 SMTP 配置齐全；认证连接单独验证，完整收款至收件箱仍需真实付款验收。日志只含订单/交易 ID、状态、次数和错误码，不含密码、激活码或完整邮件。
