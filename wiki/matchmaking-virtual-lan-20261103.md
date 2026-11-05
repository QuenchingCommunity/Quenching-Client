# r9.9：纠正局域网含义，支持跨网虚拟局域网

用户要求的是不同家庭／不同地点的玩家先通过平台连接起来，再由魔兽按局域网方式入局。r9.8 只通过物理局域网 UDP 发现同网段玩家，不能满足这一要求，已纠正。r9.8 及其证据保留，不能把旧物理局域网测试当作跨网证明。

## 最终路径

1. 两个客户端使用同一公网 origin，读取同一份虚拟局域网房间列表；不再启动本地 UDP 34855 服务。
2. 房主电脑启动 DuelSession，掌握游戏主机时钟、随机种子、槽位及 W3GS 握手。房主自己的魔兽仅连接本机 TCP。
3. 房主工具主动建立 WSS 隧道；客人的魔兽接入客人工具本机 TCP，客人工具主动连接同一公网隧道。
4. 远端 VirtualLanRelay 只转发两端字节，缓存有界，不运行游戏时钟、不生成操作帧、不生成种子。房主生成的帧被送到客人，客人的 W3GS 请求被送到房主。
5. 房主先结束时，工具继续维持主机到客人结束；不能在本机结算后立即销毁隧道。正常结束结果由房主主机上报，标记 source=lan-host。

这是魔兽专用虚拟局域网隧道，不创建系统虚拟网卡，也不是通用 VPN。玩家无需同一网段、Bonjour、本地广播、手动端口映射或入站公网端口；需要出站 HTTPS/WSS TCP 443。不能据此承诺解决所有尖峰，当前客人数据会经过服务器中继。

## 与其他模式的区别

- 自有服务器模式：游戏主机在远程服务器，沿用原有 QUIC／WSS。
- 跨网虚拟局域网：游戏主机在房主电脑，公网服务只做撮合、分图和透明转发。
- Battle.net：原生 BNET 提供器及原生大厅，保留 r9.8 行为和已知限制。

模式标识仍是 node/lan/bnet，虚拟局域网要求 virtualLanProtocol=2。旧客户端不得静默加入新隧道。房间列表有模式标记，GUI 丢弃已切换模式的迟到列表响应，避免显示旧列表。

## 无中断部署

检查时旧服务还有一局，因此没有重启 `quenching-match-player-301-lab.service`。新增并行单元 `quenching-match-virtual-lan.service`，绑定 127.0.0.1:3786，release `/opt/quenching-match-virtual-lan/releases/20261103-host-relay`，只允许 lan 模式。

Nginx 新增更具体的 `/match-player-301-lab/virtual-lan/` 路径，保留原路径。先验证 nginx -t、确认没有 worker_shutdown_timeout，再优雅 reload。旧匹配服务 PID 及 instance `cb4fbbdc-aec9-46a4-840b-59f917f24a25` 前后不变；活动对局数量前后均为 1。新 instance `bb591029-80ea-4a89-8766-76bbeb6d4195`。用户之后确认旧局结束，未为此额外重启旧服务。

客户端 connection.json 继续使用原 pathPrefix，另含 virtualLanPathPrefix；只有 lan 模式选择新入口，node/bnet 和旧 QUIC sidecar 保持原路线。地图目录共享既有内容寻址缓存，本次没有删除地图或创建重复地图副本。原 Nginx 配置备份在服务器 `/root/_tmp/match-virtual-lan-20261103/nginx.before`。

## 验证

- 109 项回归通过，包括原有节点与 Battle.net 流程。
- 新 VirtualLanRelay 的不执行游戏逻辑、字节缓存和报告权限测试通过。
- 两条独立 TCP 协议模拟流通过房主主机、透明隧道完成入局、倒计时、操作帧同步、中文聊天、先客人退出后房主继续及正常结束。帧内容逐字节核对，退出结果 host win / guest loss。
- 同一测试通过真实公网 HTTPS/WSS 执行，origin 为 https://qmapi-cn1.txzy.net，测试 gameId `2761e867-fdbf-487c-b362-ce5820675c6a`。操作帧 SHA-256 为 `43b266d41be23579686c3e99765ea5810adea1db96bd96eb15799be05811fe90`，主机种子 1539247372；没有使用私有对端 IP 或本地 UDP 发现。
- 两个不同 APPDATA 配置的实际打包 worker 均从公网看到同一个房间；编译产物检查不包含旧 UDP 发现协议 quenching-lan-v1。
- GUI 两轮模拟、槽位弹窗、数字昵称和三个选项检查通过。

以上入局与操作为网络协议模拟端，**不冒充两台真实 Warcraft III 或两个不同运营商的实机结果**。实机仍需两位玩家更新后，在不同网络下测试工人操作、聊天、槽位和正常结算。旧节点实机证明不能替代新增主机位置的验证。

## 代码地图

- `virtual-lan-relay.mjs`：远端透明隧道，不导入 DuelSession。
- `virtual-lan-host.mjs`：客户端主机、本机 TCP、客人 WSS 连接及主机生命周期上报。
- `virtual-lan-proof.mjs`、`virtual-lan.test.mjs`：独立协议端验收及本地／公网测试共用驱动，始终标记 syntheticOnly。
- `remote-duel-node.mjs`：房间、一次性票据、模式与协议门禁、独立入口支持。
- `player-301-gui-worker.ts`：公网房间查询、模式入口选择、房主／客人执行分支及主机保活。
- `PlayerClient.cs`：跨网名称、说明、服务器输入、隧道状态及房主退出提醒。
- `build-player-virtual-lan.mjs`：基于保留的 r9.8 构建完整与小更新包，检查真实公网隧道及打包房间列表证据后交付。

历史 `lan-match-service.mjs` 仅用于保留物理局域网实验及回归，不再进入新客户端包，不再作为玩家找人的路径。
