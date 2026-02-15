# cinema_order_list 表结构说明

订单表，主键为 `id` (bigint)。以下为与前端订单/取消/支付相关的字段摘要。

## 主键与唯一键

| 列        | 类型   | 说明 |
|-----------|--------|------|
| **id**    | bigint | 主键，自增。前端「取消订单」、`updateOrder` 必须用此 id。 |
| order_id  | text   | 唯一，可为空。 |

## 支付与状态

| 列          | 类型   | 说明 |
|-------------|--------|------|
| pay_status  | text   | 默认 `'INIT'`。可选：`SUCCESS` / `PAID` / `CANCELLED` 等。 |
| out_trade_no| text   | 商户订单号，微信/扫呗支付、影票详情用此查询。 |
| pay_time    | timestamptz | 支付成功时间。 |

## 锁座与取消（鼎新 seat_unlock）

| 列         | 类型   | 说明 |
|------------|--------|------|
| lock_flag  | text   | 锁座接口返回，取消时传给 `nonmember/seat_unlock`。 |
| play_id    | text   | 场次 id，解锁必传。 |
| seat_id    | text[] | 座位 id 数组，解锁时前端拼成逗号分隔字符串。 |
| cinema_id  | text   | 影院 id，解锁时作 cid。 |
| cinema_num | text   | 影院编号，可与 cinema_id 二选一。 |

## 其它常用字段

- **seat_list** text[]：座位展示用（如 "1排2座"）。
- **cinema_name**, **movie_name**, **hall_name**, **start_time**, **end_time**, **total**, **phone**, **openid**, **order_channel** 等：列表与详情展示、筛选用。

## 前端使用注意

1. **列表项 id**：`_convertOrder` 中列表项的 `id` 必须取表主键 `d.id`，这样「取消订单」调 `updateOrder(orderId, { pay_status: 'CANCELLED' })` 时才能正确 PATCH。
2. **取消订单**：先调鼎新 `seat_unlock`（需 cid、play_id、seat_id、lock_flag），成功后再 `updateOrder(id, { pay_status: 'CANCELLED' })`。
3. **seat_id**：表里为 `text[]`，取消时转为逗号分隔字符串传给接口。

表完整 DDL 见项目内或 DBA 提供的建表语句。
