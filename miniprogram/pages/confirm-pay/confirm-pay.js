/**
 * 确认支付页 - VI 规范
 * 支付方式：微信支付、券支付、会员卡支付
 * 任意支付方式成功后：轮询 cinema_order_list.pay_status，为 SUCCESS 时跳转 ticketinfo（传 out_trade_no），否则在原页等待；超时后也跳转 ticketinfo
 */
const cardApi = require('../../utils/cardApi.js');
const supabase = require('../../utils/supabase.js');
const dateHelper = require('../../utils/dateHelper.js');
const md5 = require('../../utils/md5.js');
const saopayRequest = require('../../utils/saopayRequest.js');
const auth = require('../../utils/auth.js');

const PAY_STATUS_POLL_INTERVAL_MS = 1500;
const PAY_STATUS_POLL_TIMEOUT_MS = 15000;

function maskCouponCode(code) {
  if (!code || typeof code !== 'string') return '****';
  const s = String(code).trim();
  if (s.length <= 4) return '****';
  if (s.length <= 8) return s.slice(0, 2) + '****' + s.slice(-2);
  return s.slice(0, 4) + '****' + s.slice(-4);
}

function normalizePhone(v) {
  if (v == null) return '';
  const s = String(v).trim().replace(/\D/g, '');
  return s.length >= 11 && s.slice(-11).startsWith('1') ? s.slice(-11) : s;
}

