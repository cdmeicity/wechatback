-- 微信用户表（静默登录）
CREATE TABLE IF NOT EXISTS wechat_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  openid TEXT UNIQUE NOT NULL,
  unionid TEXT,
  session_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wechat_users_updated_at
  BEFORE UPDATE ON wechat_users
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
