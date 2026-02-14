/**
 * 扫呗支付请求（/api/payment/*）
 * 用于微信小程序支付：加签规则见「前端请求加签说明（MD5）」
 * 密钥建议从自有后台下发或设置到 app.globalData.saopayFrontSignSecret，勿提交到公开仓库
 */
const md5 = require('./md5.js');

const SAOPAY_BASE_URL = 'https://saopay.meicity.net/api';

function getBaseUrl() {
  try {
    const app = getApp();
    return (app && app.globalData && app.globalData.saopayBaseUrl) || SAOPAY_BASE_URL;
  } catch (e) {
    return SAOPAY_BASE_URL;
  }
}

/** 获取前端加签密钥（与后端 SAOPAY_FRONT_SIGN_SECRET 一致） */
function getSecret() {
  try {
    const app = getApp();
    return (app && app.globalData && app.globalData.saopayFrontSignSecret) || '';
  } catch (e) {
    return '';
  }
}

/**
 * 参与签名的参数字符串：除 sign 外所有字段，value 转字符串并 trim，按 key 字典序拼接
 */
function buildSignString(params) {
  const filtered = {};
  Object.keys(params).forEach(function (key) {
    if (key !== 'sign') {
      const v = params[key];
      filtered[key] = (v === undefined || v === null ? '' : String(v)).trim();
    }
  });
  const sortedKeys = Object.keys(filtered).sort();
  return sortedKeys.map(function (k) { return k + '=' + filtered[k]; }).join('&');
}

/**
 * 为请求体加签：待签串 + "&key=" + secret，MD5 32 位小写作为 sign
 */
function addSign(params, secret) {
  const signString = buildSignString(params);
  const toSign = signString + (signString ? '&' : '') + 'key=' + (secret || '');
  params.sign = md5(toSign).toLowerCase();
  return params;
}

/**
 * 生成公共参数：appid、timestamp（秒级）、nonce
 */
function getCommonParams() {
  const appid = (function () {
    try {
      const app = getApp();
      if (app && app.globalData && app.globalData.saopayAppid) return app.globalData.saopayAppid;
      const account = wx.getAccountInfoSync && wx.getAccountInfoSync();
      if (account && account.miniProgram && account.miniProgram.appId) return account.miniProgram.appId;
    } catch (e) {}
    return '';
  })();
  return {
    appid: appid || 'wx46e9e8119f9686a4',
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: 'n' + Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 10)
  };
}

/**
 * 小程序微信支付（POST /api/payment/mini-pay）
 * 传入业务参数，自动追加 appid/timestamp/nonce 并加签
 * @param {Object} businessParams - pay_type, total_fee, terminal_trace, terminal_time, sub_appid, open_id, notify_url 等
 * @returns {Promise<Object>} 响应体，成功时含 code、paymentParams（供 wx.requestPayment）
 */
function miniPay(businessParams) {
  const baseUrl = getBaseUrl().replace(/\/$/, '');
  const url = baseUrl + '/payment/mini-pay';
  const secret = getSecret();
  const common = getCommonParams();
  const body = Object.assign({}, common, businessParams);
  if (secret) addSign(body, secret);

  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: body,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error((res.data && (res.data.message || res.data.msg)) || 'HTTP ' + res.statusCode));
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  getBaseUrl,
  getSecret,
  buildSignString,
  addSign,
  getCommonParams,
  miniPay
};
