// 封装 wx.request（需登录接口会自动带 Authorization: Bearer <access_token>）
const auth = require('./auth.js');

function getBaseUrl() {
  try {
    const app = getApp();
    return (app && app.globalData && app.globalData.baseUrl) || 'http://localhost:3000/api';
  } catch (e) {
    return 'http://localhost:3000/api';
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

function request(options) {
  const baseUrl = getBaseUrl();
  const url = options.url.startsWith('http') ? options.url : `${baseUrl}${options.url}`;
  const token = auth.getAccessToken();
  const header = {
    'Content-Type': 'application/json',
    ...options.header
  };
  if (token && options.auth !== false) header['Authorization'] = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method || 'GET',
      data: options.data || {},
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '请求失败'));
        }
      },
      fail(err) {
        reject(toError(err));
      }
    });
  });
}

module.exports = {
  get: (url) => request({ url, method: 'GET' }),
  post: (url, data) => request({ url, method: 'POST', data }),
  put: (url, data) => request({ url, method: 'PUT', data }),
  delete: (url) => request({ url, method: 'DELETE' })
};
