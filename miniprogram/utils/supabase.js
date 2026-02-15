// 小程序直连 Supabase REST API
// 优先使用 service role key（app.globalData.supabaseServiceKey），未配置时使用 anon key
const DEFAULT_URL = 'https://sbp-2ze7l7u43497j0gq.supabase.opentrust.net';
const DEFAULT_ANON_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNicC0yemU3bDd1NDM0OTdqMGdxIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NjUzMzAyNzQsImV4cCI6MjA4MDkwNjI3NH0.FBFis1VGyn7d0GPi_sxDjUVJ_sBf72OYOKrEU3NH0rI';

const STORAGE_BUCKET = 'public-assets';
const STORAGE_PATH_PREFIX = 'wechat-users';

function getConfig() {
  try {
    const app = getApp();
    if (app && app.globalData) {
      const gd = app.globalData;
      const url = (gd.supabaseUrl || DEFAULT_URL).replace(/\/$/, '');
      const serviceKey = (gd.supabaseServiceKey || '').toString().trim();
      const key = serviceKey || gd.supabaseAnonKey || DEFAULT_ANON_KEY;
      return { url, key };
    }
  } catch (e) {}
  return { url: DEFAULT_URL.replace(/\/$/, ''), key: DEFAULT_ANON_KEY };
}

/** 将 wx.request fail 的 err 转为带可读 message 的 Error，避免真机报错 [object Object] */
function toError(err) {
  if (err instanceof Error) return err;
  const msg = err && (err.errMsg != null ? err.errMsg : err.message != null ? err.message : null);
  if (typeof msg === 'string' && msg) return new Error(msg);
  if (typeof err === 'string' && err) return new Error(err);
  try { return new Error(JSON.stringify(err)); } catch (_) { return new Error('网络或请求异常'); }
}

function request(path, method = 'GET', body, extraHeaders = {}) {
  const { url, key } = getConfig();
  const fullUrl = path.startsWith('http') ? path : `${url}/rest/v1${path}`;
  const header = Object.assign({
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`
  }, extraHeaders);

  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method,
      data: body,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || res.data?.error_description || `HTTP ${res.statusCode}`));
        }
      },
      fail(err) {
        reject(toError(err));
      }
    });
  });
}

// 连通性测试（不访问表）
function ping() {
  const { url, key } = getConfig();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${url}/rest/v1/`,
      method: 'GET',
      header: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      success() { resolve(true); },
      fail(err) { reject(toError(err)); }
    });
  });
}

// RPC 调用：rpc_calc_ticket_price_tx（带用户身份算价，tx 为可写事务版本）
// 入参：p_play_id, p_user_id, p_channel_code(可选), p_sale_stage(可选)；返回数组，首项含 final_price
// 鉴权：统一用 anon key。用户身份通过 body 的 p_user_id 传递，RPC 内部按用户算价；避免用自建登录 token 导致 401（Supabase 只认自家 JWT）
function rpcCalcTicketPrice(playId, userId, opts) {
  const { url, key } = getConfig();
  const { channelCode = 'wechat', saleStage = 'normal' } = opts || {};
  const fullUrl = `${url.replace(/\/$/, '')}/rest/v1/rpc/rpc_calc_ticket_price_tx`;
  const body = { p_play_id: playId, p_user_id: userId, p_channel_code: channelCode, p_sale_stage: saleStage };
  console.log('[supabase][rpc_calc_ticket_price_tx] 请求', { playId, userId });
  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method: 'POST',
      data: body,
      header: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[supabase][rpc_calc_ticket_price_tx] 成功', { statusCode: res.statusCode, dataType: typeof res.data, isArray: Array.isArray(res.data), first: Array.isArray(res.data) && res.data[0] ? Object.keys(res.data[0]) : (res.data && typeof res.data === 'object' ? Object.keys(res.data) : null) });
          resolve(res.data);
        } else {
          const msg = res.data?.message || res.data?.error_description || res.data?.error || (typeof res.data === 'string' ? res.data : null) || `HTTP ${res.statusCode}`;
          if (res.statusCode === 405) {
            console.warn('[supabase][rpc_calc_ticket_price_tx] 405 Method Not Allowed：请确认已创建并暴露 RPC rpc_calc_ticket_price_tx。', { statusCode: res.statusCode, response: res.data, url: fullUrl });
          } else {
            console.warn('[supabase][rpc_calc_ticket_price_tx] HTTP 失败', { statusCode: res.statusCode, data: res.data });
          }
          reject(new Error(msg));
        }
      },
      fail(err) {
        console.warn('[supabase][rpc_calc_ticket_price_tx] 网络/请求失败', err);
        reject(toError(err));
      }
    });
  });
}

