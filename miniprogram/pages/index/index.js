const supabase = require('../../utils/supabase');
const lingshiRequest = require('../../utils/lingshiRequest');
const cardApi = require('../../utils/cardApi.js');

function formatDistance(meters) {
  if (meters == null) return '';
  if (meters < 1000) return meters.toFixed(0) + 'm';
  return (meters / 1000).toFixed(1) + 'km';
}

Page({
  data: {
    statusBarHeight: 0,
    menuTop: 0,
    menuButtonHeight: 32,
    headerRightPadding: 100,
    // 分类卡
    categoryCards: [
      { name: '影院活动', icon: 'activity', theme: 'primary' },
      { name: 'IMAX专场', icon: 'imax', theme: 'secondary' },
      { name: '会员专区', icon: 'vip', theme: 'accent' },
      { name: '卡券购买', icon: 'card', theme: 'surface' }
    ],
    // 热映影片
    hotMovies: [],
    loadingHotMovies: true,
    // 即将上映
    futureMovies: [],
    loadingFutureMovies: true,
    // 未读通知数（演示）
    totalUnreadCount: 0,
    // 影院列表（占位，暂不从 dingxin 拉取）
    cinemaList: [],
    currentCinema: null,
    loadingCinema: false,
    // 底部导航：主页、餐食、IMAX、订单、我的；IMAX 无图标（餐食暂时隐藏）
    navItems: [
      { key: 'home', name: '主页', icon: '/images/nav-home.svg', iconActive: '/images/nav-home-active.svg', path: '/pages/index/index', active: true },
      // { key: 'food', name: '餐食', icon: '/images/nav-popcorn.svg', iconActive: '/images/nav-popcorn-active.svg', path: '/pages/food/food', active: false },
      { key: 'imax', name: 'IMAX', icon: '', iconActive: '', path: '/pages/imax/imax', active: false },
      { key: 'order', name: '订单', icon: '/images/nav-order.svg', iconActive: '/images/nav-order-active.svg', path: '/pages/order/order', active: false },
      { key: 'user', name: '我的', icon: '/images/nav-user.svg', iconActive: '/images/nav-user-active.svg', path: '/pages/user/user', active: false }
    ]
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 0,
      menuTop: menu.top || sys.statusBarHeight || 0,
      menuButtonHeight: menu.height || 32,
      headerRightPadding: sys.windowWidth - (menu.left || sys.windowWidth - 100) + 8
    });
    this.loadNearCinemaList().then(() => this.loadMovies());

    const app = getApp();
    const gd = app.globalData || {};
    if (!gd.indexImportantTipShown) {
      gd.indexImportantTipShown = true;
      wx.showModal({
        title: '重要提示',
        content: '美承影院微信小程序全新上线，正在测试中，如果有使用中的问题，请在我的-问题反馈-进行反馈！感谢您的支持！美承影业全体员工祝您马年快乐，身体健康，观影愉快！',
        showCancel: false,
        confirmText: '知道了'
      });
    }
  },

  onShow() {
    const app = getApp();
    const gd = app.globalData || {};
    const u = gd.supabaseUser;
    console.log('[主页日志] 状态汇总', {
      sessionReady: gd.sessionReady,
      supabaseUser: u ? `有(id=${u.id || '-'})` : '无',
      cardinfo: gd.cardinfo ? '有' : '无'
    });
    if (gd.sessionReady && u?.id) {
      this._refreshAppCardInfo();
    }
  },

  /**
   * 首页加载时查询用户拥有的会员卡信息，用 card_detail 拉取最新详情并更新 app.globalData.cardinfo，
   * 以便 card-manage、mypage 等页能正确显示会员卡详情。
   */
  async _refreshAppCardInfo() {
    const app = getApp();
    const userId = app?.globalData?.supabaseUser?.id;
    if (!userId) return;
    try {
      const bindCard = await supabase.getUserMemberCard(userId);
      if (!bindCard || !bindCard.cardNumber) {
        app.globalData.cardinfo = null;
        return;
      }
      app.globalData.cardinfo = bindCard;
      const cid = app?.globalData?.cinemainfo?.cinemaid
        || app?.globalData?.cinemainfo?.cinemaNumber
        || app?.globalData?.cinemainfo?.id;
      if (!cid) return;
      const res = await cardApi.getCardDetail(cid, bindCard.cardNumber);
      const detail = cardApi.parseCardDetailResponse(res);
      if (!detail || typeof detail !== 'object') return;
      const validity = detail.period || detail.validity || detail.validDate || detail.expireDate || detail.expire_time || detail.endDate || null;
      const balanceVal = detail.balance ?? detail.money;
      const pointsVal = detail.availableJifen ?? detail.points ?? detail.integral;
      const discountVal = detail.discount != null && detail.discount !== '' ? detail.discount : null;
      const discountDisplay = discountVal != null ? (() => {
        const n = Number(discountVal);
        return (Number.isInteger(n) ? n : n) + '%';
      })() : null;
      const cardinfo = {
        cardNumber: detail.cardNumber || detail.card_number || bindCard.cardNumber,
        cardName: detail.cardLevel || detail.cardName || detail.levelName || bindCard.cardName || '会员卡',
        balance: balanceVal != null && balanceVal !== '' ? parseFloat(balanceVal) : bindCard.balance,
        points: pointsVal != null && pointsVal !== '' ? parseInt(pointsVal, 10) : bindCard.points,
        minAddMoney: cardApi.getMinAddMoneyFromDetail(detail) ?? bindCard.minAddMoney,
        validity: validity != null && validity !== '' ? String(validity) : bindCard.validity,
        discount: discountVal != null ? discountVal : bindCard.discount,
        discountDisplay: discountDisplay || bindCard.discountDisplay,
        mobile: detail.mobile || null,
        phone: bindCard.phone
      };
      app.globalData.cardinfo = cardinfo;
      console.log('[主页] 已刷新 app.cardinfo', { cardNumber: cardinfo.cardNumber, balance: cardinfo.balance, minAddMoney: cardinfo.minAddMoney });
    } catch (e) {
      console.warn('[主页] _refreshAppCardInfo 失败', e);
    }
  },

  onPullDownRefresh() {
    this.loadNearCinemaList().then(() => this.loadMovies()).then(() => wx.stopPullDownRefresh());
  },

  /** 分享给好友：不定义则右上角菜单不出现「转发」 */
  onShareAppMessage() {
    return {
      title: '美承影院 - 选座购票，畅享观影',
      path: '/pages/index/index'
    };
  },

  /** 分享到朋友圈（可选） */
  onShareTimeline() {
    return {
      title: '美承影院 - 选座购票，畅享观影',
      query: ''
    };
  },

  async loadNearCinemaList() {
    this.setData({ loadingCinema: true });
    const DEFAULT_LAT = 47.0;
    const DEFAULT_LNG = 117.0;
    let lat = DEFAULT_LAT;
    let lng = DEFAULT_LNG;
    try {
      const loc = await new Promise((resolve, reject) => {
        wx.getLocation({
          type: 'wgs84',
          success: resolve,
          fail: reject
        });
      });
      lat = loc.latitude;
      lng = loc.longitude;
    } catch (err) {
      if (err.errMsg && err.errMsg.includes('auth deny')) {
        wx.showToast({ title: '使用默认位置测试', icon: 'none' });
      }
    }
    try {
      const list = await supabase.getNearCinemaList(lat, lng, 20);
      const cinemaList = list || [];
      const cinemaListWithDist = cinemaList.map(c => Object.assign({}, c, { displayDistance: formatDistance(c.distance_meters) }));
      const first = cinemaListWithDist[0];
      const currentCinema = first || null;
      // 更新 app.globalData.cinemainfo 为第一条影院的所有字段
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.cinemainfo = first ? Object.assign({}, first) : null;
      }
      this.setData({
        cinemaList: cinemaListWithDist,
        currentCinema,
        loadingCinema: false
      });
      if (app?.globalData?.supabaseUser?.id) {
        this._refreshAppCardInfo();
      }
    } catch (err) {
      this.setData({ loadingCinema: false });
      wx.showToast({ title: '获取影院失败', icon: 'none' });
    }
  },

  onCinemaSelect() {
    const { cinemaList } = this.data;
    if (!cinemaList || cinemaList.length === 0) {
      wx.showToast({ title: '暂无影院列表', icon: 'none' });
      return;
    }
    const names = cinemaList.map(c => `${c.name} (${c.displayDistance || formatDistance(c.distance_meters)})`);
    wx.showActionSheet({
      itemList: names,
      success: (res) => {
        const selected = cinemaList[res.tapIndex];
        this.setData({ currentCinema: selected });
        const app = getApp();
        if (app && app.globalData && selected) {
          app.globalData.cinemainfo = Object.assign({}, selected);
        }
        this.loadMovies(); // 切换影院后重新加载热映/即将上映
      }
    });
  },

  async loadMovies() {
    const app = getApp();
    const cinemaNumber = app && app.globalData && app.globalData.cinemainfo
      ? app.globalData.cinemainfo.cinemaNumber
      : null;
    this.setData({ loadingHotMovies: true, loadingFutureMovies: true });
    try {
      const results = await Promise.all([
        supabase.movies(cinemaNumber).then(list => list || []),
        lingshiRequest.getFutureMovies().catch(() => [])
      ]);
      const hot = results[0] || [];
      const future = results[1] || [];
      const today = new Date().toISOString().slice(0, 10);
      const hotFiltered = hot.filter(m => (m.release_date || '') <= today);
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.hotMovies = hotFiltered.slice();
      }
      this.setData({
        hotMovies: hotFiltered,
        futureMovies: future,
        loadingHotMovies: false,
        loadingFutureMovies: false
      });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loadingHotMovies: false, loadingFutureMovies: false });
    }
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/movie-search/movie-search' });
  },

  goNotification() {
    wx.navigateTo({ url: '/pages/notification/notification' });
  },

  goMovie(e) {
    const id = e.currentTarget.dataset.id;
    const { hotMovies, futureMovies } = this.data;
    const movie = hotMovies.find(m => String(m.id) === String(id))
      || futureMovies.find(m => String(m.id) === String(id));
    const app = getApp();
    if (app && app.globalData && movie) {
      app.globalData.currentMovie = Object.assign({}, movie);
    }
    wx.navigateTo({ url: '/pages/movieinfo/movieinfo' });
  },

  onCategoryTap(e) {
    const name = e.currentTarget.dataset.name;
    if (name === '会员专区') {
      wx.navigateTo({ url: '/pages/card-manage/card-manage' });
    } else if (name === 'IMAX专场') {
      wx.navigateTo({ url: '/pages/imax/imax' });
    } else {
      wx.showToast({ title: name + ' 开发中', icon: 'none' });
    }
  },

  onNavTap(e) {
    const index = e.currentTarget.dataset.index;
    const items = this.data.navItems;
    if (items[index].active) return;
    const path = items[index].path;
    if (path === '/pages/food/food') {
      wx.showToast({ title: '餐食功能开发中', icon: 'none' });
      return;
    }
    const newItems = items.map((it, i) => Object.assign({}, it, { active: i === index }));
    this.setData({ navItems: newItems });
    if (path === '/pages/index/index') return;
    wx.navigateTo({ url: path });
  }
});
