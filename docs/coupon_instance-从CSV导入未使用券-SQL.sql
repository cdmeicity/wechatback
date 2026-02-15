-- =============================================================================
-- coupon_instance：从「美承影院线下券绑定信息.csv」导入「券状态=未使用」的券
-- =============================================================================
-- 前置：1）CSV 编码 UTF-8；2）coupon_template 中需存在一条模板（下面用 1，请按实际改）
-- 执行：在 psql 或 Supabase SQL Editor 中执行；COPY 路径改为你本机或服务器上的 CSV 路径
-- =============================================================================

-- 1）建临时表（列名与 CSV 表头一致，含中文需双引号）
CREATE TEMP TABLE tmp_coupon_csv (
  "券号"           text,
  "券类名称"       text,
  "券面值"         text,
  "优惠券来源"     text,
  "券发放渠道"     text,
  "有效期"         text,
  "用户手机号"     text,
  "会员卡号"       text,
  "券状态"         text,
  "转赠状态"       text,
  "领取时间"       text,
  "消费订单号"     text,
  "消费影院"       text,
  "消费时间"       text,
  "发券影院"       text
);

-- 2）导入 CSV
-- 方式 A：本机 psql，执行（路径按实际改）：
--     \copy tmp_coupon_csv FROM '/Users/taishan/Desktop/美承影院线下券绑定信息.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
-- 方式 B：Supabase Dashboard — 先建表（可建为普通表而非 TEMP），Table Editor 中该表 → Import → 选 CSV，映射列名与 CSV 表头一致（券号、券类名称、…、券状态、有效期、用户手机号等），再执行下面第 3 步的 INSERT（表名改为你建的表名）。

-- 3）只插入「券状态 = 未使用」的行，并映射到 coupon_instance
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
  1::bigint,   -- 【必改】改为你 coupon_template 中实际存在的 id
  TRIM("券号"),
  NULLIF(TRIM("券号"), ''),   -- 用券号兼作 serial，也可改为 NULL
  'import',
  'available',
  (TRIM(split_part(TRIM("有效期"), '~', 1)) || ' 00:00:00+08')::timestamptz,
  (TRIM(split_part(TRIM("有效期"), '~', 2)) || ' 23:59:59+08')::timestamptz,
  NULLIF(TRIM("用户手机号"), ''),
  now(),
  now()
FROM tmp_coupon_csv t
WHERE TRIM(t."券状态") = '未使用'
  AND t."券号" IS NOT NULL
  AND TRIM(t."券号") <> ''
ON CONFLICT (coupon_code) DO NOTHING;

-- 4）查看本次导入条数（可选）
-- SELECT count(*) FROM tmp_coupon_csv WHERE TRIM("券状态") = '未使用';
