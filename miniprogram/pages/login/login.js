/**
 * 登录页：仅微信静默登录 + Supabase 静默登录及相关流程，完成后跳主页
 * 获取微信手机号改到排期页（IMAX/Play 点击场次）、订单页、我的页再弹窗
 */
const auth = require('../../utils/auth.js');
const supabase = require('../../utils/supabase.js');

const LOG = (step, detail) => console.log('[登录页]', step, detail !== undefined ? detail : '');

Page({
  data: {
    loading: true
  },

  onLoad() {
    const token = auth.getAccessToken();
    const storedUser = auth.getUser();
    LOG('onLoad', { hasToken: !!token, hasUser: !!storedUser });
    if (token && storedUser) {
      LOG('已有 token 和 user，恢复 session 后跳主页');
      this._completeSessionAndGoHome();
      return;
    }
    LOG('无 token，触发静默登录', {});
    this._doSilentLogin();
  },

  /** 静默登录（微信静默登录）；成功后恢复 session 并跳主页 */
  async _doSilentLogin() {
    LOG('静默登录', '开始');
    try {
      const result = await auth.silentLogin();
      LOG('静默登录', '结束', { ok: result.ok, needPhone: result.needPhone, hasUser: !!result.user, userId: result.user?.id ?? '-' });
      if (!result.ok) {
        console.warn('[登录页] 静默登录未返回 ok', result);
        this.setData({ loading: false });
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        return;
      }
      if (result.user) {
        LOG('静默登录成功，恢复 session 并跳主页');
        this._completeSessionAndGoHome();
      } else {
        this.setData({ loading: false });
      }
    } catch (e) {
      console.warn('[登录页] 静默登录异常', e && e.message);
      LOG('静默登录', '异常', { message: e && e.message });
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.message) || '登录异常，请重试', icon: 'none' });
    }
  },

  /** 恢复 session（supabaseUser / userinfo / cardinfo）并跳转主页 */
  async _completeSessionAndGoHome() {
    const app = getApp();
    const storedUser = auth.getUser();
    const userId = storedUser?.id ?? storedUser?.user_id ?? storedUser?.userId ?? null;
    const userPhone = (storedUser?.phone || storedUser?.mobile || '').toString().trim() || null;
    const supabaseUser = {
      id: userId,
      userId,
      user_id: userId,
      phone: userPhone,
      ...storedUser
    };
    LOG('恢复 session', { userId: supabaseUser.id, phone: userPhone ? userPhone.slice(0, 3) + '****' : null });
    app.globalData.supabaseUser = supabaseUser;
    app.globalData.userinfo = supabaseUser;
    app.globalData.manualLogout = false;
    auth.setPhoneLoginDone();
    if (userId) {
      try {
        const cardinfo = await supabase.getUserMemberCard(userId);
        app.globalData.cardinfo = cardinfo || null;
        LOG('cardinfo 已恢复', { hasCard: !!cardinfo });
      } catch (e) {
        console.warn('[登录页] 拉取会员卡失败', e);
        app.globalData.cardinfo = null;
      }
    } else {
      app.globalData.cardinfo = null;
    }
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
