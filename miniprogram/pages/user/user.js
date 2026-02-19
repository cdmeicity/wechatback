const auth = require('../../utils/auth.js');
const cardApi = require('../../utils/cardApi.js');

Page({
  data: {
    nickname: '',
    phone: '',
    avatarUrl: '',
    cardInfo: null,
    isLoggedIn: false,
    showGetPhoneModal: false,
    categoryCards: [
      { name: '卡券管理', icon: '/images/icon-gift-card.svg' },
      { name: '问题反馈', icon: '/images/icon-users.svg' }
      // 可再恢复 2 个凑齐 4 个卡片，如：实名认证送生日票、合作影院购票
    ],
    // 餐食入口暂时隐藏
    navItems: [
      { key: 'home', name: '主页', icon: '/images/nav-home.svg', iconActive: '/images/nav-home-active.svg', path: '/pages/index/index', active: false },
      // { key: 'food', name: '餐食', icon: '/images/nav-popcorn.svg', iconActive: '/images/nav-popcorn-active.svg', path: '/pages/food/food', active: false },
      { key: 'imax', name: 'IMAX', icon: '', iconActive: '', path: '/pages/imax/imax', active: false },
      { key: 'order', name: '订单', icon: '/images/nav-order.svg', iconActive: '/images/nav-order-active.svg', path: '/pages/order/order', active: false },
      { key: 'user', name: '用户', icon: '/images/nav-user.svg', iconActive: '/images/nav-user-active.svg', path: '/pages/user/user', active: true }
    ]
  },

  onLoad() {
    this._setNavActive('user');
  },

  onShow() {
    const token = auth.getAccessToken();
    const storedUser = auth.getUser();
    if (!token || !storedUser) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const phone = (storedUser.phone || storedUser.mobile || '').toString().trim();
    if (!phone) {
      this.setData({ showGetPhoneModal: true });
      this.refreshUser();
      return;
    }
    this.refreshUser();
  },

  onGetPhoneModalClose() {
    this.setData({ showGetPhoneModal: false });
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onGetPhoneModalSuccess() {
    this.setData({ showGetPhoneModal: false });
    this.refreshUser();
  },

  refreshUser() {
    const app = getApp();
    const gd = app?.globalData || {};
    const u = gd.supabaseUser || null;
    const cardinfo = gd.cardinfo || null;

    const nickname = u?.nickname || '';
    const phone = u?.phone || u?.mobile || '';
    const avatarUrl = u?.avatar || u?.avatarUrl || '';

    const cardInfo = cardinfo ? {
      ...cardinfo,
      cardStatusDisplay: cardApi.getCardStatusText(cardinfo.cardStatus)
    } : null;
    this.setData({
      nickname,
      phone,
      avatarUrl,
      cardInfo,
      isLoggedIn: u != null
    });
  },

  _setNavActive(key) {
    const items = this.data.navItems.map(it => ({
      ...it,
      active: it.key === key
    }));
    this.setData({ navItems: items });
  },

  onEditProfile() {
    // wx.showToast({ title: '编辑资料功能开发中', icon: 'none' });
    // 点击头像/昵称区域无反应，仅保留原有 UI
  },

  onMembershipCardTap() {
    const card = this.data.cardInfo;
    wx.navigateTo({
      url: '/pages/card-manage/card-manage?initialTab=' + (card && card.cardNumber ? 1 : 0)
    });
  },

  onCategoryTap(e) {
    const name = e.currentTarget.dataset.name;
    if (name === '问题反馈') {
      wx.navigateTo({ url: '/pages/feedback/feedback' });
      return;
    }
    if (name === '卡券管理') {
      const u = getApp()?.globalData?.supabaseUser;
      const userId = (u && (u.id || u.user_id || u.userId)) || null;
      if (!userId) {
        wx.showToast({ title: '请先登录后查看券列表', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: '/pages/coupon-list/coupon-list' });
      return;
    }
    wx.showToast({ title: name + ' 开发中', icon: 'none' });
  },

  onPrivacy() {
    wx.showToast({ title: '隐私政策功能开发中', icon: 'none' });
  },

  onTerms() {
    wx.showToast({ title: '服务条款功能开发中', icon: 'none' });
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      confirmText: '退出',
      confirmColor: '#FE4A49',
      success: (res) => {
        if (res.confirm) {
          this._doLogout();
        }
      }
    });
  },

  async _doLogout() {
    wx.showLoading({ title: '退出中...' });
    const app = getApp();
    try {
      await auth.logout();
    } catch (e) {
      // 即使后端失败也清除本地（auth.logout 的 fail 已调用 _clearLocalAuth）
    }
    if (app?.globalData) {
      app.globalData.supabaseUser = null;
      app.globalData.userinfo = null;
      app.globalData.cardinfo = null;
      app.globalData.manualLogout = true;
      app.globalData.sessionReady = true;
    }
    console.log('[退出登录] 完成', { supabaseUser: app?.globalData?.supabaseUser, manualLogout: app?.globalData?.manualLogout });
    wx.hideLoading();
    wx.showToast({ title: '已退出登录', icon: 'success' });
    this.refreshUser();
    // 退出登录后跳转到登录页
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/login/login' });
    }, 500);
  },

  onNavTap(e) {
    const index = e.currentTarget.dataset.index;
    const items = this.data.navItems;
    const item = items[index];
    if (item?.active) return;
    const path = item?.path;
    this._setNavActive(item?.key || '');
    if (path && path !== '/pages/user/user') {
      wx.redirectTo({ url: path });
    }
  }
});
