-- 美承影院售票系统 - Supabase 数据库 Schema
-- 在 Supabase Dashboard > SQL Editor 中执行此脚本

-- 影厅表
CREATE TABLE halls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  total_seats INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 电影表
CREATE TABLE movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  poster_url TEXT,
  genre TEXT,
  duration INTEGER,
  description TEXT,
  release_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建 halls 和 movies 后创建排片
-- 排片表
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID REFERENCES movies(id) ON DELETE CASCADE,
  hall_id UUID REFERENCES halls(id) ON DELETE CASCADE,
  show_time TIMESTAMPTZ NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 座位表
CREATE TABLE seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
  row_num INTEGER NOT NULL,
  col_num INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'locked')),
  UNIQUE(schedule_id, row_num, col_num)
);

-- 订单表
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT UNIQUE NOT NULL,
  user_openid TEXT,
  schedule_id UUID REFERENCES schedules(id),
  total_amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 订单座位关联表
CREATE TABLE order_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  seat_id UUID REFERENCES seats(id) ON DELETE CASCADE,
  UNIQUE(order_id, seat_id)
);

-- 插入示例影厅
INSERT INTO halls (name, total_seats) VALUES
  ('1号厅', 100),
  ('2号厅', 80);

-- 插入示例电影
INSERT INTO movies (title, poster_url, genre, duration, description, release_date) VALUES
  ('流浪地球2', 'https://example.com/poster1.jpg', '科幻', 173, '太阳即将毁灭，人类在地球表面建造出巨大的推进器...', '2024-01-01'),
  ('满江红', 'https://example.com/poster2.jpg', '剧情', 159, '南宋绍兴年间，岳飞死后四年...', '2024-01-02');
