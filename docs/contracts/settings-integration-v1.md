# 第三批：设置主进程与渲染层接入契约

用户于2026-10-23明确授权继续并改用CLI派单，覆盖此前“桌面手工启动”的方式。本批Qoder/Antigravity新会话、新任务区；主控负责验收/合并。旧两批任务不续写。冻结base/hash/profile见本任务assignment。

## 产品边界

Antigravity独占设置main/preload/client/deskpet十二个公开字段的接线。先让**隔离开发profile**实际使用权威存储与跨客户端revision同步；稳定日常profile仍legacy，本模块不打开其settings.v1.json，不自动迁移真实数据。现有TTS密钥/endpoint、宿主、模型/预设等不在十二字段内，保留原实现；Bento mock不接真实语音或数据，不做窗口改造。

`PublicSettingsBridge`是冻结的preload面，暴露为`window.utaAPI.publicSettings`（env.d.ts可声明可选，以兼容无preload的独立预览）。mode通道只返回legacy/canonical-dev；使用已冻结SETTINGS_CHANNELS的read/patch/changed。legacy read=null，patch=store-blocked/currentRevision=null，无通知。**不暴露importLegacy给renderer，也不注册任何可写路径/任意key接口。** 显式迁移采集/备份选择UI另批做。

## 主进程

可新增独立settings-ipc模块，通过受控注册函数接受单例SettingsService与approved-sender谓词/目标webContents集合；main/index只少量挂接。mode必须由已解析environment.isStable裁决，不能由renderer/env请求改写。开发环境在app ready后确保已解析userData存在，创建一个store；注册handler先于createWindow。stable不创建该store。关闭卸载handler/订阅，等待队列close，防止before-quit重复触发或未flush就强退。

每个请求检查已登记窗口webContents及senderFrame===mainFrame，拒绝子frame/未登记窗口/销毁/导航失效目标；不得仅检查字符串origin或信任renderer提交的windowId。广播仅发活着的已登记窗口，后续独立设置窗口再加入登记。未知发送者固定失败，不执行store、不泄露路径。handler调用仍按unknown验证，patch规范保留expectedRevision，不把不同窗口的冲突静默重试覆盖。mode/read可使用固定拒绝错误；patch结构化失败，不回传原始异常栈。

## 客户端与启动

renderer settings-client目录只一份缓存/订阅：getMode→canonical时先订阅再read→取最高revision再ready；初始化完成前不创建Pinia/挂载依赖设置的App，不写默认。旧read晚到不能覆盖更高revision通知；重试初始化不能叠监听，dispose移除监听且隔离晚到响应。Electron服务失败/blocked时阻止挂载，展示简短可重试错误，不回退localStorage或默认蓝色掩盖失败。legacy和明确无preload的浏览器开发/独立mock保留原行为，不能把“接口调用失败”当成无preload。

客户端patch复制调用输入，检查并保存expectedRevision；成功才更新缓存，失败保留已提交状态/编辑意图，返回错误。并发冲突需刷新快照供上层展示/重试，**不自动以新revision覆盖用户另一窗口的修改**。本地并发操作按队列顺序，远端事件到来保持单调，不能通知回写形成环；仅发送有变化的十二字段。

## 既有Pinia接线

canonical-dev时十二字段只从已hydrate的client快照初始化、更新；现有Pinia仍是视图状态，不再另存一份权威。watcher不能启动就写默认；远端赋值不再触发patch回写。旧localStorage混合blob里只写尚未迁移字段，不镜像十二字段；legacy模式保持现状。字段范围/音量0..1、原enum、旧TTS安全配置不改。

开发保存失败必须暴露可观察错误，恢复已提交值或保留明确未保存草稿，不能显示持久成功；当前无正式保存UI可先导出typed错误/ref并在交付说明后续UI提示缺口。不同字段的有效用户修改不能因一次远端更新被悄悄丢掉。先保留原用户操作能力，不能为了测试把现有开关禁掉。所有更改只在开发模式启用；stable的旧UI/watch回归通过。

## 测试门槛

两个独立客户端共享同一个临时profile服务，验证保存→另一客户端订阅→磁盘重开；过期版本拒绝/失败无成功；乱序read/event、不回写、unsubscribe/dispose/close；两个profile不串写；陌生sender与子frame拒绝；stable模式零文件I/O。真实执行renderer bootstrap/Pinia行为测试，不只匹配源码字符串或直接测假客户端。原490测试、两批契约、类型/构建通过，新增测试交主控注册。没有实际Electron窗口/GUI时如实标未验，不假称双真实窗口通过。
