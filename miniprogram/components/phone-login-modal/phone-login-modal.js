/**
 * 手机号+验证码登录弹窗组件
 * 职责：完成 Supabase 手机号+验证码登录
 * 成功后：设置 supabaseUser、查询 user_member_cards、写入 cardinfo、触发 success
 */
const auth = require('../../utils/auth.js');
const supabase = require('../../utils/supabase.js');
const cardApi = require('../../utils/cardApi.js');

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  data: {
    phone: '',
    code: '',
    countdown: 0,
    otpSent: false,
    agreedToTerms: false,
    errorMessage: '',
    sendingCode: false,
    verifying: false
  },

  observers: {
    'show': function (val) {
      if (val) {
        this._resetForm();
      }
    }
  },

  methods: {
    _resetForm() {
      this.setData({
        phone: '',
        code: '',
        countdown: 0,
        otpSent: false,
        agreedToTerms: false,
        errorMessage: '',
        sendingCode: false,
        verifying: false
      });
    },

    onClose() {
      this.triggerEvent('close');
    },

    preventTouch() {},

    onPhoneInput(e) {
      const v = e.detail && e.detail.value;
      const phoneStr = (v !== undefined && v !== null ? String(v) : '').replace(/\D/g, '').slice(0, 11);
      this.setData({ phone: phoneStr, errorMessage: '' });
    },

    onCodeInput(e) {
      const v = e.detail && e.detail.value;
      const codeStr = (v !== undefined && v !== null ? String(v) : '').replace(/\D/g, '').slice(0, 6);
      this.setData({ code: codeStr, errorMessage: '' });
    },

    async onSendCode() {
      const { phone } = this.data;
      if (this.data.countdown > 0 || this.data.sendingCode) return;
      this.setData({ sendingCode: true, errorMessage: '' });
      try {
        await auth.sendOtpSigned(phone);
        this.setData({ sendingCode: false, otpSent: true, countdown: 60 });
        this._startCountdown();
        wx.showToast({ title: '验证码已发送', icon: 'none' });
      } catch (e) {
        this.setData({
          sendingCode: false,
          errorMessage: e.message || '发送失败'
        });
      }
    },

    _startCountdown() {
      let c = 60;
      const t = setInterval(() => {
        c--;
        this.setData({ countdown: c });
        if (c <= 0) clearInterval(t);
      }, 1000);
    },

    onAgreeChange() {
      this.setData({
        agreedToTerms: !this.data.agreedToTerms,
        errorMessage: ''
      });
    },

    onOpenServiceAgreement() {
      wx.navigateTo({ url: '/pages/agreement-service/agreement-service' });
    },

    onOpenPrivacyAgreement() {
      wx.navigateTo({ url: '/pages/agreement-privacy/agreement-privacy' });
    },

    async onVerify() {
      const { phone, code, agreedToTerms } = this.data;
      if (!agreedToTerms) {
        this.setData({ errorMessage: '请先同意用户服务协议和隐私协议' });
        return;
      }
      this.setData({ verifying: true, errorMessage: '' });
      try {
        const openid = auth.getUser()?.openid || getApp().globalData?.wxProfile?.openid;
        const data = await auth.verifyLoginSigned(phone, code, openid);
        this.setData({ verifying: false });
        if (data.user) auth.setUser(data.user);

        const app = getApp();
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
          if (cardinfo && cardinfo.cardNumber) {
            try {
              const cid = app.globalData.cinemainfo?.cinemaid || app.globalData.cinemainfo?.cinemaNumber || app.globalData.cinemainfo?.id;
              if (cid) {
                const res = await cardApi.getCardDetail(cid, cardinfo.cardNumber);
                const detail = cardApi.parseCardDetailResponse(res);
                if (detail) {
                  const validity = detail.period || detail.validity || detail.validDate || detail.expireDate || detail.expire_time || detail.endDate || null;
                  const balanceVal = detail.balance ?? detail.money;
                  const pointsVal = detail.availableJifen ?? detail.points ?? detail.integral;
                  const discountVal = detail.discount != null && detail.discount !== '' ? detail.discount : null;
                  const n = discountVal != null ? Number(discountVal) : NaN;
                  const discountDisplay = !isNaN(n) ? (n + '%') : null;
                  cardinfo = {
                    cardNumber: detail.cardNumber || detail.card_number || cardinfo.cardNumber,
                    cardName: detail.cardLevel || detail.cardName || detail.levelName || cardinfo.cardName || '会员卡',
                    balance: balanceVal != null && balanceVal !== '' ? parseFloat(balanceVal) : cardinfo.balance,
                    points: pointsVal != null && pointsVal !== '' ? parseInt(pointsVal, 10) : cardinfo.points,
                    minAddMoney: cardApi.getMinAddMoneyFromDetail(detail) ?? cardinfo.minAddMoney,
                    validity: validity != null && validity !== '' ? String(validity) : cardinfo.validity,
                    discount: discountVal != null ? discountVal : cardinfo.discount,
                    discountDisplay: discountDisplay || cardinfo.discountDisplay,
                    mobile: detail.mobile || null,
                    phone: cardinfo.phone
                  };
                  app.globalData.cardinfo = cardinfo;
                }
              }
            } catch (e) {
              console.warn('[phone-login-modal] card_detail 拉取失败，使用绑定信息', e);
            }
          }
        } else {
          app.globalData.cardinfo = null;
        }

        this.triggerEvent('success', { supabaseUser, cardinfo });
        wx.showToast({ title: '登录成功', icon: 'success' });
      } catch (e) {
        this.setData({
          verifying: false,
          errorMessage: e.message || '登录失败，请重试'
        });
      }
    }
  }
});
