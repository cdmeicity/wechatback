/**
 * 选座页 - 按 VI 规范实现
 * 参照 Flutter SeatSelectPage 逻辑
 */
const seatApi = require('../../utils/seatApi.js');
const supabase = require('../../utils/supabase.js');
const dingxin = require('../../utils/dingxinRequest.js');
const cardApi = require('../../utils/cardApi.js');
const saopayRequest = require('../../utils/saopayRequest.js');
const auth = require('../../utils/auth.js');
const md5 = require('../../utils/md5.js');
const dateHelper = require('../../utils/dateHelper.js');

const MAX_SEATS = 5; // 单笔订单最多选座数
/** 退改签协议文案（确认选座后、跳转支付前必显） */
const REFUND_CHANGE_AGREEMENT = '购票后如需退票、改签，请按影院及平台公示的退改签规则办理，具体以实际规则为准。是否同意并继续？';
const N7_POLL_INTERVAL_MS = 2000;
const N7_TIMEOUT_MS = 60000;
const M65_POLL_INTERVAL_MS = 1500;  // 会员卡支付后轮询 pay_status 间隔
const M65_POLL_TIMEOUT_MS = 15000;  // 会员卡支付后轮询超时，超时后仍跳转 ticketinfo

Page({
  data: {
    seatScrollLeft: 0,
    statusBarHeight: 20,
    contentTop: 64,
    loading: true,
    loadingSeats: true,
    movieName: '',
    movieLanguage: '',
    hallName: '',
    showTimeStr: '',
    seats: [],
    seatGrid: [], // [[rowIndex, [seats]]] 按 x 分行的座位
    maxX: 0,
    maxY: 0,
    selectedIds: [],
    selectedNames: [],
    totalPrice: '0.00',
    unitPrice: 0,
    orderId: '',
    outTradeNo: '',
    playId: '',
    order: null,
    ruleInfo: null,  // v_lanjie_interception_rules 拦截规则（cinema_code=cinemaNumber）
    showProcessingTicketModal: false,
    processingTicketOutTradeNo: '',
    showMemberCardPasswordModal: false,
    _memberCardPayCtx: null,
    _memberCardPasswordInput: ''
  },

  async onLoad(options) {
    const playId = options.playId || '';
    const orderId = options.orderId || '';
    const outTradeNo = options.outTradeNo || '';
    const app = getApp();
    const gd = app?.globalData || {};
    const order = gd.playOrder || null;
    const showtime = gd.playShowtime || null;
    const movie = gd.playMovie || null;
    const priceDetails = gd.playPriceDetails || null;

    let movieName = (order?.movie_name ?? movie?.name ?? movie?.movieName ?? '').toString() || '选座';
    const movieLanguage = (order?.movie_language ?? showtime?.language ?? '').toString();
    let hallName = (order?.hall_name ?? showtime?.hallName ?? '').toString() || '屏幕';
    const showTimeStr = showtime?.startTime ? dateHelper.formatBeijingTime(showtime.startTime, 'HH:mm') : '';
    const unitPrice = Number(priceDetails?.unitPrice ?? order?.unit_price ?? 0) || 0;

    console.log('[seat-select][onLoad] 【选座页】收到的价格', {
      fromPlayPriceDetails: priceDetails?.unitPrice,
      fromOrder: order?.unit_price,
      最终使用unitPrice: unitPrice,
      playId,
      orderId
    });

    const sysInfo = wx.getSystemInfoSync();
    const statusBarHeight = sysInfo.statusBarHeight || 20;
    const contentTop = statusBarHeight + 44;

    // 加载 v_lanjie_interception_rules（cinema_code=app.cinemainfo.cinemaNumber）
    const cinemaNumber = gd.cinemainfo?.cinemaNumber || gd.cinemainfo?.cinema_num || '';
    let ruleInfo = null;
    if (cinemaNumber) {
      try {
        ruleInfo = await supabase.getInterceptionRules(cinemaNumber);
        console.log('[seat-select][R0] v_lanjie_interception_rules 加载', { cinemaNumber, ruleInfo: ruleInfo ? '有' : '无', lock_minute: ruleInfo?.lock_minute, movie_code: ruleInfo?.movie_code });
      } catch (e) {
        console.warn('[seat-select][R0] 加载拦截规则失败', e);
      }
    }

    this.setData({
      playId,
      orderId,
      outTradeNo,
      order,
      movieName,
      movieLanguage,
      hallName,
      showTimeStr,
      unitPrice,
      statusBarHeight,
      contentTop,
      ruleInfo
    });

    this._loadSeats();
  },

  onNavBack() {
    wx.navigateBack();
  },

  /** 调试：仅日志，不弹窗 */
  _node(title, content, extra) {
    const msg = '[' + title + '] ' + content;
    console.log('[seat-select]' + msg, extra !== undefined ? extra : '');
    return Promise.resolve();
    // wx.showModal({ title, content: content + (extra ? '\n\n' + JSON.stringify(extra) : ''), showCancel: false, confirmText: '确定', success: () => resolve() });
  },

  _nodeSync(title, content, extra) {
    const msg = '[' + title + '] ' + content;
    console.log('[seat-select]' + msg, extra !== undefined ? extra : '');
    // wx.showModal({ title, content: content + (extra ? '\n\n' + JSON.stringify(extra) : ''), showCancel: false, confirmText: '确定' });
  },

  /** 解绑会员卡（当日/当场购票限制后确定），调后端 card_unbind */
  _handleUnbindCard(app) {
    const gd = app && app.globalData;
    if (!gd) return;
    const user = gd.supabaseUser;
    const userId = user && (user.id || user.userId || user.user_id);
    if (!userId) {
      gd.cardinfo = null;
      // wx.showToast({ title: '已解绑', icon: 'none' });
      return;
    }
    const cid = gd.cinemainfo && (gd.cinemainfo.cinemaid || gd.cinemainfo.cinemaNumber || gd.cinemainfo.id);
    cardApi.cardUnbind({ user_id: userId, cid: cid || undefined }).then(() => {
      gd.cardinfo = null;
      // wx.showToast({ title: '已解绑会员卡', icon: 'none' });
    }).catch(() => {
      gd.cardinfo = null;
      // wx.showToast({ title: '解绑失败', icon: 'none' });
    });
  },

  /** 6.4 会员锁座：POST member/seat_lock，成功后更新 lock_flag 并跳转 confirm-pay（onlyMemberCard） */
  async _lockSeatForMember(cardNumber, orderId, playId, selectedIds, orderData, app) {
    console.log('[seat-select][M6.4] 会员锁座开始', { cardNumber, orderId, playId, seatIds: selectedIds });
    await this._node('M6.4', '会员锁座，即将请求 member/seat_lock', { cardNumber, orderId, playId });
    const cid = orderData.cinema_id || orderData.cinemaId || orderData.cinema_num || '';
    const playUpdateTime = (orderData.play_update_time || orderData.playUpdateTime || '').toString();
    let playUpdateTimeStr = playUpdateTime;
    if (playUpdateTime && playUpdateTime.indexOf('T') !== -1) {
      const datePart = dateHelper.formatBeijingTime(playUpdateTime, 'YYYY-MM-DD');
      const timePart = dateHelper.formatBeijingTime(playUpdateTime, 'HH:mm:ss');
      if (datePart) playUpdateTimeStr = datePart + ' ' + timePart;
    }
    const seatIdStr = selectedIds.map(String).join(',');
    console.log('[seat-select][M6.4] 会员锁座请求', { cid, play_id: playId, seat_id: seatIdStr, card: cardNumber });
    try {
      const res = await cardApi.memberSeatLock({
        cid,
        play_id: playId,
        seat_id: seatIdStr,
        play_update_time: playUpdateTimeStr,
        card: cardNumber
      });
      const lockFlag = (res && res.data && (res.data.lockFlag || res.data.lock_flag)) || (res && (res.lockFlag || res.lock_flag));
      const success = lockFlag && ((res && (res.code === 200 || res.code === 0)) || !res);
      console.log('[seat-select][M6.4] 会员锁座响应', { success, lockFlag, code: res && res.code });
      if (success) {
        await supabase.updateOrder(orderId, { lock_flag: lockFlag });
        console.log('[seat-select][M6.4] 会员锁座成功，订单 lock_flag 已更新');
        await this._node('M6.4', '会员锁座成功，弹退改签协议后跳转 confirm-pay');
        const updatedOrder = Object.assign({}, orderData, { lock_flag: lockFlag });
        if (app && app.globalData) app.globalData.playOrder = updatedOrder;
        wx.showModal({
          title: '退改签协议',
          content: REFUND_CHANGE_AGREEMENT,
          confirmText: '同意',
          cancelText: '不同意',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/confirm-pay/confirm-pay?onlyMemberCard=1' });
          }
        });
      } else {
        const errMsg = (res && (res.message || res.msg)) || '未知错误';
        console.log('[seat-select][M6.4] 会员锁座失败', { errMsg });
        this._nodeSync('M6.4', '会员锁座失败', { errMsg });
        // wx.showToast({ title: '锁座失败: ' + errMsg, icon: 'none' });
      }
    } catch (e) {
      console.error('[seat-select][M6.4] 会员锁座异常', e);
      this._nodeSync('M6.4', '会员锁座异常', { err: e.message || e.errMsg });
      // wx.showToast({ title: '锁座失败: ' + (e.message || e.errMsg || '未知错误'), icon: 'none' });
    }
  },

  onMemberCardPasswordInput: function (e) {
    this.setData({ _memberCardPasswordInput: (e.detail && e.detail.value) || '' });
  },
  onMemberCardPasswordConfirm: function () {
    const pwd = (this.data._memberCardPasswordInput || '').trim();
    if (!pwd) {
      // wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    const ctx = this.data._memberCardPayCtx;
    if (!ctx) return;
    this.setData({ showMemberCardPasswordModal: false, _memberCardPasswordInput: '', _memberCardPayCtx: null });
    this._doMemberCardPayInSeatSelect(ctx, pwd);
  },
  onMemberCardPasswordCancel: function () {
    this.setData({ showMemberCardPasswordModal: false, _memberCardPasswordInput: '', _memberCardPayCtx: null });
  },

  async _doMemberCardPayInSeatSelect(ctx, plainPassword) {
    const { updatedOrderData, cardNumber, cinemaId, playId, selectedIds, total, orderId, outTradeNo, partnerBuyTicketId } = ctx;
    if (!cinemaId || !cardNumber || !playId || !selectedIds || selectedIds.length === 0 || !partnerBuyTicketId) {
      // wx.showToast({ title: '参数不完整，无法支付', icon: 'none' });
      return;
    }
    const app = getApp();
    const mobile = (app.globalData.supabaseUser && (app.globalData.supabaseUser.phone || app.globalData.supabaseUser.mobile)) || '';
    if (!mobile) {
      // wx.showToast({ title: '请先登录并绑定手机号', icon: 'none' });
      return;
    }
    const passwordMd5 = md5(plainPassword).toLowerCase();

    // wx.showLoading({ title: '正在处理扣费...' });
    try {
      // num：订单合计金额（元）取整；goods_card_balance_pay：订单金额两位小数（后端会按 num 统一）
      const totalNum = (total != null && total !== '') ? Number(total) : 0;
      const num = Math.round(totalNum);
      const goodsCardBalancePay = totalNum ? totalNum.toFixed(2) : '0.00';
      console.log('[会员卡支付-选座页] num(订单金额取整), goods_card_balance_pay', num, goodsCardBalancePay);
      // out_trade_no 来源于 order.out_trade_no
      const res = await cardApi.memberCardPayTicket({
        cid: cinemaId,
        card: cardNumber,
        password: passwordMd5,
        play_id: playId,
        seat_list: selectedIds,
        partner_buy_ticket_id: partnerBuyTicketId,
        num,
        goods_card_balance_pay: goodsCardBalancePay,
        mobile: mobile.replace(/^\+?86/, '').trim(),
        total: total,
        out_trade_no: updatedOrderData?.out_trade_no ?? outTradeNo,
        order_id: orderId
      });
      // wx.hideLoading();
      const isOk = res && (res.code === 200 || res.code === '200');
      if (!isOk) {
        const msg = (res && (res.message || res.msg)) || '扣费失败';
        // wx.showToast({ title: msg, icon: 'none' });
        return;
      }
      if (outTradeNo) {
        // wx.showToast({ title: '扣费成功，正在跳转取票页…', icon: 'none', duration: 2000 });
        this._startM65PayStatusPoll(outTradeNo);
      } else {
        // wx.showModal({ title: '扣费成功', content: '会员卡扣费成功。', showCancel: false, confirmText: '确定', success: function () { wx.switchTab(...); } });
        wx.switchTab({ url: '/pages/index/index' });
      }
    } catch (e) {
      // wx.hideLoading();
      // wx.showToast({ title: (e.message || e.errMsg) || '扣费失败，请重试', icon: 'none' });
    }
  },

  async _loadSeats() {
    const { order, playId } = this.data;
    this.setData({ loadingSeats: true });
    console.log('[seat-select][L0] _loadSeats 开始', { orderId: order?.id, playId });

    if (!order || !playId) {
      console.log('[seat-select][L0] 判断：无订单或 playId，使用模拟座位');
      this._useMockSeats();
      this.setData({ loadingSeats: false, loading: false });
      return;
    }

    const cid = order.cinema_id || order.cinemaId || '';
    const playUpdateTime = order.play_update_time || order.playUpdateTime || '';
    const cinemaNum = order.cinema_num || order.cinemaNum || '';
    console.log('[seat-select][L0] 请求座位状态', { cid, playId, playUpdateTime, cinemaNum });

    try {
      const list = await seatApi.getSeatStatus({
        cid,
        playId,
        playUpdateTime,
        cinemaNum
      });

      if (list && list.length > 0) {
        console.log('[seat-select][L0] 座位数据解析成功 座位数=', list.length);
        this._buildSeatGrid(list);
      } else {
        console.log('[seat-select][L0] 座位数据为空，使用模拟座位');
        this._useMockSeats();
      }
    } catch (e) {
      console.error('[seat-select][L0] 加载座位失败', e);
      this._useMockSeats();
    }

    this.setData({ loadingSeats: false, loading: false });
  },

  _buildSeatGrid(allSeats) {
    console.log('[seat-select][L0] _buildSeatGrid 开始', { seatCount: allSeats.length });
    const grid = {};
    let maxX = 0;
    let maxY = 0;
    allSeats.forEach((s) => {
      const x = s.x || 0;
      const y = s.y || 0;
      if (!grid[x]) grid[x] = {};
      grid[x][y] = { ...s, isSelected: false };
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });

    // x 为行，y 为列；按行(x)分组展示
    const seatGrid = [];
    for (let x = 1; x <= maxX; x++) {
      const row = grid[x] || {};
      const rowSeats = [];
      let rowLabel = '';
      for (let y = 1; y <= maxY; y++) {
        const seat = row[y];
        if (seat) {
          rowSeats.push(seat);
          if (!rowLabel && seat.rowValue && seat.rowValue !== '0') rowLabel = seat.rowValue;
        } else {
          rowSeats.push(null);
        }
      }
      seatGrid.push({ x, rowLabel, seats: rowSeats });
    }

    this.setData({
      seats: allSeats,
      seatGrid,
      maxX,
      maxY
    }, () => this._scrollSeatToCenter());
    console.log('[seat-select][L0] _buildSeatGrid 完成', { maxX, maxY, rows: seatGrid.length });
  },

  _useMockSeats() {
    const allSeats = [];
    let id = 1;
    for (let y = 1; y <= 8; y++) {
      const rowVal = String.fromCharCode(64 + y);
      for (let x = 1; x <= 9; x++) {
        if (x === 5) {
          allSeats.push({
            x, y, rowValue: '0', columnValue: '0', cineSeatId: 0,
            status: 'ok', type: 'road', isRoad: true
          });
        } else {
          const booked = (y === 1 && x <= 3) || (y === 3 && (x === 5 || x === 6)) || (y === 5 && (x === 2 || x === 3));
          allSeats.push({
            x, y, rowValue: rowVal, columnValue: String(x), cineSeatId: id++,
            status: booked ? 'booked' : 'ok', type: 'danren', isRoad: false
          });
        }
      }
    }
    this._buildSeatGrid(allSeats);
  },

  _scrollSeatToCenter() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#seatGrid').boundingClientRect();
    query.select('.seat-scroll').boundingClientRect();
    query.exec((res) => {
      if (!res || res[0] == null || res[1] == null) return;
      const gridW = res[0].width;
      const scrollW = res[1].width;
      if (gridW > scrollW) {
        const left = Math.round((gridW - scrollW) / 2);
        this.setData({ seatScrollLeft: left });
      }
    });
  },

  _getSeatName(seat) {
    if (!seat || seat.type === 'road' || seat.rowValue === '0') return '';
    return `${seat.rowValue}排${seat.columnValue}座`;
  },

  toggleSeat(e) {
    const seat = e.currentTarget.dataset.seat;
    console.log('[seat-select][S1] toggleSeat 点击', seat ? { cineSeatId: seat.cineSeatId, rowValue: seat.rowValue, columnValue: seat.columnValue, status: seat.status, type: seat.type } : null);

    if (!seat || seat.type === 'road' || seat.isRoad) {
      console.log('[seat-select][S2] 跳过：非座位或过道');
      return;
    }
    if (seat.status !== 'ok' && seat.status !== 'selected') {
      console.log('[seat-select][S3] 跳过：座位不可选 status=', seat.status);
      return;
    }

    const { selectedIds, selectedNames, seatGrid } = this.data;
    const isSelected = selectedIds.includes(seat.cineSeatId);
    console.log('[seat-select][S4] 当前选定座位', { selectedIds, selectedNames, isSelected, MAX_SEATS });

    if (isSelected) {
      const newIds = selectedIds.filter((id) => id !== seat.cineSeatId);
      const name = this._getSeatName(seat);
      const newNames = selectedNames.filter((n) => n !== name);
      console.log('[seat-select][S5] 取消选座', { cineSeatId: seat.cineSeatId, name, newIds, newNames });
      this._updateSeatSelection(seatGrid, seat.cineSeatId, false);
      this.setData({
        selectedIds: newIds,
        selectedNames: newNames,
        seatGrid: this.data.seatGrid,
        totalPrice: (this.data.unitPrice * newIds.length).toFixed(2)
      });
    } else {
      if (selectedIds.length >= MAX_SEATS) {
        console.log('[seat-select][S6] 已达上限 MAX_SEATS=', MAX_SEATS);
        // wx.showToast({ title: '最多选5个座位', icon: 'none' });
        return;
      }
      const newIds = selectedIds.concat(seat.cineSeatId);
      const name = this._getSeatName(seat);
      const newNames = selectedNames.concat(name);
      console.log('[seat-select][S7] 新增选座', { cineSeatId: seat.cineSeatId, name, newIds, newNames });
      this._updateSeatSelection(seatGrid, seat.cineSeatId, true);
      this.setData({
        selectedIds: newIds,
        selectedNames: newNames,
        seatGrid: this.data.seatGrid,
        totalPrice: (this.data.unitPrice * newIds.length).toFixed(2)
      });
    }
  },

  _updateSeatSelection(seatGrid, cineSeatId, selected) {
    seatGrid.forEach((row) => {
      row.seats.forEach((s) => {
        if (s && s.cineSeatId === cineSeatId) {
          s.isSelected = selected;
          s.status = selected ? 'selected' : 'ok';
        }
      });
    });
  },

  async onConfirm() {
    const { selectedIds, selectedNames, orderId, outTradeNo, order, unitPrice, playId } = this.data;

    // E1: 点击确认选座 - 完整状态汇总
    console.log('[seat-select][E1] 点击确认选座', {
      selectedIds,
      selectedNames,
      orderId,
      outTradeNo,
      playId,
      unitPrice,
      orderKeys: order ? Object.keys(order) : []
    });

    // P1: 最少座位数判断
    const requiredSeatCount = 1;
    const p1Pass = selectedIds.length >= requiredSeatCount;
    console.log('[seat-select][P1] 最少座位数判断', {
      selectedIds_length: selectedIds.length,
      requiredSeatCount,
      pass: p1Pass
    });
    if (!p1Pass) {
      // wx.showToast({ title: '请选择座位', icon: 'none' });
      return;
    }

    // U3-U8: 订单字段计算
    const num = selectedIds.length;
    const total = unitPrice * num;
    const handlingFees = 3 * num;
    const serviceFee = (order?.service_fee ?? 0) * num;
    const patchData = {
      num,
      total,
      handling_fees: handlingFees,
      service_fee: serviceFee,
      seat_list: selectedNames,
      seat_id: selectedIds
    };
    console.log('[seat-select][U3-U8] 订单字段计算', {
      num,
      total,
      handling_fees: handlingFees,
      service_fee: serviceFee,
      seat_list: selectedNames,
      seat_id: selectedIds
    });

    // U9: 订单 id 判断
    const u9Pass = !!orderId;
    console.log('[seat-select][U9] 订单 id 判断', { orderId, pass: u9Pass });
    if (!u9Pass) {
      // wx.showToast({ title: '订单不存在', icon: 'none' });
      return;
    }

    try {
      console.log('[seat-select][U10] 调用 Supabase 更新订单', { orderId, patchData });
      await supabase.updateOrder(orderId, patchData);
      console.log('[seat-select][U10] 订单更新成功', { orderId });

      // wx.showToast({ title: '选座成功', icon: 'success' });

      // U12: 会员/非会员分流
      const app = getApp();
      const cardinfo = app && app.globalData && app.globalData.cardinfo;
      const isMember = !!(cardinfo && (cardinfo.cardNumber || cardinfo.card_no));
      console.log('[seat-select][U12] 会员/非会员判断', {
        cardinfo: cardinfo ? '有' : '无',
        cardNumber: cardinfo && (cardinfo.cardNumber || cardinfo.card_no),
        isMember
      });
      await this._node('U12', '会员/非会员分流', { isMember: isMember, cardNumber: cardinfo && (cardinfo.cardNumber || cardinfo.card_no) });

      if (isMember) {
        // M: 会员支付分支
        const cardNumber = cardinfo.cardNumber || cardinfo.card_no;
        console.log('[seat-select][M] 会员支付分支', { cardNumber });
        await this._node('M', '进入会员支付分支', { cardNumber });
        const { order: orderData, ruleInfo: rule } = this.data;
        const showtime = app.globalData && app.globalData.playShowtime;
        const movie = app.globalData && app.globalData.playMovie;

        // 6.2 购买限制检查
        const cid = orderData.cinema_id || orderData.cinemaId || orderData.cinema_num || '';
        const totalStr = total.toFixed(2);
        let orderConfirmRes = null;
        try {
          console.log('[seat-select][M6.2] order_confirm 请求', { cid, card: cardNumber, play_id: playId, total: totalStr });
          orderConfirmRes = await cardApi.orderConfirm({ cid, card: cardNumber, play_id: playId, total: totalStr });
          console.log('[seat-select][M6.2] order_confirm 响应', { res: orderConfirmRes });
          const data0 = orderConfirmRes && (orderConfirmRes.data || orderConfirmRes);
          await this._node('M6.2', '购买限制检查 order_confirm 返回', { isNull: !orderConfirmRes, canBuy: data0 && data0.canBuy, hasBalanceCheck: !!(data0 && data0.balanceCheck), hasDayBuyInfo: !!(data0 && data0.dayBuyInfo), hasShowBuyInfo: !!(data0 && data0.showBuyInfo) });
        } catch (e6) {
          console.warn('[seat-select][M6.2] order_confirm 请求异常', e6);
          await this._node('M6.2', 'order_confirm 请求异常，按 null 处理继续', { err: e6.message || String(e6) });
        }

        if (orderConfirmRes) {
          const data = orderConfirmRes.data || orderConfirmRes;
          const canBuy = data.canBuy;
          const msg = data._message || data.message || data.msg || '';
          const reasons = Array.isArray(data.reasons) ? data.reasons.join('；') : (data.reasons || '');

          if (canBuy === false) {
            console.log('[seat-select][M6.2] canBuy=false，订单确认失败', { msg, reasons });
            // wx.showModal({ title: '[M6.2] 订单确认失败', content: msg || reasons || '无法确认订单', showCancel: false, confirmText: '确定' });
            return;
          }

          const balanceCheck = data.balanceCheck || {};
          if (balanceCheck.canPay === false) {
            console.log('[seat-select][M6.2] balanceCheck.canPay=false，余额不足', { balance: balanceCheck.balance, total: totalStr });
            // wx.showModal({ title: '余额不足', ... success: (modalRes) => { if (modalRes.confirm) wx.navigateTo(...); } });
            return;
          }

          const dayBuyInfo = data.dayBuyInfo || {};
          if (dayBuyInfo.canBuy === false) {
            console.log('[seat-select][M6.2] dayBuyInfo.canBuy=false，当日购票限制');
            // wx.showModal({ title: '当日购票限制', content: dayContent, cancelText: '取消', confirmText: '确定', success: (modalRes) => { if (modalRes.confirm) this._handleUnbindCard(app); } });
            return;
          }

          const showBuyInfo = data.showBuyInfo || {};
          if (showBuyInfo.canBuy === false) {
            console.log('[seat-select][M6.2] showBuyInfo.canBuy=false，当场购票限制');
            // wx.showModal({ title: '当场购票限制', content: showContent, cancelText: '取消', confirmText: '确定', success: (modalRes) => { if (modalRes.confirm) this._handleUnbindCard(app); } });
            return;
          }
        }

        // 6.3 会员时间判断：开场时间用数据库字段（北京时间），当前时间用 Date.now()（UTC 当前时刻），做差得距开场分钟数
        const orderStartTime = orderData.start_time || (showtime && showtime.startTime);
        const lockMinuteValue = (rule && rule.lock_minute != null) ? Number(rule.lock_minute) : 60;
        let minutesDifference = null;
        const startTimeMs = dateHelper.beijingTimeStringToMs(orderStartTime);
        if (startTimeMs != null) {
          minutesDifference = (startTimeMs - Date.now()) / (1000 * 60);
        } else {
          console.warn('[seat-select][M6.3] 开场时间无法计算，请检查 orderData.start_time / showtime.startTime', { orderStartTime, hasOrder: !!orderData, hasShowtime: !!showtime });
        }

        const timeGreaterThanLock = minutesDifference != null && minutesDifference > lockMinuteValue;
        console.log('[seat-select][M6.3] 会员时间判断', { minutesDifference, lockMinuteValue, timeGreaterThanLock });
        // 时间判断对话框已注释，判断逻辑照常执行
        // if (minutesDifference != null) {
        //   const openDisplay = startTimeMs != null ? dateHelper.formatBeijingTime(new Date(startTimeMs), 'YYYY-MM-DD HH:mm') : dateHelper.formatDbTimeDisplay(orderStartTime) || (orderStartTime || '');
        //   const nowBeijing = dateHelper.formatBeijingTime(new Date(), 'YYYY-MM-DD HH:mm');
        //   wx.showModal({
        //     title: '[M6.3] 会员时间判断',
        //     content: '开场时间(北京): ' + openDisplay + '\n当前时间(北京): ' + nowBeijing + '\n距开场分钟数: ' + minutesDifference.toFixed(2) + '\n停售分钟数(lock_minute): ' + lockMinuteValue + '\n比较: ' + minutesDifference.toFixed(2) + ' > ' + lockMinuteValue + ' ? ' + timeGreaterThanLock + '\n→ ' + (timeGreaterThanLock ? 'M6.4锁座' : 'M6.5会员卡支付'),
        //     showCancel: false,
        //     confirmText: '确定'
        //   });
        // }
        await this._node('M6.3', '会员时间判断', { minutesDifference, lockMinuteValue, timeGreaterThanLock, next: timeGreaterThanLock ? 'M6.4锁座' : 'M6.5跳转confirm-pay' });

        // 会员订单号：大于第三方 mcyy-wechat-cardgm-{id}，小于等于 mcyy-wechat-cardlj-{id}
        const memberOutTradeNo = timeGreaterThanLock ? 'mcyy-wechat-cardgm-' + orderId : 'mcyy-wechat-cardlj-' + orderId;
        try {
          await supabase.updateOrder(orderId, { out_trade_no: memberOutTradeNo });
          console.log('[seat-select][M6.1] 会员订单号已更新', { orderId, out_trade_no: memberOutTradeNo });
        } catch (e6) {
          console.warn('[seat-select][M6.1] 会员订单号更新失败', e6);
        }
        const updatedOrderData = Object.assign({}, orderData, patchData, { out_trade_no: memberOutTradeNo });

        if (timeGreaterThanLock) {
          // 6.4 会员大于第三方停售：锁座
          await this._lockSeatForMember(cardNumber, orderId, playId, selectedIds, updatedOrderData, app);
        } else {
          // 6.5 会员小于等于第三方停售：先弹退改签协议，同意后再弹会员卡密码并调 member_card_pay
          console.log('[seat-select][M6.5] 会员小于等于第三方停售，弹退改签协议后弹会员卡密码');
          await this._node('M6.5', '会员小于等于第三方停售，弹退改签→弹密码调 member_card_pay');
          if (app && app.globalData) app.globalData.playOrder = updatedOrderData;
          const cinemaId = orderData.cinema_id || orderData.cinemaId || (app.globalData.cinemainfo && (app.globalData.cinemainfo.cinemaid || app.globalData.cinemainfo.cinemaNumber || app.globalData.cinemainfo.id)) || '';
          const partnerBuyTicketId = '' + Date.now() + orderId;
          const memberPayCtx = {
            updatedOrderData,
            cardNumber,
            cinemaId,
            playId,
            selectedIds,
            selectedNames,
            total,
            orderId,
            outTradeNo: memberOutTradeNo,
            partnerBuyTicketId
          };
          wx.showModal({
            title: '退改签协议',
            content: REFUND_CHANGE_AGREEMENT,
            confirmText: '同意',
            cancelText: '不同意',
            success: (res) => {
              if (res.confirm) {
                this.setData({
                  showMemberCardPasswordModal: true,
                  _memberCardPasswordInput: '',
                  _memberCardPayCtx: memberPayCtx
                });
              }
            }
          });
        }
      } else {
        // N: 非会员支付分支 - N5/N6/N7 时间与 movie_code 判断
        console.log('[seat-select][N] 非会员支付分支');
        await this._node('N', '进入非会员支付分支');
        const { order: orderData, ruleInfo: rule } = this.data;
        const showtime = app && app.globalData && app.globalData.playShowtime;
        const movie = app && app.globalData && app.globalData.playMovie;

        const orderStartTime = orderData?.start_time || showtime?.startTime;
        const orderMovieCode = ((orderData && (orderData.movie_code || orderData.movieCode || orderData.cine_movie_num)) || (movie && (movie.movie_code || movie.movieCode)) || '').toString();
        const lockMinute = (rule && rule.lock_minute != null) ? Number(rule.lock_minute) : 60;
        const ruleMovieCodeStr = (rule && rule.movie_code) ? String(rule.movie_code) : '';

        // 时间判断：开场时间用数据库字段（北京时间），当前时间用 Date.now()（UTC 当前时刻），做差得距开场分钟数
        let minutesDifference = null;
        const startTimeMs = dateHelper.beijingTimeStringToMs(orderStartTime);
        if (startTimeMs != null) {
          minutesDifference = (startTimeMs - Date.now()) / (1000 * 60);
        } else {
          console.warn('[seat-select][N] 开场时间无法计算，请检查 orderData.start_time / showtime.startTime', { orderStartTime, hasOrder: !!orderData, hasShowtime: !!showtime });
        }

        // minutesDifference > lockMinute 表示距开场时间大于停售分钟数，走 N6（大于第三方开场时间）
        const timeGreaterThanLock = minutesDifference != null && minutesDifference > lockMinute;
        const movieCodeInRule = !!orderMovieCode && !!ruleMovieCodeStr && (ruleMovieCodeStr.includes(orderMovieCode) || ruleMovieCodeStr.includes(String(orderMovieCode)));
        const isGreaterThanThirdParty = timeGreaterThanLock || movieCodeInRule;

        console.log('[seat-select][N] 非会员时间判断', {
          orderStartTime,
          minutesDifference,
          lockMinute,
          timeGreaterThanLock,
          orderMovieCode,
          ruleMovieCodeStr: ruleMovieCodeStr ? ruleMovieCodeStr.substring(0, 50) + (ruleMovieCodeStr.length > 50 ? '...' : '') : '',
          movieCodeInRule,
          isGreaterThanThirdParty
        });
        // 时间判断对话框已注释，判断逻辑照常执行
        // if (minutesDifference != null) {
        //   const openDisplay = startTimeMs != null ? dateHelper.formatBeijingTime(new Date(startTimeMs), 'YYYY-MM-DD HH:mm') : dateHelper.formatDbTimeDisplay(orderStartTime) || (orderStartTime || '');
        //   const nowBeijing = dateHelper.formatBeijingTime(new Date(), 'YYYY-MM-DD HH:mm');
        //   const timeCompareDesc = minutesDifference > lockMinute ? (minutesDifference.toFixed(2) + ' > ' + lockMinute + ' 成立') : (minutesDifference.toFixed(2) + ' ≤ ' + lockMinute + '，不成立');
        //   const thirdPartyDesc = 'isGreaterThanThirdParty = timeGreaterThanLock(' + timeGreaterThanLock + ') || movieCodeInRule(' + movieCodeInRule + ') = ' + isGreaterThanThirdParty;
        //   wx.showModal({
        //     title: '[N] 非会员时间判断',
        //     content: '开场时间(北京): ' + openDisplay + '\n当前时间(北京): ' + nowBeijing + '\n距开场分钟数: ' + minutesDifference.toFixed(2) + ' 分钟\n停售分钟数(lock_minute): ' + lockMinute + '\n时间比较(距开场>停售?): ' + timeCompareDesc + '\n→ timeGreaterThanLock=' + timeGreaterThanLock + '\n影片在规则? movieCodeInRule=' + movieCodeInRule + '\n' + thirdPartyDesc + '\n→ ' + (isGreaterThanThirdParty ? 'N6锁座' : 'N7微信支付'),
        //     showCancel: false,
        //     confirmText: '确定'
        //   });
        // }
        await this._node('N', '非会员时间判断', { minutesDifference, lockMinute, timeGreaterThanLock, movieCodeInRule, isGreaterThanThirdParty, next: isGreaterThanThirdParty ? 'N6锁座' : 'N7微信支付' });

        if (isGreaterThanThirdParty) {
          // N6: 非会员支付大于第三方开场时间 - 调用锁座接口
          console.log('[seat-select][N6] 非会员支付大于第三方开场时间，调用锁座接口');
          await this._node('N6', '非会员大于第三方停售，即将调用 nonmember/seat_lock');
          try {
            const cid = (orderData && (orderData.cinema_id || orderData.cinemaId || orderData.cinema_num)) || '';
            const playUpdateTime = ((orderData && orderData.play_update_time) || '').toString();
            const seatIdStr = selectedIds.map(String).join(',');
            console.log('[seat-select][NL1] 非会员锁座请求', { cid, play_id: playId, seat_id: seatIdStr, play_update_time: playUpdateTime });
            await this._node('NL1', '非会员锁座请求已发出', { cid, play_id: playId, seat_id: seatIdStr });
            const res = await dingxin.get('/nonmember/seat_lock', {
              cid,
              play_id: playId,
              seat_id: seatIdStr,
              play_update_time: playUpdateTime
            });
            const lockFlag = (res && res.data && (res.data.lockFlag || res.data.lock_flag)) || (res && (res.lockFlag || res.lock_flag));
            const success = lockFlag && ((res && (res.code === 200 || res.code === 0)) || !res);
            console.log('[seat-select][NL1] 非会员锁座响应', { code: res && res.code, success, lockFlag: lockFlag ? '有' : '无' });
            await this._node('NL1', '非会员锁座响应', { code: res && res.code, success, lockFlag: lockFlag ? '有' : '无' });
            if (success) {
              const nonMemberGtOutTradeNo = 'mcyy-wechat-ypgm-' + orderId;
              try {
                await supabase.updateOrder(orderId, { lock_flag: lockFlag, out_trade_no: nonMemberGtOutTradeNo });
                console.log('[seat-select][NL3] 订单 lock_flag、out_trade_no 更新成功', { orderId, lockFlag: lockFlag ? '有' : '无', out_trade_no: nonMemberGtOutTradeNo });
                await this._node('NL3', '订单 lock_flag、out_trade_no 已更新，弹退改签协议后跳转 confirm-pay', { orderId, lockFlag, out_trade_no: nonMemberGtOutTradeNo });
                // 合并 U10 字段 + lock_flag + out_trade_no 到订单，写入 globalData 供 confirm-pay 使用
                const updatedOrder = Object.assign({}, orderData, patchData, { lock_flag: lockFlag, out_trade_no: nonMemberGtOutTradeNo });
                if (app && app.globalData) app.globalData.playOrder = updatedOrder;
              } catch (upErr) {
                console.error('[seat-select][NL3] 订单 lock_flag 更新失败', upErr);
              }
              wx.showModal({
                title: '退改签协议',
                content: REFUND_CHANGE_AGREEMENT,
                confirmText: '同意',
                cancelText: '不同意',
                success: (res) => {
                  if (res.confirm) wx.navigateTo({ url: '/pages/confirm-pay/confirm-pay' });
                }
              });
            } else {
              console.log('[seat-select][N6] 非会员锁座失败', { msg: res && (res.message || res.msg) });
              this._nodeSync('N6', '非会员锁座失败', { msg: res && (res.message || res.msg) });
              // wx.showModal({ title: '[N6] 锁座失败', content: ..., showCancel: false });
            }
          } catch (e) {
            console.error('[seat-select][NL1] 非会员锁座异常', e);
            this._nodeSync('NL1', '非会员锁座异常', { err: e.message || e.errMsg });
            // wx.showModal({ title: '[NL1] 锁座失败', content: ..., showCancel: false });
          }
        } else {
          // N7: 非会员支付小于第三方开场时间，订单号 mcyy-wechat-yplj-{id}，弹退改签协议后直接调起微信支付
          console.log('[seat-select][N7] 非会员支付小于第三方开场时间，弹退改签后直接调起微信支付');
          const nonMemberLtOutTradeNo = 'mcyy-wechat-yplj-' + orderId;
          try {
            await supabase.updateOrder(orderId, { out_trade_no: nonMemberLtOutTradeNo });
            console.log('[seat-select][N7] 订单 out_trade_no 已更新', { orderId, out_trade_no: nonMemberLtOutTradeNo });
          } catch (e7) {
            console.warn('[seat-select][N7] 订单号更新失败', e7);
          }
          const updatedOrderN7 = Object.assign({}, orderData, patchData, { out_trade_no: nonMemberLtOutTradeNo });
          if (app && app.globalData) app.globalData.playOrder = updatedOrderN7;
          await this._node('N7', '非会员小于等于第三方停售，弹退改签后直接调起微信支付', { out_trade_no: nonMemberLtOutTradeNo });
          const totalInCents = Math.round(total * 100);
          const description = '电影票订单：' + (this.data.movieName || '电影');
          wx.showModal({
            title: '退改签协议',
            content: REFUND_CHANGE_AGREEMENT,
            confirmText: '同意',
            cancelText: '不同意',
            success: (res) => {
              if (res.confirm) this._processWeChatPaymentForNonMember(nonMemberLtOutTradeNo, totalInCents, description, updatedOrderN7);
            }
          });
        }
      }

      // 已取消跳转 OrderPage，由支付分支处理跳转
      // wx.navigateTo({ url: '/pages/order/order' });
    } catch (e) {
      console.error('[seat-select][U10] 订单更新失败', { orderId, error: e.message || e });
      // wx.showToast({ title: e.message || '更新订单失败', icon: 'none' });
    }
  },

  // ---------- N7：非会员小于等于第三方停售 - 支付方式选择与等待出票 ----------
  _showPaymentMethodDialogForNonMember: function (orderData, outTradeNo, totalInCents, movieName) {
    var self = this;
    var description = '电影票订单：' + (movieName || '电影');

    // wx.showModal({ title: '退改签规定', content: '...', confirmText: '同意', cancelText: '不同意', success: function (res) { if (!res.confirm) return; self._processWeChatPaymentForNonMember(...); } });
    self._processWeChatPaymentForNonMember(outTradeNo, totalInCents, description, orderData);
  },

  _processWeChatPaymentForNonMember: function (outTradeNo, totalInCents, description, orderData) {
    var self = this;
    if (!outTradeNo) {
      // wx.showToast({ title: '订单号异常，无法支付', icon: 'none' });
      return;
    }
    var app = getApp();
    var openId = (app && app.globalData && app.globalData.wxProfile && app.globalData.wxProfile.openid) || (auth && auth.getOpenid && auth.getOpenid()) || '';
    if (!openId) {
      // wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    var subAppid = (app && app.globalData && app.globalData.saopayAppid) || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram && wx.getAccountInfoSync().miniProgram.appId) || '';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var d = new Date();
    var terminalTime = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

    // wx.showLoading({ title: '正在调起支付...' });
    saopayRequest.miniPay({
      pay_type: '010',
      total_fee: String(totalInCents),
      terminal_trace: outTradeNo,
      terminal_time: terminalTime,
      sub_appid: subAppid || undefined,
      open_id: openId,
      notify_url: 'https://saopay.meicity.net/api/notify/payment'
    }).then(function (data) {
      // wx.hideLoading();
      var isSuccess = data && (data.code === 200 || data.code === '200');
      if (!isSuccess) {
        // wx.showToast({ title: (data && (data.message || data.msg)) || '支付失败', icon: 'none' });
        return;
      }
      var payParams = self._parseWeChatPayParamsForN7(data);
      if (!payParams) {
        // wx.showToast({ title: '支付参数解析失败', icon: 'none' });
        return;
      }
      var reqPay = {
        timeStamp: payParams.timeStamp,
        nonceStr: payParams.nonceStr,
        package: payParams.package,
        signType: payParams.signType,
        paySign: payParams.paySign,
        success: function () {
          // wx.showToast({ title: '支付成功，正在跳转取票页…', icon: 'none', duration: 2000 });
          self._startM65PayStatusPoll(outTradeNo);
        },
        fail: function (err) {
          // if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) { wx.showToast({ title: '支付已取消', icon: 'none' }); } else { wx.showToast({ title: err.errMsg || '支付失败', icon: 'none' }); }
        }
      };
      wx.requestPayment(reqPay);
    }).catch(function (e) {
      // wx.hideLoading();
      // wx.showToast({ title: (e && e.message) || '支付失败', icon: 'none' });
    });
  },

  _parseWeChatPayParamsForN7: function (data) {
    var raw = (data && data.paymentParams) || (data && data.data) || data || {};
    var timeStamp = (raw.timeStamp != null && raw.timeStamp !== '') ? String(raw.timeStamp) : ((raw.timestamp != null && raw.timestamp !== '') ? String(raw.timestamp) : '');
    var nonceStr = (raw.nonceStr != null && raw.nonceStr !== '') ? String(raw.nonceStr) : ((raw.noncestr != null && raw.noncestr !== '') ? String(raw.noncestr) : '');
    var packageStr = (raw.package != null && raw.package !== '') ? String(raw.package) : '';
    var paySign = (raw.paySign != null && raw.paySign !== '') ? String(raw.paySign) : ((raw.pay_sign != null && raw.pay_sign !== '') ? String(raw.pay_sign) : ((raw.sign != null && raw.sign !== '') ? String(raw.sign) : ''));
    if (!timeStamp || !nonceStr || !packageStr || !paySign) return null;
    return { timeStamp: timeStamp, nonceStr: nonceStr, package: packageStr, signType: 'MD5', paySign: paySign };
  },

  _showProcessingTicketDialog: function (outTradeNo) {
    var self = this;
    this._clearN7Timers();
    this.setData({ showProcessingTicketModal: true, processingTicketOutTradeNo: outTradeNo || '' });
    this._checkOrderStatusOnce(outTradeNo);
    this._n7PollTimer = setInterval(function () {
      self._checkOrderStatusOnce(outTradeNo);
    }, N7_POLL_INTERVAL_MS);
    this._n7TimeoutTimer = setTimeout(function () {
      if (self._processedOrderNos && self._processedOrderNos[outTradeNo]) return;
      self._clearN7Timers();
      self.setData({ showProcessingTicketModal: false, processingTicketOutTradeNo: '' });
      wx.reLaunch({ url: '/pages/index/index' });
      // wx.showToast({ title: '等待支付结果超时，已返回主页', icon: 'none' });
    }, N7_TIMEOUT_MS);
  },

  _checkOrderStatusOnce: function (outTradeNo) {
    var self = this;
    if (!outTradeNo) return;
    if (self._processedOrderNos && self._processedOrderNos[outTradeNo]) return;
    supabase.getOrderByOutTradeNo(outTradeNo).then(function (order) {
      if (!order) return;
      var status = (order.pay_status || order.payStatus || '').toString();
      if (status === 'SUCCESS') {
        self._handleOrderPaySuccess(outTradeNo);
      }
    });
  },

  _handleOrderPaySuccess: function (outTradeNo) {
    if (this._processedOrderNos && this._processedOrderNos[outTradeNo]) return;
    this._processedOrderNos = this._processedOrderNos || {};
    this._processedOrderNos[outTradeNo] = true;
    this._clearN7Timers();
    this.setData({ showProcessingTicketModal: false, processingTicketOutTradeNo: '' });
    // wx.showToast({ title: '出票成功', icon: 'success' });
    var self = this;
    setTimeout(function () {
      self._navigateToTicketInfoPage(outTradeNo);
    }, 500);
  },

  _clearN7Timers: function () {
    if (this._n7PollTimer) {
      clearInterval(this._n7PollTimer);
      this._n7PollTimer = null;
    }
    if (this._n7TimeoutTimer) {
      clearTimeout(this._n7TimeoutTimer);
      this._n7TimeoutTimer = null;
    }
  },

  /** M6.5 会员卡支付成功后：轮询 cinema_order_list.pay_status，为 SUCCESS 时跳转 ticketinfo */
  _startM65PayStatusPoll: function (outTradeNo) {
    var self = this;
    this._clearM65Timers();
    this._checkM65OrderStatusOnce(outTradeNo);
    this._m65PollTimer = setInterval(function () {
      self._checkM65OrderStatusOnce(outTradeNo);
    }, M65_POLL_INTERVAL_MS);
    this._m65TimeoutTimer = setTimeout(function () {
      self._clearM65Timers();
      wx.redirectTo({ url: '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(outTradeNo) });
    }, M65_POLL_TIMEOUT_MS);
  },

  _checkM65OrderStatusOnce: function (outTradeNo) {
    var self = this;
    if (!outTradeNo) return;
    supabase.getOrderByOutTradeNo(outTradeNo).then(function (order) {
      if (!order) return;
      var status = (order.pay_status || order.payStatus || '').toString();
      if (status === 'SUCCESS') {
        self._clearM65Timers();
        wx.redirectTo({ url: '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(outTradeNo) });
      }
    });
  },

  _clearM65Timers: function () {
    if (this._m65PollTimer) {
      clearInterval(this._m65PollTimer);
      this._m65PollTimer = null;
    }
    if (this._m65TimeoutTimer) {
      clearTimeout(this._m65TimeoutTimer);
      this._m65TimeoutTimer = null;
    }
  },

  onN7BackToHome: function () {
    this._clearN7Timers();
    this.setData({ showProcessingTicketModal: false, processingTicketOutTradeNo: '' });
    wx.reLaunch({ url: '/pages/index/index' });
  },

  _navigateToTicketInfoPage: function (outTradeNo) {
    if (!outTradeNo) {
      wx.redirectTo({ url: '/pages/order/order' });
      return;
    }
    wx.redirectTo({ url: '/pages/ticketinfo/ticketinfo?out_trade_no=' + encodeURIComponent(outTradeNo) });
  },

  preventTouchMove: function () {},

  onUnload: function () {
    this._clearN7Timers();
    this._clearM65Timers();
  }
});
