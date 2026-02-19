const supabase = require('../../utils/supabase.js');
const noticeReadStorage = require('../../utils/noticeReadStorage.js');
const auth = require('../../utils/auth.js');

function formatTime(createdAt) {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const today = new Date();
  if (y === today.getFullYear() && m === String(today.getMonth() + 1).padStart(2, '0') && day === String(today.getDate()).padStart(2, '0')) {
    return `${h}:${min}`;
  }
  return `${y}-${m}-${day} ${h}:${min}`;
}

Page({
  data: {
    activeTab: 'event',
    tabs: [
      { key: 'event', label: '活动通知', type: 'event' },
      { key: 'system', label: '系统通知', type: 'system' }
    ],
    list: [],
    loading: true,
    empty: false
  },

  onLoad() {
    if (!auth.redirectToLoginIfNeeded()) return;
    this._loadList();
  },

  onShow() {
    if (!auth.redirectToLoginIfNeeded()) return;
    this._loadList();
  },

  onTabChange(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    this.setData({ activeTab: key, list: [], loading: true, empty: false });
    this._loadList();
  },

  async _loadList() {
    const app = getApp();
    const gd = app?.globalData || {};
    const cinemainfo = gd.cinemainfo || null;
    // new_notice.cinema_id 存的是影院编号，与 cinemaNumber/cinema_code 对应
    const cinemaId = cinemainfo && (cinemainfo.cinemaNumber || cinemainfo.cinema_num || cinemainfo.cinema_code || cinemainfo.cinemaid || cinemainfo.cinema_id);
    const cid = cinemaId != null ? String(cinemaId).trim() : '';
    const type = this.data.activeTab === 'event' ? 'event' : 'system';
    const raw = await supabase.getNoticeList(cid, 'wechat', type);
    const list = (raw || []).map(n => ({
      id: n.id,
      content: n.content || '',
      contentBrief: this._brief(n.content, 80),
      createdAt: n.created_at,
      createdAtStr: formatTime(n.created_at),
      type: n.type || type,
      isRead: noticeReadStorage.isRead(n.id)
    }));
    this.setData({ list, loading: false, empty: list.length === 0 });
    this._refreshIndexBadge();
  },

  _brief(text, len) {
    if (!text || typeof text !== 'string') return '';
    const s = String(text).trim();
    if (s.length <= len) return s;
    return s.slice(0, len) + '...';
  },

  _refreshIndexBadge() {
    const pages = getCurrentPages();
    const indexPage = pages.find(p => p.route === 'pages/index/index');
    if (indexPage && typeof indexPage._refreshNoticeUnreadCount === 'function') {
      indexPage._refreshNoticeUnreadCount();
    }
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(n => String(n.id) === String(id));
    if (!id || !item) return;
    noticeReadStorage.markRead(id);
    const list = this.data.list.map(n =>
      String(n.id) === String(id) ? { ...n, isRead: true } : n
    );
    this.setData({ list });
    this._refreshIndexBadge();
    wx.navigateTo({ url: `/pages/notification-detail/notification-detail?id=${encodeURIComponent(id)}` });
  }
});
