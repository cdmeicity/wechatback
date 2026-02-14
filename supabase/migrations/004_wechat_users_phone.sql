-- 为 wechat_users 添加手机号，用于双重登录（微信 openid + 手机号绑定）
ALTER TABLE wechat_users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS wechat_users_phone_key ON wechat_users (phone) WHERE phone IS NOT NULL;
