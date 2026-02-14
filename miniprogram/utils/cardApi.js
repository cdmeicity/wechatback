/**
 * 会员卡 API（对接 dingxin.meicity.net）
 * 路径以实际后端为准，可根据文档调整
 */
const dingxin = require('./dingxinRequest.js');

function getCinemaId() {
  try {
    const app = getApp();
    return app?.globalData?.cinemainfo?.cinemaid ||
           app?.globalData?.cinemainfo?.cinemaNumber ||
           app?.globalData?.cinemainfo?.id || null;
  } catch (e) {
    return null;
  }
}

/** 获取会员卡级别规则（接口：/api/member/get_card_level_rule） */
function getCardLevelRule(cinemaId) {
  const cid = cinemaId || getCinemaId();
  console.log('[cardApi] getCardLevelRule 请求', { cid, hasCid: !!cid });
  if (!cid) return Promise.reject(new Error('请先选择影院'));
  return dingxin.get('/member/get_card_level_rule', { cid }).then((res) => {
    console.log('[cardApi] get_card_level_rule 响应', {
      code: res?.code,
      message: res?.message,
      dataKeys: res?.data ? Object.keys(res.data) : [],
      ruleLength: Array.isArray(res?.data?.rule) ? res.data.rule.length : 0
    });
    const data = res?.data;
    const rule = data?.rule;
    if (Array.isArray(rule) && rule.length > 0) {
      const list = rule.map((r) => Object.assign({}, r, {
        id: r.levelId ?? r.id,
        price: r.initMoney ?? r.price,
        level_name: r.levelName,
        card_type: r.typeDesc ?? r.type,
        ticket_discount: r.ticketDiscount,
        daily_ticket_limit: r.dayBuyLimit,
        single_ticket_limit: r.showBuyLimit
      }));
      console.log('[cardApi] get_card_level_rule 成功，返回', list.length, '条');
      return list;
    }
    if (Array.isArray(data)) {
      console.log('[cardApi] get_card_level_rule 成功（data 即数组），返回', data.length, '条');
      return data;
    }
    if (data && Array.isArray(data.list)) {
      console.log('[cardApi] get_card_level_rule 成功（list），返回', data.list.length, '条');
      return data.list;
    }
    console.log('[cardApi] get_card_level_rule 响应无 rule 数组', res);
    return [];
  }).catch((err) => {
    console.error('[cardApi] get_card_level_rule 失败', err);
    return Promise.reject(err);
  });
}

/**
 * 从 card_detail 接口响应中解析出「卡详情」对象（保证不遗漏 minAddMoney 等字段）
 * 兼容：res.data、res.data.data、res.data.result、或 res 自身即为详情
 */
function parseCardDetailResponse(res) {
  if (!res || typeof res !== 'object') return null;
  const candidates = [
    res.data && typeof res.data === 'object' ? res.data : null,
    res.data && res.data.data && typeof res.data.data === 'object' ? res.data.data : null,
    res.data && res.data.result && typeof res.data.result === 'object' ? res.data.result : null,
    res
  ].filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    const obj = candidates[i];
    if (obj && (obj.minAddMoney != null || obj.min_add_money != null || obj.cardNumber != null || obj.card_number != null)) {
      return obj;
    }
  }
  return candidates[0] || res;
}

/**
 * 从详情对象中读取 minAddMoney（兼容 min_add_money、字符串 "1000.00"）
 */
function getMinAddMoneyFromDetail(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const raw = detail.minAddMoney ?? detail.min_add_money;
  if (raw == null || raw === '') return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

/**
 * 获取会员卡详情（接口：GET /api/member/card_detail）
 * 按影院 + 卡号查会员卡详情（余额、等级、折扣、有效期等）
 * 返回 data 结构：cardNumber, balance, availableJifen, period, cardLevel, discount, mobile, minAddMoney, giftCard, priceInfo 等
 */
function getCardDetail(cid, card) {
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card) return Promise.reject(new Error('缺少影院ID或卡号'));
  console.log('[cardApi] GET /member/card_detail', { cid: cinemaId, card });
  return dingxin.get('/member/card_detail', { cid: cinemaId, card }).then((res) => {
    console.log('[cardApi] card_detail 响应', { code: res?.code, message: res?.message, hasData: !!res?.data, hasMinAddMoney: !!(parseCardDetailResponse(res) && getMinAddMoneyFromDetail(parseCardDetailResponse(res))) });
    if (res?.code !== 200 && res?.code !== '200') {
      return Promise.reject(new Error(res?.message || res?.msg || '查询会员卡详情失败'));
    }
    return res;
  });
}

