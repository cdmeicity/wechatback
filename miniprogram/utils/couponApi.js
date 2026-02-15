/**
 * unavailabilityReason 映射：1-券已过期 2-券已作废 3-券已冻结 4-券未打印 5-券已使用 6-券未启用
 */
function getUnavailabilityReasonText(reason) {
  const r = reason != null ? Number(reason) : 0;
  const map = { 1: '券已过期', 2: '券已作废', 3: '券已冻结', 4: '券未打印', 5: '券已使用', 6: '券未启用' };
  return map[r] || '不可用';
}

/**
 * 鼎新券相关接口：券规则、券详情、添加券（试算）
 * 路径：/api/nonmember/coupon_rules | coupon_detail | check_coupon
 * 签名：与 apiSign 一致（key 字典序 + MD5 小写）
 */
const dingxin = require('./dingxinRequest.js');

/**
 * 获取券规则列表（本影院可用券类型）
 * @param {string} cid 影院 ID
 * @param {{ page?, page_len?, coupon_pay_type?, coupon_rule_id? }} opts
 * @returns {Promise<{ pageCount, pageNums, couponList }>}
 */
function getCouponRules(cid, opts = {}) {
  const params = { cid: String(cid) };
  if (opts.page != null) params.page = String(opts.page);
  if (opts.page_len != null) params.page_len = String(opts.page_len);
  if (opts.coupon_pay_type != null) params.coupon_pay_type = String(opts.coupon_pay_type);
  if (opts.coupon_rule_id != null && opts.coupon_rule_id !== '') params.coupon_rule_id = String(opts.coupon_rule_id);
  return dingxin.post('/nonmember/coupon_rules', params).then((res) => {
    if (res && (res.code === 200 || res.code === '200' || res.code === 0)) return res.data || {};
    return Promise.reject(new Error((res && (res.message || res.msg)) || '获取券规则失败'));
  });
}

/**
 * 券详情查询（单张电子券是否可用、面额、有效期）
 * @param {string} cid 影院 ID
 * @param {string} electronCode 券电子码
 * @returns {Promise<{ couponName, couponValue, couponAvailable, unavailabilityReason, allowPayTicket, allowPayRetail, periodSdate, periodEdate, ... }>}
 */
function getCouponDetail(cid, electronCode) {
  const code = String(electronCode || '').trim();
  if (!code) return Promise.reject(new Error('券码不能为空'));
  return dingxin.post('/nonmember/coupon_detail', {
    cid: String(cid),
    electronCode: code
  }).then((res) => {
    if (res && (res.code === 200 || res.code === '200' || res.code === 0)) return res.data || {};
    return Promise.reject(new Error((res && (res.message || res.msg)) || '券详情查询失败'));
  });
}

/**
 * 添加券试算：按当前订单 + 所选券计算补差、节省、是否缺券
 * @param {{ cid: string, coupons?: string, card_coupons?: string, play_id?: string, price?: string, seat_num?: string, goods?: string|object }} params
 *   coupons 与 card_coupons 二选一；影票需 play_id、price、seat_num；仅卖品可不传 play_id/price/seat_num
 * @returns {Promise<{ balance, savedMoney, ticketNumWithEcode, goodsNumWithEcode, lackedEcode, eCodes, ... }>}
 */
function checkCoupon(params) {
  const p = Object.assign({}, params);
  if (p.cid == null) return Promise.reject(new Error('缺少 cid'));
  if (!p.coupons && !p.card_coupons) return Promise.reject(new Error('coupons 与 card_coupons 需传其一'));
  if (p.coupons && p.card_coupons) return Promise.reject(new Error('coupons 与 card_coupons 不能同时传'));
  if (p.cid != null) p.cid = String(p.cid);
  if (p.play_id != null) p.play_id = String(p.play_id);
  if (p.price != null) p.price = String(p.price);
  if (p.seat_num != null) p.seat_num = String(p.seat_num);
  if (p.coupons != null) p.coupons = String(p.coupons);
  if (p.goods != null && typeof p.goods === 'object') p.goods = JSON.stringify(p.goods);
  return dingxin.post('/nonmember/check_coupon', p).then((res) => {
    if (res && (res.code === 200 || res.code === '200' || res.code === 0)) return res.data || {};
    return Promise.reject(new Error((res && (res.message || res.msg)) || '添加券失败'));
  });
}

/**
 * 券支付下单：与 check_coupon 结果一致传券 + 补差
 * 需与后端约定实际路径（如 /nonmember/order_create 或 lock-buy）
 * @param {{ cid, play_id, seat_id, lock_flag, coupons?, card_coupons?, cash, out_trade_no?, order_id?, num?, partner_buy_ticket_id?, ... }} params
 */
function orderCreateWithCoupon(params) {
  const p = Object.assign({}, params);
  if (p.cash == null) p.cash = '0';
  if (typeof p.cash === 'number') p.cash = String(p.cash);
  return dingxin.post('/nonmember/order_create', p).then((res) => {
    if (res && (res.code === 200 || res.code === '200' || res.code === 0)) return res.data || res;
    return Promise.reject(new Error((res && (res.message || res.msg)) || '券支付下单失败'));
  });
}

module.exports = {
  getCouponRules,
  getCouponDetail,
  checkCoupon,
  orderCreateWithCoupon,
  getUnavailabilityReasonText
};
