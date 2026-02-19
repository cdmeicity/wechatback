/**
 * 反馈详情页
 * 展示用户反馈内容与商家回复
 */
const supabase = require('../../utils/supabase.js');
const dateHelper = require('../../utils/dateHelper.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    id: '',
    item: null,
    loading: true,
    replyAtStr: ''
  },

  onLoad(options) {
    if (!auth.redirectToLoginIfNeeded()) return;
    const id = (options && options.id) ? String(options.id).trim() : '';
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ id });
    this._loadDetail(id);
  },

  _loadDetail(id) {
    supabase.getFeedbackById(id)
      .then((row) => {
        if (!row) {
          this.setData({ loading: false, item: null });
          return;
        }
        const replyAt = row.reply_at || null;
        const replyAtStr = replyAt ? this._formatDate(replyAt) : '';
        const createdAtStr = row.created_at ? this._formatDate(row.created_at) : '';
        const images = Array.isArray(row.images) ? row.images : (row.images ? [row.images] : []);
        this.setData({
          loading: false,
          item: {
            id: row.id,
            title: row.title || '无标题',
            content: row.content || '',
            images,
            reply: row.reply || '',
            replyAtStr,
            createdAtStr
          }
        });
      })
      .catch(() => {
        this.setData({ loading: false, item: null });
      });
  },

  _formatDate(iso) {
    if (!iso) return '';
    return dateHelper.formatBeijingTime(iso, 'YYYY-MM-DD HH:mm');
  }
});
