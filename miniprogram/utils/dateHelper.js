/**
 * 接口/数据库时间：带 Z 或 ±offset 的按原样解析；无时区后缀的按 UTC 解析（常见为数据库存 UTC）。
 * formatBeijingTime 会转为北京时间展示（+8 小时）。
 */

/**
 * 将接口返回的日期时间字符串解析为 Date（用于与 Date.now() 相减、以及 formatBeijingTime 展示）
 * - 带 Z 或 ±offset：按原样解析
 * - 无时区后缀：按 UTC 解析（与数据库常见存 UTC 一致，避免差 8 小时）
 * @param {string|Date} v - 接口原始值（如 2026-02-09T03:05:00 表示 UTC，即 11:05 北京时间）
 * @returns {Date|null}
 */
function parseApiTimeAsUTC(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  try {
    const s = String(v).trim();
    if (!s) return null;
    if (/Z$|[\+\-]\d{2}:?\d{2}$/i.test(s)) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    // 无时区：按 UTC 解析（数据库/接口常见为 UTC），formatBeijingTime 会 +8 转为北京展示
    const normalized = s.replace(' ', 'T');
    const utcStr = normalized.endsWith('Z') ? normalized : normalized + 'Z';
    const d = new Date(utcStr);
    return isNaN(d.getTime()) ? null : d;
  } catch (_) {
    return null;
  }
}

/**
 * 将接口返回的日期时间字符串解析为 Date，无时区后缀时按北京时间解析（用于排期等国内业务）
 * - 带 Z 或 ±offset：按原样解析
 * - 无时区后缀：按北京时间解析（避免排期接口存北京时间无后缀时被当 UTC 导致差 8 小时、只显示傍晚场）
 * @param {string|Date} v - 接口原始值（如 2026-02-17T11:00:00 表示 11:00 北京时间）
 * @returns {Date|null}
 */
function parseApiTimeAsBeijing(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  try {
    const s = String(v).trim();
    if (!s) return null;
    if (/Z$|[\+\-]\d{2}:?\d{2}$/i.test(s)) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    // 无时区：按北京时间解析（即 UTC = 该时刻 - 8 小时）
    const normalized = s.replace(/\s+/, ' ').replace(' ', 'T');
    const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const h = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    const sec = parseInt(m[6] || '0', 10);
    const utcMs = Date.UTC(y, mon, d, h - 8, min, sec);
    const date = new Date(utcMs);
    return isNaN(date.getTime()) ? null : date;
  } catch (_) {
    return null;
  }
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 接口时间转 UTC 时间戳（用于与 Date.now() 做差算距开场分钟数）
 * 若字符串带 Z 或无时区后缀：视为 UTC（如 08:05 即 08:05 UTC = 16:05 北京）
 * 若带 +08:00 等：视为北京时间，再转为 UTC 时间戳
 * @param {string} v - 接口值（如 2026-02-09T08:05:00 或 2026-02-09T08:05:00Z 为 UTC；2026-02-09T16:05:00+08:00 为北京）
 * @returns {number|null} 毫秒时间戳，无效时 null
 */
function beijingTimeStringToMs(v) {
  if (v == null) return null;
  let s = String(v).trim();
  const hasZ = /Z$/i.test(s);
  const hasOffset = /[+-]\d{2}:?\d{2}$/.test(s);
  s = s.replace(/\s+/g, ' ').replace(' ', 'T').replace(/Z$/i, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const h = parseInt(m[4], 10);
  const min = parseInt(m[5], 10);
  const sec = parseInt(m[6] || '0', 10);
  const isUtc = hasZ || !hasOffset;
  const ms = isUtc ? Date.UTC(y, mon - 1, d, h, min, sec) : Date.UTC(y, mon - 1, d, h - 8, min, sec);
  return isNaN(ms) ? null : ms;
}

/**
 * 直接显示数据库时间字符串，不做解析（仅替换 T 为空格、截取为 YYYY-MM-DD HH:mm）
 * @param {string} v - 数据库字段值，如 2026-02-09T11:05:00
 * @returns {string}
 */
function formatDbTimeDisplay(v) {
  if (v == null) return '';
  const s = String(v).trim().replace('T', ' ');
  return s.substring(0, 16);
}

/**
 * 将 Date 转为北京时间的年月日时分秒（任何设备一致）
 * @param {Date} d
 * @returns {{ year, month, date, hours, minutes, seconds }|null} month 1-12，其余为数字
 */
function getBeijingComponents(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  const t = d.getTime() + BEIJING_OFFSET_MS;
  const bj = new Date(t);
  return {
    year: bj.getUTCFullYear(),
    month: bj.getUTCMonth() + 1,
    date: bj.getUTCDate(),
    hours: bj.getUTCHours(),
    minutes: bj.getUTCMinutes(),
    seconds: bj.getUTCSeconds()
  };
}

/**
 * 按北京时间格式化展示（任何设备都显示北京时间）
 * @param {string|Date} v - 接口原始值或 Date，会先经 parseApiTimeAsUTC 解析
 * @param {string} [format='HH:mm'] - 'HH:mm' | 'HH:mm:ss' | 'YYYY-MM-DD' | 'YYYY-MM-DD HH:mm' | 'M/D HH:mm'
 * @returns {string}
 */
function formatBeijingTime(v, format) {
  const d = v instanceof Date ? v : parseApiTimeAsUTC(v);
  const c = getBeijingComponents(d);
  if (!c) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const h = pad(c.hours);
  const min = pad(c.minutes);
  const sec = pad(c.seconds);
  const y = c.year;
  const m = pad(c.month);
  const day = pad(c.date);
  switch (format) {
    case 'HH:mm:ss':
      return `${h}:${min}:${sec}`;
    case 'YYYY-MM-DD':
      return `${y}-${m}-${day}`;
    case 'YYYY-MM-DD HH:mm':
      return `${y}-${m}-${day} ${h}:${min}`;
    case 'M/D HH:mm':
      return `${c.month}/${c.date} ${h}:${min}`;
    case 'HH:mm':
    default:
      return `${h}:${min}`;
  }
}

module.exports = {
  parseApiTimeAsUTC,
  parseApiTimeAsBeijing,
  beijingTimeStringToMs,
  formatDbTimeDisplay,
  getBeijingComponents,
  formatBeijingTime
};
