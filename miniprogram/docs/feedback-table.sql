-- 问题反馈表（表名 user_ 前缀，在 Supabase SQL Editor 中执行）
-- 用于小程序「问题反馈」：用户提交反馈，商家后台可回复；user_id 供 App 端按用户维度查询

CREATE TABLE IF NOT EXISTS user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  openid text NOT NULL,
  user_id uuid,
  phone text,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  images jsonb DEFAULT '[]',
  reply text,
  reply_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_openid ON user_feedback(openid);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC);

COMMENT ON TABLE user_feedback IS '用户问题反馈，商家可回复';
COMMENT ON COLUMN user_feedback.openid IS '微信 openid，小程序端用于筛选当前用户的反馈列表';
COMMENT ON COLUMN user_feedback.user_id IS '用户 ID（如 Supabase auth users.id），供 App 端按用户维度查询';
COMMENT ON COLUMN user_feedback.images IS '图片 URL 数组，如 ["https://..."]';
COMMENT ON COLUMN user_feedback.reply IS '商家回复内容';
COMMENT ON COLUMN user_feedback.reply_at IS '商家回复时间';

-- 若表已存在且尚无 user_id 列，可单独执行：
-- ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS user_id uuid;
-- CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);

-- 反馈图片存储：需在 Supabase Dashboard → Storage 中创建桶 public-assets，并设为公开。
-- 上传路径：public-assets / wechat-users/{user_id}/feedback_xxx.jpg
