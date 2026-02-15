/**
 * 小程序登录：静默登录 + 手机号验证码注册/登录
 *
 * 约定：后端域名 https://auth.meicity.net
 * 静默登录：POST /auth/wechat-mp/login，Body: { "code" }
 * 微信端（Bearer 免签）：POST /api/v1/send-otp、/api/v1/verify-login，Header: Authorization: Bearer <access_token>
 */
const STORAGE_ACCESS_TOKEN = 'access_token';
const STORAGE_USER = 'user';
const STORAGE_NEED_PHONE = 'need_phone';
const STORAGE_PHONE_LOGIN_DONE = 'phone_login_done';  // 仅 phone-login 成功后才为 true，用于判断是否可恢复登录态

function getAppSafe() {
  try {
    const app = getApp();
    return app && app.globalData ? app : null;
  } catch (e) {
    return null;
  }
}

/** 将 wx.request fail 回调的 err（可能是对象）转为带可读 message 的 Error，避免真机报错显示 [object Object] */
function toError(err) {
  if (err instanceof Error) return err;
  const msg = err && (err.errMsg != null ? err.errMsg : err.message != null ? err.message : null);
  if (typeof msg === 'string' && msg) return new Error(msg);
  if (typeof err === 'string' && err) return new Error(err);
  try { return new Error(JSON.stringify(err)); } catch (_) { return new Error('网络或请求异常'); }
}

function getLoginUrl() {
  const app = getAppSafe();
  const base = (app?.globalData?.authBaseUrl || 'https://auth.meicity.net').replace(/\/$/, '');
  return `${base}/auth/wechat-mp/login`;
}

function requestLogin(code) {
  const url = getLoginUrl();
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { code },
      success(res) {
        if (res.statusCode === 200) resolve(res.data);
        else reject(new Error(res.data?.error || res.data?.message || '登录失败'));
      },
      fail(err) { reject(toError(err)); }
    });
  });
}

