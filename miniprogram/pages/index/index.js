const supabase = require('../../utils/supabase');
const lingshiRequest = require('../../utils/lingshiRequest');
const cardApi = require('../../utils/cardApi.js');
const auth = require('../../utils/auth.js');
const noticeReadStorage = require('../../utils/noticeReadStorage.js');

const STORAGE_KEY_PREFIX = 'index_notice_ack_';

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
      { name: '卡券管理', icon: 'card', theme: 'surface' }
    ],
    // 热映影片
    hotMovies: [],
    loadingHotMovies: true,
    // 即将上映
    futureMovies: [],
    loadingFutureMovies: true,
    // 未读通知数（演示）
    totalUnreadCount: 0,
    // 首页通知弹窗（来自 new_notice 表）
    showNoticeModal: false,
    noticeContent: '',
    noticeId: null,
    noticeList: [],      // type=event 列表，用于上一条/下一条
    noticeCurrentIndex: 0,
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
    this.loadNearCinemaList().then(() => {
      this.loadMovies();
      this._fetchAndShowNotice();
      this._refreshNoticeUnreadCount();
    });
  },

  /** 刷新首页通知图标未读数（通知中心用 noticeReadStorage 统计） */
  _refreshNoticeUnreadCount() {
    const app = getApp();
    const gd = app?.globalData || {};
    const cinemainfo = gd.cinemainfo || null;
    // new_notice.cinema_id 存的是影院编号，与 cinemaNumber/cinema_code 对应
    const cinemaId = cinemainfo && (cinemainfo.cinemaNumber || cinemainfo.cinema_num || cinemainfo.cinema_code || cinemainfo.cinemaid || cinemainfo.cinema_id);
    const cid = cinemaId != null ? String(cinemaId).trim() : '';
    supabase.getNoticeList(cid, 'wechat', null)
      .then(list => {
        const count = noticeReadStorage.getUnreadCount(list || []);
        this.setData({ totalUnreadCount: count });
      })
      .catch(() => this.setData({ totalUnreadCount: 0 }));
  },

  onShow() {
    // 仅无 token 时跳转登录页；无手机不跳转，留到排期/订单/我的页再弹获取手机号
    const token = auth.getAccessToken();
    const storedUser = auth.getUser();
    if (!token || !storedUser) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
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
    if (this.data.currentCinema) {
      this._fetchAndShowNotice();
      this._refreshNoticeUnreadCount();
    }
  },

  /** 获取当前用户标识，用于持久化「我已了解」状态（一个用户每个通知只显示一次） */
  _getNoticeAckUserKey() {
    const gd = getApp()?.globalData || {};
    const openid = (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
    const userId = gd.supabaseUser?.id;
    return (openid || userId || 'guest').toString();
  },

  /** 从本地存储读取该用户已确认的通知 id 列表 */
  _getAckedNoticeIds() {
    const key = STORAGE_KEY_PREFIX + this._getNoticeAckUserKey();
    try {
      const raw = wx.getStorageSync(key);
      if (Array.isArray(raw)) return raw;
      if (raw != null && typeof raw === 'object' && Array.isArray(raw.ids)) return raw.ids;
      return [];
    } catch (e) {
      return [];
    }
  },

  /** 将通知 id 标记为已确认并持久化 */
  _markNoticeAcked(noticeId) {
    if (noticeId == null) return;
    const key = STORAGE_KEY_PREFIX + this._getNoticeAckUserKey();
    const ids = this._getAckedNoticeIds();
    const idStr = String(noticeId);
    if (ids.indexOf(idStr) >= 0) return;
    ids.push(idStr);
    try {
      wx.setStorageSync(key, ids);
    } catch (e) {
      console.warn('[index] 保存通知已读失败', e);
    }
  },

  /** 查询 new_notice：type=event、channel=wechat、cinema_id=cinemaid 或 null，最新一条；加载列表用于上一条/下一条 */
  async _fetchAndShowNotice() {
    const app = getApp();
    const gd = app.globalData || {};
    const cinemainfo = gd.cinemainfo || null;
    // new_notice.cinema_id 存的是影院编号，与 cinemaNumber/cinema_code 对应
    const cinemaId = cinemainfo && (cinemainfo.cinemaNumber || cinemainfo.cinema_num || cinemainfo.cinema_code || cinemainfo.cinemaid || cinemainfo.cinema_id);
    const cid = cinemaId != null ? String(cinemaId).trim() : '';
    const [notice, list] = await Promise.all([
      supabase.getLatestNotice(cid),
      supabase.getNoticeList(cid, 'wechat', 'event')
    ]);
    if (!notice || !notice.id) return;
    const content = notice.content != null ? String(notice.content).trim() : '';
    if (!content) return;
    if (gd.indexNoticeShownForId === notice.id) return;
    const acked = this._getAckedNoticeIds();
    if (acked.indexOf(String(notice.id)) >= 0) return;
    const noticeList = Array.isArray(list) ? list : [];
    const idx = noticeList.findIndex(n => n && String(n.id) === String(notice.id));
    const noticeCurrentIndex = idx >= 0 ? idx : 0;
    this.setData({
      showNoticeModal: true,
      noticeContent: content,
      noticeId: notice.id,
      noticeList,
      noticeCurrentIndex
    });
  },

  preventTouchMove() {},

  /** 通知弹窗关闭：右上角 X 或点击遮罩 */
  onNoticeModalClose() {
    const { noticeId } = this.data;
    if (noticeId != null) this._markNoticeAcked(noticeId);
    const app = getApp();
    if (app && app.globalData && noticeId != null) app.globalData.indexNoticeShownForId = noticeId;
    this.setData({ showNoticeModal: false, noticeContent: '', noticeId: null, noticeList: [], noticeCurrentIndex: 0 });
  },

  /** 上一条：显示列表中更早（时间更旧）的一条 */
  onNoticePrev() {
    const { noticeList, noticeCurrentIndex } = this.data;
    if (!noticeList || noticeList.length === 0) return;
    const nextIdx = noticeCurrentIndex + 1;
    if (nextIdx >= noticeList.length) return;
    const item = noticeList[nextIdx];
    const content = item && item.content != null ? String(item.content).trim() : '';
    if (!content) return;
    this.setData({
      noticeContent: content,
      noticeId: item.id,
      noticeCurrentIndex: nextIdx
    });
  },

  /** 下一条：显示列表中更新（时间更新）的一条 */
  onNoticeNext() {
    const { noticeList, noticeCurrentIndex } = this.data;
    if (!noticeList || noticeList.length === 0) return;
    const prevIdx = noticeCurrentIndex - 1;
    if (prevIdx < 0) return;
    const item = noticeList[prevIdx];
    const content = item && item.content != null ? String(item.content).trim() : '';
    if (!content) return;
    this.setData({
      noticeContent: content,
      noticeId: item.id,
      noticeCurrentIndex: prevIdx
    });
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
      const cardinfo = cardApi.mergeCardDetailIntoCardinfo(bindCard, detail);
      app.globalData.cardinfo = cardinfo;
      console.log('[主页] 会员卡详情已更新到 cardinfo', JSON.stringify(cardinfo));
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
          fail(err) {
            reject(err instanceof Error ? err : new Error(err && (err.errMsg || err.message) || '获取位置失败'));
          }
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
        this._fetchAndShowNotice(); // 切换影院后拉取该影院最新通知
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
      const hotFiltered = hot.filter(m => (m.release_date || '') <= today)
        .sort((a, b) => (b.playdate || b.playDate || '').localeCompare(a.playdate || a.playDate || ''));
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
    } else if (name === '卡券管理') {
      const u = getApp()?.globalData?.supabaseUser;
      const userId = (u && (u.id || u.user_id || u.userId)) || null;
      if (!userId) {
        wx.showToast({ title: '请先登录后查看券列表', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: '/pages/coupon-list/coupon-list' });
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
