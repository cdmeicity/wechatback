const supabase = require('../../utils/supabase');
const auth = require('../../utils/auth.js');

Page({
  data: {
    schedule: null,
    seats: [],
    selected: [],
    loading: true
  },

  onLoad(options) {
    if (!auth.redirectToLoginIfNeeded()) return;
    const scheduleId = options.scheduleId;
    if (scheduleId) this.loadSeats(scheduleId);
  },

  async loadSeats(scheduleId) {
    try {
      const rawSeats = await supabase.seats(scheduleId);
      const seats = rawSeats.map(s => ({ ...s, isSelected: false }));
      this.setData({ seats, scheduleId, loading: false });
    } catch (err) {
      wx.showToast({ title: '加载座位失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  toggleSeat(e) {
    const seat = e.currentTarget.dataset.seat;
    const selected = this.data.selected.slice();
    const idx = selected.findIndex(s => s.id === seat.id);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      selected.push(seat);
    }
    const selectedIds = selected.map(s => s.id);
    const seats = this.data.seats.map(s => ({
      ...s,
      isSelected: selectedIds.includes(s.id)
    }));
    this.setData({ selected, seats });
  },

  confirm() {
    const { selected, scheduleId } = this.data;
    if (selected.length === 0) {
      wx.showToast({ title: '请选择座位', icon: 'none' });
      return;
    }
    const ids = selected.map(s => s.id).join(',');
    wx.navigateTo({
      url: `/pages/order/order?scheduleId=${scheduleId}&seatIds=${ids}`
    });
  }
});