Page({
  data: {
    orderId: '',
    outTradeNo: '',
    onlyMemberCard: false,  // 仅会员卡支付（来自 seat-select 会员小于等于第三方停售）
    movieName: '',
    movieType: '',
    moviePoster: '',
    hallName: '',
    showtimeStr: '',
    seatList: '',
    baseTotal: '0.00',
    discountAmount: 0,
    grandTotal: '0.00',
    totalInCents: 0,
    orderData: null,
    cardInfo: null,
    selectedMethod: 'wechat',
    selectedCoupon: null,
    availableCoupons: [],
    boundCouponList: [],       // 已绑定的券列表（展示用）
    showPasswordModal: false,
    _passwordInput: '',
    _memberCardPayCtx: null,
    showCouponModal: false,
    _couponCodeInput: '',
    _couponSubmitting: false
  },

  onLoad(options) {
    const app = getApp();
    const gd = (app && app.globalData) || {};
    const order = gd.playOrder || null;
    const onlyMemberCard = options.onlyMemberCard === '1' || options.onlyMemberCard === 'true';
    const showtime = gd.playShowtime || null;
    const movie = gd.playMovie || null;

    if (!order) {
      wx.showToast({ title: '订单不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    const cardinfo = gd.cardinfo || null;
    const cardInfo = cardinfo && (cardinfo.cardNumber || cardinfo.card_no) ? {
      cardNumber: cardinfo.cardNumber || cardinfo.card_no,
      cardName: cardinfo.cardName || cardinfo.card_name || '会员卡',
      balance: cardinfo.balance
    } : null;

    const movieName = (order.movie_name != null ? order.movie_name : (movie && (movie.name || movie.movieName)) || '').toString() || '电影';
    const movieType = (order.movie_dimensional != null ? order.movie_dimensional : (showtime && showtime.format) || '').toString();
    const moviePoster = (order.movie_img_url != null ? order.movie_img_url : (movie && (movie.logo || movie.movie_img_url)) || '').toString();
    const hallName = (order.hall_name != null ? order.hall_name : (showtime && showtime.hallName) || '').toString() || '影厅';
    let showtimeStr = '';
    if (order.start_time || (showtime && showtime.startTime)) {
      const raw = order.start_time || (showtime && showtime.startTime);
      showtimeStr = dateHelper.formatBeijingTime(raw, 'M/D HH:mm');
    }
    const seatList = Array.isArray(order.seat_list) ? order.seat_list.join('、') : (order.seat_list || '').toString();
    const total = Number(order.total) || 0;
    const baseTotal = total.toFixed(2);
    const grandTotal = baseTotal;

    this.setData({
      orderId: order.id,
      outTradeNo: order.out_trade_no || '',
      onlyMemberCard,
      selectedMethod: onlyMemberCard ? 'memberCard' : 'wechat',
      cardInfo,
      movieName,
      movieType,
      moviePoster,
      hallName,
      showtimeStr,
      seatList,
      baseTotal,
      grandTotal,
      totalInCents: Math.round(total * 100),
      orderData: order
    });

    this._loadCoupons();
  },

  _getOpenid() {
    const gd = getApp()?.globalData || {};
    return (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
  },

  _getUserId() {
    const app = getApp();
    const gd = app?.globalData || {};
    const u = gd.userinfo || gd.supabaseUser || null;
    return (u && (u.user_id || u.id || u.userId)) || null;
  },

  _getUserPhone() {
    const app = getApp();
    const gd = app?.globalData || {};
    const u = gd.userinfo || gd.supabaseUser || null;
    const raw = (u && (u.phone || u.mobile)) || '';
    return normalizePhone(raw);
  },

  _loadCoupons() {
    const self = this;
    const openid = this._getOpenid();
    const phone = this._getUserPhone();
    if (!openid && !phone) {
      this.setData({ boundCouponList: [], availableCoupons: [] });
      return;
    }
    const promiseProfile = openid ? supabase.getUserProfileByOpenid(openid) : Promise.resolve(null);
    promiseProfile
      .then((profile) => {
        const userId = (profile && profile.user_id) ? String(profile.user_id).trim() : self._getUserId();
        if (!userId && !phone) {
          self.setData({ boundCouponList: [], availableCoupons: [] });
          return;
        }
        return supabase.getCouponListForUser(userId, phone);
      })
      .then((rows) => {
        if (!rows || !Array.isArray(rows)) return;
        const list = rows.map((row) => ({
          id: row.id,
          couponCode: row.coupon_code || '',
          couponCodeMasked: maskCouponCode(row.coupon_code),
          validToStr: dateHelper.formatBeijingTime(row.valid_to, 'YYYY-MM-DD HH:mm'),
          status: row.status || 'available'
        }));
        self.setData({ boundCouponList: list, availableCoupons: list });
      })
      .catch(() => {
        self.setData({ boundCouponList: [], availableCoupons: [] });
      });
  },

  onSelectPayment(e) {
    const method = e.currentTarget.dataset.method;
    this.setData({ selectedMethod: method });
  },

  /** 点击「添加优惠券」：弹出输入券码对话框 */
  onAddCoupon() {
    this.setData({ showCouponModal: true, _couponCodeInput: '', _couponSubmitting: false });
  },

  onCouponCodeInput(e) {
    this.setData({ _couponCodeInput: (e.detail && e.detail.value) || '' });
  },

  /** 弹窗内取消 */
  onCouponModalCancel() {
    if (this.data._couponSubmitting) return;
    this.setData({ showCouponModal: false, _couponCodeInput: '' });
  },

  /** 弹窗内确认：先二次确认再绑定 */
  onCouponModalConfirm() {
    const code = String(this.data._couponCodeInput || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入券码', icon: 'none' });
      return;
    }
    const self = this;
    wx.showModal({
      title: '确认绑定',
      content: '确定要绑定券码「' + code + '」吗？',
      confirmText: '确定',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) return;
        const userId = self._getUserId();
        if (!userId) {
          wx.showToast({ title: '请先登录', icon: 'none' });
          self.setData({ showCouponModal: false, _couponCodeInput: '' });
          return;
        }
        self.setData({ _couponSubmitting: true });
        supabase
          .bindCoupon(userId, code)
          .then(() => {
            wx.showToast({ title: '绑定成功', icon: 'success' });
            self.setData({ showCouponModal: false, _couponCodeInput: '', _couponSubmitting: false });
            self._loadCoupons();
          })
          .catch((err) => {
            self.setData({ _couponSubmitting: false });
            wx.showToast({ title: (err && err.message) || '绑定失败', icon: 'none' });
          });
      }
    });
  },

  /** 兼容旧名 */
  onSelectCoupon() {
    this.onAddCoupon();
  },

  _getGrandTotal() {
    const { baseTotal, discountAmount } = this.data;
    const base = parseFloat(baseTotal) || 0;
    const discount = Number(discountAmount) || 0;
    return Math.max(0, base - discount).toFixed(2);
  },

  onPay() {
    const { selectedMethod, orderData, outTradeNo } = this.data;
    const grandTotal = this._getGrandTotal();
    const totalInCents = Math.round(parseFloat(grandTotal) * 100);

    if (selectedMethod === 'wechat') {
      if (!outTradeNo) {
        wx.showToast({ title: '订单号异常，无法支付', icon: 'none' });
        return;
      }
      this._processWeChatPay(outTradeNo, totalInCents, orderData);
    } else if (selectedMethod === 'memberCard') {
      this._processMemberCardPay(orderData);
    } else if (selectedMethod === 'coupon') {
      wx.showToast({ title: '券支付功能正在开发中，敬请期待', icon: 'none' });
    }
  },

  _processMemberCardPay(orderData) {
    const app = getApp();
    const gd = (app && app.globalData) || {};
    const cardinfo = gd.cardinfo || null;
    const cinemainfo = gd.cinemainfo || null;

    if (!cardinfo || !(cardinfo.cardNumber || cardinfo.card_no)) {
      wx.showToast({ title: '未找到会员卡信息，无法使用会员卡支付', icon: 'none' });
      return;
    }

    const cinemaId = (cinemainfo && (cinemainfo.cinemaid || cinemainfo.cinemaNumber || cinemainfo.id)) || null;
    if (!cinemaId) {
      wx.showToast({ title: '未找到影院信息，无法使用会员卡支付', icon: 'none' });
      return;
    }

    this.setData({
      showPasswordModal: true,
      _passwordInput: '',
      _memberCardPayCtx: { orderData, cardNumber: cardinfo.cardNumber || cardinfo.card_no, cinemaId }
    });
  },

  onPasswordInput(e) {
    this.setData({ _passwordInput: e.detail.value });
  },

  onPasswordConfirm() {
    const password = (this.data._passwordInput || '').trim();
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    const ctx = this.data._memberCardPayCtx;
    if (!ctx) return;
    this.setData({ showPasswordModal: false, _passwordInput: '', _memberCardPayCtx: null });
    this._doMemberCardPay(ctx.orderData, ctx.cardNumber, password, ctx.cinemaId);
  },

  onPasswordCancel() {
    this.setData({ showPasswordModal: false, _passwordInput: '', _memberCardPayCtx: null });
  },

  preventTouchMove() {},

  /** 会员卡支付：一个接口完成「先验密再扣费」（POST /api/member/member_card_pay） */
  async _doMemberCardPay(orderData, cardNumber, password, cinemaId) {
    const orderId = orderData.id || '';
    const totalRaw = orderData.total;
    const totalValue = (typeof totalRaw === 'number' || typeof totalRaw === 'string') ? parseFloat(totalRaw) : 0;
    if (totalValue <= 0) {
      wx.showToast({ title: '订单金额无效', icon: 'none' });
      return;
    }

    const partnerBuyTicketId = '' + Date.now() + orderId;
    // num：订单合计金额（元）取整；goods_card_balance_pay：订单金额两位小数（后端会按 num 统一）
    const numValue = Math.round(totalValue);
    const goodsCardBalancePay = totalValue.toFixed(2);
    console.log('[会员卡支付-确认页] num(订单金额取整), goods_card_balance_pay', numValue, goodsCardBalancePay);
    const mobile = (orderData.phone || orderData.mobile || '').toString().replace(/^\+86/, '').trim() || '13800138000';
    const passwordMd5 = md5(password).toLowerCase();

    wx.showLoading({ title: '正在支付...' });

    try {
      // out_trade_no 来源于 order.out_trade_no
      const res = await cardApi.memberCardPay({
        cid: cinemaId,
        card: cardNumber,
        password: passwordMd5,
        partner_buy_ticket_id: partnerBuyTicketId,
        num: numValue,
        goods_card_balance_pay: goodsCardBalancePay,
        mobile,
        delivery_type: '1',
        out_trade_no: orderData.out_trade_no || undefined,
        order_id: orderId || undefined
      });

      wx.hideLoading();

      const isSuccess = res && (res.code === 200 || res.code === '200');
      if (!isSuccess) {
        const msg = (res && (res.message || res.msg)) || '支付失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }

      await supabase.updateOrder(orderId, {
        order_id: partnerBuyTicketId,
        pay_status: 'SUCCESS',
        paytype: 'cardpay',
        pay_time: new Date().toISOString()
      });

      const outTradeNo = (orderData.out_trade_no || '').toString();
      wx.showToast({ title: '支付成功，正在跳转取票页…', icon: 'none', duration: 2000 });
      if (outTradeNo) {
        this._startPayStatusPoll(outTradeNo);
      } else {
        wx.redirectTo({ url: '/pages/order/order' });
      }
    } catch (e) {
      wx.hideLoading();
      const msg = (e && (e.message || e.errMsg)) || '支付失败，请稍后重试';
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

  /**
   * 微信支付：调用扫呗 mini-pay 接口 → 调起微信收银台 → 等待用户支付
   * 1. 请求 POST /api/payment/mini-pay 获取支付参数
   * 2. 用返回的 paymentParams 调起 wx.requestPayment（收银台）
   * 3. 用户完成支付或取消后走 success/fail 回调
   */
  async _processWeChatPay(outTradeNo, totalInCents, orderData) {
    wx.showLoading({ title: '正在调起支付...' });

    try {
      const app = getApp();
      const openId = (app && app.globalData && app.globalData.wxProfile && app.globalData.wxProfile.openid) || (auth && auth.getOpenid && auth.getOpenid()) || '';
      if (!openId) {
        wx.hideLoading();
        wx.showToast({ title: '请先登录', icon: 'none' });
        return;
      }

      const subAppid = (app && app.globalData && app.globalData.saopayAppid) || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram && wx.getAccountInfoSync().miniProgram.appId) || '';
      const pad = function (n) { return n < 10 ? '0' + n : String(n); };
      const d = new Date();
      const terminalTime = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

      const data = await saopayRequest.miniPay({
        pay_type: '010',
        total_fee: String(totalInCents),
        terminal_trace: outTradeNo,
        terminal_time: terminalTime,
        sub_appid: subAppid || undefined,
        open_id: openId,
        notify_url: 'https://saopay.meicity.net/api/notify/payment'
      });

      const code = data && (data.code === 200 || data.code === '200');
      if (!code) {
        wx.hideLoading();
        wx.showToast({ title: (data && (data.message || data.msg)) || '支付失败', icon: 'none' });
        return;
      }

      const payParams = this._parseWeChatPayParams(data);
      if (!payParams) {
        wx.hideLoading();
        wx.showToast({ title: '支付参数解析失败', icon: 'none' });
        return;
      }

      wx.hideLoading();
      const self = this;
      // 调起微信收银台，等待用户支付或取消；成功后等待 pay_status=SUCCESS 再跳转 ticketinfo
      wx.requestPayment({
        ...payParams,
        success: function () {
          wx.showToast({ title: '支付成功，正在跳转取票页…', icon: 'none', duration: 2000 });
          self._startPayStatusPoll(outTradeNo);
        },
        fail: function (err) {
          if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
            wx.showToast({ title: '支付已取消', icon: 'none' });
          } else {
            wx.showToast({ title: err.errMsg || '支付失败', icon: 'none' });
          }
        }
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '支付失败', icon: 'none' });
    }
  },

  /** 跳转影票详情页，始终携带 out_trade_no（优先用参数，否则用 orderData.out_trade_no） */
  _redirectToTicketinfo(outTradeNoParam) {
    const no = (outTradeNoParam && String(outTradeNoParam).trim()) || (this.data.orderData && (this.data.orderData.out_trade_no || this.data.orderData.outTradeNo) && String(this.data.orderData.out_trade_no || this.data.orderData.outTradeNo).trim()) || '';
    if (!no) {
      wx.showToast({ title: '订单号缺失，请从订单列表查看', icon: 'none' });
      wx.redirectTo({ url: '/pages/order/order' });
      return;
    }
    wx.redirectTo({ url: '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(no) });
  },

  /** 支付成功后：轮询 cinema_order_list.pay_status，为 SUCCESS 时跳转 ticketinfo */
  _startPayStatusPoll(outTradeNo) {
    const no = (outTradeNo && String(outTradeNo).trim()) || (this.data.orderData && (this.data.orderData.out_trade_no || this.data.orderData.outTradeNo) && String(this.data.orderData.out_trade_no || this.data.orderData.outTradeNo).trim()) || '';
    if (!no) {
      wx.showToast({ title: '订单号缺失，请从订单列表查看', icon: 'none' });
      wx.redirectTo({ url: '/pages/order/order' });
      return;
    }
    const self = this;
    this._clearPayStatusTimers();
    this._checkPayStatusOnce(no);
    this._payStatusPollTimer = setInterval(function () {
      self._checkPayStatusOnce(no);
    }, PAY_STATUS_POLL_INTERVAL_MS);
    this._payStatusTimeoutTimer = setTimeout(function () {
      self._clearPayStatusTimers();
      self._redirectToTicketinfo(no);
    }, PAY_STATUS_POLL_TIMEOUT_MS);
  },

  _checkPayStatusOnce(outTradeNo) {
    const self = this;
    if (!outTradeNo) return;
    supabase.getOrderByOutTradeNo(outTradeNo).then(function (order) {
      if (!order) return;
      const status = (order.pay_status || order.payStatus || '').toString();
      if (status === 'SUCCESS') {
        self._clearPayStatusTimers();
        self._redirectToTicketinfo(outTradeNo);
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

  /** 从 mini-pay 响应中解析出 wx.requestPayment 所需参数（收银台参数） */
  _parseWeChatPayParams(data) {
    const raw = (data && data.paymentParams) || (data && data.data) || data || {};
    const timeStamp = (raw.timeStamp != null && raw.timeStamp !== '') ? String(raw.timeStamp) : ((raw.timestamp != null && raw.timestamp !== '') ? String(raw.timestamp) : '');
    const nonceStr = (raw.nonceStr != null && raw.nonceStr !== '') ? String(raw.nonceStr) : ((raw.noncestr != null && raw.noncestr !== '') ? String(raw.noncestr) : '');
    const packageStr = (raw.package != null && raw.package !== '') ? String(raw.package) : '';
    const signType = (raw.signType != null && raw.signType !== '') ? String(raw.signType) : ((raw.sign_type != null && raw.sign_type !== '') ? String(raw.sign_type) : 'MD5');
    const paySign = (raw.paySign != null && raw.paySign !== '') ? String(raw.paySign) : ((raw.pay_sign != null && raw.pay_sign !== '') ? String(raw.pay_sign) : ((raw.sign != null && raw.sign !== '') ? String(raw.sign) : ''));

    if (!timeStamp || !nonceStr || !packageStr || !paySign) return null;

    return {
      timeStamp: timeStamp,
      nonceStr: nonceStr,
      package: packageStr,
      signType: signType,
      paySign: paySign
    };
  },

  onUnload() {
    this._clearPayStatusTimers();
  }
});
