/**
 * 订单页面 - 待观看 / 未付款 / 全部订单
 * 查询条件：openid=当前登录用户、order_channel=miniprogram、phone=当前用户手机号
 */
const supabase = require('../../utils/supabase');
const auth = require('../../utils/auth');
const dateHelper = require('../../utils/dateHelper');

function parseSeats(seatList) {
  if (Array.isArray(seatList)) return seatList.map(String);
  if (typeof seatList === 'string') {
    try {
      const arr = JSON.parse(seatList);
      return Array.isArray(arr) ? arr.map(String) : [seatList];
    } catch (_) {
      return seatList ? [String(seatList)] : [];
    }
  }
  return [];
}

Page({
  data: {
    currentTab: 0,
    allOrders: [],
    showLoginModal: false,
    displayOrders: [],
    loading: true,
    currentUserPhone: null
  },

  onLoad() {
    this._loadOrders();
  },

  onShow() {
    const app = getApp();
    const { sessionReady, supabaseUser } = app?.globalData || {};
    if (!sessionReady) return;
    if (supabaseUser == null) {
      this.setData({ showLoginModal: true });
      return;
    }
    if (this.data.allOrders.length > 0) {
      this._loadOrders();
    }
  },

  onLoginModalClose() {
    this.setData({ showLoginModal: false });
  },

  onLoginSuccess() {
    this.setData({ showLoginModal: false });
    this._loadOrders();
  },

  onPullDownRefresh() {
    this._loadOrders().then(() => wx.stopPullDownRefresh());
  },

  async _loadOrders() {
    this.setData({ loading: true });
    try {
      const app = getApp();
      const gd = app.globalData || {};
      const openid = (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
      const phone = gd.supabaseUser?.phone || null;
      if (!openid) {
        this.setData({
          allOrders: [],
          displayOrders: [],
          currentUserPhone: phone,
          loading: false
        });
        return;
      }
      const raw = await supabase.orders({
        openid,
        order_channel: 'miniprogram',
        phone: phone || undefined
      }).catch(() => []);
      const list = Array.isArray(raw) ? raw : [];
      const orders = list.map((d) => this._convertOrder(d));
      const displayOrders = this._filterOrders(orders, phone);
      this.setData({
        allOrders: orders,
        displayOrders,
        currentUserPhone: phone,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, allOrders: [], displayOrders: [] });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  _convertOrder(d) {
    const seatList = d.seat_list || d.seatList || [];
    const seats = parseSeats(seatList);
    const startTime = d.start_time || d.startTime;
    const showDate = startTime ? dateHelper.formatBeijingTime(startTime, 'YYYY-MM-DD') : '';
    const showTime = startTime ? dateHelper.formatBeijingTime(startTime, 'HH:mm') : '';
    const payStatus = (d.pay_status || d.payStatus || 'INIT').toString();
    let seeState = false;
    if (d.see_state != null) {
      seeState = d.see_state === true || d.see_state === 'true';
    }
    let status = 'pending';
    if ((payStatus === 'PAID' || payStatus === 'SUCCESS') && !seeState) {
      status = 'paid';
    } else if ((payStatus === 'PAID' || payStatus === 'SUCCESS') && seeState) {
      status = 'watched';
    } else if (payStatus === 'CANCELLED') {
      status = 'cancelled';
    }
    const num = d.num != null ? Number(d.num) : seats.length;
    return {
      id: (d.order_id || d.id || '').toString(),
      movieName: (d.movie_name || d.movieName || '未知电影').toString(),
      moviePoster: (d.movie_img_url || d.movieImgUrl || d.poster || '').toString(),
      movieCategory: (d.movie_dimensional || d.movieDimensional || '').toString(),
      language: (d.movie_language || d.movieLanguage || '').toString(),
      cinemaName: (d.cinema_name || d.cinemaName || '未知影院').toString(),
      showDate,
      showTime,
      seats,
      seatCount: num,
      totalPrice: d.total != null ? Number(d.total) : 0,
      status,
      payStatus,
      seeState,
      showDateTime: startTime,
      phone: (d.phone || '').toString(),
      cinemaNum: (d.cinema_num || d.cinemaNum || '').toString(),
      refundStatus: (d.refund_status || d.refundStatus || '').toString(),
      refundId: (d.refund_id || d.refundId || '').toString(),
      outTradeNo: (d.out_trade_no || d.outTradeNo || '').toString()
    };
  },

  _filterOrders(orders, phone, tabIndex) {
    const now = new Date();
    const t = tabIndex !== undefined ? tabIndex : this.data.currentTab;
    if (t === 0) {
      return orders.filter((o) => {
        if (phone && o.phone !== phone) return false;
        if (o.payStatus !== 'SUCCESS' && o.payStatus !== 'PAID') return false;
        const showAt = dateHelper.parseApiTimeAsUTC(o.showDateTime);
        if (!showAt) return false;
        return showAt > now;
      });
    }
    if (t === 1) {
      return orders.filter((o) => {
        if (phone && o.phone !== phone) return false;
        if (o.payStatus !== 'INIT') return false;
        const showAt = dateHelper.parseApiTimeAsUTC(o.showDateTime);
        if (!showAt) return false;
        return showAt > now;
      });
    }
    return orders.filter((o) => {
      if (phone && o.phone !== phone) return false;
      if (o.payStatus !== 'SUCCESS' && o.payStatus !== 'PAID') return false;
      const showAt = dateHelper.parseApiTimeAsUTC(o.showDateTime);
      if (!showAt) return false;
      return showAt < now;
    });
  },

  onTabTap(e) {
    const i = parseInt(e.currentTarget.dataset.index, 10);
    const displayOrders = this._filterOrders(this.data.allOrders, this.data.currentUserPhone, i);
    this.setData({ currentTab: i, displayOrders });
  },

  onViewTicket(e) {
    const outTradeNo = e.currentTarget.dataset.outTradeNo;
    if (!outTradeNo) {
      wx.showToast({ title: '订单号不存在', icon: 'none' });
      return;
    }
    const fromAll = this.data.currentTab === 2;
    let url = '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(outTradeNo);
    if (fromAll) url += '&blur_qr=1';
    wx.navigateTo({ url });
  },

  onPay(e) {
    wx.showToast({ title: '马上支付 开发中', icon: 'none' });
  },

  onCancelOrder(e) {
    wx.showToast({ title: '取消订单 开发中', icon: 'none' });
  }
});
