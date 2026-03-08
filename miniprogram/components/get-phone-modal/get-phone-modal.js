/**
 * 微信手机号授权弹窗：与登录页一致的协议勾选 + getPhoneNumber
 * 成功：bindPhoneWithWechatCode → applyBindPhoneResult，triggerEvent('success')
 */
const auth = require('../../utils/auth.js');

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  data: {
    agreedToTerms: false,
    showDenyTip: false
  },

  observers: {
    show(val) {
      if (!val) {
        this.setData({ agreedToTerms: false, showDenyTip: false });
      }
    }
  },

  methods: {
    preventTouch() {},

    onClose() {
      this.triggerEvent('close');
    },

    onAgreeChange() {
      const next = !this.data.agreedToTerms;
      this.setData({ agreedToTerms: next });
    },

    onOpenServiceAgreement() {
      wx.navigateTo({ url: '/pages/agreement-service/agreement-service' });
    },

    onOpenPrivacyAgreement() {
      wx.navigateTo({ url: '/pages/agreement-privacy/agreement-privacy' });
    },

    /** 未勾选协议时点击：弹窗提示，同意则勾选并提示再次点击按钮 */
    onAgreementRequired() {
      if (this.data.agreedToTerms) return;
      wx.showModal({
        title: '温馨提示',
        content: '请先阅读并同意《用户服务协议》和《隐私政策》后再使用手机号快捷登录。同意后将自动勾选协议，请再次点击上方按钮完成授权。',
        confirmText: '同意',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.setData({ agreedToTerms: true });
            wx.showToast({ title: '请再次点击上方按钮完成授权', icon: 'none', duration: 2500 });
          }
        }
      });
    },

    async onGetPhoneNumber(e) {
      const errMsg = e.detail && e.detail.errMsg;
      const code = e.detail && e.detail.code;

      if (errMsg !== 'getPhoneNumber:ok') {
        this.setData({ showDenyTip: true });
        wx.showToast({ title: '需要授权手机号才能继续', icon: 'none' });
        return;
      }
      if (!code) {
        wx.showToast({ title: '未获取到授权信息，请重试', icon: 'none' });
        return;
      }

      let token = auth.getAccessToken();
      if (!token) {
        wx.showLoading({ title: '登录中...' });
        try {
          await auth.silentLogin();
          token = auth.getAccessToken();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '请先完成微信登录', icon: 'none' });
          return;
        }
        wx.hideLoading();
        if (!token) {
          wx.showToast({ title: '请先完成微信登录', icon: 'none' });
          return;
        }
      }

      wx.showLoading({ title: '绑定中...' });
      try {
        const data = await auth.bindPhoneWithWechatCode(code);
        await auth.applyBindPhoneResult(data);
        wx.hideLoading();
        wx.showToast({ title: '绑定成功', icon: 'success' });
        this.triggerEvent('success');
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || '绑定失败，请重试', icon: 'none' });
      }
    }
  }
});
