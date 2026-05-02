# seat-select 选座页：接口调用、数据传递与全量复制清单

本文档梳理 `miniprogram/pages/seat-select/` 的**全部网络与能力调用**、**依赖全局数据**、**分支逻辑**，供在其它微信小程序中**完整复制该页**时对照实现。

---

## 一、页面文件（需一并复制）

| 文件 | 说明 |
|------|------|
| `pages/seat-select/seat-select.js` | 主逻辑（约 1050+ 行） |
| `pages/seat-select/seat-select.wxml` | 布局、自定义导航、座位网格、退改签弹窗、会员卡密码弹窗、N7 出票等待弹窗、底部确认栏 |
| `pages/seat-select/seat-select.wxss` | 样式（需与 wxml class 一致） |
| `pages/seat-select/seat-select.json` | `navigationStyle: custom`，无自定义组件引用 |

**复制后必改**：`app.json` 中注册 `pages/seat-select/seat-select`；所有 `wx.navigateTo` / `reLaunch` / `switchTab` 的路径若你项目路由不同需替换。

---

## 二、依赖的 JS 工具模块（必须存在且接口兼容）

| 模块路径 | 用途 |
|----------|------|
| `utils/seatApi.js` | `getSeatStatus` → 内部调鼎新 `GET /nonmember/get_play_seat_status_plus` |
| `utils/dingxinRequest.js` | `dingxin.get(...)`，鼎新域名与签名（见 `app.globalData.dingxinBaseUrl`） |
| `utils/supabase.js` | 见下文「Supabase 调用清单」 |
| `utils/cardApi.js` | `memberSeatLock`、`memberCardPayTicket`、`cardUnbind` |
| `utils/saopayRequest.js` | `miniPay`（N7 非会员微信支付参数） |
| `utils/auth.js` | `redirectToLoginIfNeeded`、`getOpenid` |
| `utils/md5.js` | 会员卡密码 MD5 |
| `utils/dateHelper.js` | 北京时间解析/格式化、`beijingTimeStringToMs`、`formatBeijingTime` 等 |

---

## 三、进入本页的「合法入口」与数据传递

本页 **强依赖** Play 页写入的 `globalData`，仅靠 URL 参数不够。

### 3.1 URL 参数（`onLoad(options)`）

| 参数 | 用途 |
|------|------|
| `playId` | 排期 ID |
| `orderId` | 订单主键，须与 `globalData.playOrder.id` 一致 |
| `outTradeNo` | 订单商户单号（展示/日志；核心仍以 `playOrder` 为准） |

### 3.2 必须通过 `getApp().globalData` 传入（由 Play 页 `onContinue` 写入）

| 字段 | 用途 |
|------|------|
| `playOrder` | **完整订单对象**（与 `orderId` 一致）；选座、更新订单、支付分支都从这里取字段 |
| `playShowtime` | 开场时间展示、会员/非会员时间计算 |
| `playMovie` | 影片信息兜底 |
| `playPriceDetails` | `{ unitPrice, serviceFee, lowestPrice, priceDetails }`，本页 `unitPrice` 优先来自订单与这里 |
| `cinemainfo` | 拦截规则 `cinemaNumber`、部分兜底 |
| `cardinfo` | 是否会员、卡号、余额、`cardStatus`、`maxBuyNum` 等 |
| `supabaseUser` | 手机号（会员卡支付） |
| `wxProfile.openid` | 非会员 N7 扫呗支付 |

**校验逻辑**：若 `!orderId || !playOrder || String(order.id) !== String(orderId)` → **`reLaunch` 首页**（防深链进选座）。

---

## 四、接口与数据访问全清单（按类型）

### 4.1 认证 / 门禁

| 调用 | 时机 |
|------|------|
| `auth.redirectToLoginIfNeeded()` | `onLoad` 最先；未登录或未绑手机会 `redirectTo` 登录页 |

### 4.2 Supabase REST（`utils/supabase.js` → `{url}/rest/v1/...`）

