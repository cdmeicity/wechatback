const supabase = require('../../utils/supabase.js');
const noticeReadStorage = require('../../utils/noticeReadStorage.js');

function formatTime(createdAt) {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

Page({
  data: {
    id: null,
    content: '',
    createdAtStr: '',
    typeLabel: '',
    loading: true
  },

  onLoad(options) {
    const id = options?.id;
    if (!id) {
      wx.showToast({ title: '无效的通知', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    noticeReadStorage.markRead(id);
    this.setData({ id });
    this._loadDetail(id);
  },

  async _loadDetail(id) {
    const notice = await supabase.getNoticeById(id);
    if (!notice) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
      return;
    }
    const type = notice.type || '';
    const typeLabel = type === 'event' ? '活动通知' : type === 'system' ? '系统通知' : '通知';
    this.setData({
      content: notice.content || '',
      createdAtStr: formatTime(notice.created_at),
      typeLabel,
      loading: false
    });
  }
});
