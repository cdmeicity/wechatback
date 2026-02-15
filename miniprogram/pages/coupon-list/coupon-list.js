/**
 * 券列表页：仅登录用户可进入
 * 查询逻辑：用当前微信 openid 查 user_profiles 得到 user_id，再用 user_id 和/或 app.userinfo.phone 查 coupon_instance，有哪个用哪个
 */
const supabase = require('../../utils/supabase.js');
const auth = require('../../utils/auth.js');
const dateHelper = require('../../utils/dateHelper.js');
const couponApi = require('../../utils/couponApi.js');

function maskCouponCode(code) {
  if (!code || typeof code !== 'string') return '****';
  const s = String(code).trim();
  if (s.length <= 4) return '****';
  if (s.length <= 8) return s.slice(0, 2) + '****' + s.slice(-2);
  return s.slice(0, 4) + '****' + s.slice(-4);
}

function normalizePhone(v) {
  if (v == null) return '';
  const s = String(v).trim().replace(/\D/g, '');
  return s.length >= 11 && s.slice(-11).startsWith('1') ? s.slice(-11) : s;
}

Page({
  data: {
    list: [],
    loading: true,
    isLoggedIn: false,
    showCouponModal: false,
    _couponCodeInput: '',
    _couponSubmitting: false,
    showCouponDetailModal: false,
    couponDetailData: null,
    _couponDetailCode: ''
  },

  onLoad() {
    this._checkAndLoad();
  },

  onShow() {
    this._checkAndLoad();
  },

  _getUserPhone() {
    const app = getApp();
    const gd = app?.globalData || {};
    const u = gd.userinfo || gd.supabaseUser || null;
    const raw = (u && (u.phone || u.mobile)) || '';
    return normalizePhone(raw);
  },

  _getOpenid() {
    const gd = getApp()?.globalData || {};
    return (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
  },

  _getUserId() {
    const app = getApp();
    const gd = app?.globalData || {};
    const u = gd.userinfo || gd.supabaseUser || null;
    return (u && (u.user_id || u.id || u.userId)) || null;
  },

  preventTouchMove() {},

  _checkAndLoad() {
    const openid = this._getOpenid();
    const phone = this._getUserPhone();
    if (!openid && !phone) {
      this.setData({ isLoggedIn: false, loading: false, list: [] });
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ isLoggedIn: true, loading: true });
    this._loadList();
  },

  _loadList() {
    const self = this;
    const openid = this._getOpenid();
    const phone = this._getUserPhone();

    const done = (rows) => {
      const list = (rows || []).map((row) => ({
        id: row.id,
        couponCode: row.coupon_code || '',
        couponCodeMasked: maskCouponCode(row.coupon_code),
        validTo: row.valid_to,
        validToStr: dateHelper.formatBeijingTime(row.valid_to, 'YYYY-MM-DD HH:mm'),
        status: row.status || 'available',
        createdAt: row.created_at
      }));
      self.setData({ list, loading: false });
    };

    // 1) 用 openid 查 user_profiles，取 user_id
    const promiseProfile = openid
      ? supabase.getUserProfileByOpenid(openid)
      : Promise.resolve(null);

    promiseProfile
      .then((profile) => {
        const userId = (profile && profile.user_id) ? String(profile.user_id).trim() : null;
        console.log('[coupon-list] openid→user_profiles.user_id', { openid: openid ? '有' : '无', userId: userId || null, phone: phone || null });
        if (!userId && !phone) {
          self.setData({ list: [], loading: false });
          return;
        }
        return supabase.getCouponListForUser(userId, phone).then(done);
      })
      .catch(() => {
        self.setData({ loading: false, list: [] });
      });
  },

  /** 点击「新绑券」：打开本页添加优惠券弹窗（与 confirm-pay 一致） */
  onAddBind() {
    const openid = this._getOpenid();
    const phone = this._getUserPhone();
    if (!openid && !phone) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ showCouponModal: true, _couponCodeInput: '', _couponSubmitting: false });
  },

  onCouponCodeInput(e) {
    this.setData({ _couponCodeInput: (e.detail && e.detail.value) || '' });
  },

  onCouponModalCancel() {
    if (this.data._couponSubmitting) return;
    this.setData({ showCouponModal: false, _couponCodeInput: '' });
  },

  onCouponModalMaskTap(e) {
    if (!e || !e.target || !e.currentTarget) return;
    const tid = (e.target && e.target.id) || '';
    const cid = (e.currentTarget && e.currentTarget.id) || '';
    if (tid === cid && cid === 'couponModalMask') this.onCouponModalCancel();
  },

  /** 确认：有 cid 则调券详情接口并弹框；无 cid 则直接弹框展示“无影院信息” */
  onCouponModalConfirm() {
    const code = String(this.data._couponCodeInput || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入券码', icon: 'none' });
      return;
    }
    const self = this;
    const cinemainfo = getApp()?.globalData?.cinemainfo || {};
    const cid = (cinemainfo.cinemaid || '').toString().trim();
    if (!cid) {
      self.setData({
        _couponSubmitting: false,
        showCouponDetailModal: true,
        couponDetailData: { error: '当前无影院信息，无法校验券' },
        _couponDetailCode: code
      });
      return;
    }
    self.setData({ _couponSubmitting: true });
    couponApi.getCouponDetail(cid, code)
      .then((detail) => {
        const avail = detail.couponAvailable ?? detail.coupon_available;
        const availNum = avail != null ? Number(avail) : null;
        const reason = detail.unavailabilityReason ?? detail.unavailability_reason ?? 0;
        const reasonText = (couponApi.getUnavailabilityReasonText || (() => '不可用'))(reason);
        const normalized = Object.assign({}, detail, { couponAvailable: availNum, unavailabilityReasonText: reasonText });
        self.setData({
          _couponSubmitting: false,
          showCouponDetailModal: true,
          couponDetailData: normalized,
          _couponDetailCode: code
        });
      })
      .catch((err) => {
        self.setData({
          _couponSubmitting: false,
          showCouponDetailModal: true,
          couponDetailData: { error: (err && err.message) || '券详情查询失败' },
          _couponDetailCode: code
        });
      });
  },

  onCouponDetailModalCancel() {
    this.setData({ showCouponDetailModal: false, couponDetailData: null, _couponDetailCode: '' });
  },

  onCouponDetailModalConfirm() {
    const { couponDetailData, _couponDetailCode } = this.data;
    const self = this;
    this.setData({ showCouponDetailModal: false, couponDetailData: null, _couponDetailCode: '' });
    if (!couponDetailData || couponDetailData.error) return;
    const avail = couponDetailData.couponAvailable ?? couponDetailData.coupon_available;
    if (Number(avail) !== 1) {
      wx.showToast({ title: '券状态不正确，不能绑定', icon: 'none' });
      return;
    }
    const code = String(_couponDetailCode || '').trim();
    if (!code) return;
    const userId = this._getUserId();
    const phone = this._getUserPhone();
    supabase.insertCouponFromDetail(couponDetailData, code, userId || undefined, phone || undefined)
      .then(() => {
        wx.showToast({ title: '添加成功', icon: 'success' });
        self.setData({ showCouponModal: false, _couponCodeInput: '' });
        self._loadList();
      })
      .catch((err) => {
        const msg = (err && err.message) || '';
        if (msg.indexOf('duplicate') !== -1 || msg.indexOf('唯一') !== -1 || msg.indexOf('already exists') !== -1) {
          if (userId) {
            supabase.bindCoupon(userId, code).then(() => {
              wx.showToast({ title: '绑定成功', icon: 'success' });
              self.setData({ showCouponModal: false, _couponCodeInput: '' });
              self._loadList();
            }).catch((e2) => {
              wx.showToast({ title: (e2 && e2.message) || '绑定失败', icon: 'none' });
            });
            return;
          }
        }
        wx.showToast({ title: msg || '写入失败', icon: 'none' });
      });
  },

  onGoLogin() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/user' }) });
  }
});