| 方法 | HTTP | 路径/说明 | 调用时机 |
|------|------|-----------|----------|
| `getInterceptionRules(cinemaNumber)` | GET | `v_lanjie_interception_rules?cinema_code=eq.{cinemaNumber}` | `onLoad`，取 `lock_minute`、`movie_code` |
| `updateOrder(orderId, patchData)` | PATCH | `cinema_order_list?id=eq.{orderId}` | 确认选座后写座位/金额；会员/非会员各分支更新 `out_trade_no`、`lock_flag` |
| `getOrderById(orderId)` | GET | `cinema_order_list?id=eq.{orderId}` | 锁座成功后校验 `lock_flag` 是否写回 |
| `getOrderByOutTradeNo(outTradeNo)` | GET | `cinema_order_list?out_trade_no=eq.{outTradeNo}` | N7 / M6.5 轮询 `pay_status === 'SUCCESS'` |
| `getCardDayBuyNum(cardNumber, buyDay)` | GET | `v_card_day_buy_number` 视图 | 会员分支：当日已购票数限制 |

**确认选座时 `updateOrder` 写入的 `patchData` 典型字段**：

- `num`、`total`、`handling_fees`（代码里 `3 * num`）、`service_fee`（`order.service_fee * num`）
- `seat_list`（座位名称数组）、`seat_id`（`cineSeatId` 数组）

### 4.3 鼎新 HTTP（`dingxinRequest` + `seatApi`）

| 调用 | 路径/方式 | 说明 |
|------|-----------|------|
| `seatApi.getSeatStatus({ cid, playId, playUpdateTime, cinemaNum })` | **GET** `/nonmember/get_play_seat_status_plus` | `_loadSeats`；失败或空列表则 `_useMockSeats` |
| `dingxin.get('/nonmember/seat_lock', { cid, play_id, seat_id, play_update_time })` | 非会员 **N6** 分支：大于第三方停售时锁座 | |

### 4.4 会员卡（`utils/cardApi.js`，鼎新域）

| 调用 | 说明 |
|------|------|
| `memberSeatLock({ cid, play_id, seat_id, play_update_time, card })` | **M6.4** 会员且距开场时间 > `lock_minute` |
| `memberCardPayTicket({ cid, card, password, play_id, seat_list, partner_buy_ticket_id, num, goods_card_balance_pay, mobile, total, out_trade_no, order_id, ... })` | **M6.5** 会员且距开场 ≤ 停售；密码 MD5 |
| `cardUnbind({ user_id, cid })` | `_handleUnbindCard`（当日购票限制弹窗点确定后解绑，当前 Toast 多注释） |

### 4.5 扫呗 + 微信收银台（非会员 **N7**）

| 调用 | 说明 |
|------|------|
| `saopayRequest.miniPay({ pay_type, total_fee, terminal_trace, terminal_time, sub_appid, open_id, notify_url })` | 换微信支付参数 |
| `wx.requestPayment({ timeStamp, nonceStr, package, signType, paySign })` | 拉起微信支付；成功后轮询订单 `pay_status` |

### 4.6 微信能力

| 能力 | 用途 |
|------|------|
| `wx.getSystemInfoSync` | 状态栏高度、内容区 `paddingTop` |
| `wx.createSelectorQuery` | 座位区横向滚动居中 |
| `wx.navigateTo` / `wx.reLaunch` / `wx.switchTab` / `wx.navigateBack` | 见各分支 |

**本页不调用** `wx.login`；openid 来自全局或 `auth.getOpenid()`。

---

## 五、主流程（逻辑传递）

### 5.1 `onLoad`

1. `redirectToLoginIfNeeded`  
2. 校验 `orderId` + `playOrder` 一致性，否则回首页  
3. 从 `playOrder` / `playShowtime` / `playMovie` / `playPriceDetails` 拼展示字段与 `unitPrice`  
4. `getInterceptionRules(cinemaNumber)` → `ruleInfo`  
5. `_loadSeats()`

### 5.2 `_loadSeats`

- `seatApi.getSeatStatus({ cid, playId, playUpdateTime, cinemaNum })`  
- 成功 → `_buildSeatGrid`；失败/空 → `_useMockSeats`（本地假数据）

### 5.3 `toggleSeat`

- 最多 `MAX_SEATS = 5` 个座位；维护 `selectedIds`、`selectedNames`、`totalPrice = unitPrice * 数量`

### 5.4 `onConfirm`（核心分流）

