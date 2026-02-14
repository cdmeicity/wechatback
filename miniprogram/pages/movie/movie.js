const supabase = require('../../utils/supabase');
const dateHelper = require('../../utils/dateHelper.js');

Page({
  data: {
    movie: null,
    schedules: [],
    loading: true
  },

  onLoad(options) {
    const id = (options && options.id) ? String(options.id).trim() : '';
    if (id) {
      this.loadMovie(id);
      this.loadSchedules(id);
      return;
    }
    const app = getApp();
    const current = app.globalData.currentMovie;
    if (current) {
      this.setData({ movie: current, loading: false });
      const mid = current.id || current.movie_id || current.movieId;
      if (mid) this.loadSchedules(mid);
    } else {
      this.setData({ loading: false });
    }
  },

  async loadMovie(id) {
    try {
      const movie = await supabase.movie(id);
      this.setData({ movie });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async loadSchedules(movieId) {
    try {
      const raw = await supabase.schedules(movieId);
      const schedules = raw.map(s => ({
        ...s,
        show_time_formatted: this.formatTime(s.show_time)
      }));
      this.setData({ schedules, loading: false });
    } catch (err) {
      wx.showToast({ title: '加载场次失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  selectSchedule(e) {
    const schedule = e.currentTarget.dataset.schedule;
    wx.navigateTo({
      url: `/pages/select-seat/select-seat?scheduleId=${schedule.id}`
    });
  },

  formatTime(dateStr) {
    return dateHelper.formatBeijingTime(dateStr, 'M/D HH:mm');
  }
});
