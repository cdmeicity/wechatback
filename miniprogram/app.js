// 美承影院售票小程序 - 登录 & 会员卡状态统一管理
// 全局状态：supabaseUser / sessionReady / wxProfile / cardinfo
App({
  globalData: {
    supabaseUser: null,   // Supabase 登录用户（auth.meicity.net 返回的 user）
    sessionReady: false,  // 是否完成 session 恢复
    wxProfile: null,      // { openid, unionid }
    cardinfo: null,       // 会员卡信息（status=bind 才有）
    manualLogout: false,  // 防复活：用户主动退出后为 true，阻止 silentLogin 重新拉回

    // 业务配置
    cinemainfo: null,
    currentMovie: null,
    playParams: null,
    supabaseUrl: 'https://sbp-2ze7l7u43497j0gq.supabase.opentrust.net',
    supabaseAnonKey: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNicC0yemU3bDd1NDM0OTdqMGdxIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NjUzMzAyNzQsImV4cCI6MjA4MDkwNjI3NH0.FBFis1VGyn7d0GPi_sxDjUVJ_sBf72OYOKrEU3NH0rI',
    /** 填此处后 REST 请求将使用 service role key（绕过 RLS）。生产环境建议仅在后端使用。 */
    supabaseServiceKey: '',
    authBaseUrl: 'https://auth.meicity.net',
    dingxinBaseUrl: 'https://dingxin.meicity.net/api',
    dingxinAppId: '6755111259',

    // 扫呗支付（/api/payment/mini-pay）：后端配置 SAOPAY_FRONT_SIGN_SECRET 后必填
    saopayBaseUrl: 'https://saopay.meicity.net/api',
    saopayFrontSignSecret: '',  // 与后端约定，建议从自有后台下发
    saopayAppid: '',            // 可选，不填则用小程序 appId
    saopayNotifyUrl: 'https://saopay.meicity.net/api/notify/payment'
  },

  onLaunch(options) {
    console.log('[App] onLaunch 启动流程', options ? { scene: options.scene, path: options.path } : '');
    try {
      this._runSessionRestore();
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const detail = err && typeof err === 'object' ? JSON.stringify(err) : '';
      console.error('[App] onLaunch 异常', msg, detail || err);
    }
  },

  onShow() {
    // 小程序从后台切回前台时，若 session 已就绪则无需重复恢复
    if (!this.globalData.sessionReady) {
      this._runSessionRestore();
    }
  },

  /**
   * 统一 session 恢复流程（文档三）
   * 防复活：manualLogout=true 时跳过，避免刚退出又被 silentLogin 拉回
   */
  async _runSessionRestore() {
    const LOG = (msg, extra) => console.log('[SessionRestore]', msg, extra !== undefined ? extra : '');
    const auth = require('./utils/auth.js');
    const supabase = require('./utils/supabase.js');

    if (this.globalData.manualLogout === true) {
      LOG('manualLogout=true，跳过恢复');
      this.globalData.supabaseUser = null;
      this.globalData.userinfo = null;
      this.globalData.cardinfo = null;
      this.globalData.wxProfile = null;
      this.globalData.sessionReady = true;
      // 已退出登录，除登录页外都跳转登录页
      const pages = getCurrentPages();
      const cur = pages.length > 0 ? pages[pages.length - 1] : null;
      const route = cur && cur.route ? cur.route : '';
      if (route !== 'pages/login/login' && route !== 'pages/bind-phone/bind-phone') {
        setTimeout(() => { wx.redirectTo({ url: '/pages/login/login' }); }, 80);
      }
      return;
    }

    try {
      LOG('① 微信静默登录');
      const { ok, user } = await auth.silentLogin();
      const token = auth.getAccessToken();
      const storedUser = auth.getUser();

      const openid = (user || storedUser)?.openid || auth.getOpenid() || null;
      const unionid = (user || storedUser)?.unionid || null;
      this.globalData.wxProfile = openid || unionid ? { openid, unionid } : null;
      LOG('① 完成', { hasToken: !!token, openid: openid ? '有' : '无' });

      LOG('② 恢复登录态（仅 phone-login 成功过才恢复）');
      const phoneLoginDone = auth.hasPhoneLoginDone();
      if (!phoneLoginDone || !token || !storedUser) {
        this.globalData.supabaseUser = null;
        this.globalData.userinfo = null;
        this.globalData.cardinfo = null;
        LOG('② 不恢复', { phoneLoginDone, hasToken: !!token, hasUser: !!storedUser });
      } else {
        // 与 public.users 对齐：user_id 来自 users.id，phone 来自 users.phone
        const userId = storedUser.id ?? null;
        const userPhone = storedUser.phone ?? storedUser.mobile ?? null;
        const userObj = {
          id: userId,
          userId,
          user_id: userId,
          phone: userPhone,
          ...storedUser
        };
        this.globalData.supabaseUser = userObj;
        this.globalData.userinfo = userObj;
        LOG('② session 恢复', { userId: this.globalData.supabaseUser.id });

        LOG('③ 查询 user_member_cards');
        let cardinfo = await supabase.getUserMemberCard(userId);
        this.globalData.cardinfo = cardinfo || null;
        LOG('③ 完成', { hasCard: !!cardinfo });
        if (cardinfo && cardinfo.cardNumber) {
          try {
            const cid = this.globalData.cinemainfo?.cinemaid || this.globalData.cinemainfo?.cinemaNumber || this.globalData.cinemainfo?.id;
            if (cid) {
              const cardApi = require('./utils/cardApi.js');
              const res = await cardApi.getCardDetail(cid, cardinfo.cardNumber);
              const detail = cardApi.parseCardDetailResponse(res);
              if (detail) {
                cardinfo = cardApi.mergeCardDetailIntoCardinfo(cardinfo, detail);
                this.globalData.cardinfo = cardinfo;
                LOG('③ 已用 card_detail 更新 cardinfo，会员卡详情', JSON.stringify(cardinfo));
              }
            }
          } catch (e) {
            console.warn('[SessionRestore] card_detail 拉取失败，使用绑定信息', e);
          }
        }
      }

      this.globalData.sessionReady = true;
      LOG('④ sessionReady=true');
      const pages = getCurrentPages();
      const cur = pages.length > 0 ? pages[pages.length - 1] : null;
      const route = cur && cur.route ? cur.route : '';
      const isLoginPage = route === 'pages/login/login' || route === 'pages/bind-phone/bind-phone';

      if (cur && cur.route === 'pages/index/index' && typeof cur._refreshAppCardInfo === 'function') {
        cur._refreshAppCardInfo();
        LOG('④ 已通知首页刷新 cardinfo');
      }

      // 除登录页外：仅未静默登录（无 token）时跳转登录页；无手机不跳转，留到排期/订单/我的页再弹获取手机号
      if (!isLoginPage) {
        const noToken = !token;
        const noUser = !this.globalData.supabaseUser;
        if (noToken || noUser) {
          LOG('④ 未登录，跳转登录页', { noToken, noUser });
          setTimeout(() => {
            const pages = getCurrentPages();
            const cur = pages.length > 0 ? pages[pages.length - 1] : null;
            const r = cur && cur.route ? cur.route : '';
            if (r !== 'pages/login/login' && r !== 'pages/bind-phone/bind-phone') {
              wx.redirectTo({ url: '/pages/login/login' });
            }
          }, 80);
        }
      }
    } catch (err) {
      const msg = (err && err.message) || String(err);
      console.warn('[SessionRestore] 异常', msg, err && err.stack ? err.stack : '');
      this.globalData.supabaseUser = null;
      this.globalData.userinfo = null;
      this.globalData.cardinfo = null;
      this.globalData.sessionReady = true;
      // 静默登录失败时也要跳转登录页（除已在登录页外）
      const pages = getCurrentPages();
      const cur = pages.length > 0 ? pages[pages.length - 1] : null;
      const route = cur && cur.route ? cur.route : '';
      if (route !== 'pages/login/login' && route !== 'pages/bind-phone/bind-phone') {
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/login/login' });
        }, 80);
      }
    }
  }
});

