-- ========== 一键导入：CSV 未使用券 → coupon_instance ==========
-- 使用步骤：
-- 1. 在 Supabase 导航打开 SQL Editor，先执行下面整段（会建导入表 coupon_import_staging）
-- 2. Table Editor → 选表 coupon_import_staging → Import data from CSV → 选「美承影院线下券绑定信息.csv」
-- 3. 再在 SQL Editor 执行下面整段一次，即完成导入
-- 执行前请把下面 template_id 的 1 改成你库里已有的 coupon_template.id
-- ==========

-- 建导入表（与 CSV 表头一致，首次执行即可；若表已存在会跳过）
CREATE TABLE IF NOT EXISTS public.coupon_import_staging (
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

-- 从导入表写入 coupon_instance（只导入「券状态=未使用」）
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
  1::bigint,
  TRIM(t."券号"),
  NULLIF(TRIM(t."券号"), ''),
  'import',
  'available',
  (TRIM(split_part(TRIM(t."有效期"), '~', 1)) || ' 00:00:00+08')::timestamptz,
  (TRIM(split_part(TRIM(t."有效期"), '~', 2)) || ' 23:59:59+08')::timestamptz,
  NULLIF(TRIM(t."用户手机号"), ''),
  now(),
  now()
FROM public.coupon_import_staging t
WHERE TRIM(t."券状态") = '未使用'
  AND t."券号" IS NOT NULL
  AND TRIM(t."券号") <> ''
ON CONFLICT (coupon_code) DO NOTHING;
