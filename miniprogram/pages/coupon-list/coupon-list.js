/**
 * 券列表页：仅登录用户可进入
 * 查询逻辑：用当前微信 openid 查 user_profiles 得到 user_id，再用 user_id 和/或 app.userinfo.phone 查 coupon_instance，有哪个用哪个
 */
const supabase = require('../../utils/supabase.js');
const auth = require('../../utils/auth.js');
const dateHelper = require('../../utils/dateHelper.js');

function maskCouponCode(code) {
  if (!code || typeof code !== 'string') return '****';
  const s = String(code).trim();
  if (s.length <= 4) return '****';
  if (s.length <= 8) return s.slice(0, 2) + '****' + s.slice(-2);
  return s.slice(0, 4) + '****' + s.slice(-4);
}

function normalizePhone(v) {
  if (v == null) return '';
  const s = String(v).trim().replace(/\D/g, '');
  return s.length >= 11 && s.slice(-11).startsWith('1') ? s.slice(-11) : s;
}

Page({
  data: {
    list: [],
    loading: true,
    isLoggedIn: false
  },

  onLoad() {
    this._checkAndLoad();
  },

  onShow() {
    this._checkAndLoad();
  },

  _getUserPhone() {
    const app = getApp();
    const gd = app?.globalData || {};
    const u = gd.userinfo || gd.supabaseUser || null;
    const raw = (u && (u.phone || u.mobile)) || '';
    return normalizePhone(raw);
  },

  _getOpenid() {
    const gd = getApp()?.globalData || {};
    return (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
  },

  _checkAndLoad() {
    const openid = this._getOpenid();
    const phone = this._getUserPhone();
    if (!openid && !phone) {
      this.setData({ isLoggedIn: false, loading: false, list: [] });
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ isLoggedIn: true, loading: true });
    this._loadList();
  },

  _loadList() {
    const self = this;
    const openid = this._getOpenid();
    const phone = this._getUserPhone();

    const done = (rows) => {
      const list = (rows || []).map((row) => ({
        id: row.id,
        couponCode: row.coupon_code || '',
        couponCodeMasked: maskCouponCode(row.coupon_code),
        validTo: row.valid_to,
        validToStr: dateHelper.formatBeijingTime(row.valid_to, 'YYYY-MM-DD HH:mm'),
        status: row.status || 'available',
        createdAt: row.created_at
      }));
      self.setData({ list, loading: false });
    };

    // 1) 用 openid 查 user_profiles，取 user_id
    const promiseProfile = openid
      ? supabase.getUserProfileByOpenid(openid)
      : Promise.resolve(null);

    promiseProfile
      .then((profile) => {
        const userId = (profile && profile.user_id) ? String(profile.user_id).trim() : null;
        console.log('[coupon-list] openid→user_profiles.user_id', { openid: openid ? '有' : '无', userId: userId || null, phone: phone || null });
        if (!userId && !phone) {
          self.setData({ list: [], loading: false });
          return;
        }
        return supabase.getCouponListForUser(userId, phone).then(done);
      })
      .catch(() => {
        self.setData({ loading: false, list: [] });
      });
  },

  onAddBind() {
    const openid = this._getOpenid();
    const phone = this._getUserPhone();
    if (!openid && !phone) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/coupon-bind/coupon-bind' });
  },

  onGoLogin() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/user' }) });
  }
});
