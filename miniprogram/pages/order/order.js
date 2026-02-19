/**
 * 订单页面 - 待观看 / 未付款 / 全部订单
 * 查询条件：openid=当前登录用户、order_channel=miniprogram、phone=当前用户手机号
 * 未付款「确认支付」：与 confirm-pay 页同一套微信支付（mini-pay + 收银台 + 轮询），参数从订单数据取
 */
const supabase = require('../../utils/supabase');
const auth = require('../../utils/auth');
const dateHelper = require('../../utils/dateHelper');
const saopayRequest = require('../../utils/saopayRequest.js');
const dingxin = require('../../utils/dingxinRequest.js');

const PAY_STATUS_POLL_INTERVAL_MS = 1500;
const PAY_STATUS_POLL_TIMEOUT_MS = 15000;

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
    displayOrders: [],
    loading: true,
    currentUserPhone: null,
    showGetPhoneModal: false
  },

  onLoad() {
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
      return;
    }
    this._loadOrders();
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
      return;
    }
    if (this.data.allOrders.length > 0) {
      this._loadOrders();
    }
  },

  onGetPhoneModalClose() {
    this.setData({ showGetPhoneModal: false });
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onGetPhoneModalSuccess() {
    this.setData({ showGetPhoneModal: false });
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
      const unpaidOrders = orders.filter((o) => (o.payStatus || '') !== 'SUCCESS' && (o.payStatus || '') !== 'PAID');
      console.log('[order] 订单列表加载完成', {
        total: orders.length,
        displayCount: displayOrders.length,
        未付款数量: unpaidOrders.length,
        未付款订单: unpaidOrders.slice(0, 5).map((o) => ({ id: o.id, outTradeNo: o.outTradeNo || '(空)', payStatus: o.payStatus }))
      });
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
    // 主键为 cinema_order_list.id (bigint)，取消/更新订单必须用 id
    return {
      id: (d.id != null && d.id !== '' ? d.id : d.order_id || '').toString(),
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

  /**
   * 查看影票：调鼎新 ticket_info，仅按返回的 ticketStatus 决定二维码清晰/模糊
   * ticketStatus 1=未出票→清晰，2=已出票→模糊；无 ticket_flag 或接口失败时默认清晰（不传 blur_qr）
   */
  async onViewTicket(e) {
    const outTradeNo = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.outTradeNo) ? String(e.currentTarget.dataset.outTradeNo).trim() : '';
    if (!outTradeNo) {
      wx.showToast({ title: '订单号不存在', icon: 'none' });
      return;
    }
    let blurQr = false;

    const order = await supabase.getOrderByOutTradeNo(outTradeNo).catch(() => null);
    const cid = order && (order.cinema_id || order.cinemaId || order.cinema_num || '').toString().trim();
    const ticketFlag1 = order && (order.ticket_flag1 || '').toString().trim();
    const ticketFlag2 = order && (order.ticket_flag2 || '').toString().trim();

    if (cid && ticketFlag1 && ticketFlag2) {
      try {
        const res = await dingxin.post('/nonmember/ticket_info', { cid, ticket_flag1: ticketFlag1, ticket_flag2: ticketFlag2 });
        const code = res && (res.code === 200 || res.code === '200' || res.code === 0);
        if (code && res.data != null) {
          const ticketStatus = res.data.ticketStatus != null ? Number(res.data.ticketStatus) : NaN;
          blurQr = ticketStatus === 2; // 1=未出票→清晰，2=已出票→模糊
        }
      } catch (err) {
        console.warn('[order][查看影票] ticket_info 失败，默认清晰', err && err.message);
      }
    }

    let url = '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(outTradeNo);
    if (blurQr) url += '&blur_qr=1';
    wx.navigateTo({ url });
  },

  async onPay(e) {
    const outTradeNo = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.outTradeNo) ? String(e.currentTarget.dataset.outTradeNo).trim() : '';
    console.log('[order][确认支付] 点击', { outTradeNo: outTradeNo || '(空)', hasOutTradeNo: !!outTradeNo });
    if (!outTradeNo) {
      wx.showToast({ title: '订单号不存在，无法支付', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载订单…' });
    try {
      console.log('[order][确认支付] 请求 getOrderByOutTradeNo', { outTradeNo });
      const order = await supabase.getOrderByOutTradeNo(outTradeNo);
      wx.hideLoading();
      console.log('[order][确认支付] getOrderByOutTradeNo 返回', {
        hasOrder: !!order,
        orderId: order && (order.id || order.order_id),
        out_trade_no: order && (order.out_trade_no || order.outTradeNo),
        pay_status: order && (order.pay_status || order.payStatus),
        total: order && order.total
      });
      if (!order) {
        console.warn('[order][确认支付] 订单不存在或已失效：接口返回 null，outTradeNo=', outTradeNo);
        wx.showToast({ title: '订单不存在或已失效', icon: 'none' });
        return;
      }
      const payStatus = (order.pay_status || order.payStatus || '').toString();
      if (payStatus === 'SUCCESS' || payStatus === 'PAID') {
        console.log('[order][确认支付] 订单已支付，跳过', { payStatus });
        wx.showToast({ title: '订单已支付', icon: 'none' });
        this._loadOrders();
        return;
      }
      const orderOutTradeNo = (order.out_trade_no || order.outTradeNo || '').toString().trim();
      const total = parseFloat(order.total);
      if (!orderOutTradeNo || isNaN(total) || total <= 0) {
        console.warn('[order][确认支付] 订单数据异常', { orderOutTradeNo: orderOutTradeNo || '(空)', total, isNaN: isNaN(total) });
        wx.showToast({ title: '订单数据异常，无法支付', icon: 'none' });
        return;
      }
      const totalInCents = Math.round(total * 100);
      console.log('[order][确认支付] 调起微信支付', { outTradeNo: orderOutTradeNo, total, totalInCents });
      this._doWeChatPay(orderOutTradeNo, totalInCents);
    } catch (err) {
      wx.hideLoading();
      console.error('[order][确认支付] 加载订单异常', { outTradeNo, err: err && err.message, stack: err && err.stack });
      wx.showToast({ title: (err && err.message) || '加载订单失败', icon: 'none' });
    }
  },

  /** 与 confirm-pay 同一套：调扫呗 mini-pay → 调起微信收银台 → 成功后轮询 pay_status 再跳转影票页 */
  async _doWeChatPay(outTradeNo, totalInCents) {
    console.log('[order][微信支付] 开始', { outTradeNo, totalInCents });
    wx.showLoading({ title: '正在调起支付...' });
    try {
      const app = getApp();
      const openId = (app && app.globalData && app.globalData.wxProfile && app.globalData.wxProfile.openid) || (auth && auth.getOpenid && auth.getOpenid()) || '';
      console.log('[order][微信支付] openId', { hasOpenId: !!openId, openIdLen: openId ? openId.length : 0 });
      if (!openId) {
        wx.hideLoading();
        console.warn('[order][微信支付] 未登录，无 openId');
        wx.showToast({ title: '请先登录', icon: 'none' });
        return;
      }
      const subAppid = (app && app.globalData && app.globalData.saopayAppid) || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram && wx.getAccountInfoSync().miniProgram.appId) || '';
      const pad = (n) => (n < 10 ? '0' + n : String(n));
      const d = new Date();
      const terminalTime = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

      console.log('[order][微信支付] 请求 miniPay', { outTradeNo, totalInCents, terminalTime: terminalTime.slice(0, 8) + '...' });
      const data = await saopayRequest.miniPay({
        pay_type: '010',
        total_fee: String(totalInCents),
        terminal_trace: outTradeNo,
        terminal_time: terminalTime,
        sub_appid: subAppid || undefined,
        open_id: openId,
        notify_url: 'https://saopay.meicity.net/api/notify/payment'
      });

      console.log('[order][微信支付] miniPay 返回', { code: data && data.code, message: data && (data.message || data.msg), hasPaymentParams: !!(data && (data.paymentParams || data.data)) });
      const code = data && (data.code === 200 || data.code === '200');
      if (!code) {
        wx.hideLoading();
        console.warn('[order][微信支付] miniPay 失败', data);
        wx.showToast({ title: (data && (data.message || data.msg)) || '支付失败', icon: 'none' });
        return;
      }

      const payParams = this._parseWeChatPayParams(data);
      if (!payParams) {
        wx.hideLoading();
        console.warn('[order][微信支付] 支付参数解析失败', { dataKeys: data ? Object.keys(data) : [] });
        wx.showToast({ title: '支付参数解析失败', icon: 'none' });
        return;
      }

      wx.hideLoading();
      console.log('[order][微信支付] 调起收银台 wx.requestPayment');
      const self = this;
      wx.requestPayment({
        ...payParams,
        success() {
          console.log('[order][微信支付] 收银台 success，开始轮询 pay_status');
          wx.showToast({ title: '支付成功，正在跳转取票页…', icon: 'none', duration: 2000 });
          self._startPayStatusPoll(outTradeNo);
        },
        fail(err) {
          console.log('[order][微信支付] 收银台 fail', { errMsg: err && err.errMsg, cancel: err && err.errMsg && err.errMsg.indexOf('cancel') !== -1 });
          if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
            wx.showToast({ title: '支付已取消', icon: 'none' });
          } else {
            wx.showToast({ title: (err && err.errMsg) || '支付失败', icon: 'none' });
          }
        }
      });
    } catch (e) {
      wx.hideLoading();
      console.error('[order][微信支付] 异常', { message: e && e.message, stack: e && e.stack });
      wx.showToast({ title: (e && e.message) || '支付失败', icon: 'none' });
    }
  },

  _parseWeChatPayParams(data) {
    const raw = (data && data.paymentParams) || (data && data.data) || data || {};
    const timeStamp = (raw.timeStamp != null && raw.timeStamp !== '') ? String(raw.timeStamp) : ((raw.timestamp != null && raw.timestamp !== '') ? String(raw.timestamp) : '');
    const nonceStr = (raw.nonceStr != null && raw.nonceStr !== '') ? String(raw.nonceStr) : ((raw.noncestr != null && raw.noncestr !== '') ? String(raw.noncestr) : '');
    const packageStr = (raw.package != null && raw.package !== '') ? String(raw.package) : '';
    const signType = (raw.signType != null && raw.signType !== '') ? String(raw.signType) : ((raw.sign_type != null && raw.sign_type !== '') ? String(raw.sign_type) : 'MD5');
    const paySign = (raw.paySign != null && raw.paySign !== '') ? String(raw.paySign) : ((raw.pay_sign != null && raw.pay_sign !== '') ? String(raw.pay_sign) : ((raw.sign != null && raw.sign !== '') ? String(raw.sign) : ''));
    if (!timeStamp || !nonceStr || !packageStr || !paySign) return null;
    return { timeStamp, nonceStr, package: packageStr, signType, paySign };
  },

  _startPayStatusPoll(outTradeNo) {
    const no = (outTradeNo && String(outTradeNo).trim()) || '';
    if (!no) {
      wx.showToast({ title: '订单号缺失', icon: 'none' });
      return;
    }
    const self = this;
    this._clearPayStatusTimers();
    this._checkPayStatusOnce(no);
    this._payStatusPollTimer = setInterval(() => { self._checkPayStatusOnce(no); }, PAY_STATUS_POLL_INTERVAL_MS);
    this._payStatusTimeoutTimer = setTimeout(() => {
      self._clearPayStatusTimers();
      wx.redirectTo({ url: '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(no) });
    }, PAY_STATUS_POLL_TIMEOUT_MS);
  },

  _checkPayStatusOnce(outTradeNo) {
    if (!outTradeNo) return;
    const self = this;
    supabase.getOrderByOutTradeNo(outTradeNo).then((order) => {
      if (!order) return;
      const status = (order.pay_status || order.payStatus || '').toString();
      if (status === 'SUCCESS') {
        self._clearPayStatusTimers();
        wx.redirectTo({ url: '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(outTradeNo) });
      }
    });
  },

  _clearPayStatusTimers() {
    if (this._payStatusPollTimer) {
      clearInterval(this._payStatusPollTimer);
      this._payStatusPollTimer = null;
    }
    if (this._payStatusTimeoutTimer) {
      clearTimeout(this._payStatusTimeoutTimer);
      this._payStatusTimeoutTimer = null;
    }
  },

  /** 未付款订单取消：先调鼎新 seat_unlock 解锁座位，成功后把订单状态改为 CANCELLED */
  async onCancelOrder(e) {
    const orderId = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderId) ? String(e.currentTarget.dataset.orderId).trim() : '';
    const outTradeNo = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.outTradeNo) ? String(e.currentTarget.dataset.outTradeNo).trim() : '';
    console.log('[order][取消订单] 点击', { orderId, outTradeNo });
    if (!orderId || !outTradeNo) {
      wx.showToast({ title: '订单信息不全', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '取消中…' });
    try {
      const order = await supabase.getOrderByOutTradeNo(outTradeNo);
      if (!order) {
        wx.hideLoading();
        wx.showToast({ title: '订单不存在或已失效', icon: 'none' });
        return;
      }
      const payStatus = (order.pay_status || order.payStatus || '').toString();
      if (payStatus === 'SUCCESS' || payStatus === 'PAID') {
        wx.hideLoading();
        wx.showToast({ title: '订单已支付，无法取消', icon: 'none' });
        return;
      }
      const lockFlag = (order.lock_flag || order.lockFlag || '').toString().trim();
      if (lockFlag) {
        const cid = (order.cinema_id || order.cinemaId || order.cinema_num || '').toString().trim();
        const playId = (order.play_id || order.cine_play_id || '').toString().trim();
        let seatId = order.seat_id;
        if (Array.isArray(seatId)) seatId = seatId.map(String).join(',');
        else if (seatId != null) seatId = String(seatId).trim();
        else seatId = '';
        if (!cid || !playId || !seatId) {
          console.warn('[order][取消订单] 缺少解锁参数，仅更新订单状态', { cid: !!cid, playId: !!playId, seatId: !!seatId });
        } else {
          try {
            console.log('[order][取消订单] 调用 seat_unlock', { cid, play_id: playId, seat_id: seatId, lock_flag: lockFlag });
            const res = await dingxin.post('/nonmember/seat_unlock', { cid, play_id: playId, seat_id: seatId, lock_flag: lockFlag });
            const code = res && (res.code === 200 || res.code === '200' || res.code === 0);
            console.log('[order][取消订单] seat_unlock 返回', { code: res && res.code, message: res && (res.message || res.msg) });
            if (!code) {
              wx.hideLoading();
              wx.showToast({ title: (res && (res.message || res.msg)) || '解锁座位失败', icon: 'none' });
              return;
            }
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: (err && err.message) || '解锁座位失败', icon: 'none' });
            return;
          }
        }
      }
      await supabase.updateOrder(orderId, { pay_status: 'CANCELLED' });
      console.log('[order][取消订单] 订单状态已更新为 CANCELLED', { orderId });
      wx.hideLoading();
      wx.showToast({ title: '已取消', icon: 'success' });
      this._loadOrders();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' });
    }
  },

  onUnload() {
    this._clearPayStatusTimers();
  }
});
