/**
 * 电影详情页（原 ticketinfo 的影片详情内容，首页点击影片进入）
 * 数据来源：app.globalData.currentMovie（首页 goMovie 时写入）
 */
const dateHelper = require('../../utils/dateHelper.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    movie: null,
    basicItems: [],
    otherItems: [],
    trailers: [],
    currentTrailerIndex: 0
  },

  onLoad() {
    // 只校验登录（token），不因无手机跳转；无手机留到排期页点击场次时再弹获取手机号
    const token = auth.getAccessToken();
    const storedUser = auth.getUser();
    if (!token || !storedUser) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const app = getApp();
    const movie = app.globalData.currentMovie || null;
    if (!movie) {
      wx.showToast({ title: '未获取到影片信息', icon: 'none' });
      return;
    }
    this._processMovie(movie);
  },

  onUnload() {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.currentMovie = null;
    }
  },

  /** 分享给好友 */
  onShareAppMessage() {
    const movie = this.data.movie;
    const title = movie && movie.name ? `${movie.name} - 美承影院` : '美承影院 - 选座购票，畅享观影';
    return { title, path: '/pages/index/index' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    const movie = this.data.movie;
    const title = movie && movie.name ? `${movie.name} - 美承影院` : '美承影院 - 选座购票，畅享观影';
    return { title, query: '' };
  },

  _processMovie(movie) {
    const basicKeys = [
      'id', 'movie_id', 'movieId', 'movie_code', 'movieCode',
      'cinema_code', 'cinemaCode', 'cinemaNumber',
      'week_sales_rank', 'weekSalesRank',
      'created_at', 'createdAt', 'updated_at', 'updatedAt'
    ];
    const skipKeys = new Set([
      'id', 'name', 'logo', 'poster', 'posterUrl', 'poster_url',
      'type', 'duration', 'rating', 'score',
      'description', 'synopsis', 'intro', 'origin', 'country', 'source',
      'trailers', 'trailer', 'trailer_list', 'trailerlist',
      'raw_data', 'rawData', 'moviedetail', 'movie_detail', 'detail'
    ]);

    const allData = Object.assign({}, movie);
    const basicItems = [];
    const otherItems = [];
    const fieldNameMap = this._getFieldNameMap();

    const entries = Object.entries(allData);
    for (let i = 0; i < entries.length; i++) {
      const key = entries[i][0];
      const value = entries[i][1];
      if (value == null || skipKeys.has(key)) continue;
      const label = fieldNameMap[key] || this._formatFieldName(key);
      const displayValue = this._formatValue(value);
      const item = { label, value: displayValue };
      if (basicKeys.includes(key)) {
        basicItems.push(item);
      } else {
        otherItems.push(item);
      }
    }

    const addIfMissing = (k, v) => {
      if (v != null && v !== '' && !basicItems.some(i => i.label === (fieldNameMap[k] || this._formatFieldName(k)))) {
        basicItems.push({ label: fieldNameMap[k] || this._formatFieldName(k), value: this._formatValue(v) });
      }
    };
    addIfMissing('id', movie.id);
    addIfMissing('movie_code', movie.movie_code || movie.movieCode);
    addIfMissing('cinema_code', movie.cinema_code || movie.cinemaCode);
    addIfMissing('week_sales_rank', movie.week_sales_rank ?? movie.weekSalesRank);
    addIfMissing('created_at', movie.created_at || movie.createdAt);
    addIfMissing('updated_at', movie.updated_at || movie.updatedAt);

    const addOtherIfMissing = (k, v) => {
      if (v != null && v !== '' && !otherItems.some(i => i.label === (fieldNameMap[k] || this._formatFieldName(k)))) {
        otherItems.push({ label: fieldNameMap[k] || this._formatFieldName(k), value: this._formatValue(v) });
      }
    };
    addOtherIfMissing('release_date', movie.release_date || movie.releaseDate || movie.releaseTime);
    addOtherIfMissing('actors', movie.actors);
    addOtherIfMissing('director', movie.director);

    let trailers = movie.trailers || movie.trailer_list || movie.trailerlist || [];
    if (!Array.isArray(trailers) && movie.trailer) {
      trailers = [movie.trailer];
    }
    if (!Array.isArray(trailers)) trailers = [];

    const duration = movie.duration != null ? Number(movie.duration) : null;
    let durationText = '未知';
    if (duration != null && !isNaN(duration)) {
      const h = Math.floor(duration / 60);
      const m = duration % 60;
      durationText = h > 0 ? `${h}小时${m}分钟` : `${duration}分钟`;
    }

    const ratingVal = movie.rating ?? movie.score;
    const ratingText = ratingVal != null ? `${ratingVal}/10` : '暂无评分';

    this.setData({
      movie: Object.assign({}, movie, { durationText, ratingText }),
      basicItems,
      otherItems,
      trailers,
      currentTrailerIndex: 0
    });
  },

  _getFieldNameMap() {
    return {
      id: '影片ID',
      movie_id: '影片ID',
      movieId: '影片ID',
      movie_code: '影片代码',
      movieCode: '影片代码',
      cinema_code: '影院代码',
      cinemaCode: '影院代码',
      cinemaNumber: '影院编号',
      week_sales_rank: '周票房排名',
      weekSalesRank: '周票房排名',
      created_at: '创建时间',
      createdAt: '创建时间',
      updated_at: '更新时间',
      updatedAt: '更新时间',
      release_date: '上映日期',
      releaseDate: '上映日期',
      releaseTime: '上映时间',
      playdate: '上映日期',
      actors: '演员',
      director: '导演',
      type: '类型',
      duration: '时长',
      rating: '评分',
      score: '评分',
      origin: '来源',
      country: '国家/地区',
      language: '语言',
      state: '国家/地区',
      edition: '版本'
    };
  },

  _formatFieldName(key) {
    const map = this._getFieldNameMap();
    const lower = key.toLowerCase();
    if (map[key] || map[lower]) return map[key] || map[lower];
    const formatted = key
      .replace(/_([a-z])/g, (_, c) => ' ' + c.toUpperCase())
      .replace(/([a-z])([A-Z])/g, (_, a, b) => a + ' ' + b);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  },

  _formatValue(value) {
    if (value == null) return '无';
    if (value instanceof Date) return this._formatDateTime(value);
    if (typeof value === 'object') {
      if (Array.isArray(value)) return value.join(', ');
      return JSON.stringify(value);
    }
    return String(value);
  },

  _formatDateTime(v) {
    return dateHelper.formatBeijingTime(v, 'YYYY-MM-DD HH:mm') || String(v);
  },

  onTrailerSwiperChange(e) {
    this.setData({ currentTrailerIndex: e.detail.current });
  },

  selectShowtime() {
    const app = getApp();
    const cinema = app.globalData.cinemainfo;
    if (!cinema) {
      wx.showToast({ title: '请先在首页选择影院', icon: 'none' });
      return;
    }
    const movie = this.data.movie;
    if (!movie) return;
    const movies = app.globalData.hotMovies || [];
    const current = movies.find((m) => (m.id === movie.id || m.movie_code === movie.movie_code || m.movieCode === movie.movieCode));
    const movieList = current ? movies : [movie].concat(movies);
    const movieCode = movie.movie_code || movie.movieCode || null;
    app.globalData.playParams = {
      cinema,
      movies: movieList,
      initialMovieCode: movieCode
    };
    wx.navigateTo({ url: '/pages/play/play' });
  }
});
