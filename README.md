# 美承影院售票系统

基于 **微信小程序 + Supabase + Node.js** 的影院在线售票系统。

## 技术栈

- **前端**：微信小程序
- **后端**：Node.js + Express
- **数据库**：Supabase (PostgreSQL)

## 项目结构

```
wechat/
├── miniprogram/          # 微信小程序
│   ├── pages/            # 页面
│   │   ├── index/        # 首页（电影列表）
│   │   ├── movie/        # 电影详情 / 场次选择
│   │   ├── select-seat/  # 选座
│   │   ├── order/        # 订单确认
│   │   └── user/         # 个人中心
│   └── utils/            # 工具函数
├── server/               # Node 后端
│   ├── src/
│   │   └── index.js      # Express API
│   └── .env.example
└── supabase/
    └── migrations/       # 数据库迁移脚本
```

## 快速开始

### 1. Supabase 配置

1. 登录 [Supabase](https://supabase.com) 创建项目
2. 进入 **SQL Editor**，依次执行：
   - `supabase/migrations/001_cinema_schema.sql`（创建表）
   - `supabase/migrations/002_seed_data.sql`（插入示例数据）
3. 在 **Settings > API** 获取：
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Node 后端

```bash
cd server
cp .env.example .env
# 编辑 .env，填入 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

后端默认运行在 `http://localhost:3000`。

### 3. 微信小程序

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入项目：选择 `miniprogram` 目录
3. 在 `project.config.json` 中填入你的 `appid`
4. 修改 `miniprogram/app.js` 中 `globalData.baseUrl` 为你的后端地址：
   - 开发调试：`http://localhost:3000/api` 或本机 IP
   - 正式上线：改为已部署的后端域名
5. 在微信公众平台配置 **服务器域名**（request 合法域名）

### 4. 静默登录

1. 执行 `supabase/migrations/003_wechat_users.sql` 创建微信用户表
2. 在 `.env` 中配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`
3. 启动 Node 后端：`cd server && npm run dev`
4. 小程序 `app.js` 中 `authBaseUrl` 指向后端地址（如 `http://localhost:3000/api`）
5. 小程序启动时自动静默登录，openid 存入本地

**或使用 Supabase Edge Function：**
```bash
supabase functions deploy wechat-auth --no-verify-jwt
supabase secrets set WECHAT_APP_ID=xxx WECHAT_APP_SECRET=xxx
```
小程序 `authBaseUrl` 改为 `https://xxx.supabase.opentrust.net/functions/v1`

### 5. 本地调试

- 微信开发者工具：**详情 > 本地设置** 中勾选「不校验合法域名...」
- 真机调试时需使用 HTTPS 域名或内网穿透工具（如 ngrok）

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/movies | 电影列表 |
| GET | /api/movies/:id | 电影详情 |
| GET | /api/schedules?movie_id=xxx | 排片列表 |
| GET | /api/schedules/:id/seats | 座位信息 |

## 后续待开发

- [ ] 微信登录
- [ ] 下单与支付（微信支付）
- [ ] 我的订单
- [ ] 座位锁定与释放

## 许可证

MIT
