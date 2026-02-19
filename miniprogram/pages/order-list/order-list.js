const auth = require('../../utils/auth.js');

Page({
  data: { orders: [] },
  onLoad() {
    if (!auth.redirectToLoginIfNeeded()) return;
    wx.showToast({ title: '订单列表开发中', icon: 'none' });
  }
});
