/**
 * 问题反馈列表页
 * 展示当前用户的反馈列表，点击进入详情查看商家回复
 */
const supabase = require('../../utils/supabase.js');
const auth = require('../../utils/auth.js');
const dateHelper = require('../../utils/dateHelper.js');

Page({
  data: {
    list: [],
    loading: true,
    openid: ''
  },

  onLoad() {
    this._loadList();
  },

  onShow() {
    this._loadList();
  },

  _loadList() {
    const app = getApp();
    const gd = app?.globalData || {};
    const openid = (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
    if (!openid) {
      this.setData({ loading: false, list: [] });
      return;
    }
    this.setData({ loading: true, openid });
    const self = this;
    supabase.getFeedbackList(openid)
      .then((list) => {
        const items = (list || []).map((row) => ({
          id: row.id,
          title: row.title || '无标题',
          content: (row.content || '').slice(0, 60) + ((row.content || '').length > 60 ? '...' : ''),
          hasReply: !!(row.reply && String(row.reply).trim()),
          replyAt: row.reply_at || null,
          createdAt: row.created_at,
          createdAtStr: self.formatDate(row.created_at)
        }));
        self.setData({ list: items, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, list: [] });
      });
  },

  onAddTap() {
    wx.navigateTo({ url: '/pages/feedback-add/feedback-add' });
  },

  onCardTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/feedback-detail/feedback-detail?id=${encodeURIComponent(id)}` });
  },

  formatDate(iso) {
    if (!iso) return '';
    return dateHelper.formatBeijingTime(iso, 'YYYY-MM-DD HH:mm');
  }
});
