/**
 * dingxin.meicity.net API 请求封装
 * 自动加签，支持 GET / POST
 */
const apiSign = require('./apiSign.js');

const BASE_URL = 'https://dingxin.meicity.net/api';

function getBaseUrl() {
  try {
    const app = getApp();
    return (app && app.globalData && app.globalData.dingxinBaseUrl) || BASE_URL;
  } catch (e) {
    return BASE_URL;
  }
}

/** 将 wx.request fail 的 err 转为带可读 message 的 Error，避免真机报错 [object Object] */
function toError(err) {
  if (err instanceof Error) return err;
  const msg = err && (err.errMsg != null ? err.errMsg : err.message != null ? err.message : null);
  if (typeof msg === 'string' && msg) return new Error(msg);
  if (typeof err === 'string' && err) return new Error(err);
  try { return new Error(JSON.stringify(err)); } catch (_) { return new Error('网络或请求异常'); }
}

/**
 * GET 请求（已签名参数拼到 query）
 */
function get(path, businessParams = {}) {
  const p = path.startsWith('/') ? path : '/' + path;
  const signed = apiSign.buildSignedParams(businessParams);
  const query = apiSign.toQueryString(signed);
  const url = `${getBaseUrl()}${p}${query ? (p.includes('?') ? '&' : '?') + query : ''}`;
  console.log('[dingxinRequest] GET', p, { params: businessParams, url: url.replace(/sign=[^&]+/, 'sign=***') });

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[dingxinRequest] GET', p, '成功', res.statusCode);
          resolve(res.data);
        } else {
          console.error('[dingxinRequest] GET', p, '失败', res.statusCode, res.data);
          reject(new Error(res.data?.message || res.data?.msg || `HTTP ${res.statusCode}`));
        }
      },
      fail(err) {
        console.error('[dingxinRequest] GET', p, '网络异常', err);
        reject(toError(err));
      }
    });
  });
}

/**
 * POST 请求（已签名参数作为 JSON body）
 */
function post(path, businessParams = {}) {
  const p = path.startsWith('/') ? path : '/' + path;
  const signed = apiSign.buildSignedParams(businessParams);
  const url = `${getBaseUrl()}${p}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      data: signed,
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error(res.data?.message || res.data?.msg || `HTTP ${res.statusCode}`));
      },
      fail(err) { reject(toError(err)); }
    });
  });
}

module.exports = { get, post };
