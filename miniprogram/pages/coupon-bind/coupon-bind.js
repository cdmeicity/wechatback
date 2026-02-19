/**
 * 新绑券：输入券码绑定到当前登录用户
 * 先调券详情，couponAvailable=1 才能绑定，否则提示券状态不正确
 */
const supabase = require('../../utils/supabase.js');
const couponApi = require('../../utils/couponApi.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    couponCode: '',
    submitting: false
  },

  onLoad() {
    if (!auth.redirectToLoginIfNeeded()) return;
  },

  /** 优先从 app.globalData.userinfo 取，否则从 supabaseUser 取 */
  _getUserId() {
    const app = getApp();
    const gd = app?.globalData || {};
    const u = gd.userinfo || gd.supabaseUser || null;
    return (u && (u.user_id || u.id || u.userId)) || null;
  },

  onCodeInput(e) {
    this.setData({ couponCode: (e.detail && e.detail.value) || '' });
  },

  onSubmit() {
    const userId = this._getUserId();
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const code = String(this.data.couponCode || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入券码', icon: 'none' });
      return;
    }
    const cinemainfo = getApp()?.globalData?.cinemainfo || {};
    const cid = (cinemainfo.cinemaid || cinemainfo.cinemaNumber || cinemainfo.cinema_number || '').toString().trim();
    if (!cid) {
      wx.showToast({ title: '当前无影院信息，无法校验券', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    const self = this;
    couponApi
      .getCouponDetail(cid, code)
      .then((detail) => {
        const avail = detail.couponAvailable ?? detail.coupon_available;
        if (Number(avail) !== 1) {
          return Promise.reject(new Error('券状态不正确'));
        }
        return supabase.bindCoupon(userId, code);
      })
      .then(() => {
        wx.showToast({ title: '绑定成功', icon: 'success' });
        self.setData({ submitting: false, couponCode: '' });
        setTimeout(() => wx.navigateBack(), 1500);
      })
      .catch((err) => {
        self.setData({ submitting: false });
        const msg = (err && err.message) || '';
        if (msg.indexOf('券') !== -1 || msg.indexOf('不可用') !== -1) {
          wx.showToast({ title: '券状态不正确，不能绑定', icon: 'none' });
        } else {
          wx.showToast({ title: msg || '绑定失败', icon: 'none' });
        }
      });
  }
});
