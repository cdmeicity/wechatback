/**
 * 新绑券：输入券码绑定到当前登录用户
 */
const supabase = require('../../utils/supabase.js');

Page({
  data: {
    couponCode: '',
    submitting: false
  },

  onLoad() {
    const userId = this._getUserId();
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/user' }) }), 1500);
    }
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
    this.setData({ submitting: true });
    const self = this;
    supabase
      .bindCoupon(userId, code)
      .then(() => {
        wx.showToast({ title: '绑定成功', icon: 'success' });
        self.setData({ submitting: false, couponCode: '' });
        setTimeout(() => wx.navigateBack(), 1500);
      })
      .catch((err) => {
        self.setData({ submitting: false });
        wx.showToast({ title: (err && err.message) || '绑定失败', icon: 'none' });
      });
  }
});
