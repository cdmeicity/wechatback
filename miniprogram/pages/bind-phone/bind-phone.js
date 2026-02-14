/**
 * 绑定手机号页面（手机号+验证码）
 * 静默登录后 need_phone 为 true 时进入
 * 成功后设置 supabaseUser、查询 user_member_cards 写入 cardinfo
 */
const auth = require('../../utils/auth.js');
const supabase = require('../../utils/supabase.js');

Page({
  data: {
    phone: '',
    code: '',
    countdown: 0
  },

  onLoad(options) {
    this.options = options || {};
  },

  onClose() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  onPhoneInput(e) {
    this.setData({ phone: (e.detail.value || '').replace(/\D/g, '').slice(0, 11) });
  },

  onCodeInput(e) {
    this.setData({ code: (e.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },

  async onSendCode() {
    const { phone } = this.data;
    if (this.data.countdown > 0) return;
    try {
      await auth.sendOtpSigned(phone);
      wx.showToast({ title: '验证码已发送', icon: 'none' });
      let n = 60;
      this.setData({ countdown: n });
      const t = setInterval(() => {
        n--;
        this.setData({ countdown: n });
        if (n <= 0) clearInterval(t);
      }, 1000);
    } catch (e) {
      wx.showToast({ title: e.message || '发送失败', icon: 'none' });
    }
  },

  async onBind() {
    const { phone, code } = this.data;
    const LOG = (step, data) => console.log('[bind-phone]', step, data !== undefined ? data : '');
    try {
      const app = getApp();
      const openid = auth.getUser()?.openid || app.globalData?.wxProfile?.openid;
      LOG('调用 verify-login', { phone: phone.slice(0, 3) + '****', hasOpenid: !!openid });
      const data = await auth.verifyLoginSigned(phone, code, openid);
      if (data.user) auth.setUser(data.user);
      // 与 public.users 对齐：user_id 来自 users.id，phone 来自 users.phone
      const userId = data.user?.id ?? null;
      const userPhone = data.user?.phone ?? data.user?.mobile ?? null;
      const supabaseUser = data.user ? {
        id: userId,
        userId,
        user_id: userId,
        phone: userPhone,
        ...data.user
      } : null;
      app.globalData.supabaseUser = supabaseUser;
      app.globalData.userinfo = supabaseUser;
      app.globalData.manualLogout = false;
      auth.setPhoneLoginDone();
      let cardinfo = null;
      if (supabaseUser?.id) {
        cardinfo = await supabase.getUserMemberCard(supabaseUser.id);
        app.globalData.cardinfo = cardinfo || null;
      } else {
        app.globalData.cardinfo = null;
      }
      LOG('supabaseUser 已更新', { userId: supabaseUser?.id, phone: supabaseUser?.phone });
      wx.showToast({ title: '绑定成功', icon: 'success' });
      const fromPlay = !!(this.options && this.options.from === 'play');
      setTimeout(() => {
        if (fromPlay) {
          wx.navigateBack();
        } else {
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }, 1500);
    } catch (e) {
      wx.showToast({ title: e.message || '绑定失败', icon: 'none' });
    }
  }
});