module.exports = {
  getAccessToken() {
    return wx.getStorageSync(STORAGE_ACCESS_TOKEN) || null;
  },

  getUser() {
    try {
      return wx.getStorageSync(STORAGE_USER) || null;
    } catch (e) {
      return null;
    }
  },

  getNeedPhone() {
    return wx.getStorageSync(STORAGE_NEED_PHONE) === true || wx.getStorageSync(STORAGE_NEED_PHONE) === 'true';
  },

  getOpenid() {
    const user = this.getUser();
    return user?.openid || null;
  },

  /**
   * 退出 Supabase 登录态：POST /auth/logout
   * 收到 200 后清除本地 access_token、user、app.globalData.userinfo 等
   */
  hasPhoneLoginDone() {
    return wx.getStorageSync(STORAGE_PHONE_LOGIN_DONE) === true || wx.getStorageSync(STORAGE_PHONE_LOGIN_DONE) === 'true';
  },

  setPhoneLoginDone() {
    wx.setStorageSync(STORAGE_PHONE_LOGIN_DONE, true);
  },

  _clearLocalAuth() {
    wx.removeStorageSync(STORAGE_ACCESS_TOKEN);
    wx.removeStorageSync(STORAGE_USER);
    wx.removeStorageSync(STORAGE_NEED_PHONE);
    wx.removeStorageSync(STORAGE_PHONE_LOGIN_DONE);
    try {
      const app = getAppSafe();
      if (app?.globalData) {
        app.globalData.supabaseUser = null;
        app.globalData.userinfo = null;
        app.globalData.cardinfo = null;
        app.globalData.manualLogout = true;
      }
    } catch (e) {}
  },

  logout() {
    const token = wx.getStorageSync(STORAGE_ACCESS_TOKEN);
    const base = getAppSafe()?.globalData?.authBaseUrl || this.BASE_URL || 'https://auth.meicity.net';
    const url = `${base.replace(/\/$/, '')}/auth/logout`;
    const auth = this;
    return new Promise((resolve, reject) => {
      if (!token) {
        auth._clearLocalAuth();
        return resolve();
      }
      wx.request({
        url,
        method: 'POST',
        header: { 'Authorization': `Bearer ${token}` },
        data: {},
        success(res) {
          auth._clearLocalAuth();
          if (res.statusCode === 200) resolve(res.data);
          else resolve(res.data);
        },
        fail(err) {
          auth._clearLocalAuth();
          reject(toError(err));
        }
      });
    });
  },

  /** 静默登录：wx.login + code 调后端 */
  async silentLogin() {
    const LOG = (step, status, detail) => console.log(`[静默登录] ${step} ${status}`, detail !== undefined ? detail : '');
    try {
      LOG('① wx.login', '开始', '获取 code');
      const { code } = await new Promise((resolve, reject) => {
        wx.login({ success: (r) => resolve(r), fail: (err) => reject(toError(err)) });
      });
      if (!code) {
        LOG('① wx.login', '失败', '未获取到 code');
        return { ok: false, needPhone: false, user: null };
      }
      LOG('① wx.login', '成功', { code: code.slice(0, 8) + '...' });

      LOG('② 请求后端', '开始', getLoginUrl());
      const data = await requestLogin(code);
      const token = data.access_token;
      const user = data.user || null;
      const needPhone = !!data.need_phone;

      if (!token) {
        LOG('② 请求后端', '失败', '响应无 access_token');
        return { ok: false, needPhone: false, user: null };
      }
      LOG('② 请求后端', '成功', { hasToken: !!token, hasUser: !!user, needPhone });

      LOG('③ 存储 token', '开始');
      if (token) wx.setStorageSync(STORAGE_ACCESS_TOKEN, token);
      if (user) wx.setStorageSync(STORAGE_USER, user);
      wx.setStorageSync(STORAGE_NEED_PHONE, needPhone);
      LOG('③ 存储 token', '成功', 'wx.setStorageSync(access_token) 已写入');

      LOG('④ 全流程', '成功', { tokenLen: String(token).length, userId: user?.id || '-' });
      return { ok: true, needPhone, user };
    } catch (err) {
      console.warn('[静默登录] ④ 全流程 失败', err);
      return { ok: false, needPhone: false, user: null };
    }
  },

  /** 绑定手机号（验证码流程由 bind-phone 页调用后端） */
  setUser(user) {
    if (user) {
      wx.setStorageSync(STORAGE_USER, user);
      wx.setStorageSync(STORAGE_NEED_PHONE, !user.phone);
    }
  },

  setAccessToken(token) {
    if (token) {
      wx.setStorageSync(STORAGE_ACCESS_TOKEN, token);
      try {
        const app = getAppSafe();
        if (app && app.globalData) app.globalData.accessToken = token;
      } catch (e) {}
    }
  },

  // ========== 手机号+验证码 注册/登录（对接 https://auth.meicity.net） ==========
  BASE_URL: 'https://auth.meicity.net',

  normalizePhone(phone) {
    const s = String(phone || '').replace(/\D/g, '');
    return s.length >= 11 && s.slice(-11).startsWith('1') ? s.slice(-11) : s;
  },

  /** 发送验证码：POST /auth/phone/send-otp */
  sendPhoneCode(phone) {
    const p = this.normalizePhone(phone);
    if (p.length !== 11) return Promise.reject(new Error('请输入正确的 11 位手机号'));
    const base = getAppSafe()?.globalData?.authBaseUrl || this.BASE_URL;
    const url = `${base.replace(/\/$/, '')}/auth/phone/send-otp`;
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { phone: p },
        success(res) {
          if (res.statusCode === 200) resolve(res.data);
          else reject(new Error(res.data?.message || res.data?.error || '发送失败'));
        },
        fail(err) {
          reject(toError(err));
        }
      });
    });
  },

  /** 手机号+验证码 登录/注册（无则注册、有则登录）：POST /auth/phone/login */
  loginWithPhoneCode(phone, code) {
    const p = this.normalizePhone(phone);
    const c = String(code || '').trim();
    if (p.length !== 11) return Promise.reject(new Error('请输入正确的 11 位手机号'));
    if (!c) return Promise.reject(new Error('请输入验证码'));
    const base = getAppSafe()?.globalData?.authBaseUrl || this.BASE_URL;
    const url = `${base.replace(/\/$/, '')}/auth/phone/login`;
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { phone: p, code: c },
        success(res) {
          if (res.statusCode === 200) {
            const d = res.data;
            if (d.access_token) wx.setStorageSync(STORAGE_ACCESS_TOKEN, d.access_token);
            if (d.user) wx.setStorageSync(STORAGE_USER, d.user);
            wx.setStorageSync(STORAGE_NEED_PHONE, false);
            try {
              const app = getAppSafe();
              if (app && app.globalData) app.globalData.accessToken = d.access_token;
            } catch (e) {}
            resolve(d);
          } else {
            reject(new Error(res.data?.message || res.data?.error || '登录失败'));
          }
        },
        fail(err) {
          reject(toError(err));
        }
      });
    });
  },

  /** 绑定手机（已静默登录后 need_phone 为 true 时用）：POST /auth/phone/bind */
  bindPhone(phone, code) {
    const token = wx.getStorageSync(STORAGE_ACCESS_TOKEN);
    if (!token) return Promise.reject(new Error('请先完成微信登录'));
    const p = this.normalizePhone(phone);
    const c = String(code || '').trim();
    if (p.length !== 11) return Promise.reject(new Error('请输入正确的 11 位手机号'));
    if (!c) return Promise.reject(new Error('请输入验证码'));
    const base = getAppSafe()?.globalData?.authBaseUrl || this.BASE_URL;
    const url = `${base.replace(/\/$/, '')}/auth/phone/bind`;
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        data: { phone: p, code: c },
        success(res) {
          if (res.statusCode === 200) {
            const d = res.data;
            if (d.user) wx.setStorageSync(STORAGE_USER, d.user);
            if (d.access_token) wx.setStorageSync(STORAGE_ACCESS_TOKEN, d.access_token);
            wx.setStorageSync(STORAGE_NEED_PHONE, false);
            try {
              const app = getAppSafe();
              if (app && app.globalData) app.globalData.accessToken = d.access_token;
            } catch (e) {}
            resolve(d);
          } else {
            reject(new Error(res.data?.message || res.data?.error || '绑定失败'));
          }
        },
        fail(err) {
          reject(toError(err));
        }
      });
    });
  },

  /**
   * 微信 getPhoneNumber 预填充：把 code 发后端解密，返回手机号
   * 后端：POST /auth/wechat-mp/get-phone，Header: Authorization: Bearer <token>，Body: { code }
   * 返回：{ phone } 或 { purePhoneNumber }
   */
  getPhoneFromWechatCode(code) {
    const LOG = (msg, data) => console.log('[微信手机号]', msg, data !== undefined ? data : '');
    const token = wx.getStorageSync(STORAGE_ACCESS_TOKEN);
    if (!token) return Promise.reject(new Error('请先完成微信静默登录'));
    const base = getAppSafe()?.globalData?.authBaseUrl || this.BASE_URL;
    const url = `${base.replace(/\/$/, '')}/auth/wechat-mp/get-phone`;
    LOG('请求', { url });
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        data: { code },
        success: (res) => {
          if (res.statusCode === 200) {
            const d = res.data;
            const phone = d.phone || d.purePhoneNumber || d.phoneNumber || '';
            if (phone) {
              const normalized = this.normalizePhone(phone) || phone;
              LOG('成功', { phone: normalized.slice(0, 3) + '****' + normalized.slice(-4) });
              resolve(normalized);
            } else {
              LOG('失败', '响应无手机号', d);
              reject(new Error(d.message || d.error || '未能获取手机号'));
            }
          } else {
            LOG('失败', { status: res.statusCode, data: res.data });
            reject(new Error(res.data?.message || res.data?.error || '获取手机号失败'));
          }
        },
        fail(err) {
          LOG('请求异常', err);
          reject(toError(err));
        }
      });
    });
  },

  /** 发送验证码（Bearer 免签）：POST /api/v1/send-otp */
  sendOtpSigned(phone) {
    const LOG = (msg, data) => console.log('[发验证码]', msg, data !== undefined ? data : '');
    const token = wx.getStorageSync(STORAGE_ACCESS_TOKEN);
    if (!token) return Promise.reject(new Error('请先完成微信静默登录'));
    const p = this.normalizePhone(phone);
    if (p.length !== 11) return Promise.reject(new Error('请输入正确的 11 位手机号'));
    const base = getAppSafe()?.globalData?.authBaseUrl || this.BASE_URL;
    const url = `${base.replace(/\/$/, '')}/api/v1/send-otp`;
    LOG('请求', { url, phone: p.slice(0, 3) + '****' + p.slice(-4) });
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        data: { phone: p },
        success(res) {
          if (res.statusCode === 200) {
            LOG('成功', res.data);
            resolve(res.data);
          } else {
            LOG('失败', { status: res.statusCode, data: res.data });
            reject(new Error(res.data?.message || res.data?.error || '发送失败'));
          }
        },
        fail(err) {
          LOG('请求异常', err);
          reject(toError(err));
        }
      });
    });
  },

  /**
   * 验证码登录/注册（Bearer 免签）：POST /api/v1/verify-login
   * Body: { phone, code }，可选 openid 绑定微信账号
   * 返回: { access_token, user }
   */
  async verifyLoginSigned(phone, code, openid) {
    const LOG = (msg, data) => console.log('[手机号登录]', msg, data !== undefined ? data : '');
    const token = wx.getStorageSync(STORAGE_ACCESS_TOKEN);
    if (!token) return Promise.reject(new Error('请先完成微信静默登录'));
    const app = getAppSafe();
    const p = this.normalizePhone(phone);
    const c = String(code || '').trim();
    if (p.length !== 11) return Promise.reject(new Error('请输入正确的 11 位手机号'));
    if (!c) return Promise.reject(new Error('请输入验证码'));
    const body = { phone: p, code: c };
    if (openid) body.openid = openid;
    const base = app?.globalData?.authBaseUrl || this.BASE_URL;
    const url = `${base.replace(/\/$/, '')}/api/v1/verify-login`;
    LOG('① 请求参数', { url, phone: p.slice(0, 3) + '****' + p.slice(-4), hasOpenid: !!openid, bodyKeys: Object.keys(body) });
    const d = await new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        data: body,
        success(res) {
          if (res.statusCode === 200) {
            const raw = res.data;
            LOG('② 响应原始', {
              hasAccessToken: !!raw?.access_token,
              hasUser: !!raw?.user,
              userId: raw?.user?.id,
              userPhone: raw?.user?.phone ? raw.user.phone.slice(0, 3) + '****' : null
            });
            resolve(raw);
          } else {
            LOG('② 失败', { status: res.statusCode, data: res.data });
            reject(new Error(res.data?.message || res.data?.error || '登录失败'));
          }
        },
        fail(err) {
          LOG('② 请求异常', err);
          reject(toError(err));
        }
      });
    });
    if (d.access_token) {
      wx.setStorageSync(STORAGE_ACCESS_TOKEN, d.access_token);
      try {
        if (app && app.globalData) app.globalData.accessToken = d.access_token;
      } catch (e) {}
    }
    if (d.user) {
      wx.setStorageSync(STORAGE_USER, d.user);
      wx.setStorageSync(STORAGE_NEED_PHONE, false);
    }
    return d;
  },

  /** 带登录态的请求（后续调 GET /auth/me 等用） */
  requestWithAuth(options) {
    const token = wx.getStorageSync(STORAGE_ACCESS_TOKEN);
    const base = getAppSafe()?.globalData?.authBaseUrl || this.BASE_URL;
    return new Promise((resolve, reject) => {
      wx.request({
        ...options,
        url: (options.url && options.url.indexOf('http') === 0) ? options.url : `${base.replace(/\/$/, '')}${options.url || ''}`,
        header: {
          'Content-Type': 'application/json',
          ...(options.header || {}),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        success: resolve,
        fail(err) { reject(toError(err)); }
      });
    });
  }
};
