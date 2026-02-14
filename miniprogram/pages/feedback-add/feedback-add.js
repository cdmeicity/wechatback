/**
 * 新增问题反馈
 * 标题、反馈内容、多图上传至 Supabase Storage（桶 public-assets，路径 wechat-users/user_id/）
 */
const supabase = require('../../utils/supabase.js');
const auth = require('../../utils/auth.js');

const MAX_IMAGES = 9;

Page({
  data: {
    title: '',
    content: '',
    imageList: [],
    submitting: false
  },

  onTitleInput(e) {
    this.setData({ title: (e.detail && e.detail.value) || '' });
  },

  onContentInput(e) {
    this.setData({ content: (e.detail && e.detail.value) || '' });
  },

  onChooseImage() {
    const current = this.data.imageList || [];
    const remain = MAX_IMAGES - current.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传' + MAX_IMAGES + '张图片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).map(f => f.tempFilePath);
        const next = (current || []).concat(files).slice(0, MAX_IMAGES);
        this.setData({ imageList: next });
      },
      fail: () => {}
    });
  },

  onRemoveImage(e) {
    const index = e.currentTarget.dataset.index;
    const list = (this.data.imageList || []).slice();
    list.splice(index, 1);
    this.setData({ imageList: list });
  },

  onSubmit() {
    const title = String(this.data.title || '').trim();
    const content = String(this.data.content || '').trim();
    if (!title) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    if (!content) {
      wx.showToast({ title: '请输入反馈内容', icon: 'none' });
      return;
    }

    const app = getApp();
    const gd = app?.globalData || {};
    const openid = (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const phone = (gd.supabaseUser && (gd.supabaseUser.phone || gd.supabaseUser.mobile)) || '';
    const userId = (gd.supabaseUser && gd.supabaseUser.id) || null;
    const cinemainfo = gd.cinemainfo || null;
    const cinemaId = cinemainfo
      ? (cinemainfo.cinema_id || cinemainfo.cinemaid || cinemainfo.cinemaNumber || cinemainfo.id)
      : null;
    const cinema_id = cinemaId != null ? String(cinemaId) : null;
    const imageList = this.data.imageList || [];
    this.setData({ submitting: true });

    const pathUserId = (userId && String(userId)) || openid;
    if (imageList.length > 0) {
      wx.showLoading({ title: '上传图片中...', mask: true });
    }

    const uploadOne = (index) => {
      if (index >= imageList.length) return Promise.resolve([]);
      return supabase.uploadFeedbackImage(imageList[index], pathUserId)
        .then((url) => uploadOne(index + 1).then((rest) => [url].concat(rest)));
    };

    const doCreate = (imageUrls) => {
      return supabase.createFeedback({
        openid,
        user_id: userId,
        phone: phone || null,
        title,
        content,
        images: imageUrls,
        cinema_id
      });
    };

    uploadOne(0)
      .then((imageUrls) => {
        if (imageList.length > 0) wx.hideLoading();
        return doCreate(imageUrls);
      })
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '提交成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      })
      .catch((err) => {
        if (imageList.length > 0) wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: err.message || '提交失败', icon: 'none' });
      });
  }
});