// 计算票价/成交价（仅用于详情、下单等场景，严禁在排期列表页调用）
// 返回值：number | null，成功为单价（元）
function calcTicketPrice(playId, userId) {
  if (!playId || !userId) return Promise.resolve(null);
  return rpcCalcTicketPrice(playId, userId).then((raw) => {
    if (raw == null) return null;
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0];
      if (first && typeof first === 'object') {
        const v = first.final_price ?? first.price ?? first.ticket_price;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return parseFloat(v) || null;
        return null;
      }
      if (typeof first === 'number') return first;
      if (typeof first === 'string') return parseFloat(first) || null;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const v = raw.final_price ?? raw.price ?? raw.ticket_price;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') return parseFloat(v) || null;
      return null;
    }
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') return parseFloat(raw) || null;
    return null;
  }).catch(() => null);
}

// 获取价格详情/成交价（仅用于选座、下单、支付；排期列表页使用 getCinemaPlay 的 display_price）
// 返回值：{ final_price, price, fixed_price, service_fee, lowest_price } | null
function getPriceDetails(playId, userId) {
  if (!playId || !userId) {
    console.log('[supabase][getPriceDetails] 跳过：缺少 playId 或 userId', { playId, userId });
    return Promise.resolve(null);
  }
  return rpcCalcTicketPrice(playId, userId).then((raw) => {
    if (raw == null) {
      console.log('[supabase][getPriceDetails] RPC 返回 null/undefined');
      return null;
    }
    let map = null;
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0];
      if (first && typeof first === 'object') map = first;
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      map = raw;
    }
    if (!map) console.log('[supabase][getPriceDetails] RPC 返回无法解析', { rawType: typeof raw, isArray: Array.isArray(raw), length: Array.isArray(raw) ? raw.length : 0 });
    return map;
  }).catch((err) => {
    console.warn('[supabase][getPriceDetails] 失败', { playId, userId, err: err && err.message });
    return null;
  });
}

// RPC 调用：获取附近影院列表
function getNearCinemaList(userLat, userLng, maxResults = 10) {
  const { url, key } = getConfig();
  const fullUrl = `${url.replace(/\/$/, '')}/rest/v1/rpc/get_near_cinema_list`;
  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method: 'POST',
      data: {
        user_lat: userLat,
        user_lng: userLng,
        max_results: maxResults
      },
      header: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data || []);
        } else {
          reject(new Error(res.data?.message || res.data?.error_description || `HTTP ${res.statusCode}`));
        }
      },
      fail(err) {
        reject(toError(err));
      }
    });
  });
}

