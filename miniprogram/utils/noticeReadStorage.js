/**
 * 通知已读状态（本地存储，一个用户一份）
 * 用于首页未读数角标、通知中心列表红点
 */
const auth = require('./auth.js');
const STORAGE_PREFIX = 'notice_read_';

function getUserKey() {
  const gd = getApp()?.globalData || {};
  const openid = (gd.wxProfile && gd.wxProfile.openid) || (auth.getOpenid && auth.getOpenid()) || '';
  const userId = gd.supabaseUser?.id;
  return (openid || userId || 'guest').toString();
}

function getStorageKey() {
  return STORAGE_PREFIX + getUserKey();
}

/** 获取已读通知 id 列表 */
function getReadIds() {
  try {
    const raw = wx.getStorageSync(getStorageKey());
    if (Array.isArray(raw)) return raw.map(String);
    if (raw && typeof raw === 'object' && Array.isArray(raw.ids)) return raw.ids.map(String);
    return [];
  } catch (e) {
    return [];
  }
}

/** 标记通知已读 */
function markRead(noticeId) {
  if (noticeId == null) return;
  const key = getStorageKey();
  const ids = getReadIds();
  const idStr = String(noticeId);
  if (ids.indexOf(idStr) >= 0) return;
  ids.push(idStr);
  try {
    wx.setStorageSync(key, ids);
  } catch (e) {
    console.warn('[noticeReadStorage] 保存已读失败', e);
  }
}

/** 计算未读数量：noticeList 中未在已读列表的条数 */
function getUnreadCount(noticeList) {
  if (!Array.isArray(noticeList) || noticeList.length === 0) return 0;
  const readIds = new Set(getReadIds());
  return noticeList.filter(n => n && n.id != null && !readIds.has(String(n.id))).length;
}

/** 是否已读 */
function isRead(noticeId) {
  return getReadIds().indexOf(String(noticeId)) >= 0;
}

module.exports = {
  getReadIds,
  markRead,
  getUnreadCount,
  isRead,
  getUserKey
};
