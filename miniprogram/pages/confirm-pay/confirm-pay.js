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
const couponApi = require('../../utils/couponApi.js');

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
    hasCoupons: false,         // 当前用户是否有券（与卡券管理同源），有券只显示券支付，无券只显示微信支付
    selectedCouponIds: [],     // 当前选中的券 id 列表，用于券支付（可多选）
    availableCoupons: [],
    boundCouponList: [],       // 已绑定的券列表（展示用）
    payRemain: '0.00',         // 券支付时「还需要支付」金额，来自 check_coupon.balance
    savedMoney: '0.00',        // 券支付时「已节省」金额，来自 check_coupon.savedMoney
    couponCheckResult: null,   // check_coupon 返回结果，下单时需与 coupons + cash 一致
    couponLackedTip: '',       // lackedEcode 非空时的提示文案
    couponCountTip: '',        // 券数量与购票数量不符时的提示（多/少）
    couponCheckLoading: false,
    showPasswordModal: false,
    _passwordInput: '',
    _memberCardPayCtx: null,
    showCouponModal: false,
    _couponCodeInput: '',
    _couponSubmitting: false,
    showCouponDetailModal: false,
    couponDetailData: null,
    _couponDetailCode: ''
  },

  onLoad(options) {
    if (!auth.redirectToLoginIfNeeded()) return;
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

  /** 无券时弹窗：重要提示 - 有券请先到卡券管理绑定，无券默认微信支付 */
  _showCouponTipModal() {
    wx.showModal({
      title: '重要提示',
      content: '如果您是我们重要的行业客户，您拥有我们的兑换券，请您先到我的-卡券管理-绑定您的券！如果不绑定，默认是微信支付，绑定券之后才能使用券支付，感谢您的理解和支持！\n热线电话：0314-2207000',
      cancelText: '我没有券',
      confirmText: '我去绑券',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/coupon-list/coupon-list' });
        }
      }
    });
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
    const onlyMemberCard = this.data.onlyMemberCard;
    if (!openid && !phone) {
      this._applyCouponListResult([], onlyMemberCard);
      return;
    }
    const promiseProfile = openid ? supabase.getUserProfileByOpenid(openid) : Promise.resolve(null);
    promiseProfile
      .then((profile) => {
        const userId = (profile && profile.user_id) ? String(profile.user_id).trim() : self._getUserId();
        if (!userId && !phone) {
          self._applyCouponListResult([], self.data.onlyMemberCard);
          return;
        }
        return supabase.getCouponListForUser(userId, phone);
      })
      .then((rows) => {
        if (!rows || !Array.isArray(rows)) {
          self._applyCouponListResult([], onlyMemberCard);
          return;
        }
        const list = rows.map((row) => ({
          id: row.id,
          couponCode: row.coupon_code || '',
          couponCodeMasked: maskCouponCode(row.coupon_code),
          validToStr: dateHelper.formatBeijingTime(row.valid_to, 'YYYY-MM-DD HH:mm'),
          status: row.status || 'available',
          isSelected: false
        }));
        const onlyMemberCard = self.data.onlyMemberCard;
        self._applyCouponListResult(list, onlyMemberCard);
      })
      .catch(() => {
        self._applyCouponListResult([], self.data.onlyMemberCard);
      });
  },

  /** 券列表加载完成后：有券只显示券支付且默认选中，无券只显示微信支付且默认选中；无券时弹出重要提示 */
  _applyCouponListResult(list, onlyMemberCard) {
    const hasCoupons = list.length > 0;
    this.setData({
      boundCouponList: list,
      availableCoupons: list,
      hasCoupons
    });
    if (!onlyMemberCard) {
      this.setData({ selectedMethod: hasCoupons ? 'coupon' : 'wechat' });
      if (!hasCoupons) this._showCouponTipModal();
    }
  },

  onSelectPayment(e) {
    const method = e.currentTarget.dataset.method;
    const orderId = this.data.orderId;
    this.setData({ selectedMethod: method }, () => {
      if (method === 'coupon' && orderId) {
        const newOutTradeNo = `mcyy-wechat-coupon-${orderId}`;
        supabase.updateOrder(orderId, {
          paytype: 'couponpay',
          out_trade_no: newOutTradeNo
        }).then(() => {
          const orderData = Object.assign({}, this.data.orderData || {}, { out_trade_no: newOutTradeNo });
          this.setData({ orderData, outTradeNo: newOutTradeNo });
        }).catch((err) => {
          console.warn('[confirm-pay] 更新订单 paytype/out_trade_no 失败', err);
        });
        this._applyCouponPayDisplay();
      }
    });
  },

  /** 券支付时：无选券则显示总计为待支付；有选券则调 check_coupon 更新 payRemain/savedMoney（不再与 order.num 数量校验）
   * @param {string[]} [overrideIds] - 可选，覆盖 selectedCouponIds（Android setData 回调时序用）
   * @param {Array} [overrideBoundList] - 可选，覆盖 boundCouponList
   */
  _applyCouponPayDisplay(overrideIds, overrideBoundList) {
    const ids = overrideIds != null ? overrideIds : (this.data.selectedCouponIds || []);
    const grandTotal = this._getGrandTotal();
    if (ids.length === 0) {
      this.setData({
        payRemain: grandTotal,
        savedMoney: '0.00',
        couponCheckResult: null,
        couponLackedTip: '',
        couponCountTip: ''
      });
      return;
    }
    this._fetchCheckCoupon(overrideIds, overrideBoundList);
  },

  /** 从订单数据取 cid、play_id、price、seat_num（供 check_coupon） */
  _getOrderParamsForCoupon() {
    const order = this.data.orderData || {};
    const cid = (order.cinema_id || order.cinemaId || order.cinema_num || '').toString().trim();
    const playId = (order.play_id || order.cine_play_id || order.playId || '').toString().trim();
    const num = Number(order.num) || 0;
    const total = parseFloat(order.total) || 0;
    const price = num > 0 ? (total / num).toFixed(2) : '0';
    const seatNum = String(num);
    return { cid, play_id: playId, price, seat_num: seatNum };
  },

  /** 调用 check_coupon，用当前订单 + 已选券试算，更新 payRemain、savedMoney、couponLackedTip（不再与 order.num 数量校验）
   * @param {string[]} [overrideIds] - 可选
   * @param {Array} [overrideBoundList] - 可选
   */
  _fetchCheckCoupon(overrideIds, overrideBoundList) {
    const { orderData } = this.data;
    const ids = overrideIds != null ? overrideIds : (this.data.selectedCouponIds || []);
    const boundCouponList = overrideBoundList != null ? overrideBoundList : (this.data.boundCouponList || []);
    if (!orderData || ids.length === 0) {
      this.setData({ payRemain: this._getGrandTotal(), savedMoney: '0.00', couponCheckResult: null, couponLackedTip: '', couponCountTip: '', couponCheckLoading: false });
      return;
    }
    const codes = ids.map((id) => {
      const c = (boundCouponList || []).find((x) => String(x.id) === String(id));
      return c ? (c.couponCode || '').trim() : '';
    }).filter(Boolean);
    if (codes.length === 0) {
      this.setData({ payRemain: this._getGrandTotal(), savedMoney: '0.00', couponCheckResult: null, couponLackedTip: '', couponCountTip: '', couponCheckLoading: false });
      return;
    }
    const { cid, play_id, price, seat_num } = this._getOrderParamsForCoupon();
    if (!cid || !play_id) {
      this.setData({ couponCheckLoading: false, couponLackedTip: '订单缺少影院或场次信息' });
      return;
    }
    this.setData({ couponCheckLoading: true, couponLackedTip: '' });
    const self = this;
    couponApi.checkCoupon({
      cid,
      play_id,
      price,
      seat_num,
      coupons: codes.join(',')
    }).then((data) => {
      const balance = (data.balance != null ? Number(data.balance) : 0);
      const saved = (data.savedMoney != null ? Number(data.savedMoney) : 0);
      const lacked = (data.lackedEcode && (Array.isArray(data.lackedEcode) ? data.lackedEcode.length : 1)) ? (data.lackedEcode.join ? data.lackedEcode.join('、') : '当前券不足或规则不满足') : '';
      self.setData({
        payRemain: balance.toFixed(2),
        savedMoney: saved.toFixed(2),
        couponCheckResult: data,
        couponLackedTip: lacked,
        couponCountTip: '',
        couponCheckLoading: false
      });
    }).catch((err) => {
      console.warn('[confirm-pay] check_coupon 失败', err);
      self.setData({
        payRemain: self._getGrandTotal(),
        savedMoney: '0.00',
        couponCheckResult: null,
        couponLackedTip: (err && err.message) || '试算失败，请重试',
        couponCountTip: '',
        couponCheckLoading: false
      });
    });
  },

  /** 获取订单购票数量（券数量规则：1 张票 = 1 张券） */
  _getOrderNum() {
    const order = this.data.orderData || {};
    return Math.max(0, Math.floor(Number(order.num) || 0));
  },

  /** 点击券卡片或选择框：多选/取消该券（不再与 order.num 数量限制） */
  onSelectCouponCard(e) {
    const id = String(e.currentTarget.dataset.couponId || '');
    if (!id) return;
    const current = this.data.selectedCouponIds || [];
    const has = current.some((x) => String(x) === id);
    const next = has ? current.filter((x) => String(x) !== id) : current.concat([id]);
    const list = (this.data.boundCouponList || []).map((c) =>
      Object.assign({}, c, { isSelected: next.indexOf(String(c.id)) >= 0 })
    );
    this.setData({ selectedCouponIds: next, boundCouponList: list }, () => {
      if (this.data.selectedMethod === 'coupon') {
        // Android 上 setData 回调可能早于数据完全同步，用 nextTick 确保 _applyCouponPayDisplay 读到最新数据
        const ids = next;
        const boundList = list;
        if (typeof wx.nextTick === 'function') {
          wx.nextTick(() => { this._applyCouponPayDisplay(ids, boundList); });
        } else {
          setTimeout(() => { this._applyCouponPayDisplay(ids, boundList); }, 0);
        }
      }
    });
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

  /** 仅点击蒙层（非弹窗内容）时关闭，避免点输入框时关闭且不拦截输入 */
  onCouponModalMaskTap(e) {
    if (!e || !e.target || !e.currentTarget) return;
    const tid = (e.target && e.target.id) || '';
    const cid = (e.currentTarget && e.currentTarget.id) || '';
    if (tid === cid && cid === 'couponModalMask') this.onCouponModalCancel();
  },

  /** 弹窗内确认：先调券详情接口，弹框展示券详情，取消仅关闭提示框，确定则写入 coupon_instance */
  onCouponModalConfirm() {
    const code = String(this.data._couponCodeInput || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入券码', icon: 'none' });
      return;
    }
    const self = this;
    const order = this.data.orderData || {};
    const cid = (order.cinema_id || order.cinemaId || order.cinema_num || '').toString().trim();
    if (!cid) {
      wx.showToast({ title: '当前无影院信息，无法校验券', icon: 'none' });
      return;
    }
    self.setData({ _couponSubmitting: true });
    couponApi.getCouponDetail(cid, code)
      .then((detail) => {
        const avail = detail.couponAvailable ?? detail.coupon_available;
        const availNum = avail != null ? Number(avail) : null;
        const reason = detail.unavailabilityReason ?? detail.unavailability_reason ?? 0;
        const reasonText = (couponApi.getUnavailabilityReasonText || (() => '不可用'))(reason);
        const normalized = Object.assign({}, detail, { couponAvailable: availNum, unavailabilityReasonText: reasonText });
        self.setData({
          _couponSubmitting: false,
          showCouponDetailModal: true,
          couponDetailData: normalized,
          _couponDetailCode: code
        });
      })
      .catch((err) => {
        self.setData({
          _couponSubmitting: false,
          showCouponDetailModal: true,
          couponDetailData: { error: (err && err.message) || '券详情查询失败' },
          _couponDetailCode: code
        });
      });
  },

  /** 券详情弹框：取消 → 仅关闭详情框 */
  onCouponDetailModalCancel() {
    this.setData({ showCouponDetailModal: false, couponDetailData: null, _couponDetailCode: '' });
  },

  /** 券详情弹框：确定 → 仅 couponAvailable=1 时才能添加/绑定，否则提示券状态不正确 */
  onCouponDetailModalConfirm() {
    const { couponDetailData, _couponDetailCode } = this.data;
    const self = this;
    this.setData({ showCouponDetailModal: false, couponDetailData: null, _couponDetailCode: '' });
    if (!couponDetailData || couponDetailData.error) return;
    const avail = couponDetailData.couponAvailable ?? couponDetailData.coupon_available;
    if (Number(avail) !== 1) {
      wx.showToast({ title: '券状态不正确，不能绑定', icon: 'none' });
      return;
    }
    const code = String(_couponDetailCode || '').trim();
    if (!code) return;
    const userId = this._getUserId();
    const phone = this._getUserPhone();
    supabase.insertCouponFromDetail(couponDetailData, code, userId || undefined, phone || undefined)
      .then(() => {
        wx.showToast({ title: '添加成功', icon: 'success' });
        self.setData({ showCouponModal: false, _couponCodeInput: '' });
        self._loadCoupons();
      })
      .catch((err) => {
        const msg = (err && err.message) || '';
        if (msg.indexOf('duplicate') !== -1 || msg.indexOf('唯一') !== -1 || msg.indexOf('already exists') !== -1) {
          if (userId) {
            supabase.bindCoupon(userId, code).then(() => {
              wx.showToast({ title: '绑定成功', icon: 'success' });
              self.setData({ showCouponModal: false, _couponCodeInput: '' });
              self._loadCoupons();
            }).catch((e2) => {
              wx.showToast({ title: (e2 && e2.message) || '绑定失败', icon: 'none' });
            });
            return;
          }
        }
        wx.showToast({ title: msg || '写入失败', icon: 'none' });
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
    const { selectedMethod, orderData, outTradeNo, selectedCouponIds, boundCouponList, couponCheckResult, couponLackedTip } = this.data;
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
      const selCount = (selectedCouponIds || []).length;
      if (selCount === 0) {
        wx.showToast({ title: '请选择要使用的券', icon: 'none' });
        return;
      }
      if (couponLackedTip) {
        wx.showToast({ title: couponLackedTip, icon: 'none', duration: 2500 });
        return;
      }
      if (!couponCheckResult || couponCheckResult.balance == null) {
        wx.showToast({ title: '请等待试算完成或重新选择券', icon: 'none' });
        return;
      }
      if (!outTradeNo) {
        wx.showToast({ title: '订单号异常，无法支付', icon: 'none' });
        return;
      }
      this._processCouponPay(orderData);
    }
  },

  /**
   * 券支付：1) 更新 order.total 为券后金额；2) 调起微信支付（金额为 0 时付 0.01 元）；3) 轮询 pay_status 跳转 ticketinfo（不出票）
   */
  async _processCouponPay(orderData) {
    const { couponCheckResult, outTradeNo, orderId } = this.data;
    const payRemainVal = parseFloat(couponCheckResult && couponCheckResult.balance != null ? couponCheckResult.balance : 0) || 0;
    const totalInCents = payRemainVal > 0 ? Math.round(payRemainVal * 100) : 1;
    const cashStr = (totalInCents / 100).toFixed(2);

    const doCouponPay = () => {
      wx.showLoading({ title: '正在准备支付...' });
      this._doCouponPayInner({ orderData, cashStr, totalInCents, outTradeNo, orderId });
    };

    if (cashStr === '0.01') {
      wx.showModal({
        title: '提示',
        content: '您此单购票由兑换票全额兑换，没有费用，但为了保证您的权益，需要您预先支付0.01元，在出票成功之后，系统会自动退回',
        confirmText: '同意继续',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) doCouponPay();
        }
      });
      return;
    }

    doCouponPay();
  },

  async _doCouponPayInner(args) {
    const { orderData, cashStr, totalInCents, outTradeNo, orderId } = args;
    try {
      const ids = this.data.selectedCouponIds || [];
      const boundCouponList = this.data.boundCouponList || [];
      const codes = ids.map((id) => {
        const c = boundCouponList.find((x) => String(x.id) === String(id));
        return c ? (c.couponCode || '').trim() : '';
      }).filter(Boolean);
      const cardNumberStr = codes.join(',') || null;
      await supabase.updateOrder(orderId, { total: cashStr, card_number: cardNumberStr });
      const orderDataNew = Object.assign({}, orderData || {}, { total: parseFloat(cashStr) });
      this.setData({ orderData: orderDataNew });

      wx.hideLoading();
      this._processWeChatPay(outTradeNo, totalInCents, orderDataNew);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '券支付准备失败', icon: 'none' });
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
        wx.reLaunch({ url: '/pages/order/order' });
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

  /** 跳转影票详情页，用 reLaunch 清空页面栈，防止用户返回到选座/支付页 */
  _redirectToTicketinfo(outTradeNoParam) {
    const no = (outTradeNoParam && String(outTradeNoParam).trim()) || (this.data.orderData && (this.data.orderData.out_trade_no || this.data.orderData.outTradeNo) && String(this.data.orderData.out_trade_no || this.data.orderData.outTradeNo).trim()) || '';
    if (!no) {
      wx.showToast({ title: '订单号缺失，请从订单列表查看', icon: 'none' });
      wx.reLaunch({ url: '/pages/order/order' });
      return;
    }
    wx.reLaunch({ url: '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(no) });
  },

  /** 支付成功后：轮询 cinema_order_list.pay_status，为 SUCCESS 时跳转 ticketinfo */
  _startPayStatusPoll(outTradeNo) {
    const no = (outTradeNo && String(outTradeNo).trim()) || (this.data.orderData && (this.data.orderData.out_trade_no || this.data.orderData.outTradeNo) && String(this.data.orderData.out_trade_no || this.data.orderData.outTradeNo).trim()) || '';
    if (!no) {
      wx.showToast({ title: '订单号缺失，请从订单列表查看', icon: 'none' });
      wx.reLaunch({ url: '/pages/order/order' });
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