/** 验证会员卡密码（password 需 MD5 小写后传入） */
function authCardPassword(cid, card, passwordMd5) {
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card || !passwordMd5) return Promise.reject(new Error('缺少必要参数'));
  return dingxin.post('/member/card_auth', { cid: cinemaId, card, password: passwordMd5 });
}

/**
 * 会员卡绑定（后端接口：POST /api/member/card_bind）
 * 后端负责 user_member_cards 有则更新无则插入，并维护 user_price_scheme(scheme_id=member)
 * @param {Object} opts - cid, card, password(32位小写MD5), user_id, phone(可选)
 */
function cardBind(opts) {
  const { cid, card, password, user_id, phone } = opts || {};
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card || !password || !user_id) {
    return Promise.reject(new Error('缺少必要参数：cid、card、password(MD5)、user_id'));
  }
  const body = { cid: cinemaId, card, password, user_id: String(user_id) };
  if (phone != null && String(phone).trim() !== '') body.phone = String(phone).trim();
  return dingxin.post('/member/card_bind', body);
}

/**
 * 会员卡解绑（后端接口：POST /api/member/card_unbind）
 * 后端负责解绑并更新 user_price_scheme(scheme_id=normal)
 * @param {Object} opts - user_id(必填), cid(可选)
 */
function cardUnbind(opts) {
  const { user_id, cid } = opts || {};
  if (!user_id) return Promise.reject(new Error('缺少 user_id'));
  const body = { user_id: String(user_id) };
  if (cid != null && String(cid).trim() !== '') body.cid = String(cid).trim();
  return dingxin.post('/member/card_unbind', body);
}

/** 根据手机号查询会员卡号（接口：/api/member/card_query_by_phone，phone 从 app.userinfo.phone 取） */
function cardQueryByPhone(cid, phone) {
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !phone) return Promise.reject(new Error('缺少影院ID或手机号'));
  return dingxin.get('/member/card_query_by_phone', { cid: cinemaId, phone }).then((res) => {
    const data = res?.data;
    if (data && Array.isArray(data.cardArray) && data.cardArray.length > 0) {
      return data.cardArray;
    }
    if (data && data.cardList) {
      const list = String(data.cardList).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length > 0) return list;
    }
    return [];
  });
}

/** 购买限制检查（接口：GET /api/member/order_confirm） */
function orderConfirm(opts) {
  const { cid, card, play_id, total } = opts || {};
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card) return Promise.reject(new Error('缺少影院ID或卡号'));
  const params = { cid: cinemaId, card, total: String(total || '0.00') };
  if (play_id) params.play_id = play_id;
  return dingxin.get('/member/order_confirm', params);
}

/** 会员锁座（接口：POST /api/member/seat_lock） */
function memberSeatLock(opts) {
  const { cid, play_id, seat_id, play_update_time, card } = opts || {};
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card || !play_id || !seat_id) return Promise.reject(new Error('缺少必要参数'));
  return dingxin.post('/member/seat_lock', {
    cid: cinemaId,
    play_id: String(play_id),
    seat_id: String(seat_id),
    play_update_time: String(play_update_time || ''),
    card: String(card)
  });
}

/**
 * 会员卡支付（接口：POST /api/member/member_card_pay）
 * 一个接口完成「先验密再扣费」，替代 authCardPassword + hotGoodsOrder
 * @param {Object} opts - cid, card, password(MD5), partner_buy_ticket_id, num, goods_card_balance_pay, mobile, delivery_type(可选), out_trade_no(可选), order_id(可选)
 */
