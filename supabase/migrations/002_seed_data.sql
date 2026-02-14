-- 种子数据：为已有电影创建排片和座位
-- 执行 001 后运行此脚本

-- 为《流浪地球2》在1号厅创建一场排片
INSERT INTO schedules (movie_id, hall_id, show_time, price)
SELECT m.id, h.id, NOW() + INTERVAL '2 hours', 45.00
FROM movies m, halls h
WHERE m.title = '流浪地球2' AND h.name = '1号厅'
LIMIT 1;

-- 为刚创建的排片生成座位 (10行 x 10列)
INSERT INTO seats (schedule_id, row_num, col_num, status)
SELECT s.id, r.n, c.n, 'available'
FROM (SELECT id FROM schedules WHERE movie_id = (SELECT id FROM movies WHERE title = '流浪地球2' LIMIT 1) LIMIT 1) s(id)
CROSS JOIN generate_series(1, 10) AS r(n)
CROSS JOIN generate_series(1, 10) AS c(n)
WHERE NOT EXISTS (SELECT 1 FROM seats WHERE seats.schedule_id = s.id);
