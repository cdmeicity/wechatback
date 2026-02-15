# coupon_instance 表 · Excel「未使用」券导入方案

## 一、目标

- 从 Excel「美承影院线下券绑定信息.xlsx」中，筛选 **券状态名称 = 未使用** 的行。
- 导入到表 `public.coupon_instance`，且符合表结构、约束和枚举。

---

## 二、表字段与约束要点

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | bigint | 自增 | 不插入，由序列生成 |
| tenant_id | uuid | 是 | 有默认值 `5f3c8e2a-9b4d-4f7a-8c21-6d2a1e9b73c4` |
| template_id | bigint | 是 | 外键 → coupon_template(id)，需有效模板 ID |
| user_id | uuid | 否 | 未绑定时为 null |
| coupon_code | text | 是 | **唯一**，券码 |
| coupon_serial | text | 否 | 券序列号 |
| source_type | text | 是 | 枚举，默认 `'system'`；导入建议用 `'import'` 或 `'manual'` |
| source_id / source_detail | text / jsonb | 否 | 来源标识 |
| status | text | 是 | 枚举：available / locked / used / expired / revoked / transferred；**未使用 → `'available'`** |
| valid_from | timestamptz | 是 | 生效开始时间 |
| valid_to | timestamptz | 是 | 生效结束时间 |
| used_at / used_cinema_id / used_order_id / used_amount | 各类型 | 否 | 未使用则 null |
| locked_at / locked_order_id / lock_expires_at | 各类型 | 否 | 未使用则 null |
| original_user_id | uuid | 否 | 默认 null |
| transfer_count | integer | 否 | 默认 0 |
| created_at / updated_at | timestamptz | 有默认 | 默认 now() |
| phone | text | 否 | 绑定手机号，可 null |

---

## 三、CSV「美承影院线下券绑定信息」→ 表字段 映射（已按实际表头核对）

CSV 表头：`券号,券类名称,券面值,优惠券来源,券发放渠道,有效期,用户手机号,会员卡号,券状态,转赠状态,领取时间,消费订单号,消费影院,消费时间,发券影院`

| CSV 列名 | 对应 coupon_instance 字段 | 说明 |
|----------|---------------------------|------|
| 券号     | **coupon_code**           | 必填，TRIM 后入库，唯一 |
| 券状态   | 筛选条件                  | 只导入 TRIM(券状态) = `'未使用'` → status = `'available'` |
| 有效期   | **valid_from** / **valid_to** | 格式 `2025-08-10~2027-08-18`，按 `~` 拆成起止日期，转 timestamptz |
| 用户手机号 | **phone**               | 可选，TRIM 后入库 |
| （无）   | **template_id**          | 必填，CSV 无此列，需在 SQL 中写死一个 coupon_template.id（如 1） |
| 券号     | coupon_serial            | 可选，当前用券号兼作 serial |
| （无）   | source_type              | 固定 `'import'` |
| （无）   | tenant_id                | 固定默认 UUID |

**可直接执行的 SQL**：见同目录下 `coupon_instance-从CSV导入未使用券-SQL.sql`（含临时表、COPY 说明、INSERT 与 ON CONFLICT DO NOTHING；执行前请把 `template_id` 改为你库里已有的 `coupon_template.id`）。

---

## 四、导入前你需要确认的几件事

1. **Excel 中“券码”列的实际列名**（如：券码、券号、兑换码等），以及是否可能和库里已有 `coupon_code` 重复（若会重复，需先决定是跳过还是更新）。  
2. **有效期列**：是否有两列分别表示开始/结束时间？列名是什么？格式是日期时间还是纯日期？  
3. **template_id**：是否有一列对应券类型/模板？若没有，请提供一个默认的 `coupon_template.id` 用于本次导入。  
4. **券状态名称**：确认筛选条件是否为「券状态名称 = 未使用」且只导入这些行；其它状态（已使用、已过期等）是否一律不导入。

你确认上述 4 点后，我可以按你的列名和格式给出最终版 SQL（或带 COPY 的导入步骤）。

---

## 五、SQL 思路与示例（确认映射后再执行）

思路：  
- 只导入「券状态名称 = 未使用」的行。  
- 未使用 → `status = 'available'`。  
- 其它必填字段：从 Excel 列映射，或用常量/默认值。

因无法直接读 Excel，下面给出两种常见做法，你选一种再根据实际列名改。

### 方式 A：先导入到临时表，再 INSERT 到 coupon_instance

1. 用 Excel 另存为 CSV（UTF-8），上传到服务器或放到可被 PostgreSQL 访问的路径。  
2. 建临时表（列名与 CSV 表头一致，或与下面示例一致）：

```sql
-- 临时表：列名请按你 CSV 表头修改
CREATE TEMP TABLE tmp_coupon_import (
  coupon_code        text,
  coupon_serial      text,
  valid_from_str     text,
  valid_to_str       text,
  template_id        bigint,
  phone              text,
  status_name        text
);
```

3. 用 `COPY` 或 pgAdmin 的导入把 CSV 导入到 `tmp_coupon_import`。  
4. 只插入「券状态名称 = 未使用」且映射为 `status = 'available'`：

```sql
-- 只导入 券状态名称 = 未使用
INSERT INTO public.coupon_instance (
  tenant_id,
  template_id,
  coupon_code,
  coupon_serial,
  source_type,
  status,
  valid_from,
  valid_to,
  phone,
  created_at,
  updated_at
)
SELECT
  '5f3c8e2a-9b4d-4f7a-8c21-6d2a1e9b73c4'::uuid,
  COALESCE(t.template_id, 1),  -- 请改成你实际的默认 template_id
  t.coupon_code,
  NULLIF(TRIM(t.coupon_serial), ''),
  'import',
  'available',
  (t.valid_from_str::timestamptz),  -- 若格式是 'YYYY-MM-DD' 等，可写 to_timestamp(t.valid_from_str, 'YYYY-MM-DD')
  (t.valid_to_str::timestamptz),
  NULLIF(TRIM(t.phone), ''),
  now(),
  now()
FROM tmp_coupon_import t
WHERE TRIM(t.status_name) = '未使用'
  AND t.coupon_code IS NOT NULL
  AND TRIM(t.coupon_code) <> ''
ON CONFLICT (coupon_code) DO NOTHING;  -- 若券码已存在则跳过
```

请把 `valid_from_str`/`valid_to_str` 和 `status_name` 等改成你 CSV 里实际列名；若日期是字符串，用 `to_timestamp(..., '格式')` 或 `to_date(..., '格式')` 再转成 timestamptz。

### 方式 B：在应用层或脚本里读 Excel，生成 INSERT

用 Python/Node 等读 Excel，筛选「券状态名称 = 未使用」，按上表映射生成多行 INSERT，再在库里执行。这样更灵活，适合列名不统一或需要复杂转换的情况。

---

## 六、建议你先回复的信息（便于给出最终 SQL）

1. Excel 里与「券码、有效期开始、有效期结束、券状态名称」对应的**准确列名**（可贴第一行表头）。  
2. 有效期列的**格式示例**（如：2025-01-01、2025/01/01 00:00 等）。  
3. 是否有「模板ID」列；若没有，用于本次导入的**默认 template_id**（必须是 coupon_template 里已有的 id）。  
4. 若某行券码在 coupon_instance 已存在：是**跳过**（ON CONFLICT DO NOTHING）还是**更新**（如只更新 status/valid_to）？

你确认后，我可以按你的列名和格式写一份可直接执行的 SQL（含 COPY 或临时表定义）。
