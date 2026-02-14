const cardApi = require('../../utils/cardApi.js');
const supabase = require('../../utils/supabase.js');
const saopayRequest = require('../../utils/saopayRequest.js');
const auth = require('../../utils/auth.js');

const CARD_PAY_BASE = 'https://pay.meicity.net';

Page({
  data: {
    activeTab: 0,
    loadingCardLevels: false,
    cardLevels: [],
    selectedCard: null,
    currentCardIndex: 0,
    agreedToTerms: false,
    cardNumber: '',
    cardPassword: '',
    cardInfo: null,
    hasBoundCard: false,
    showApplyForm: false,
    applyPassword: '',
    applyPasswordConfirm: '',
    applyName: '',
    applyIdcardType: 1,
    applyIdcard: ''
  },

  onLoad(options) {
    const initialTab = options.initialTab ? parseInt(options.initialTab, 10) : 0;
    this.setData({ activeTab: initialTab === 1 ? 1 : 0 });
    if (initialTab !== 1) {
      this._loadCardLevelRules();
    }
    this._refreshCardInfo();
  },

  onShow() {
    this._refreshCardInfo();
    this._fetchCardDetailAndUpdateIfBound();
  },

  /**
   * 若已绑定会员卡，用 card_detail 拉取最新详情并更新 app.cardinfo 与页面，确保余额、minAddMoney 等正确
   */
  async _fetchCardDetailAndUpdateIfBound() {
    const app = getApp();
    const cardinfo = app?.globalData?.cardinfo;
    if (!cardinfo?.cardNumber) return;
    const cid = app?.globalData?.cinemainfo?.cinemaid || app?.globalData?.cinemainfo?.cinemaNumber || app?.globalData?.cinemainfo?.id;
    if (!cid) return;
    try {
      const res = await cardApi.getCardDetail(cid, cardinfo.cardNumber);
      const detail = cardApi.parseCardDetailResponse(res);
      if (!detail || typeof detail !== 'object') return;
      const validity = detail.period || detail.validity || detail.validDate || detail.expireDate || detail.expire_time || detail.endDate || null;
      const balanceVal = detail.balance ?? detail.money;
      const pointsVal = detail.availableJifen ?? detail.points ?? detail.integral;
      const discountVal = detail.discount != null && detail.discount !== '' ? detail.discount : null;
      const n = discountVal != null ? Number(discountVal) : NaN;
      const discountDisplay = !isNaN(n) ? (n + '%') : null;
      const minAddMoneyVal = cardApi.getMinAddMoneyFromDetail(detail) ?? cardinfo.minAddMoney;
      const updated = {
        cardNumber: detail.cardNumber || detail.card_number || cardinfo.cardNumber,
        cardName: detail.cardLevel || detail.cardName || detail.levelName || cardinfo.cardName || '会员卡',
        balance: balanceVal != null && balanceVal !== '' ? parseFloat(balanceVal) : cardinfo.balance,
        points: pointsVal != null && pointsVal !== '' ? parseInt(pointsVal, 10) : cardinfo.points,
        minAddMoney: minAddMoneyVal != null ? minAddMoneyVal : cardinfo.minAddMoney,
        validity: validity != null && validity !== '' ? String(validity) : cardinfo.validity,
        discount: discountVal != null ? discountVal : cardinfo.discount,
        discountDisplay: discountDisplay || cardinfo.discountDisplay,
        mobile: detail.mobile || null,
        phone: cardinfo.phone
      };
      app.globalData.cardinfo = updated;
      this.setData({
        cardInfo: { ...updated, discountDisplay: updated.discountDisplay || this._formatDiscountDisplay(updated.discount) },
        hasBoundCard: true
      });
      console.log('[card-manage] card_detail 已刷新', { balance: updated.balance, minAddMoney: updated.minAddMoney });
    } catch (e) {
      console.warn('[card-manage] _fetchCardDetailAndUpdateIfBound 失败', e);
    }
  },

  _formatDiscountDisplay(discount) {
    if (discount == null || discount === '') return null;
    const n = Number(discount);
    if (isNaN(n)) return null;
    return (Number.isInteger(n) ? n : n) + '%';
  },

  _refreshCardInfo() {
    const app = getApp();
    const cardinfo = app?.globalData?.cardinfo || null;
    const hasBoundCard = !!(cardinfo && cardinfo.cardNumber);
    const cardInfo = cardinfo ? {
      ...cardinfo,
      discountDisplay: cardinfo.discountDisplay || this._formatDiscountDisplay(cardinfo.discount)
    } : null;
    this.setData({ cardInfo, hasBoundCard });
    console.log('[card-manage] _refreshCardInfo', { hasCard: !!cardinfo, cardNumber: cardinfo?.cardNumber, hasBoundCard });
  },

  async _loadCardLevelRules() {
    const app = getApp();
    const cid = app?.globalData?.cinemainfo?.cinemaid || app?.globalData?.cinemainfo?.cinemaNumber || app?.globalData?.cinemainfo?.id;
    console.log('[card-manage] _loadCardLevelRules 开始', { cid, cinemainfo: app?.globalData?.cinemainfo });
    if (!cid) {
      this.setData({ loadingCardLevels: false, cardLevels: [] });
      console.warn('[card-manage] 无影院ID，跳过加载');
      wx.showToast({ title: '请先选择影院', icon: 'none' });
      return;
    }
    this.setData({ loadingCardLevels: true });
    try {
      const list = await cardApi.getCardLevelRule(cid);
      const arr = Array.isArray(list) ? list : [];
      const enabled = arr.filter((c) => {
        const v = c.extraData?.enableOnlineIssue ?? c.enableOnlineIssue ?? c.enable_online_issue;
        return v === 1 || v === '1' || v === true || v === 'Y' || v === 'y';
      });
      const levels = enabled.length > 0 ? enabled : arr;
      console.log('[card-manage] _loadCardLevelRules 完成', { total: arr.length, enabled: levels.length, levels });
      this.setData({
        cardLevels: levels,
        selectedCard: levels[0] || null,
        currentCardIndex: 0,
        loadingCardLevels: false
      });
    } catch (e) {
      console.error('[card-manage] _loadCardLevelRules 失败', e);
      this.setData({ cardLevels: [], selectedCard: null, loadingCardLevels: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onTabTap(e) {
    const index = parseInt(e.currentTarget.dataset.index, 10);
    this.setData({ activeTab: index });
    if (index === 0 && this.data.cardLevels.length === 0) {
      this._loadCardLevelRules();
    }
  },

  onSelectCard(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10);
    const card = this.data.cardLevels[idx];
    if (card) this.setData({ selectedCard: card, currentCardIndex: idx });
  },

  onSwiperChange(e) {
    const idx = e.detail?.current ?? 0;
    const card = this.data.cardLevels[idx];
    if (card) this.setData({ selectedCard: card, currentCardIndex: idx });
  },

  onAgreeChange() {
    this.setData({ agreedToTerms: !this.data.agreedToTerms });
  },

  onApplyCard() {
    if (!this.data.agreedToTerms) {
      wx.showToast({ title: '请先同意会员卡办理协议', icon: 'none' });
      return;
    }
    const { selectedCard } = this.data;
    if (!selectedCard) return;
    wx.showModal({
      title: '会员卡新办及充值协议',
      content: '请阅读并同意《会员卡新办及充值协议》后再办理。是否同意？',
      confirmText: '确定',
      success: (res) => {
        if (res.confirm) this._showApplyCardForm();
      }
    });
  },

  _showApplyCardForm() {
    this.setData({
      showApplyForm: true,
      applyPassword: '',
      applyPasswordConfirm: '',
      applyName: '',
      applyIdcardType: 1,
      applyIdcard: ''
    });
  },

  onApplyFormCancel() {
    this.setData({ showApplyForm: false });
  },

  /** 阻止弹窗内点击/触摸冒泡到遮罩，避免点击输入框时关闭弹窗 */
  preventMaskTap() {},

  onApplyPasswordInput(e) {
    this.setData({ applyPassword: (e.detail.value || '').replace(/\D/g, '').slice(0, 8) });
  },
  onApplyPasswordConfirmInput(e) {
    this.setData({ applyPasswordConfirm: (e.detail.value || '').replace(/\D/g, '').slice(0, 8) });
  },
  onApplyNameInput(e) {
    this.setData({ applyName: (e.detail.value || '').trim() });
  },
  onApplyIdcardTypeChange(e) {
    const idx = parseInt(e.detail.value, 10);
    this.setData({ applyIdcardType: idx === 0 ? 1 : idx === 1 ? 2 : 3 });
  },
  onApplyIdcardInput(e) {
    this.setData({ applyIdcard: (e.detail.value || '').trim() });
  },

  onApplyFormConfirm() {
    const { selectedCard, applyPassword, applyPasswordConfirm, applyName, applyIdcardType, applyIdcard } = this.data;
    if (!selectedCard) return;
    if (!applyPassword || applyPassword.length < 6 || applyPassword.length > 8) {
      wx.showToast({ title: '请设置6-8位数字密码', icon: 'none' });
      return;
    }
    if (applyPassword !== applyPasswordConfirm) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }
    if (!applyName || !applyName.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    const idcardType = applyIdcardType === 2 ? 2 : applyIdcardType === 3 ? 3 : 1;
    if (!applyIdcard || !applyIdcard.trim()) {
      wx.showToast({ title: '请输入证件号码', icon: 'none' });
      return;
    }
    if (idcardType === 1 && !/^\d{17}[\dXx]$/.test(applyIdcard.trim())) {
      wx.showToast({ title: '请输入正确的18位身份证号', icon: 'none' });
      return;
    }
    this.setData({ showApplyForm: false });
    this._createNewCardOrderAndPay(selectedCard, {
      password: applyPassword,
      userName: applyName.trim(),
      idcardType,
      idcard: applyIdcard.trim()
    });
  },

  async _createNewCardOrderAndPay(card, form) {
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const userId = u?.id || u?.userId || u?.user_id;
    const cid = app?.globalData?.cinemainfo?.cinemaid || app?.globalData?.cinemainfo?.cinemaNumber || app?.globalData?.cinemainfo?.id;
    const phone = (u?.phone || u?.mobile || '').toString().replace(/^\+?86/, '').trim();
    if (!userId || !phone) {
      wx.showToast({ title: '请先登录并绑定手机号', icon: 'none' });
      return;
    }
    if (!cid) {
      wx.showToast({ title: '请先在首页选择影院', icon: 'none' });
      return;
    }
    const extra = card.extraData || card.extra_data || {};
    const initMoney = parseFloat(card.initMoney ?? card.price ?? extra.initMoney ?? 0) || 0;
    const sendCardFee = parseFloat(extra.sendCardFee ?? extra.send_card_fee ?? card.sendCardFee ?? 0) || 0;
    const sendCardEquityFee = parseFloat(extra.sendCardEquityFee ?? extra.send_card_equity_fee ?? card.sendCardEquityFee ?? 0) || 0;
    const cardLevelId = card.levelId ?? card.id ?? '';
    const cardLevelName = card.levelName || card.level_name || '会员卡';
    const totalAmount = initMoney + sendCardFee + sendCardEquityFee;
    if (totalAmount <= 0) {
      wx.showToast({ title: '卡种信息异常', icon: 'none' });
      return;
    }
    const md5 = require('../../utils/md5.js');
    const passwordMd5 = md5(form.password).toLowerCase();
    const cardInfo = {
      password: passwordMd5,
      mobile: phone,
      cardLevelId: String(cardLevelId),
      cardLevelName,
      rechargeValue: initMoney,
      sendCardFee,
      sendCardEquityFee,
      userName: form.userName,
      idcard: form.idcard,
      idcardType: form.idcardType
    };
    const totalCents = Math.round(totalAmount * 100);
    const payDeadline = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    wx.showLoading({ title: '创建订单…' });
    let outTradeNo;
    try {
      const row = await supabase.createCardRechargeOrder({
        levelId: String(cardLevelId),
        levelName: cardLevelName,
        lowestDepositMoney: initMoney,
        sendCardFee,
        Total: totalAmount,
        card_pay_type: 'create',
        pay_state: 'INIT',
        uuid: String(userId),
        pay_deadline: payDeadline,
        phone: phone || null,
        processed: false,
        cinema_id: String(cid),
        cardinfo: JSON.stringify(cardInfo)
      });
      outTradeNo = row?.out_trade_no;
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '创建订单失败', icon: 'none' });
      return;
    }
    if (!outTradeNo) {
      wx.showToast({ title: '订单号异常', icon: 'none' });
      return;
    }
    this._requestWechatNewCardPay(outTradeNo, totalCents, cardInfo, totalAmount);
  },

  /**
   * 新办会员卡：调起微信支付（saopay mini-pay），total_fee 为订单金额（分）
   */
  async _requestWechatNewCardPay(outTradeNo, totalCents, cardInfoJson, amount) {
    if (!outTradeNo) {
      wx.showToast({ title: '订单号异常，无法支付', icon: 'none' });
      return;
    }
    const app = getApp();
    const openId = (app && app.globalData && app.globalData.wxProfile && app.globalData.wxProfile.openid) || (auth && auth.getOpenid && auth.getOpenid()) || '';
    if (!openId) {
      wx.showToast({ title: '请先完成微信授权', icon: 'none' });
      return;
    }
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    const d = new Date();
    const terminalTime = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const totalFeeStr = String(Math.round(Number(totalCents)));
    wx.showLoading({ title: '调起支付…' });
    try {
      const subAppid = (app && app.globalData && app.globalData.saopayAppid) || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram && wx.getAccountInfoSync().miniProgram.appId) || '';
      const data = await saopayRequest.miniPay({
        pay_type: '010',
        total_fee: totalFeeStr,
        terminal_trace: outTradeNo,
        terminal_time: terminalTime,
        sub_appid: subAppid || undefined,
        open_id: openId,
        notify_url: 'https://saopay.meicity.net/api/notify/payment'
      });
      const ok = data && (data.code === 200 || data.code === '200');
      if (!ok) {
        wx.hideLoading();
        wx.showToast({ title: (data && (data.message || data.msg)) || '支付请求失败', icon: 'none' });
        return;
      }
      const payParams = this._parseWeChatPayParams(data);
      if (!payParams) {
        wx.hideLoading();
        wx.showToast({ title: '支付参数解析失败', icon: 'none' });
        return;
      }
      wx.hideLoading();
      wx.requestPayment({
        ...payParams,
        success: () => {
          supabase.updateCardRechargeOrderPayState(outTradeNo, 'SUCCESS', new Date().toISOString()).catch(() => {});
          wx.showModal({
            title: '支付成功',
            content: '新办会员卡支付成功，系统将为您开卡，请稍后在「绑定会员卡」中绑定。',
            showCancel: false,
            success: () => {
              this.setData({ activeTab: 1 });
            }
          });
        },
        fail: (err) => {
          if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
            wx.showToast({ title: '支付已取消', icon: 'none' });
          } else {
            wx.showToast({ title: err.errMsg || '支付失败', icon: 'none' });
          }
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '支付请求失败', icon: 'none' });
    }
  },

  onCardNumberInput(e) {
    this.setData({ cardNumber: (e.detail.value || '').replace(/\D/g, '') });
  },

  onCardPasswordInput(e) {
    this.setData({ cardPassword: (e.detail.value || '').replace(/\D/g, '') });
  },

  async _doVerifyAndBind(toastSuccess = '绑定成功') {
    const LOG = (step, data) => console.log(`[绑定会员卡] ${step}`, data !== undefined ? data : '');
    const { cardNumber, cardPassword } = this.data;
    LOG('① 点击开始', { cardNumber: cardNumber ? cardNumber.slice(0, 4) + '****' : '', hasPassword: !!cardPassword });

    if (!cardNumber || !cardNumber.trim()) {
      LOG('① 校验失败', '卡号为空');
      wx.showToast({ title: '请输入会员卡号', icon: 'none' });
      return;
    }
    if (!cardPassword || !String(cardPassword).trim()) {
      LOG('① 校验失败', '密码为空');
      wx.showToast({ title: '请输入卡密码', icon: 'none' });
      return;
    }
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const phone = u?.phone || '';
    if (!phone) {
      LOG('① 校验失败', '未登录或无手机号');
      wx.showToast({ title: '请先登录并绑定手机号', icon: 'none' });
      return;
    }
    LOG('① 校验通过', { userId: u?.id, phone: phone.slice(0, 3) + '****' });

    wx.showLoading({ title: '验证中...' });
    try {
      const md5 = require('../../utils/md5.js');
      const passwordMd5 = md5(String(cardPassword).trim()).toLowerCase();
      const cid = app.globalData?.cinemainfo?.cinemaid || app.globalData?.cinemainfo?.cinemaNumber || app.globalData?.cinemainfo?.id;
      if (!cid) {
        wx.hideLoading();
        wx.showToast({ title: '请先选择影院', icon: 'none' });
        return;
      }
      LOG('② 开始查询会员卡详情并绑定', { cardNumber: cardNumber.trim(), cid });

      let cardinfo = null;
      try {
        let detail = await cardApi.getCardDetail(null, cardNumber.trim());
        LOG('③ getCardDetail 原始响应', { hasDetail: !!detail, keys: detail ? Object.keys(detail) : [] });

        if (detail && detail.data && typeof detail.data === 'object') detail = detail.data;
        if (!detail || typeof detail !== 'object') {
          throw new Error('详情格式异常');
        }

        const cardPhone = (detail.mobile || detail.phone || detail.phoneNumber || detail.mobilePhone || '').toString().replace(/\D/g, '');
        const cleanPhone = phone.replace(/\D/g, '').replace(/^86/, '');
        const cleanCardPhone = cardPhone.replace(/^86/, '');
        LOG('③ 手机号校验', { cleanPhone: cleanPhone ? cleanPhone.slice(0, 3) + '****' : '', cleanCardPhone: cleanCardPhone ? cleanCardPhone.slice(0, 3) + '****' : '', match: !cleanCardPhone || cleanPhone === cleanCardPhone });

        if (cleanCardPhone && cleanPhone !== cleanCardPhone) {
          wx.hideLoading();
          LOG('③ 手机号不匹配，中断');
          wx.showToast({ title: '电话号码与会员卡不匹配', icon: 'none' });
          return;
        }

        const validity = detail.period || detail.validity || detail.validDate || detail.expireDate || detail.expire_time || detail.endDate || null;
        const balanceVal = detail.balance ?? detail.money;
        const pointsVal = detail.availableJifen ?? detail.points ?? detail.integral;
        const discountVal = detail.discount != null && detail.discount !== '' ? detail.discount : null;
        const discountDisplay = discountVal != null ? (() => {
          const n = Number(discountVal);
          return (Number.isInteger(n) ? n : n) + '%';
        })() : null;
        cardinfo = {
          cardNumber: detail.cardNumber || cardNumber.trim(),
          cardName: detail.cardLevel || detail.cardName || detail.levelName || '会员卡',
          balance: balanceVal != null && balanceVal !== '' ? parseFloat(balanceVal) : null,
          points: pointsVal != null && pointsVal !== '' ? parseInt(pointsVal, 10) : null,
          minAddMoney: detail.minAddMoney != null && detail.minAddMoney !== '' ? parseFloat(detail.minAddMoney) : (detail.min_add_money != null ? parseFloat(detail.min_add_money) : null),
          validity: validity != null && validity !== '' ? String(validity) : null,
          discount: discountVal,
          discountDisplay,
          mobile: detail.mobile || null,
          phone: phone,
          giftCard: detail.giftCard || null,
          priceInfo: detail.priceInfo || null
        };
        LOG('③ card_detail 解析成功，将写入 app.cardinfo', cardinfo);
      } catch (e) {
        LOG('③ getCardDetail 失败，使用 minimal', { err: e.message });
        cardinfo = {
          cardNumber: cardNumber.trim(),
          cardName: '会员卡',
          balance: null,
          points: null,
          minAddMoney: null,
          validity: null,
          phone
        };
      }

      const userId = u?.id || u?.userId || u?.user_id;
      LOG('④ 调用后端 card_bind', { userId, cid, hasCardinfo: !!cardinfo });
      if (!userId) {
        wx.hideLoading();
        LOG('④ 无 userId，中断');
        wx.showToast({ title: '请先登录', icon: 'none' });
        return;
      }
      try {
        const bindRes = await cardApi.cardBind({
          cid,
          card: cardNumber.trim(),
          password: passwordMd5,
          user_id: userId,
          phone: phone || undefined
        });
        const code = bindRes?.code;
        const msg = bindRes?.message || bindRes?.msg || '';
        if (code !== 200 && code !== '200') {
          wx.hideLoading();
          wx.showToast({ title: msg || '绑定失败', icon: 'none' });
          return;
        }
        LOG('④ 后端 card_bind 成功', { scheme_id: bindRes?.data?.scheme_id });
      } catch (e) {
        LOG('④ 后端 card_bind 失败', { err: e.message });
        console.warn('[card-manage] card_bind 失败', e);
        wx.hideLoading();
        wx.showToast({ title: (e.message || e.errMsg) || '绑定失败', icon: 'none' });
        return;
      }

      LOG('⑤ 绑定成功，更新本地会员价状态 app.globalData.cardinfo');
      app.globalData.cardinfo = cardinfo;
      LOG('⑤ app.cardinfo 已更新', { cardNumber: app.globalData.cardinfo?.cardNumber, cardName: app.globalData.cardinfo?.cardName });

      LOG('⑥ 执行 setData', { cardInfo: !!cardinfo, hasBoundCard: true });
      this.setData({
        cardInfo: { ...cardinfo },
        hasBoundCard: true,
        cardNumber: '',
        cardPassword: ''
      });

      LOG('⑦ 绑定完成', {
        app_cardinfo: app.globalData.cardinfo,
        pageData_cardInfo: this.data.cardInfo,
        pageData_hasBoundCard: this.data.hasBoundCard
      });
      wx.hideLoading();
      wx.showToast({ title: toastSuccess, icon: 'success' });
    } catch (e) {
      LOG('异常', { err: e.message, stack: e.stack });
      wx.hideLoading();
      wx.showToast({ title: e.message || '验证失败', icon: 'none' });
    }
  },

  onBindCard() {
    console.log('[绑定会员卡] 点击「绑定会员卡」按钮');
    this._doVerifyAndBind('绑定成功');
  },

  async onQueryCardByPhone() {
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const phone = u?.phone || '';
    if (!phone) {
      wx.showToast({ title: '请先登录并绑定手机号', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '查询中...' });
    try {
      const list = await cardApi.cardQueryByPhone(null, phone);
      wx.hideLoading();
      if (!list || !Array.isArray(list) || list.length === 0) {
        wx.showToast({ title: '未查询到该手机号下的会员卡', icon: 'none' });
        return;
      }
      wx.showModal({
        title: '我的会员卡',
        content: list.join('\n'),
        showCancel: false,
        success: () => {
          if (list[0]) this.setData({ cardNumber: list[0] });
        }
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '查询失败', icon: 'none' });
    }
  },

  onRecharge() {
    const cardInfo = this.data.cardInfo;
    if (!cardInfo || !cardInfo.cardNumber) {
      wx.showToast({ title: '请先绑定会员卡', icon: 'none' });
      return;
    }
    const minAddMoney = cardInfo.minAddMoney != null ? parseFloat(cardInfo.minAddMoney) : null;
    if (minAddMoney == null || minAddMoney <= 0) {
      wx.showToast({ title: '无法获取最低充值金额，暂不支持充值', icon: 'none' });
      return;
    }
    const balance = (cardInfo.balance != null && cardInfo.balance !== '') ? parseFloat(cardInfo.balance) : 0;
    const afterBalance = balance + minAddMoney;
    const content = [
      '会员卡号：' + (cardInfo.cardNumber || '--'),
      '卡片名称：' + (cardInfo.cardName || '--'),
      '当前余额：¥' + balance.toFixed(2),
      (cardInfo.points != null ? '积分：' + cardInfo.points : ''),
      (cardInfo.discountDisplay ? '折扣：' + cardInfo.discountDisplay : ''),
      '最低充值金额：¥' + minAddMoney.toFixed(2),
      '待支付金额：¥' + minAddMoney.toFixed(2),
      '充值后余额：¥' + afterBalance.toFixed(2)
    ].filter(Boolean).join('\n');

    wx.showModal({
      title: '会员卡充值',
      content,
      confirmText: '确认充值',
      success: (res) => {
        if (!res.confirm) return;
        this._createRechargeOrderThenAgreement(cardInfo, minAddMoney);
      }
    });
  },

  /**
   * 创建充值订单 → 弹出会员卡新办及充值协议 → 同意后调起微信支付
   */
  async _createRechargeOrderThenAgreement(cardInfo, amount) {
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const userId = u?.id || u?.userId || u?.user_id;
    const cid = app?.globalData?.cinemainfo?.cinemaid || app?.globalData?.cinemainfo?.cinemaNumber || app?.globalData?.cinemainfo?.id;
    const phone = (u?.phone || u?.mobile || '').toString().replace(/^\+?86/, '').trim();
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (!cid) {
      wx.showToast({ title: '请先在首页选择影院', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '创建订单…' });
    let outTradeNo;
    let totalCents = Math.round(amount * 100);
    try {
      const detailRes = await cardApi.getCardDetail(cid, cardInfo.cardNumber);
      const raw = detailRes?.data || detailRes;
      const detail = raw && raw.data && typeof raw.data === 'object' ? raw.data : (raw && typeof raw === 'object' ? raw : {});
      const levelId = detail.levelId ?? detail.cardLevelId ?? null;
      const levelName = detail.cardLevel ?? detail.levelName ?? cardInfo.cardName ?? '会员卡';
      const cardBalance = detail.balance ?? detail.money ?? cardInfo.balance ?? 0;

      const payDeadline = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const orderData = {
        levelId: levelId || '',
        levelName: String(levelName),
        lowestDepositMoney: amount,
        sendCardFee: 0,
        Total: amount,
        card_pay_type: 'recharge',
        pay_state: 'INIT',
        uuid: String(userId),
        pay_deadline: payDeadline,
        phone: phone || null,
        processed: false,
        cardNum: String(cardInfo.cardNumber),
        cardBalance: cardBalance != null ? parseFloat(cardBalance) : 0,
        cinema_id: String(cid)
      };
      const row = await supabase.createCardRechargeOrder(orderData);
      outTradeNo = row?.out_trade_no;
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '创建订单失败', icon: 'none' });
      return;
    }

    if (!outTradeNo) {
      wx.showToast({ title: '订单号异常', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '会员卡新办及充值协议',
      content: '请阅读并同意《会员卡新办及充值协议》后再进行充值。是否同意？',
      confirmText: '同意',
      success: (res) => {
        if (!res.confirm) return;
        this._requestWechatCardPayAndPay(outTradeNo, totalCents, amount, cardInfo);
      }
    });
  },

  /**
   * 会员卡充值：调起微信支付（saopay mini-pay）
   * total_fee 取会员卡详情的 minAddMoney（元）* 100 为分
   */
  async _requestWechatCardPayAndPay(outTradeNo, totalCents, amount, cardInfo) {
    if (!outTradeNo) {
      wx.showToast({ title: '订单号异常，无法支付', icon: 'none' });
      return;
    }
    const app = getApp();
    const openId = (app && app.globalData && app.globalData.wxProfile && app.globalData.wxProfile.openid) || (auth && auth.getOpenid && auth.getOpenid()) || '';
    if (!openId) {
      wx.showToast({ title: '请先完成微信授权', icon: 'none' });
      return;
    }
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    const d = new Date();
    const terminalTime = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const totalFeeStr = String(Math.round(Number(totalCents)));
    wx.showLoading({ title: '调起支付…' });
    try {
      const subAppid = (app && app.globalData && app.globalData.saopayAppid) || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram && wx.getAccountInfoSync().miniProgram.appId) || '';
      const data = await saopayRequest.miniPay({
        pay_type: '010',
        total_fee: totalFeeStr,
        terminal_trace: outTradeNo,
        terminal_time: terminalTime,
        sub_appid: subAppid || undefined,
        open_id: openId,
        notify_url: 'https://saopay.meicity.net/api/notify/payment'
      });
      const ok = data && (data.code === 200 || data.code === '200');
      if (!ok) {
        wx.hideLoading();
        wx.showToast({ title: (data && (data.message || data.msg)) || '支付请求失败', icon: 'none' });
        return;
      }
      const payParams = this._parseWeChatPayParams(data);
      if (!payParams) {
        wx.hideLoading();
        wx.showToast({ title: '支付参数解析失败', icon: 'none' });
        return;
      }
      wx.hideLoading();
      wx.requestPayment({
        ...payParams,
        success: () => {
          supabase.updateCardRechargeOrderPayState(outTradeNo, 'SUCCESS', new Date().toISOString()).catch(() => {});
          wx.showModal({
            title: '支付成功',
            content: '您已通过微信支付成功充值 ¥' + amount.toFixed(2) + '，充值成功！',
            showCancel: false,
            success: () => {
              this._refreshCardDetailThenSetState(cardInfo);
              wx.showToast({ title: '充值成功！', icon: 'success' });
            }
          });
        },
        fail: (err) => {
          if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
            wx.showToast({ title: '支付已取消', icon: 'none' });
          } else {
            wx.showToast({ title: err.errMsg || '支付失败', icon: 'none' });
          }
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '支付请求失败', icon: 'none' });
    }
  },

  _parseWeChatPayParams(data) {
    const raw = (data && data.paymentParams) || (data && data.data) || data || {};
    const timeStamp = (raw.timeStamp != null && raw.timeStamp !== '') ? String(raw.timeStamp) : ((raw.timestamp != null && raw.timestamp !== '') ? String(raw.timestamp) : '');
    const nonceStr = (raw.nonceStr != null && raw.nonceStr !== '') ? String(raw.nonceStr) : ((raw.noncestr != null && raw.noncestr !== '') ? String(raw.noncestr) : '');
    const packageStr = (raw.package != null && raw.package !== '') ? String(raw.package) : '';
    const signType = (raw.signType != null && raw.signType !== '') ? String(raw.signType) : ((raw.sign_type != null && raw.sign_type !== '') ? String(raw.sign_type) : 'MD5');
    const paySign = (raw.paySign != null && raw.paySign !== '') ? String(raw.paySign) : ((raw.pay_sign != null && raw.pay_sign !== '') ? String(raw.pay_sign) : ((raw.sign != null && raw.sign !== '') ? String(raw.sign) : ''));
    if (!timeStamp || !nonceStr || !packageStr || !paySign) return null;
    return { timeStamp, nonceStr, package: packageStr, signType, paySign };
  },

  /**
   * 充值成功后刷新卡详情并更新 app.cardinfo 与页面
   */
  async _refreshCardDetailThenSetState(cardInfo) {
    if (!cardInfo || !cardInfo.cardNumber) return;
    const app = getApp();
    const cid = app?.globalData?.cinemainfo?.cinemaid || app?.globalData?.cinemainfo?.cinemaNumber || app?.globalData?.cinemainfo?.id;
    if (!cid) {
      this._refreshCardInfo();
      return;
    }
    try {
      const res = await cardApi.getCardDetail(cid, cardInfo.cardNumber);
      const detail = cardApi.parseCardDetailResponse(res) || {};
      const validity = detail.period || detail.validity || detail.validDate || detail.expireDate || detail.expire_time || detail.endDate || null;
      const balanceVal = detail.balance ?? detail.money;
      const pointsVal = detail.availableJifen ?? detail.points ?? detail.integral;
      const discountVal = detail.discount != null && detail.discount !== '' ? detail.discount : null;
      const discountDisplay = discountVal != null ? (() => {
        const n = Number(discountVal);
        return (Number.isInteger(n) ? n : n) + '%';
      })() : null;
      const updated = {
        cardNumber: detail.cardNumber || detail.card_number || cardInfo.cardNumber,
        cardName: detail.cardLevel || detail.cardName || detail.levelName || cardInfo.cardName || '会员卡',
        balance: balanceVal != null && balanceVal !== '' ? parseFloat(balanceVal) : cardInfo.balance,
        points: pointsVal != null && pointsVal !== '' ? parseInt(pointsVal, 10) : cardInfo.points,
        minAddMoney: cardApi.getMinAddMoneyFromDetail(detail) ?? cardInfo.minAddMoney,
        validity: validity != null && validity !== '' ? String(validity) : cardInfo.validity,
        discount: discountVal != null ? discountVal : cardInfo.discount,
        discountDisplay: discountDisplay || cardInfo.discountDisplay,
        mobile: detail.mobile || null,
        phone: cardInfo.phone
      };
      app.globalData.cardinfo = updated;
      this.setData({
        cardInfo: { ...updated },
        hasBoundCard: true
      });
    } catch (e) {
      this._refreshCardInfo();
    }
  },

  onUnbind() {
    const app = getApp();
    const u = app?.globalData?.supabaseUser;
    const userId = u?.id || u?.userId || u?.user_id;
    const cid = app?.globalData?.cinemainfo?.cinemaid || app?.globalData?.cinemainfo?.cinemaNumber || app?.globalData?.cinemainfo?.id;
    wx.showModal({
      title: '确认解绑',
      content: '确定要解绑会员卡吗？解绑后将无法享受会员权益。',
      confirmText: '确认解绑',
      confirmColor: '#FF5252',
      success: async (res) => {
        if (res.confirm) {
          if (userId) {
            try {
              await cardApi.cardUnbind({ user_id: userId, cid: cid || undefined });
            } catch (e) {
              console.warn('[card-manage] 后端 card_unbind 失败', e);
            }
          }
          if (app?.globalData) app.globalData.cardinfo = null;
          this.setData({ cardInfo: null, hasBoundCard: false });
          wx.showToast({ title: '解绑成功', icon: 'success' });
        }
      }
    });
  }
});
