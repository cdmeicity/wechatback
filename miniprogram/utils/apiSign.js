/**
 * dingxin.meicity.net API 加签
 * 与文档约定一致：业务参数 + 系统参数 → 按 key 排序 → key=value& → MD5(UTF-8) → 32位小写 hex
 */
const md5 = require('./md5.js');

const DEFAULT_APPID = '6755111259';

function generateNonce(len = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function valueToString(val) {
  if (val == null) return null;
  if (Array.isArray(val)) return val.map(String).join(',');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * 构建带签名的参数
 * @param {Object} businessParams 业务参数
 * @param {string} appid 应用ID，默认从 globalData 或 6755111259
 * @returns {Object} 含 appid、nonce、timestamp、sign 的完整参数
 */
function buildSignedParams(businessParams = {}, appid) {
  let aid = appid || DEFAULT_APPID;
  try {
    const app = getApp();
    if (app && app.globalData) aid = appid || app.globalData.dingxinAppId || DEFAULT_APPID;
  } catch (e) {}
  const params = Object.assign({}, businessParams, {
    appid: aid,
    nonce: generateNonce(32),
    timestamp: Math.floor(Date.now() / 1000) + ''
  });

  const keys = Object.keys(params).sort();
  let signStr = '';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === 'sign') continue;
    const val = params[key];
    if (val == null) continue;
    const valueStr = valueToString(val);
    if (valueStr === null) continue;
    signStr += key + '=' + valueStr + '&';
  }
  if (signStr.endsWith('&')) signStr = signStr.slice(0, -1);

  params.sign = md5(signStr).toLowerCase();
  return params;
}

/**
 * 转为 URL query 字符串（用于 GET）
 */
function toQueryString(signedParams) {
  const parts = [];
  const keys = Object.keys(signedParams).sort();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = signedParams[key];
    if (val == null) continue;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(valueToString(val)));
  }
  return parts.join('&');
}

/**
 * 转为 JSON 字符串（用于 POST）
 */
function toJsonString(signedParams) {
  return JSON.stringify(signedParams);
}

module.exports = {
  buildSignedParams,
  toQueryString,
  toJsonString,
  generateNonce
};