// 快捷方法
const supabase = {
  ping,
  get: (path) => request(path, 'GET'),
  post: (path, body) => request(path, 'POST', body),
  getNearCinemaList,
  calcTicketPrice,
  getPriceDetails,
  // 查询热映影片（视图 v_movie_week_sales_rank）；cinemaCode 可选，筛选 cinema_code=cinemaCode
  movies: (cinemaCode) => {
    let path = '/v_movie_week_sales_rank?select=*';
    if (cinemaCode) path += `&cinema_code=eq.${encodeURIComponent(cinemaCode)}`;
    return request(path);
  },
  /**
   * 按影片代码列表查询影片（v_movie_week_sales_rank），不按影院筛选
   * 用于 IMAX 等场景：排期里有 cine_movie_num，但 cinema_code=该影院 时热映视图可能无数据
   * or 里用 movie_code.eq."code" 双引号形式，避免被当成数字、前导零被吃掉或解析错误
   */
  getMoviesByMovieCodes: (codes) => {
    if (!codes || codes.length === 0) return Promise.resolve([]);
    const list = Array.isArray(codes) ? codes : [codes];
    const trimmed = list.map((c) => String(c).trim()).filter(Boolean);
    if (trimmed.length === 0) return Promise.resolve([]);
    const orClause = trimmed.map((c) => 'movie_code.eq."' + String(c).replace(/"/g, '') + '"').join(',');
    const orParam = '(' + orClause + ')';
    const path = `/v_movie_week_sales_rank?select=*&or=${encodeURIComponent(orParam)}`;
    return request(path).then((arr) => (Array.isArray(arr) ? arr : [])).catch(() => []);
  },
  movie: (id) => request(`/v_movie_week_sales_rank?id=eq.${id}&select=*&limit=1`).then(arr => arr[0]),
  // 查询 halls
  halls: () => request('/halls?select=*'),
  // 查询排片
  schedules: (movieId) => request(`/schedules?select=*,hall:halls(name)&movie_id=eq.${movieId}&order=show_time.asc`),
  // 查询座位
  seats: (scheduleId) => request(`/seats?select=*&schedule_id=eq.${scheduleId}`),
  /**
   * 查询订单列表（cinema_order_list）
   * @param {Object} opts - { openid, order_channel, phone }
   *    openid: 当前登录用户 openid，必填（否则返回空）
   *    order_channel: 如 'miniprogram'
   *    phone: 可选，电话号码筛选
   * @returns {Promise<Array>}
   */
  orders: (opts) => {
    const openid = opts && opts.openid;
    const orderChannel = (opts && opts.order_channel) != null ? opts.order_channel : 'miniprogram';
    const phone = opts && opts.phone;
    if (!openid) return Promise.resolve([]);
    let path = '/cinema_order_list?select=*&order=created_at.desc';
    path += '&openid=eq.' + encodeURIComponent(openid);
    path += '&order_channel=eq.' + encodeURIComponent(orderChannel);
    if (phone != null && String(phone).trim() !== '') {
      path += '&phone=eq.' + encodeURIComponent(String(phone).trim());
    }
    return request(path);
  },
  /** 按 id 查询订单（用于获取完整订单字段如 seat_id） */
  getOrderById: (orderId) => {
    if (!orderId) return Promise.resolve(null);
    return request(`/cinema_order_list?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`)
      .then(arr => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null))
      .catch(() => null);
  },
  /** 按 out_trade_no 查询订单（用于 N7 出票状态轮询/跳转票务详情） */
  getOrderByOutTradeNo: (outTradeNo) => {
    if (!outTradeNo) return Promise.resolve(null);
    return request(`/cinema_order_list?out_trade_no=eq.${encodeURIComponent(outTradeNo)}&select=*&limit=1`)
      .then(function (arr) { return Array.isArray(arr) && arr.length > 0 ? arr[0] : null; })
      .catch(function () { return null; });
  },
  /**
   * 查询拦截规则（v_lanjie_interception_rules）
   * @param {string} cinemaCode 影院代码，对应 cinema_code
   * @returns {Promise<Object|null>} 单条规则或 null
   */
  getInterceptionRules: (cinemaCode) => {
    if (!cinemaCode) return Promise.resolve(null);
    return request(`/v_lanjie_interception_rules?cinema_code=eq.${encodeURIComponent(cinemaCode)}&select=*&limit=1`)
      .then(arr => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null))
      .catch(() => null);
  },

  // 查询影院排期（含展示价）。展示价来源：v_meicity_cinema_play LEFT JOIN price_play_cache ON play_id，视图需包含 display_price
  // 列表页仅使用 display_price，严禁调用算价 RPC（成交价仅在详情/下单时通过 getPriceDetails 获取）
  getCinemaPlay: (cinemaId, hallId) => {
    let path = '/v_meicity_cinema_play?select=*&order=start_time.asc';
    if (cinemaId) path += `&cinema_id=eq.${encodeURIComponent(cinemaId)}`;
    if (hallId) path += `&hall_id=eq.${encodeURIComponent(hallId)}`;
    return request(path);
  },

  /**
   * 查询 new_notice：type=event、channel=wechat、(cinema_id=cinemaId 或 cinema_id 为空)、created_at 最新一条
   * @param {string} cinemaId - 影院编号（app.cinemainfo.cinemaNumber / cinema_code，与 new_notice.cinema_id 对应）
   * @returns {Promise<{ id, content, created_at, cinema_id, channel, type }|null>}
   */
  getLatestNotice: (cinemaId) => {
    const cid = cinemaId != null ? String(cinemaId).trim() : '';
    const orPart = cid ? `or=(cinema_id.eq.${encodeURIComponent(cid)},cinema_id.is.null)` : 'cinema_id=is.null';
    return request(
      `/new_notice?${orPart}&channel=eq.wechat&type=eq.event&order=created_at.desc&select=id,content,created_at,cinema_id,channel,type&limit=1`
    )
      .then(arr => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null))
      .catch(() => null);
  },

  /**
   * 查询 new_notice 列表：channel=wechat、(cinema_id=cinemaId 或 cinema_id 为空)、可选 type，created_at 降序
   * @param {string} [cinemaId] - 影院编号（cinemaNumber/cinema_code），空时只查 cinema_id 为空的
   * @param {string} [channel='wechat'] - 渠道
   * @param {string} [type] - 类型：'event' 活动通知，'system' 系统通知
   */
  getNoticeList: (cinemaId, channel = 'wechat', type) => {
    const cid = cinemaId != null ? String(cinemaId).trim() : '';
    const orPart = cid ? `or=(cinema_id.eq.${encodeURIComponent(cid)},cinema_id.is.null)` : 'cinema_id=is.null';
    let path = `/new_notice?${orPart}&channel=eq.${encodeURIComponent(channel)}&order=created_at.desc&select=id,content,created_at,cinema_id,channel,type`;
    if (type && String(type).trim()) {
      path += `&type=eq.${encodeURIComponent(String(type).trim())}`;
    }
    return request(path)
      .then(arr => (Array.isArray(arr) ? arr : []))
      .catch(() => []);
  },

  /** 按 id 查询单条 new_notice */
  getNoticeById: (id) => {
    if (id == null || String(id).trim() === '') return Promise.resolve(null);
    return request(
      `/new_notice?id=eq.${encodeURIComponent(String(id).trim())}&select=*&limit=1`
    )
      .then(arr => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null))
      .catch(() => null);
  },
  // 按 openid 查询 user_profiles
  getUserProfileByOpenid: (openid) => {
    if (!openid) return Promise.resolve(null);
    return request(`/user_profiles?openid=eq.${encodeURIComponent(openid)}&select=*&limit=1`)
      .then(arr => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null))
      .catch(() => null);
  },
  // 按 id 查询 users
  getUserById: (userId) => {
    if (!userId) return Promise.resolve(null);
    return request(`/users?id=eq.${encodeURIComponent(userId)}&select=*&limit=1`)
      .then(arr => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null))
      .catch(() => null);
  },

  /**
   * 查询用户已绑定的会员卡（user_member_cards，status=bind）
   * 表结构：user_id(uuid), card_no, phone, status, extra_data(jsonb)
   * extra_data 存 card_name, balance, points, min_add_money
   */
  getUserMemberCard: (userId) => {
    if (!userId) return Promise.resolve(null);
    return request(`/user_member_cards?user_id=eq.${encodeURIComponent(userId)}&status=eq.bind&select=card_no,phone,extra_data&limit=1`)
      .then(arr => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const row = arr[0];
        const ed = row.extra_data || {};
        return {
          cardNumber: row.card_no || ed.cardNumber || '',
          cardName: ed.cardName || ed.card_name || '会员卡',
          balance: ed.balance != null ? parseFloat(ed.balance) : null,
          points: ed.points != null ? parseInt(ed.points, 10) : null,
          minAddMoney: ed.minAddMoney != null ? parseFloat(ed.minAddMoney) : (ed.min_add_money != null ? parseFloat(ed.min_add_money) : null),
          validity: ed.validity || null,
          discount: ed.discount != null ? ed.discount : null
        };
      })
      .catch(() => null);
  },

  /**
   * 绑定会员卡到 user_member_cards（upsert，user_id 唯一）
   */
  bindMemberCard: (userId, cardinfo) => {
    if (!userId || !cardinfo) return Promise.reject(new Error('缺少 userId 或 cardinfo'));
    const payload = {
      user_id: String(userId),
      card_no: String(cardinfo.cardNumber || cardinfo.card_no || ''),
      phone: cardinfo.phone || null,
      status: 'bind',
      extra_data: {
        cardName: cardinfo.cardName || cardinfo.card_name || '会员卡',
        balance: cardinfo.balance != null ? cardinfo.balance : null,
        points: cardinfo.points != null ? cardinfo.points : null,
        minAddMoney: cardinfo.minAddMoney != null ? cardinfo.minAddMoney : (cardinfo.min_add_money != null ? cardinfo.min_add_money : null),
        validity: cardinfo.validity || null,
        discount: cardinfo.discount != null ? cardinfo.discount : null
      }
    };
    return request('/user_member_cards', 'POST', payload, { Prefer: 'resolution=merge-duplicates,return=representation' })
      .then(rows => {
        const r = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        const ed = r?.extra_data || payload.extra_data;
        return {
          cardNumber: payload.card_no,
          cardName: ed?.cardName || '会员卡',
          balance: ed?.balance ?? null,
          points: ed?.points ?? null,
          minAddMoney: ed?.minAddMoney ?? null
        };
      });
  },

  /**
   * 解绑会员卡：status=unbind, unbind_at=now()
   */
  unbindMemberCard: (userId) => {
    if (!userId) return Promise.reject(new Error('缺少 userId'));
    return request(`/user_member_cards?user_id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
      status: 'unbind',
      unbind_at: new Date().toISOString()
    })
      .then(() => ({}))
      .catch(() => ({}));
  },

  /**
   * 创建订单（插入 cinema_order_list，生成 out_trade_no）
   * @param {Object} orderData 订单数据，字段下划线命名
   * @returns {Promise<Object>} 创建成功的订单对象（含 id、out_trade_no）
   */
  /**
   * 更新订单（PATCH cinema_order_list）
   * @param {string|number} orderId 订单 ID
   * @param {Object} patchData 要更新的字段
   */
  updateOrder: (orderId, patchData) => {
    const path = `/cinema_order_list?id=eq.${encodeURIComponent(orderId)}`;
    const payload = Object.assign({}, patchData, { updated_at: new Date().toISOString() });
    console.log('[supabase][API7] 更新订单 cinema_order_list', {
      orderId,
      path,
      patchData: payload
    });
    return request(path, 'PATCH', payload)
      .then((res) => {
        console.log('[supabase][API7] 更新订单 成功', { orderId, res });
        return res;
      })
      .catch((err) => {
        console.error('[supabase][API7] 更新订单 失败', { orderId, err });
        throw err;
      });
  },

  createOrder: (orderData) => {
    return request('/cinema_order_list', 'POST', orderData, { Prefer: 'return=representation' })
      .then((inserted) => {
        const row = Array.isArray(inserted) && inserted.length > 0 ? inserted[0] : inserted;
        const id = row?.id;
        if (!id) return Promise.reject(new Error('创建订单失败，未返回 id'));
        const outTradeNo = `mcyy-wechat-${id}`;
        return request(`/cinema_order_list?id=eq.${encodeURIComponent(id)}`, 'PATCH', { out_trade_no: outTradeNo })
          .then(() => Object.assign({}, row, { out_trade_no: outTradeNo }))
          .catch(() => Object.assign({}, row, { out_trade_no: outTradeNo }));
      });
  },

  /**
   * 创建会员卡充值/新办订单（表 card_new_recharge_order）
   * 插入后按 id 回写 out_trade_no：新办会员卡(立即办理) mcyy-wechat-cardnew-(id)，充值 mcyy-wechat-cardcz-(id)
   */
  createCardRechargeOrder: (orderData) => {
    const payload = Object.assign({}, orderData);
    delete payload.out_trade_no;
    return request('/card_new_recharge_order', 'POST', payload, { Prefer: 'return=representation' })
      .then((inserted) => {
        const row = Array.isArray(inserted) && inserted.length > 0 ? inserted[0] : inserted;
        const id = row?.id;
        if (id == null) return Promise.reject(new Error('创建订单失败，未返回 id'));
        const isNewCard = orderData.card_pay_type === 'create';
        const prefix = isNewCard ? 'mcyy-wechat-cardnew-' : 'mcyy-wechat-cardcz-';
        const out_trade_no = prefix + id;
        return request(`/card_new_recharge_order?id=eq.${encodeURIComponent(id)}`, 'PATCH', { out_trade_no })
          .then(() => Object.assign({}, row, { out_trade_no }))
          .catch(() => Object.assign({}, row, { out_trade_no }));
      });
  },

  /**
   * 更新会员卡订单支付状态（按 out_trade_no）
   */
  updateCardRechargeOrderPayState: (outTradeNo, payState, payTime = null) => {
    const body = { pay_state: payState };
    if (payTime != null) body.pay_time = payTime;
    return request(`/card_new_recharge_order?out_trade_no=eq.${encodeURIComponent(outTradeNo)}`, 'PATCH', body);
  },

  /**
   * 问题反馈：按 openid 查询列表（小程序端，按创建时间倒序）
   */
  getFeedbackList: (openid) => {
    if (!openid) return Promise.resolve([]);
    return request(`/user_feedback?openid=eq.${encodeURIComponent(openid)}&order=created_at.desc&select=*`)
      .then(arr => (Array.isArray(arr) ? arr : []))
      .catch(() => []);
  },

  /**
   * 问题反馈：按 user_id 查询列表（App 端，按创建时间倒序）
   */
  getFeedbackListByUserId: (userId) => {
    if (!userId) return Promise.resolve([]);
    return request(`/user_feedback?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&select=*`)
      .then(arr => (Array.isArray(arr) ? arr : []))
      .catch(() => []);
  },

  /**
   * 问题反馈：按 id 查询单条（含商家回复）
   */
  getFeedbackById: (id) => {
    if (!id) return Promise.resolve(null);
    return request(`/user_feedback?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
      .then(arr => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null))
      .catch(() => null);
  },

  /**
   * 问题反馈：新增一条
   * @param {Object} data - { openid, user_id?, phone?, title, content, images?, cinema_id? }
   */
  createFeedback: (data) => {
    const payload = {
      openid: String(data.openid || ''),
      user_id: data.user_id != null ? String(data.user_id) : null,
      phone: data.phone != null ? String(data.phone) : null,
      title: String(data.title || '').trim(),
      content: String(data.content || '').trim(),
      images: Array.isArray(data.images) ? data.images : [],
      cinema_id: data.cinema_id != null && data.cinema_id !== '' ? String(data.cinema_id) : null
    };
    return request('/user_feedback', 'POST', payload, { Prefer: 'return=representation' })
      .then(rows => (Array.isArray(rows) && rows.length > 0 ? rows[0] : null));
  },

  /**
   * 券实例：按 app.userinfo 的 user_id 或 phone 查询券列表（满足其一即展示），按截止时间升序
   * 表 coupon_instance 含 user_id、phone 字段；有两者时分别请求再合并去重，避免 or 语法差异
   */
  getCouponListForUser: (userId, phone) => {
    const uid = userId && String(userId).trim();
    const ph = phone != null && String(phone).trim() !== '' ? String(phone).trim().replace(/\D/g, '') : '';
    if (!uid && !ph) return Promise.resolve([]);
    const select = 'id,coupon_code,coupon_serial,valid_from,valid_to,status,template_id,created_at';
    const order = 'order=valid_to.asc';
    const selectPart = `select=${select}`;

    const statusFilter = 'status=eq.available';
    const fetchByUserId = () => {
      if (!uid) return Promise.resolve([]);
      const path = `/coupon_instance?user_id=eq.${encodeURIComponent(uid)}&${statusFilter}&${order}&${selectPart}`;
      return request(path).then(arr => (Array.isArray(arr) ? arr : [])).catch(() => []);
    };
    const fetchByPhone = () => {
      if (!ph) return Promise.resolve([]);
      const path = `/coupon_instance?phone=eq.${encodeURIComponent(ph)}&${statusFilter}&${order}&${selectPart}`;
      return request(path).then(arr => (Array.isArray(arr) ? arr : [])).catch(() => []);
    };

    const doRequest = uid && ph
      ? Promise.all([fetchByUserId(), fetchByPhone()]).then(([a, b]) => {
          const seen = new Set();
          const merged = [];
          [...a, ...b].forEach((row) => {
            const id = row.id;
            if (id != null && !seen.has(id)) {
              seen.add(id);
              merged.push(row);
            }
          });
          merged.sort((x, y) => {
            const ta = x.valid_to ? new Date(x.valid_to).getTime() : 0;
            const tb = y.valid_to ? new Date(y.valid_to).getTime() : 0;
            return ta - tb;
          });
          return merged;
        })
      : (uid ? fetchByUserId() : fetchByPhone());

    console.log('[supabase][getCouponListForUser] 请求', { userId: uid || null, phone: ph || null });
    return doRequest
      .then(arr => {
        console.log('[supabase][getCouponListForUser] 成功', { count: arr.length });
        return arr;
      })
      .catch((err) => {
        console.warn('[supabase][getCouponListForUser] 失败', err?.message || err);
        return [];
      });
  },

  /**
   * 绑券：根据券码绑定到当前用户（仅可绑定 status=available 且 user_id 为空的券）
   * 先按券码查询一条未绑定的券，再 PATCH 写入 user_id
   */
  bindCoupon: (userId, couponCode) => {
    if (!userId || !couponCode || !String(couponCode).trim()) {
      return Promise.reject(new Error('请输入券码'));
    }
    const code = String(couponCode).trim();
    return request(
      `/coupon_instance?coupon_code=eq.${encodeURIComponent(code)}&status=eq.available&user_id=is.null&select=id&limit=1`
    )
      .then(arr => {
        if (!Array.isArray(arr) || arr.length === 0) {
          return Promise.reject(new Error('券码无效或已被绑定'));
        }
        const id = arr[0].id;
        return request(`/coupon_instance?id=eq.${encodeURIComponent(id)}`, 'PATCH', {
          user_id: String(userId),
          updated_at: new Date().toISOString()
        });
      });
  },

  /**
   * 根据券详情接口结果写入 coupon_instance（新增一条，完全符合表结构）
   * @param {Object} detail - coupon_detail 返回：periodSdate、periodEdate、couponName、couponValue、coupon_rule_id 等
   * @param {string} couponCode - 券电子码
   * @param {string} [userId] - 当前用户 id，可选
   * @param {string} [phone] - 当前用户手机号，可选
   * @param {number} [templateId=1] - coupon_template.id，无则用 1
   */
  insertCouponFromDetail: (detail, couponCode, userId, phone, templateId = 1) => {
    const code = String(couponCode || '').trim();
    if (!code) return Promise.reject(new Error('券码不能为空'));
    const validFrom = parseCouponDetailDate(detail.periodSdate || detail.period_sdate, true);
    const validTo = parseCouponDetailDate(detail.periodEdate || detail.period_edate, false);
    if (!validFrom || !validTo) return Promise.reject(new Error('券有效期无效'));

    const tid = Number(detail.template_id ?? detail.coupon_rule_id ?? templateId) || 1;
    const serial = (detail.coupon_serial || detail.couponSerial || code) || code;
    const sourceId = detail.coupon_rule_id != null ? String(detail.coupon_rule_id) : (detail.electronCode ? String(detail.electronCode) : null);

    const sourceDetail = detail && typeof detail === 'object'
      ? {
          couponName: detail.couponName ?? detail.coupon_name,
          couponValue: detail.couponValue ?? detail.coupon_value,
          couponAvailable: detail.couponAvailable ?? detail.coupon_available,
          periodSdate: detail.periodSdate ?? detail.period_sdate,
          periodEdate: detail.periodEdate ?? detail.period_edate,
          unavailabilityReason: detail.unavailabilityReason ?? detail.unavailability_reason,
          coupon_rule_id: detail.coupon_rule_id,
          electronCode: detail.electronCode ?? detail.electron_code
        }
      : null;

    const body = {
      tenant_id: '5f3c8e2a-9b4d-4f7a-8c21-6d2a1e9b73c4',
      template_id: tid,
      user_id: userId ? String(userId) : null,
      coupon_code: code,
      coupon_serial: serial,
      source_type: 'manual',
      source_id: sourceId,
      source_detail: sourceDetail,
      status: 'available',
      valid_from: validFrom,
      valid_to: validTo,
      phone: phone && String(phone).trim() ? String(phone).trim() : null
    };
    return request('/coupon_instance', 'POST', body);
  },

  /**
   * 上传反馈图片到 Storage：桶 public-assets，路径 wechat-users/{user_id}/
   * @param {string} filePath - 本地临时路径（wx.chooseMedia 返回）
   * @param {string} user_id - 用户 ID 或 openid，用于路径
   * @returns {Promise<string>} 公开访问 URL
   */
  uploadFeedbackImage: (filePath, user_id) => {
    const { url, key } = getConfig();
    const baseUrl = url.replace(/\/$/, '');
    const pathSegment = (user_id && String(user_id).trim()) ? String(user_id).trim() : 'anonymous';
    const ext = getExtension(filePath);
    const fileName = 'feedback_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    const objectPath = STORAGE_PATH_PREFIX + '/' + pathSegment + '/' + fileName;
    const uploadUrl = baseUrl + '/storage/v1/object/' + STORAGE_BUCKET + '/' + objectPath;

    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath,
        success(res) {
          const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
          wx.request({
            url: uploadUrl,
            method: 'POST',
            data: res.data,
            header: {
              'Content-Type': contentType,
              'Authorization': 'Bearer ' + key,
              'x-upsert': 'true'
            },
            success(reqRes) {
              if (reqRes.statusCode >= 200 && reqRes.statusCode < 300) {
                const publicUrl = baseUrl + '/storage/v1/object/public/' + STORAGE_BUCKET + '/' + objectPath;
                resolve(publicUrl);
              } else {
                reject(new Error(reqRes.data?.message || reqRes.data?.error || '上传失败'));
              }
            },
            fail(err) { reject(toError(err)); }
          });
        },
        fail(err) { reject(toError(err)); }
      });
    });
  }
};

/** 解析券详情返回的日期为 ISO 字符串，startOfDay  true=当天 00:00，false=当天 23:59 */
function parseCouponDetailDate(val, startOfDay) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const part = s.slice(0, 10);
    d = new Date(part + (startOfDay ? 'T00:00:00+08:00' : 'T23:59:59+08:00'));
  } else {
    d = new Date(s);
  }
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getExtension(path) {
  if (!path || typeof path !== 'string') return '.jpg';
  const i = path.lastIndexOf('.');
  if (i === -1) return '.jpg';
  const e = path.slice(i).toLowerCase();
  if (e === '.png' || e === '.jpeg' || e === '.jpg' || e === '.gif' || e === '.webp') return e;
  return '.jpg';
}

module.exports = supabase;
