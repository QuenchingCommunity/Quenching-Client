# CN1 匹配服务器部署记录（2026-10-26）

后续更新：2026-10-27 已部署 30 ms 发帧及分层延迟诊断，当前程序目录和验收结果见 [延迟优化记录](matchmaking-cn1-latency-20261027.md)。本页保留首次部署来源与历史验收。

## 当前入口与使用

- 用户指定的新机：`191.40.41.124`，SSH 别名 `QMCN1`，主机名 `RainYun-jskHCafV`。
- 客户端服务器地址：`https://qmapi-cn1.txzy.net`，API 前缀 `/match-player-301-lab`。
- 当前使用 DNS only 直连。部署初验曾保留 Cloudflare Proxy，后续延迟排查证明其链路明显更慢，用户于当晚关闭 Proxy；公网直连 HTTPS/WSS 已重新验证。
- 使用现有 r9.2 GUI，在“服务器”栏填写上述地址。两位玩家必须选同一服务器；选择地图开始匹配，另一位从等待列表加入，两人自动开局。
- 旧 `qmapi.txzy.net` 的队列与此节点独立，不存在跨服务器自动撮合。本次没有改动旧节点服务。
- 当前仍沿用测试包凭据，有效期至北京时间 **2026-11-06 02:58:24**。正式运营前需要更换鉴权方案并兼容客户端，不能把当前配置当成永久开放服务。

## 部署内容

Ubuntu 24.04.1 LTS、Nginx 1.24.0、Node v24.13.0，使用已经验证的 r9.2 匹配及 W3GS 实现，没有改动游戏协议或地图槽位算法。

| 项目 | 新机位置 |
| --- | --- |
| 服务 | `quenching-match-player-301-lab.service` |
| 程序 | `/opt/quenching-match-player-301-lab/releases/20261026-cn1-r9.2` |
| Node | `/opt/quenching-match-player-301-lab/runtime/bin/node` |
| 配置 | `/etc/quenching-match-player-301-lab/config.json` |
| 凭据 | `/etc/quenching-match-player-301-lab/player-token`，root 0600，通过 systemd LoadCredential 传入 |
| 地图、对局报告 | `/var/lib/quenching-match-player-301-lab/` |
| 服务日志 | `/var/log/quenching-match-player-301-lab/service.log` |
| Nginx 配置 | `/etc/nginx/sites-available/qmapi-cn1.txzy.net` |
| 部署回执 | 程序目录中的 `deployment.json` |

服务以独立非 root 用户运行，开机启动、失败重启，内存上限 512 MB；没有 CPUQuota。测试限制仍为最多 4 个并发对局、16 位等待玩家，地图库最多 128 张/512 MB；初始附带 3 张地图。

UFW 仅开放 TCP 22（管理）、80（证书验证及 HTTPS 跳转）、443（HTTPS/WSS）。业务服务只监听 `127.0.0.1:3785`；服务器无需对公网开放 6112 或 Bonjour 端口。

证书为 Let's Encrypt，有效期至 **2027-01-24**，启用 certbot 自动续期及续期后 Nginx reload。Nginx 保留 HTTP-01 验证路径，其余 HTTP 请求跳转 HTTPS。WSS 使用 HTTP/1.1 Upgrade、关闭代理缓冲、6 小时读取超时。服务日志配置轮转（daily/maxsize 10M，保留 4 份压缩日志）。对局 JSON 单独持久保存。

## 验收范围与证据

1. 新 IP 直接 HTTP、可信 TLS 均正常；通过 Cloudflare 域名访问 HTTPS 返回新机实例。
2. 未携带凭据访问房间列表返回 403。
3. 通过公网 HTTPS/WSS 的双协议客户端探针完成：上传地图、列出房间、下载地图并比对 SHA-256、第二端加入、两端同步开始、操作转发、退出通知。
4. 配置持久日志并重启后，再次完成相同公网协议验收；最终实例 `229682f2-f167-4429-ad68-b5c931e7d13d`，测试对局 `a57cafdb-4976-402c-bbca-b27df866a2ab`。
5. 测试队列已清理；服务、Nginx、证书续期定时器均设置为开机启用。

最终探针报告见 [JSON 证据](evidence/matchmaking-cn1-20261026.json)。服务器对应对局报告为 `/var/lib/quenching-match-player-301-lab/a57cafdb-4976-402c-bbca-b27df866a2ab.json`。