1. **`supabase.updateOrder(orderId, patchData)`** — 先落库座位与金额。  
2. 若有 **`cardinfo.cardNumber`** → **会员分支 M**；否则 → **非会员分支 N**。

**会员 M：**

- M6.2：余额、`cardStatus===1`、当日 `getCardDayBuyNum` vs `maxBuyNum`  
- M6.3：`minutesDifference`（开场 − 现在）与 `rule.lock_minute` 比较  
  - **大于停售** → M6.4：`memberSeatLock` → `updateOrder(lock_flag)` → 退改签弹窗 → `confirm-pay?onlyMemberCard=1`  
  - **不大于停售** → M6.5：改 `out_trade_no` 为 `mcyy-wechat-cardlj-{orderId}` → 退改签弹窗 → 密码弹窗 → `memberCardPayTicket` → `_startM65PayStatusPoll` → 成功跳转 `ticketinfo`

**非会员 N：**

- `isGreaterThanThirdParty = (minutesDifference > lockMinute) || movieCodeInRule`  
  - **true（N6）**：`dingxin.get('/nonmember/seat_lock')` → `updateOrder(lock_flag, out_trade_no: mcyy-wechat-ypgm-{id})` → 退改签 → `confirm-pay`  
  - **false（N7）**：`updateOrder(out_trade_no: mcyy-wechat-yplj-{id})` → 退改签 → `miniPay` + `requestPayment` → `_showProcessingTicketDialog` 轮询 `getOrderByOutTradeNo` 直到 `pay_status === 'SUCCESS'` → `ticketinfo`

### 5.5 轮询

- **N7**：`N7_POLL_INTERVAL_MS = 2000`，`N7_TIMEOUT_MS = 60000`  
- **M6.5**：`M65_POLL_INTERVAL_MS = 1500`，`M65_POLL_TIMEOUT_MS = 15000`（超时仍 `reLaunch` 到 `ticketinfo`）

---

## 六、`app.globalData` 本页会修改的项

| 字段 | 时机 |
|------|------|
| `playOrder` | 锁座成功、会员/非会员更新 `out_trade_no` / `lock_flag` 后 |

---

## 七、跳转目标页（复制时需存在或改路径）

| 路径 | 条件 |
|------|------|
| `/pages/index/index` | 非法入口、多处 `reLaunch` |
| `/pages/login/login` | `redirectToLoginIfNeeded` |
| `/pages/play/play` | 锁座失败让用户重选 |
| `/pages/confirm-pay/confirm-pay` | N6 / 会员 M6.4；会员加 `?onlyMemberCard=1` |
| `/pages/card-manage/card-manage` | 余额不足 |
| `/pages/ticketinfo/ticketinfo?out_trade_no=` | 支付/出票成功 |

---

## 八、复制检查清单（另一小程序）

- [ ] `app.json` 注册页面；合法域名包含 **Supabase**、**dingxinBaseUrl**、**saopay**、**auth**（若用）。  
- [ ] `globalData` 含：`dingxinBaseUrl`、`supabaseUrl`、密钥、`cinemainfo`、`saopayAppid`/`notify_url` 等。  
- [ ] **仅从 Play 下单后进入**：实现与 `play.js` 一致的 `playOrder` / `playShowtime` / `playMovie` / `playPriceDetails` 写入。  
- [ ] 数据库表/视图：`cinema_order_list`、`v_lanjie_interception_rules`、`v_card_day_buy_number` 与鼎新接口字段一致。  
- [ ] 复制上文列出的 **utils** 或保持函数签名一致。  
- [ ] 退改签文案常量 `REFUND_AGREEMENT_MODAL_BODY` 可按法务调整。

---

## 九、与 Play 页的衔接（必须成对实现）

另一小程序若只复制 seat-select 而不复制 play 的建单逻辑，需自行保证：

1. 先 **POST `cinema_order_list` 创建订单**并得到 `id`、`out_trade_no`；  
2. 再 **navigateTo** `seat-select?playId=&orderId=&outTradeNo=`；  
3. **`globalData.playOrder` 等**与 Play 页字段一致，否则 `onLoad` 会 `reLaunch` 首页。

---

*文档随 `seat-select.js` 当前实现整理；若业务改接口路径或订单号前缀，以代码为准。*
