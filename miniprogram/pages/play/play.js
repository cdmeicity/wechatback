/**
 * 排期列表页面（Play页面）
 * 参照 Flutter PlayPage：影片选择、日期选择、场次列表
 * 列表页价格：展示价来自 getCinemaPlay 返回的 display_price（v_meicity_cinema_play LEFT JOIN price_play_cache），展示「¥xx 起」，不调用 RPC 算价
 */
const supabase = require('../../utils/supabase');
const dateHelper = require('../../utils/dateHelper');

function parseStartTime(v) {
  // 排期接口 start_time 常为北京时间且无时区后缀，按北京时间解析避免被当 UTC 导致只显示傍晚场
  return dateHelper.parseApiTimeAsBeijing(v);
}

function formatTime(d) {
  if (!d) return '';
  return dateHelper.formatBeijingTime(d, 'HH:mm');
}

Page({
  data: {
    statusBarHeight: 0,
    appbarHeight: 176,
    cinema: null,
    movies: [],
    selectedMovie: null,
    selectedMovieIndex: 0,
    selectdata: '',
    selectmoviecode: [],
    showtimes: [],
    showtimesRaw: {},
    loadingShowtimes: false,
    dateList: [],
    selectedDateIndex: 0,
    selectedShowtime: null,
    selectedShowtimePriceDetails: null,
    hallId: null,
    movieScrollLeft: 0,
    showLoginModal: false,
    hasUser: false
  },

  onLoad() {
    const win = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = win.statusBarHeight || 0;
    const menuBottom = (menu.top || statusBarHeight) + (menu.height || 32);
    const appbarHeight = Math.round(menuBottom * (750 / (win.windowWidth || 375)));

    const app = getApp();
    const params = app.globalData.playParams || {};
    const cinema = params.cinema || app.globalData.cinemainfo;
    const movies = params.movies || [];
    const u = app.globalData.supabaseUser;
    const hasUser = !!(u && (u.id ?? u.userId ?? u.user_id));
    const initialMovieCode = params.initialMovieCode || null;
    const hallId = params.hallId || null;

    let selectedMovie = movies[0] || null;
    let selectedMovieIndex = 0;
    if (initialMovieCode && movies.length > 0) {
      const idx = movies.findIndex((m) => (m.movie_code || m.movieCode || '') === initialMovieCode);
      if (idx >= 0) {
        selectedMovie = movies[idx];
        selectedMovieIndex = idx;
      }
    }

    const selectmoviecode = this._parseMovieCodes(selectedMovie?.movie_code || selectedMovie?.movieCode || initialMovieCode);
    const movieScrollLeft = this._calcMovieScrollLeft(selectedMovieIndex);

    this.setData({
      statusBarHeight,
      appbarHeight,
      cinema,
      movies,
      selectedMovie,
      selectedMovieIndex,
      selectdata: '',
      selectmoviecode,
      dateList: [],
      selectedDateIndex: 0,
      hallId,
      showtimes: [],
      movieScrollLeft,
      hasUser
    });

    if (cinema && selectmoviecode.length > 0) {
      this._loadShowtimes();
    }
  },

  onShow() {
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const hasUser = !!(u && (u.id ?? u.userId ?? u.user_id));
    this.setData({ hasUser });
  },

  _showLoginModal() {
    this.setData({ showLoginModal: true });
  },

  onLoginSuccess() {
    this.setData({ showLoginModal: false, hasUser: true });
    this._loadShowtimes();
  },

  _parseMovieCodes(val) {
    if (!val) return [];
    const s = String(val).trim();
    if (s.includes(',')) return s.split(',').map((c) => c.trim()).filter(Boolean);
    return [s];
  },

  onBack() {
    wx.navigateBack();
  },

  /** 分享给好友 */
  onShareAppMessage() {
    const cinema = this.data.cinema;
    const title = cinema && cinema.name ? `${cinema.name} - 选座购票` : '美承影院 - 选座购票，畅享观影';
    return { title, path: '/pages/index/index' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    const cinema = this.data.cinema;
    const title = cinema && cinema.name ? `${cinema.name} - 选座购票` : '美承影院 - 选座购票，畅享观影';
    return { title, query: '' };
  },

  onLoginModalClose() {
    this.setData({ showLoginModal: false });
  },

  onMovieTap(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10);
    const movie = this.data.movies[idx];
    if (!movie) return;
    const selectmoviecode = this._parseMovieCodes(movie.movie_code || movie.movieCode);
    const scrollLeft = this._calcMovieScrollLeft(idx);
    this.setData({
      selectedMovie: movie,
      selectedMovieIndex: idx,
      selectmoviecode,
      selectedShowtime: null,
      movieScrollLeft: scrollLeft
    });
    this._loadShowtimes();
  },

  _calcMovieScrollLeft(index) {
    const win = wx.getWindowInfo();
    const vw = win.windowWidth || 375;
    const itemPx = (220 / 750) * vw;
    const half = vw / 2 - itemPx / 2;
    return Math.max(0, index * itemPx - half);
  },

  onDateTap(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10);
    const item = this.data.dateList[idx];
    if (!item) return;
    this.setData({
      selectdata: item.str,
      selectedDateIndex: idx,
      selectedShowtime: null
    }, () => this._loadShowtimes());
  },

  async _loadShowtimes() {
    const LOG = (msg, data) => console.log('[play][排期列表]', msg, data !== undefined ? data : '');
    const { cinema, selectmoviecode, selectdata, hallId } = this.data;
    const cinemaId = cinema?.cinemaid || cinema?.cinemaNumber || cinema?.id;
    LOG('_loadShowtimes 开始', { cinemaId, hallId, selectmoviecode, selectdata });
    if (!cinemaId) {
      LOG('无 cinemaId，清空场次');
      this.setData({ showtimes: [], dateList: [], loadingShowtimes: false });
      return;
    }
    if (selectmoviecode.length === 0) {
      LOG('无 selectmoviecode，清空场次');
      this.setData({ showtimes: [], dateList: [], loadingShowtimes: false });
      return;
    }

    this.setData({ loadingShowtimes: true });
    try {
      LOG('请求 getCinemaPlay（仅排期+展示价，不调用算价 RPC）', { cinemaId, hallId });
      const raw = await supabase.getCinemaPlay(cinemaId, hallId).catch((err) => {
        LOG('getCinemaPlay 失败', { err: err && err.message });
        return [];
      });
      const arr = Array.isArray(raw) ? raw : [];
      LOG('getCinemaPlay 返回', { count: arr.length, samplePlayId: arr[0] ? (arr[0].play_id || arr[0].cine_play_id) : null });
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const movieFiltered = arr.filter((row) => {
        const cineNum = (row.cine_movie_num || row.cineMovieNum || '').toString().trim();
        const movieMatch = selectmoviecode.some((code) => {
          const c = String(code).trim();
          return c === cineNum || c.includes(cineNum) || cineNum.includes(c);
        });
        if (!movieMatch) return false;
        const startTime = parseStartTime(row.start_time || row.startTime);
        if (!startTime || startTime < now) return false;
        return true;
      });

      const dateSet = new Set();
      movieFiltered.forEach((row) => {
        const st = parseStartTime(row.start_time || row.startTime);
        if (st) {
          const ds = `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')}`;
          dateSet.add(ds);
        }
      });

      const dateStrs = Array.from(dateSet).sort();
      const dateList = dateStrs.map((str) => {
        const parts = str.split('-');
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return {
          str,
          displayDate: `${d.getMonth() + 1}/${d.getDate()}`,
          weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()],
          isToday: str === todayStr
        };
      });

      // 默认显示日期列表第一条对应的排期（当天有排期则第一条是当天，预售可能第一条是 17 号等，排期就显示该日期的场次）
      let newSelectdata = selectdata;
      let newDateIndex = 0;
      if (dateList.length > 0) {
        const idx = dateStrs.indexOf(selectdata);
        if (idx >= 0) {
          newDateIndex = idx;
          newSelectdata = dateStrs[idx];
        } else {
          newSelectdata = dateStrs[0];
          newDateIndex = 0;
        }
      }

      const filtered = movieFiltered.filter((row) => {
        const st = parseStartTime(row.start_time || row.startTime);
        if (!st) return false;
        const rowDateStr = `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')}`;
        return rowDateStr === newSelectdata;
      });

      filtered.sort((a, b) => {
        const ta = parseStartTime(a.start_time || a.startTime)?.getTime() || 0;
        const tb = parseStartTime(b.start_time || b.startTime)?.getTime() || 0;
        return ta - tb;
      });

      // 展示价来源：v_meicity_cinema_play LEFT JOIN price_play_cache 的 display_price，不调用 RPC 算价
      const showtimes = filtered.map((row) => {
        const st = parseStartTime(row.start_time || row.startTime);
        const et = parseStartTime(row.end_time || row.endTime);
        const playId = row.play_id || row.id || row.cine_play_id;
        const displayPrice = row.display_price ?? row.price ?? row.unit_price;
        const priceNum = displayPrice != null && displayPrice !== '' ? Number(displayPrice) : (Number(row.price ?? row.unit_price ?? 0) || 0);
        const priceStr = displayPrice != null && displayPrice !== '' ? (Number(displayPrice).toFixed(1) + ' 起') : (priceNum > 0 ? priceNum.toFixed(2) : '--');
        return {
          id: playId,
          playId,
          movieName: row.movie_name || row.movieName,
          hallName: row.hall_name || row.hallName || '未知影厅',
          startTime: st,
          endTime: et,
          startTimeStr: formatTime(st),
          endTimeStr: formatTime(et),
          format: row.movie_dimensional || row.dimensional || '2D',
          language: row.movie_language || row.language || '',
          price: priceNum,
          priceStr,
          raw: row
        };
      });

      const showtimesRaw = {};
      filtered.forEach((row) => {
        const key = row.play_id || row.id || row.cine_play_id;
        if (key) showtimesRaw[key] = row;
      });

      LOG('排期列表渲染完成', { showtimesCount: showtimes.length, dateListCount: dateList.length, 说明: '未调用算价RPC，价格来自 display_price' });
      this.setData({
        dateList,
        selectdata: newSelectdata,
        selectedDateIndex: newDateIndex,
        showtimes,
        showtimesRaw,
        loadingShowtimes: false
      });
    } catch (e) {
      LOG('_loadShowtimes 异常', { err: e && e.message });
      this.setData({ showtimes: [], dateList: [], loadingShowtimes: false });
      wx.showToast({ title: '加载场次失败', icon: 'none' });
    }
  },

  async onShowtimeTap(e) {
    const LOG = (msg, data) => console.log('[play][点击场次]', msg, data !== undefined ? data : '');
    const idx = parseInt(e.currentTarget.dataset.index, 10);
    const showtimes = this.data.showtimes || [];
    const showtime = showtimes[idx];
    if (!showtime) return;
    const app = getApp();
    const u = app.globalData.supabaseUser;
    const userId = (u && (u.id ?? u.userId ?? u.user_id)) || (typeof u === 'string' ? u : null);
    if (!userId) {
      LOG('未登录，弹登录框');
      this._showLoginModal();
      return;
    }
    const playId = showtime.playId ?? showtime.id;
    LOG('选中场次，发起算价 RPC', { playId, userId });
    this.setData({ selectedShowtime: showtime, selectedShowtimePriceDetails: null });
    if (playId && userId) {
      try {
        const priceDetails = await supabase.getPriceDetails(playId, userId);
        if (priceDetails && (priceDetails.final_price != null || priceDetails.price != null)) {
          LOG('算价成功，已缓存', { final_price: priceDetails.final_price, price: priceDetails.price });
          this.setData({ selectedShowtimePriceDetails: { playId, priceDetails } });
        } else {
          LOG('算价返回无有效价格', { priceDetails: priceDetails ? Object.keys(priceDetails) : null });
        }
      } catch (err) {
        console.warn('[play][点击场次] 算价失败', err);
        LOG('算价异常', { err: err && err.message });
      }
    }
  },

  async onContinue() {
    const { selectedShowtime, selectedMovie, cinema, showtimesRaw } = this.data;
    if (!selectedShowtime) {
      wx.showToast({ title: '请选择场次', icon: 'none' });
      return;
    }
    const app = getApp();
    const u = app.globalData.supabaseUser;
    const userId = (u && (u.id ?? u.userId ?? u.user_id)) || (typeof u === 'string' ? u : null);
    if (!userId) {
      this._showLoginModal();
      return;
    }
    let playId = selectedShowtime.playId ?? selectedShowtime.id;
    const showtimeRawData = showtimesRaw && playId ? showtimesRaw[playId] : selectedShowtime.raw;
    if (showtimeRawData && (showtimeRawData.play_id || showtimeRawData.playId)) {
      playId = showtimeRawData.play_id ?? showtimeRawData.playId;
    }
    if (!playId) {
      wx.showToast({ title: '场次信息异常', icon: 'none' });
      return;
    }
    const cinemaId = app.globalData.cinemainfo?.cinemaid || cinema?.cinemaid || cinema?.cinemaNumber || cinema?.id || '';
    const cinemaNum = cinema?.cinemaNumber || cinema?.cinemaid || cinema?.cinema_num || '';
    if (!cinemaId) {
      wx.showToast({ title: '影院信息异常', icon: 'none' });
      return;
    }
    const phone = (u?.phone || '').replace(/\D/g, '').replace(/^86/, '').slice(0, 11) || '';
    const auth = require('../../utils/auth.js');
    const openid = app.globalData.wxProfile?.openid || auth.getUser()?.openid || auth.getOpenid() || '';
    const cardinfo = app.globalData.cardinfo || null;
    const cardNumber = cardinfo?.cardNumber || '';

    const LOG = (msg, data) => console.log('[play][继续/创建订单]', msg, data !== undefined ? data : '');
    wx.showLoading({ title: '创建订单中...' });
    try {
      let priceDetails = null;
      const cached = this.data.selectedShowtimePriceDetails;
      if (cached && cached.playId === playId && cached.priceDetails) {
        priceDetails = cached.priceDetails;
        LOG('使用缓存的算价结果', { playId, final_price: priceDetails.final_price });
      }
      if (!priceDetails) {
        LOG('无缓存，请求 getPriceDetails', { playId, userId });
        priceDetails = await supabase.getPriceDetails(playId, userId);
      }
      if (!priceDetails) {
        LOG('获取价格信息失败：getPriceDetails 返回 null', { playId, userId });
        wx.hideLoading();
        wx.showToast({ title: '获取价格信息失败', icon: 'none' });
        return;
      }
      const unitPrice = Number(priceDetails.final_price ?? priceDetails.price ?? priceDetails.fixed_price ?? selectedShowtime.price) || 0;
      console.log('[play][继续] 【算价结果】RPC/缓存返回与使用的单价', {
        final_price: priceDetails.final_price,
        price: priceDetails.price,
        fixed_price: priceDetails.fixed_price,
        selectedShowtime_price: selectedShowtime.price,
        unitPrice
      });
      LOG('价格详情', { final_price: priceDetails.final_price, price: priceDetails.price, service_fee: priceDetails.service_fee });
      if (priceDetails.final_price == null && priceDetails.price == null && priceDetails.fixed_price == null) {
        wx.hideLoading();
        wx.showToast({ title: '无法获取该场次价格(final_price)，请重试', icon: 'none' });
        return;
      }
      const serviceFee = Number(priceDetails.service_fee ?? 0) || 0;
      const lowestPrice = priceDetails.lowest_price != null ? Number(priceDetails.lowest_price) : null;

      const raw = showtimeRawData || selectedShowtime;
      const startTimeDate = dateHelper.parseApiTimeAsUTC(selectedShowtime.startTime);
      const playUpdateTime = raw.cine_update_time || raw.cineUpdateTime || (startTimeDate ? startTimeDate.toISOString() : '');
      const cineMovieNum = (raw.cine_movie_num ?? raw.cineMovieNum ?? selectedShowtime.movieId ?? '').toString();
      const localShowId = (raw.cine_play_id ?? raw.cinePlayId ?? raw.play_id ?? raw.playId ?? playId).toString();
      const startTime = startTimeDate ? startTimeDate.toISOString() : '';
      const endTimeDate = dateHelper.parseApiTimeAsUTC(selectedShowtime.endTime);
      const endTime = endTimeDate ? endTimeDate.toISOString() : '';

      const orderData = {
        paytype: 'miniwechat',
        cinema_id: cinemaId,
        cinema_name: (cinema?.name || cinema?.cinema_name || '').toString(),
        cinema_num: cinemaNum.toString(),
        play_id: String(playId),
        movie_name: (selectedShowtime.movieName || selectedMovie?.name || '').toString(),
        movie_img_url: (selectedMovie?.logo || selectedMovie?.movie_img_url || '').toString(),
        hall_name: (selectedShowtime.hallName || '').toString(),
        phone: phone || '',
        start_time: startTime,
        end_time: endTime,
        movie_dimensional: (selectedShowtime.format || selectedShowtime.dimensional || '').toString(),
        movie_language: (selectedShowtime.language || '').toString(),
        order_channel: 'miniprogram',
        play_update_time: playUpdateTime.toString(),
        unit_price: unitPrice,
        handling_fees: 3.0,
        service_fee: serviceFee,
        user_id: String(userId),
        see_state: false,
        cine_movie_num: cineMovieNum,
        local_show_id: localShowId,
        hall_id: (raw.hall_id ?? raw.hallId ?? '').toString(),
        openid: openid || ''
      };
      if (cardNumber) orderData.card_number = cardNumber;
      if (lowestPrice != null) orderData.lowest_price = lowestPrice;

      const order = await supabase.createOrder(orderData);
      wx.hideLoading();
      if (!order || !order.id) {
        wx.showToast({ title: '创建订单失败', icon: 'none' });
        return;
      }
      app.globalData.playShowtime = selectedShowtime;
      app.globalData.playMovie = selectedMovie;
      app.globalData.playCinema = cinema;
      app.globalData.playOrder = order;
      app.globalData.playPriceDetails = { unitPrice, serviceFee, lowestPrice, priceDetails };
      console.log('[play][继续] 【play→选座】即将跳转，使用的价格', {
        unitPrice,
        final_price: priceDetails?.final_price,
        order_unit_price: order?.unit_price,
        serviceFee,
        playId,
        orderId: order?.id
      });
      wx.navigateTo({
        url: `/pages/seat-select/seat-select?playId=${encodeURIComponent(playId)}&orderId=${encodeURIComponent(order.id)}&outTradeNo=${encodeURIComponent(order.out_trade_no || '')}`
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '创建订单失败', icon: 'none' });
    }
  }
});
