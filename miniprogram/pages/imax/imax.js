/**
 * IMAX 排期页：复制自 play 页面，数据源固定 cinema_id=20006088、hall_id=23346（排期表 v_meicity_cinema_play）；
 * 查热映 v_movie_week_sales_rank 时用 cinema_code=13044301
 * 列表页价格：展示价来自 getCinemaPlay 返回的 display_price（v_meicity_cinema_play LEFT JOIN price_play_cache），展示「¥xx 起」，不调用 RPC 算价
 */
const supabase = require('../../utils/supabase');
const dateHelper = require('../../utils/dateHelper');
const auth = require('../../utils/auth.js');

const IMAX_CINEMA_ID = '20006088';   // 排期表 v_meicity_cinema_play 用 cinema_id
const IMAX_CINEMA_CODE = '13044301'; // 热映表 v_movie_week_sales_rank 用 cinema_code
const IMAX_HALL_ID = '23346';
const IMAX_CINEMA_NAME = 'IMAX CoLa 12.1激光第二代放映系统';

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
    hasUser: false,
    loadingMovies: true,
    errorMessage: null,
    showGetPhoneModal: false
  },

  async onLoad() {
    const LOG = (msg, data) => console.log('[IMAX]', msg, data !== undefined ? data : '');

    LOG('onLoad 开始', { cinemaId: IMAX_CINEMA_ID, hallId: IMAX_HALL_ID });

    const win = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = win.statusBarHeight || 0;
    const menuBottom = (menu.top || statusBarHeight) + (menu.height || 32);
    const appbarHeight = Math.round(menuBottom * (750 / (win.windowWidth || 375)));

    const cinema = {
      id: `imax-${IMAX_CINEMA_ID}`,
      name: IMAX_CINEMA_NAME,
      cinemaid: IMAX_CINEMA_ID,
      cinemaNumber: IMAX_CINEMA_ID
    };
    const hallId = IMAX_HALL_ID;

    this.setData({
      statusBarHeight,
      appbarHeight,
      cinema,
      hallId,
      loadingMovies: true,
      errorMessage: null
    });

    let movies = [];
    let errorMessage = null;
    try {
      LOG('请求排期 getCinemaPlay', { cinemaId: IMAX_CINEMA_ID, hallId: IMAX_HALL_ID });
      const playRaw = await supabase.getCinemaPlay(IMAX_CINEMA_ID, IMAX_HALL_ID);
      const playRows = Array.isArray(playRaw) ? playRaw : [];
      LOG('排期接口返回', { count: playRows.length, sample: playRows[0] ? { cine_movie_num: playRows[0].cine_movie_num, cineMovieNum: playRows[0].cineMovieNum, start_time: playRows[0].start_time } : null });

      const codesWithShowtimes = new Set();
      playRows.forEach((row) => {
        const code = (row.cine_movie_num || row.cineMovieNum || '').toString().trim();
        if (code) codesWithShowtimes.add(code);
      });
      LOG('从排期中提取的影片代码', { count: codesWithShowtimes.size, codes: Array.from(codesWithShowtimes) });

      if (codesWithShowtimes.size === 0) {
        LOG('排期无有效影片代码，影片列表为空');
        movies = [];
      } else {
        const codeList = Array.from(codesWithShowtimes);
        LOG('先按影片代码拉取 getMoviesByMovieCodes（不依赖 cinema_code）', { codes: codeList });
        let all = await supabase.getMoviesByMovieCodes(codeList);
        if (!Array.isArray(all)) all = [];
        if (all.length === 0) {
          LOG('getMoviesByMovieCodes 返回 0，回退为 movies(cinemaCode) 再过滤', { cinemaCode: IMAX_CINEMA_CODE });
          const allRaw = await supabase.movies(IMAX_CINEMA_CODE);
          all = Array.isArray(allRaw) ? allRaw : [];
        }
        LOG('热映/按代码接口返回', { count: all.length, sample: all[0] ? { name: all[0].name, movie_code: all[0].movie_code, movieCode: all[0].movieCode } : null });

        movies = all.filter((m) => {
          const codes = this._parseMovieCodes(m.movie_code || m.movieCode);
          return codes.some((c) => {
            if (!c) return false;
            if (codesWithShowtimes.has(c)) return true;
            return codeList.some((h) => h === c || (h && (h.includes(c) || c.includes(h))));
          });
        });
        LOG('按排期代码过滤后影片数', { moviesCount: movies.length, codesFromMovies: movies.slice(0, 3).map((m) => this._parseMovieCodes(m.movie_code || m.movieCode)) });
      }
    } catch (e) {
      console.error('[IMAX] 加载影片失败', e);
      errorMessage = (e && e.message) ? e.message : '加载失败';
      LOG('捕获异常', { errorMessage, stack: e.stack });
    }

    let selectedMovie = movies[0] || null;
    let selectedMovieIndex = 0;
    const selectmoviecode = this._parseMovieCodes(selectedMovie?.movie_code || selectedMovie?.movieCode);
    const movieScrollLeft = this._calcMovieScrollLeft(0);

    LOG('onLoad 结束', { moviesCount: movies.length, selectmoviecode, willLoadShowtimes: !!(cinema && selectmoviecode.length > 0) });

    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const hasUser = !!(u && (u.id ?? u.userId ?? u.user_id));
    this.setData({
      movies,
      selectedMovie,
      selectedMovieIndex,
      selectdata: '',
      selectmoviecode,
      dateList: [],
      selectedDateIndex: 0,
      showtimes: [],
      movieScrollLeft,
      loadingMovies: false,
      errorMessage,
      hasUser
    });

    if (cinema && selectmoviecode.length > 0) {
      this._loadShowtimes();
    }
  },

  onShow() {
    // 进入页只校验登录（token），不因无手机跳转；无手机留到点击排期时再弹获取手机号
    const token = auth.getAccessToken();
    const storedUser = auth.getUser();
    if (!token || !storedUser) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const hasUser = !!(u && (u.id ?? u.userId ?? u.user_id));
    this.setData({ hasUser });
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

  onGetPhoneModalClose() {
    this.setData({ showGetPhoneModal: false });
  },

  onGetPhoneModalSuccess() {
    this.setData({ showGetPhoneModal: false });
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    this.setData({ hasUser: !!(u && (u.id ?? u.userId ?? u.user_id)) });
  },

  /** 分享给好友 */
  onShareAppMessage() {
    return {
      title: 'IMAX 专场 - 美承影院',
      path: '/pages/imax/imax'
    };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return {
      title: 'IMAX 专场 - 美承影院',
      query: ''
    };
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
    const LOG = (msg, data) => console.log('[IMAX][场次]', msg, data !== undefined ? data : '');
    const { cinema, selectmoviecode, selectdata, hallId } = this.data;
    const cinemaId = cinema?.cinemaid || cinema?.cinemaNumber || cinema?.id;

    LOG('_loadShowtimes 开始', { cinemaId, hallId, selectmoviecode, selectdata });

    if (!cinemaId) {
      LOG('无 cinemaId，提前返回');
      this.setData({ showtimes: [], dateList: [], loadingShowtimes: false });
      return;
    }
    if (selectmoviecode.length === 0) {
      LOG('selectmoviecode 为空，提前返回');
      this.setData({ showtimes: [], dateList: [], loadingShowtimes: false });
      return;
    }

    this.setData({ loadingShowtimes: true });
    try {
      const raw = await supabase.getCinemaPlay(cinemaId, hallId).catch((err) => {
        LOG('getCinemaPlay 请求失败', err);
        return [];
      });
      const arr = Array.isArray(raw) ? raw : [];
      LOG('排期原始条数', { count: arr.length, sample: arr[0] ? { cine_movie_num: arr[0].cine_movie_num, start_time: arr[0].start_time } : null });

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
      LOG('按当前影片+未开场过滤后', { movieFilteredCount: movieFiltered.length, now: now.toISOString(), todayStr });

      const dateSet = new Set();
      movieFiltered.forEach((row) => {
        const st = parseStartTime(row.start_time || row.startTime);
        if (st) {
          const ds = `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')}`;
          dateSet.add(ds);
        }
      });

      const dateStrs = Array.from(dateSet).sort();
      LOG('有排期日期', { dateStrs });
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

      let newSelectdata = selectdata;
      let newDateIndex = 0;
      if (dateList.length > 0) {
        const idx = dateStrs.indexOf(selectdata);
        if (idx >= 0) {
          newDateIndex = idx;
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
      LOG('选中日期场次', { newSelectdata, filteredCount: filtered.length });

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
      LOG('_loadShowtimes 完成', { dateListLength: dateList.length, showtimesCount: showtimes.length });

      this.setData({
        dateList,
        selectdata: newSelectdata,
        selectedDateIndex: newDateIndex,
        showtimes,
        showtimesRaw,
        loadingShowtimes: false
      });
    } catch (e) {
      console.error('[IMAX][场次] _loadShowtimes 异常', e);
      this.setData({ showtimes: [], dateList: [], loadingShowtimes: false });
      wx.showToast({ title: '加载场次失败', icon: 'none' });
    }
  },

  async onShowtimeTap(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10);
    const showtimes = this.data.showtimes || [];
    const showtime = showtimes[idx];
    if (!showtime) return;
    const app = getApp();
    const u = app.globalData.supabaseUser;
    const userId = (u && (u.id ?? u.userId ?? u.user_id)) || (typeof u === 'string' ? u : null);
    if (!userId) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    // 点击排期时再检测手机号：无手机则弹获取手机号，不进入选座
    const phone = (u?.phone || u?.mobile || '').toString().trim();
    if (!phone) {
      this.setData({ showGetPhoneModal: true });
      return;
    }
    const playId = showtime.playId ?? showtime.id;
    this.setData({ selectedShowtime: showtime, selectedShowtimePriceDetails: null });
    if (playId && userId) {
      try {
        const priceDetails = await supabase.getPriceDetails(playId, userId);
        if (priceDetails && (priceDetails.final_price != null || priceDetails.price != null)) {
          this.setData({ selectedShowtimePriceDetails: { playId, priceDetails } });
        }
      } catch (err) {
        console.warn('[IMAX] 点击场次算价失败', err);
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
      wx.redirectTo({ url: '/pages/login/login' });
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
    const cinemaId = cinema?.cinemaid || cinema?.cinemaNumber || cinema?.id || '';
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

    wx.showLoading({ title: '创建订单中...' });
    try {
      let priceDetails = null;
      const cached = this.data.selectedShowtimePriceDetails;
      if (cached && cached.playId === playId && cached.priceDetails) {
        priceDetails = cached.priceDetails;
      }
      if (!priceDetails) {
        priceDetails = await supabase.getPriceDetails(playId, userId);
      }
      if (!priceDetails) {
        wx.hideLoading();
        wx.showToast({ title: '获取价格信息失败', icon: 'none' });
        return;
      }
      const unitPrice = Number(priceDetails.final_price ?? priceDetails.price ?? priceDetails.fixed_price ?? selectedShowtime.price) || 0;
      if (priceDetails.final_price == null && priceDetails.price == null && priceDetails.fixed_price == null) {
        wx.hideLoading();
        wx.showToast({ title: '无法获取该场次价格(final_price)，请重试', icon: 'none' });
        return;
      }
      console.log('[imax][继续] 【算价结果】RPC/缓存返回与使用的单价', {
        final_price: priceDetails.final_price,
        price: priceDetails.price,
        fixed_price: priceDetails.fixed_price,
        selectedShowtime_price: selectedShowtime.price,
        unitPrice
      });
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
      console.log('[imax][继续] 【IMAX→选座】即将跳转，使用的价格', {
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