上述部署初验双端是协议模拟客户端，不是两份真实 Warcraft III；当时未完成新机真人验收。后续真人记录及用户自行关闭 Proxy 后的结果见下节。本代理没有改动用户的 Cloudflare 设置。

### 当晚后续：真人对局与延迟排查

新机记录了北京时间 23:38 开始的真人双端对局 `09b4f0bf-35f3-4536-bb12-c1801c3738b1`：两端 28/74 个操作包，1069 个服务器帧，2118 个帧确认，无协议错误，其中一端上报收到结算、用时 106 秒。由此确认玩家实际使用了新节点，而非旧地址。用户反馈游戏中约 600 ms 延迟。

使用同一域名、同一服务、正常 TLS 校验，通过 WSS 对应用层包做原样回送，强制分别连接源站及此前观察到的 Cloudflare 边缘地址，每路 15 次：

| 路径 | 最小往返 | 中位往返 | 最大往返 |
| --- | --- | --- | --- |
| `191.40.41.124` 源站 | 61.3 ms | 66.2 ms | 74.8 ms |
| `172.67.149.76` Cloudflare 入口 | 382.3 ms | 389.1 ms | 2497.8 ms |

这些是从本机到应用程序的往返测量，不是两位玩家的游戏延迟或双方线路保证。对照测量绕过 DNS 缓存，源站地址保持域名 SNI 和可信证书验证；没有禁用 TLS 校验。Cloudflare 链路的绕路/抖动是已证实的主要优化方向。证据见 [延迟测量](evidence/matchmaking-cn1-latency-20261026.json)。

用户随后关闭 Proxy，权威 DNS 与本机普通解析均变为 `191.40.41.124`。本机一度仍命中旧 Cloudflare 缓存，之后自然更新；`ipconfig /flushdns` 因权限不足未执行成功，无需为此提权。最终普通 HTTPS 响应为 Nginx，连接 IP 为源站。

再以**普通域名解析**完成整套双协议端验收：对局 `a0545d85-5970-4c21-acf7-36e669be6d35`，两条 WSS 的实际远端 IP 均为 `191.40.41.124`，地图上传/下载、房间加入、自动开局、操作转发和退出均通过。[直连验收证据](evidence/matchmaking-cn1-direct-20261026.json)。此轮仍为协议端；真人关闭 Proxy 后的游戏延迟待反馈。

已有 WebSocket 会话不会随 DNS 变更迁移。玩家应结束当前对局后重新打开匹配工具，服务器地址继续使用同一 HTTPS 域名；不应把 IP 直接填成 HTTPS 地址，也无需分发新客户端。DNS 变更后其他玩家的递归解析仍可能短暂缓存旧记录。

## 构建来源

部署包 SHA-256：`a65032fff5e43fac086ab594365f0483ec22a41d57d06de75c04cd7bb04de2df`，53,754,606 字节。Node 可执行文件 SHA-256：`53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`。

| 程序文件 | SHA-256 |
| --- | --- |
| solo-w3gs.mjs | ade57def19fab1e2a3f526a22a469870e1d7701e57b72c8e7e7f15e462d17357 |
| duel-w3gs.mjs | 925a5d388543a061e2fae785ac1146ab9b57bfa558c27146d9f7d288ef1f4e0a |
| solo-player-room.mjs | 7c053755d582ca955fb4057331613e884a3cc09b9af526742f6f4140a3c027d7 |
| room-map-store.mjs | cf6fddd12206f1f03ccd86f4fe48a52b14eb3e2abbcabc5ecab2ce721771256d |
| remote-duel-node.mjs | d15b0df17765554c4424e99269b06685af0a343e51a16959a6290ecaf05ac648 |
| map-player-layout.mjs | 4ecfeaedea3e6e578758f72e4d4bbafb16acf39c1c2d8c3e620910b8c5c09a4d |

新机临时目录中的上传归档、解压树和凭据副本已删除，程序、实际凭据、报告和配置保留。前一台 `103.36.63.18` 未在本轮连接或修改，未自动销毁；它不是当前域名入口。

## 运维检查

```powershell
ssh QMCN1 'systemctl status quenching-match-player-301-lab --no-pager -n 6'
ssh QMCN1 'tail -c 3000 /var/log/quenching-match-player-301-lab/service.log'
curl.exe --max-time 15 https://qmapi-cn1.txzy.net/match-player-301-lab/health
```

检查对局问题优先按 GUI 报告中的 gameId 查服务器同名 JSON，结合 Nginx 日志和服务日志；不要仅凭健康检查正常就判断真人对局已经通过。
