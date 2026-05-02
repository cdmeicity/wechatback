const auth = require('../../utils/auth.js');

Page({
  data: {
    title: '美承影院会员卡办理和充值协议',
    effectiveDate: '2026年3月5日',
    company: '承德扬天文化传媒有限公司'
  },
  onLoad() {
    if (!auth.redirectToLoginIfNeeded()) return;
  }
});
