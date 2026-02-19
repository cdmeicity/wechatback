/**
 * 影票详情页
 * 入参：out_trade_no（订单号），通过 url 参数传入，如 /pages/ticketinfo/ticketinfo?out_trade_no=xxx
 * 逻辑：查询 cinema_order_list.out_trade_no = 传入的 out_trade_no，再根据订单数据与条形码规则展示
 *
 * 条形码规则（何时多张条形码）：
 * - 仅当 pay_status === 'SUCCESS' 时展示条形码
 * - 若订单 ticket_num 不为空：条形码数据为 ticket_flag1 + ticket_flag2，共 1 条
 * - 若订单 ticket_num 为空：从 lanjie_online_tickets 表按 concessions = out_trade_no 查询 user_code，可能多条
 */
const supabase = require('../../utils/supabase.js');
const qrcode = require('../../utils/qrcode.js');
const dateHelper = require('../../utils/dateHelper.js');
const auth = require('../../utils/auth.js');

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
    outTradeNo: '',
    orderData: null,
    orderInfo: null,
    movieListData: null,
    barcodeList: [],
    currentBarcodeIndex: 0,
    loading: true,
    errorMessage: null,
    ticketStatus: null,
    qrBlur: false // 从「全部订单」进入或订单已观看时，二维码模糊显示
  },

  onLoad(options) {
    if (!auth.redirectToLoginIfNeeded()) return;
    const outTradeNo = (options && options.out_trade_no) ? String(options.out_trade_no).trim() : '';
    if (!outTradeNo) {
      this.setData({ loading: false, errorMessage: '订单号不存在' });
      return;
    }
    const blurQr = (options && options.blur_qr) === '1';
    this.setData({ outTradeNo, qrBlur: blurQr });
    this._loadOrderData(outTradeNo);
  },

  onClose() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /** 返回首页（清栈，与 onClose 一致） */
  onGoHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /** 我的订单 */
  onGoOrder() {
    wx.navigateTo({ url: '/pages/order/order' });
  },

  /** 无条形码时点击「刷新取票码」重新拉取订单与条形码 */
  onRefreshBarcode() {
    const no = (this.data.outTradeNo || '').toString().trim();
    if (!no) {
      wx.showToast({ title: '订单号不存在', icon: 'none' });
      return;
    }
    this._loadOrderData(no);
  },

  async _loadOrderData(outTradeNo) {
    this.setData({ loading: true, errorMessage: null });
    try {
      const order = await supabase.getOrderByOutTradeNo(outTradeNo);
      if (!order) {
        this.setData({ loading: false, errorMessage: '订单不存在' });
        return;
      }

      const orderInfo = this._convertToOrderInfo(order);
      await this._loadMovieListData(order);
      const barcodeList = await this._loadBarcodeData(outTradeNo, order);

      const displayTicketId = this._getTicketId(order, orderInfo);
      const displayTransactionId = (order.transaction_id != null ? String(order.transaction_id) : '') || '';
      const displayPayTime = this._formatPayTime(order);
      const movieDisplay = this._getMovieDisplay(order, orderInfo);
      const displayDate = this.formatDate(orderInfo.showDate);
      const displayTimeRange = this.formatTimeRange(orderInfo.showTime, this.data.movieListData && this.data.movieListData.duration != null ? this.data.movieListData.duration : 128);
      const displayHallName = (order.hall_name || order.hallName || '').toString() || '影厅';
      const seeState = order.see_state === true || order.see_state === 'true';
      const qrBlur = this.data.qrBlur || seeState;

      this.setData({
        orderData: order,
        orderInfo,
        barcodeList,
        loading: false,
        currentBarcodeIndex: 0,
        displayTicketId,
        displayTransactionId,
        displayPayTime,
        movieDisplay,
        displayDate,
        displayTimeRange,
        displayHallName,
        qrBlur
      }, () => {
        this._drawBarcodes();
      });
    } catch (e) {
      this.setData({
        loading: false,
        errorMessage: '加载订单数据失败: ' + (e.message || String(e))
      });
    }
  },

  _convertToOrderInfo(order) {
    const seats = parseSeats(order.seat_list || order.seatList || []);
    let showDate = '';
    let showTime = '';
    let showDateTime = null;
    try {
      const raw = order.start_time || order.startTime;
      if (raw) {
        const d = dateHelper.parseApiTimeAsUTC(raw);
        if (d) {
          showDateTime = d;
          showDate = dateHelper.formatBeijingTime(d, 'YYYY-MM-DD');
          showTime = dateHelper.formatBeijingTime(d, 'HH:mm');
        }
      }
    } catch (_) {}

    return {
      id: (order.order_id || order.id || '').toString(),
      movieName: (order.movie_name || order.movieName || '未知电影').toString(),
      moviePoster: (order.movie_img_url || order.movieImgUrl || order.poster || '').toString(),
      movieCategory: (order.movie_dimensional || order.movieDimensional || '2D').toString(),
      language: (order.movie_language || order.movieLanguage || '').toString(),
      cinemaName: (order.cinema_name || order.cinemaName || '未知影院').toString(),
      hallName: (order.hall_name || order.hallName || '').toString(),
      showDate,
      showTime,
      showDateTime: order.start_time || order.startTime,
      seats,
      seatCount: order.num != null ? Number(order.num) : seats.length,
      totalPrice: order.total != null ? Number(order.total) : 0,
      payStatus: (order.pay_status || order.payStatus || 'INIT').toString(),
      phone: (order.phone || '').toString(),
      transactionId: (order.transaction_id || order.transaction_id || '').toString(),
      payTime: (order.pay_time || order.payTime || '').toString(),
      outTradeNo: (order.out_trade_no || order.outTradeNo || '').toString()
    };
  },

  async _loadMovieListData(order) {
    const cineMovieNum = (order.cine_movie_num || order.cineMovieNum || '').toString().trim();
    if (!cineMovieNum) return;

    try {
      const rows = await supabase.get('/movie_list?select=type,actors,duration,language,movie_code&limit=500');
      if (!Array.isArray(rows)) return;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const movieCode = row.movie_code;
        let match = false;
        if (Array.isArray(movieCode)) {
          match = movieCode.some(function (c) {
            const s = (c != null ? String(c) : '');
            return s.indexOf(cineMovieNum) !== -1 || cineMovieNum.indexOf(s) !== -1;
          });
        } else if (typeof movieCode === 'string') {
          match = movieCode.indexOf(cineMovieNum) !== -1 || cineMovieNum.indexOf(movieCode) !== -1;
        }
        if (match) {
          this.setData({
            movieListData: {
              type: row.type,
              actors: row.actors,
              duration: row.duration,
              language: row.language
            }
          });
          return;
        }
      }
    } catch (_) {}
  },

  async _loadBarcodeData(outTradeNo, order) {
    const payStatus = (order.pay_status || order.payStatus || '').toString();
    if (payStatus !== 'SUCCESS' && payStatus !== 'PAID') return [];

    const ticketNum = (order.ticket_num != null && order.ticket_num !== '') ? String(order.ticket_num).trim() : '';

    if (ticketNum.length > 0) {
      const ticketFlag1 = (order.ticket_flag1 || '').toString();
      const ticketFlag2 = (order.ticket_flag2 || '').toString();
      const code = ticketFlag1 + ticketFlag2;
      return code ? [code] : [];
    }

    try {
      const list = await supabase.get(
        '/lanjie_online_tickets?concessions=eq.' + encodeURIComponent(outTradeNo) + '&select=user_code&limit=50'
      );
      if (!Array.isArray(list)) return [];
      const codes = list.map(function (r) { return (r.user_code != null ? String(r.user_code) : ''); }).filter(Boolean);
      return codes;
    } catch (_) {
      return [];
    }
  },

  _getTicketId(order, info) {
    if (!order || !info) return '';
    const ms = Date.now().toString();
    const id = (info.id || '').replace(/-/g, '');
    return ms + id;
  },

  _formatPayTime(order) {
    if (!order) return '';
    const raw = (order.pay_time || order.payTime || '').toString();
    if (!raw) return '';
    try {
      const dateStr = dateHelper.formatBeijingTime(raw, 'YYYY-MM-DD');
      const timeStr = dateHelper.formatBeijingTime(raw, 'HH:mm:ss');
      if (!dateStr) return raw;
      const parts = dateStr.split('-');
      if (parts.length >= 3) return parts[0] + '年' + parts[1] + '月' + parts[2] + '日 ' + timeStr;
      return dateStr + ' ' + timeStr;
    } catch (_) {
      return raw;
    }
  },

  _getMovieDisplay(order, info) {
    const movieList = this.data.movieListData;
    if (!info) return { name: '未知电影', poster: '', duration: '', language: '', format: '2D', actors: '' };

    const name = (order && (order.movie_name || order.movieName)) || info.movieName || '未知电影';
    const poster = (order && (order.movie_img_url || order.movieImgUrl)) || info.moviePoster || '';
    const format = (order && (order.movie_dimensional || order.movieDimensional)) || info.movieCategory || '2D';
    const language = (movieList && movieList.language) || (order && order.movie_language) || info.language || '';
    const duration = (movieList && movieList.duration != null) ? String(movieList.duration) : (order && order.movie_duration) || '';
    const actors = (movieList && movieList.actors) || (order && order.actors) || '';

    return { name, poster, duration, language, format, actors };
  },

  formatDate(showDate) {
    if (!showDate) return '';
    const parts = showDate.split('-');
    if (parts.length >= 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return y + '年' + m + '月' + d + '日';
    }
    return showDate;
  },

  formatTimeRange(showTime, durationMinutes) {
    if (!showTime) return '';
    const defaultMin = 128;
    const min = (durationMinutes != null && durationMinutes !== '') ? parseInt(String(durationMinutes), 10) : defaultMin;
    const startParts = showTime.split(':');
    if (startParts.length < 2) return showTime;

    let sh = parseInt(startParts[0], 10);
    let sm = parseInt(startParts[1], 10) || 0;
    if (isNaN(sh)) sh = 0;

    let eh = sh;
    let em = sm + (isNaN(min) ? defaultMin : min);
    while (em >= 60) { em -= 60; eh += 1; }
    while (eh >= 24) { eh -= 24; }

    const startStr = String(sh).padStart(2, '0') + ':' + String(sm).padStart(2, '0');
    const endStr = String(eh).padStart(2, '0') + ':' + String(em).padStart(2, '0');
    return startStr + '-' + endStr;
  },

  onPrevBarcode() {
    const idx = this.data.currentBarcodeIndex || 0;
    if (idx <= 0) return;
    this.setData({ currentBarcodeIndex: idx - 1 }, () => {
      this._drawMultiBarcodeCurrent();
    });
  },

  onNextBarcode() {
    const list = this.data.barcodeList || [];
    const idx = this.data.currentBarcodeIndex || 0;
    if (idx >= list.length - 1) return;
    this.setData({ currentBarcodeIndex: idx + 1 }, () => {
      this._drawMultiBarcodeCurrent();
    });
  },

  _drawBarcodes() {
    const list = this.data.barcodeList || [];
    if (list.length === 0) return;
    const self = this;
    const opts = { size: 260 };
    if (list.length === 1) {
      setTimeout(function () {
        qrcode.drawQrcode('#barcodeCanvas0', list[0], opts, self).catch(function () {});
      }, 80);
    } else {
      wx.nextTick(function () {
        setTimeout(function () {
          self._drawMultiBarcodeCurrent();
        }, 120);
      });
    }
  },

  _drawMultiBarcodeCurrent() {
    const list = this.data.barcodeList || [];
    const idx = this.data.currentBarcodeIndex || 0;
    if (idx < 0 || idx >= list.length) return;
    const opts = { size: 260 };
    const self = this;
    qrcode.drawQrcode('#barcodeCanvasMulti', list[idx], opts, self).catch(function () {
      setTimeout(function () {
        qrcode.drawQrcode('#barcodeCanvasMulti', list[idx], opts, self).catch(function () {});
      }, 200);
    });
  }
});