function memberCardPay(opts) {
  const { cid, card, password, partner_buy_ticket_id, num, goods_card_balance_pay, mobile, delivery_type, out_trade_no, order_id } = opts || {};
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card || !password || !partner_buy_ticket_id || num == null || !goods_card_balance_pay || !mobile) {
    return Promise.reject(new Error('缺少必要参数：cid、card、password、partner_buy_ticket_id、num、goods_card_balance_pay、mobile'));
  }
  const body = {
    cid: cinemaId,
    card: String(card),
    password: String(password),
    partner_buy_ticket_id: String(partner_buy_ticket_id),
    num: Number(num),
    goods_card_balance_pay: String(goods_card_balance_pay),
    mobile: String(mobile),
    delivery_type: String(delivery_type || '1')
  };
  if (out_trade_no) body.out_trade_no = String(out_trade_no);
  if (order_id) body.order_id = String(order_id);
  return dingxin.post('/member/member_card_pay', body);
}

/**
 * 会员卡支付-影票（接口：POST /api/member/member_card_pay）
 * 用于 cardlj 分支：必传 play_id、seat_list、partner_buy_ticket_id、num、goods_card_balance_pay，密码 MD5 32 位小写
 * @param {Object} opts - cid, card, password(MD5), play_id, seat_list, partner_buy_ticket_id, num(订单合计金额元取整), goods_card_balance_pay(扣款金额，两位小数), mobile, total, out_trade_no(可选), order_id(可选)
 */
function memberCardPayTicket(opts) {
  const { cid, card, password, play_id, seat_list, partner_buy_ticket_id, num, goods_card_balance_pay, mobile, total, out_trade_no, order_id } = opts || {};
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card || !password) {
    return Promise.reject(new Error('缺少必要参数：cid、card、password'));
  }
  if (!play_id || seat_list == null) {
    return Promise.reject(new Error('会员卡影票支付缺少 play_id 或 seat_list'));
  }
  if (!partner_buy_ticket_id) {
    return Promise.reject(new Error('缺少 partner_buy_ticket_id 参数'));
  }
  if (num == null || num === '') {
    return Promise.reject(new Error('缺少 num 参数'));
  }
  if (!goods_card_balance_pay && goods_card_balance_pay !== 0) {
    return Promise.reject(new Error('缺少 goods_card_balance_pay 参数'));
  }
  const body = {
    cid: cinemaId,
    card: String(card),
    password: String(password),
    play_id: String(play_id),
    seat_list: Array.isArray(seat_list) ? seat_list.join(',') : String(seat_list),
    partner_buy_ticket_id: String(partner_buy_ticket_id),
    num: Number(num),
    goods_card_balance_pay: String(Number(goods_card_balance_pay).toFixed(2)),
    mobile: String(mobile || '').replace(/^\+?86/, '').trim() || undefined
  };
  if (total != null && total !== '') body.total = String(Number(total));
  if (out_trade_no) body.out_trade_no = String(out_trade_no);
  if (order_id) body.order_id = String(order_id);
  return dingxin.post('/member/member_card_pay', body);
}

/** 卖品订单（会员卡扣费，接口：POST /api/member/hot_goods_order） */
function hotGoodsOrder(opts) {
  const { cid, partnerBuyTicketId, num, goodsCardBalancePay, mobile, card, deliveryType } = opts || {};
  const cinemaId = cid || getCinemaId();
  if (!cinemaId || !card || !partnerBuyTicketId || num == null || !goodsCardBalancePay) {
    return Promise.reject(new Error('缺少必要参数'));
  }
  return dingxin.post('/member/hot_goods_order', {
    cid: cinemaId,
    partner_buy_ticket_id: String(partnerBuyTicketId),
    num: Number(num),
    goods_card_balance_pay: String(goodsCardBalancePay),
    mobile: String(mobile || ''),
    card: String(card),
    delivery_type: String(deliveryType || '1')
  });
}

module.exports = {
  getCardLevelRule,
  getCardDetail,
  parseCardDetailResponse,
  getMinAddMoneyFromDetail,
  authCardPassword,
  cardBind,
  cardUnbind,
  cardQueryByPhone,
  orderConfirm,
  memberSeatLock,
  memberCardPay,
  memberCardPayTicket,
  hotGoodsOrder,
  getCinemaId
};
