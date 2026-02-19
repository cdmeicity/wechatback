/**
 * 影片搜索页：数据与首页热映影片同一来源（app.globalData.hotMovies），竖向卡片展示，点击进入影片详情
 * 与 Flutter MovieSearchPage 逻辑一致，遵循 VI 规范
 */
const supabase = require('../../utils/supabase.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    keyword: '',
    hotMovies: [],
    filteredMovies: [],
    loading: true
  },

  onLoad() {
    this._loadHotMovies();
  },

  onShow() {
    if (!auth.redirectToLoginIfNeeded()) return;
    this._syncFromGlobal();
  },

  /** 从全局拉取热映列表并刷新过滤结果 */
  _syncFromGlobal() {
    const app = getApp();
    const gd = app?.globalData || {};
    const hot = gd.hotMovies || [];
    const keyword = (this.data.keyword || '').trim().toLowerCase();
    const filtered = keyword === ''
      ? hot
      : hot.filter((m) => {
          if ((m.name || '').toLowerCase().includes(keyword)) return true;
          if ((m.type || '').toLowerCase().includes(keyword)) return true;
          const code = (m.movie_code || m.movieCode || '').toLowerCase();
          if (code && code.includes(keyword)) return true;
          return false;
        });
    this.setData({
      hotMovies: hot,
      filteredMovies: filtered,
      loading: false
    });
  },

  /** 进入页时若首页已有选中影院但热映未加载/为空，主动拉取热映列表 */
  _loadHotMovies() {
    const app = getApp();
    const gd = app?.globalData || {};
    const cinema = gd.cinemainfo || null;
    const hot = gd.hotMovies || [];

    if (hot.length > 0) {
      this._syncFromGlobal();
      return;
    }

    const cinemaNumber = cinema?.cinemaNumber || cinema?.cinemaid || cinema?.cinema_code || null;
    if (!cinemaNumber) {
      this.setData({ hotMovies: [], filteredMovies: [], loading: false });
      return;
    }

    this.setData({ loading: true });
    supabase.movies(cinemaNumber)
      .then((list) => {
        const arr = list || [];
        const today = new Date().toISOString().slice(0, 10);
        const hotFiltered = arr.filter((m) => (m.release_date || '') <= today)
          .sort((a, b) => (b.playdate || b.playDate || '').localeCompare(a.playdate || a.playDate || ''));
        if (app.globalData) app.globalData.hotMovies = hotFiltered.slice();
        this.setData({ hotMovies: hotFiltered }, () => this._applyFilter());
      })
      .catch(() => {
        this.setData({ hotMovies: [], filteredMovies: [], loading: false });
      });
  },

  _applyFilter() {
    const keyword = (this.data.keyword || '').trim().toLowerCase();
    const hot = this.data.hotMovies || [];
    const filtered = keyword === ''
      ? hot
      : hot.filter((m) => {
          if ((m.name || '').toLowerCase().includes(keyword)) return true;
          if ((m.type || '').toLowerCase().includes(keyword)) return true;
          const code = (m.movie_code || m.movieCode || '').toLowerCase();
          if (code && code.includes(keyword)) return true;
          return false;
        });
    this.setData({ filteredMovies: filtered, loading: false });
  },

  onInput(e) {
    this.setData({ keyword: (e.detail && e.detail.value) || '' }, () => this._applyFilter());
  },

  onClear() {
    this.setData({ keyword: '' }, () => this._applyFilter());
  },

  goMovie(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.filteredMovies || [];
    const movie = list.find((m) => String(m.id) === String(id));
    if (!movie) return;
    const app = getApp();
    if (app && app.globalData) app.globalData.currentMovie = { ...movie };
    wx.navigateTo({ url: '/pages/movieinfo/movieinfo' });
  }
});
