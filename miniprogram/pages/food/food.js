const auth = require('../../utils/auth.js');

Page({
  data: {},
  onLoad() {
    if (!auth.redirectToLoginIfNeeded()) return;
    wx.showToast({ title: '餐食专区开发中', icon: 'none' });
  }
});
