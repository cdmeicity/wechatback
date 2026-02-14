/**
 * 美承影院售票系统 - Node 后端
 * 提供微信小程序与 Supabase 之间的 API 桥接
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Supabase 客户端 (优先 service_role，否则使用 anon key)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: !!supabase
  });
});

// Supabase 连接测试
app.get('/api/test', async (req, res) => {
  const result = { connected: false, tables: {}, error: null };
  if (!supabase) {
    result.error = 'Supabase 未配置，请检查 .env 中的 SUPABASE_URL 和 SUPABASE_ANON_KEY';
    return res.json(result);
  }
  try {
    const [movies, halls] = await Promise.all([
      supabase.from('movies').select('id, title').limit(5),
      supabase.from('halls').select('id, name').limit(5)
    ]);
    result.connected = true;
    result.tables = {
      movies: { count: movies.data?.length ?? 0, data: movies.data, error: movies.error?.message },
      halls: { count: halls.data?.length ?? 0, data: halls.data, error: halls.error?.message }
    };
    if (movies.error || halls.error) result.error = '部分表查询失败，请确认已执行数据库迁移脚本';
  } catch (err) {
    result.error = err.message;
  }
  res.json(result);
});

// 电影列表
app.get('/api/movies', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase 未配置' });
  try {
    const { data, error } = await supabase
      .from('movies')
      .select('*')
      .order('release_date', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 电影详情
app.get('/api/movies/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase 未配置' });
  try {
    const { data, error } = await supabase
      .from('movies')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 排片列表
app.get('/api/schedules', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase 未配置' });
  try {
    const { movie_id } = req.query;
    let query = supabase.from('schedules').select('*, hall:halls(name)');
    if (movie_id) query = query.eq('movie_id', movie_id);
    const { data, error } = await query.order('show_time', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 微信静默登录（获取 openid，写入 wechat_users）
app.post('/api/auth/login', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: '缺少 code' });

  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) return res.status(500).json({ error: '未配置 WECHAT_APP_ID / WECHAT_APP_SECRET' });

  try {
    const wxRes = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = await wxRes.json();
    if (wxData.errcode) return res.status(400).json({ error: wxData.errmsg || '微信接口错误' });

    const { openid, unionid, session_key } = wxData;
    if (!supabase) return res.status(503).json({ error: 'Supabase 未配置' });

    const { data: profile } = await supabase.from('user_profiles').upsert(
      {
        user_id: null,
        platform: 'wechat_miniprogram',
        openid,
        unionid: unionid || null,
        extra_data: { session_key },
        updated_at: new Date().toISOString()
      },
      { onConflict: 'platform,openid' }
    ).select('id, openid').single();

    res.json({ openid, profileId: profile?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 手机号 + openid 绑定（双重登录：微信 + 会员）
// 方式1: code + openid（来自 wx.getPhoneNumber）
// 方式2: phone + openid（手动输入手机号，需配合短信验证）
app.post('/api/auth/bind-phone', async (req, res) => {
  const { code, phone, openid } = req.body || {};
  if (!openid) return res.status(400).json({ error: '缺少 openid' });

  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) return res.status(500).json({ error: '未配置 WECHAT_APP_ID / WECHAT_APP_SECRET' });
  if (!supabase) return res.status(503).json({ error: 'Supabase 未配置' });

  let phoneNumber = null;
  if (code) {
    try {
      const tokenRes = await fetch(
        `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
      );
      const tokenData = await tokenRes.json();
      if (tokenData.errcode || !tokenData.access_token) {
        return res.status(400).json({ error: tokenData.errmsg || '获取 access_token 失败' });
      }
      const phoneRes = await fetch(
        `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${tokenData.access_token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }
      );
      const phoneData = await phoneRes.json();
      if (phoneData.errcode || !phoneData.phone_info) {
        return res.status(400).json({ error: phoneData.errmsg || '获取手机号失败' });
      }
      phoneNumber = phoneData.phone_info.phoneNumber || phoneData.phone_info.purePhoneNumber;
    } catch (e) {
      return res.status(500).json({ error: '解析手机号失败: ' + e.message });
    }
  } else if (phone && /^1[3-9]\d{9}$/.test(String(phone))) {
    phoneNumber = String(phone).trim();
  } else {
    return res.status(400).json({ error: '请提供 code（微信快捷获取）或有效的手机号' });
  }

  try {
    const { data: row, error } = await supabase.from('wechat_users')
      .update({ phone: phoneNumber, updated_at: new Date().toISOString() })
      .eq('openid', openid)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: '该手机号已被其他账号绑定' });
      throw error;
    }
    if (!row) return res.status(404).json({ error: '未找到 openid 对应用户，请先完成微信登录' });

    res.json({
      id: row.id,
      openid: row.openid,
      phone: row.phone,
      userId: row.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 座位信息
app.get('/api/schedules/:id/seats', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase 未配置' });
  try {
    const { data, error } = await supabase
      .from('seats')
      .select('*')
      .eq('schedule_id', req.params.id);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`美承影院后端服务运行于 http://localhost:${PORT}`);
  if (!supabase) {
    console.warn('警告: Supabase 未配置，请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY');
  }
});
