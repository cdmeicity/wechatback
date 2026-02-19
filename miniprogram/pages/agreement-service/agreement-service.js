const auth = require('../../utils/auth.js');

Page({
  data: {
    title: '美承影院用户服务协议',
    effectiveDate: '2026年2月9日',
    company: '承德扬天文化传媒有限公司'
  },
  onLoad() {
    if (!auth.redirectToLoginIfNeeded()) return;
  }
});
