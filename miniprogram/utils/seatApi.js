/**
 * 选座相关 API（鼎鑫 dingxin.meicity.net）
 * 获取场次座位状态
 */
const dingxin = require('./dingxinRequest.js');

/**
 * 从接口返回中解析座位列表
 * 支持多种返回格式
 * @param {Object} response 接口原始返回
 * @returns {Array<Object>} 座位列表 [{ x, y, rowValue, columnValue, cineSeatId, status, type }]
 */
function parseSeatList(response) {
  if (!response || typeof response !== 'object') return [];
  let raw = null;
  if (response.res && response.res.data) raw = response.res.data;
  else if (response.data) raw = response.data;
  else if (Array.isArray(response)) raw = response;
  if (!raw) return [];
  let arr = Array.isArray(raw) ? raw : (raw.seatList || raw.seat_list || raw.seats || []);
  if (!Array.isArray(arr)) return [];

  return arr.map((s) => {
    const x = s.x ?? s.row ?? 0;
    const y = s.y ?? s.col ?? s.column ?? 0;
    const rowValue = (s.rowValue ?? s.row_value ?? s.rowNum ?? '').toString();
    const columnValue = (s.columnValue ?? s.column_value ?? s.colNum ?? s.col ?? '').toString();
    const cineSeatId = s.cineSeatId ?? s.cine_seat_id ?? s.seatId ?? s.seat_id ?? s.id ?? 0;
    let status = (s.status ?? s.seatStatus ?? s.seat_status ?? 'ok').toString().toLowerCase();
    if (['booked', 'selled', 'locked', 'repair'].includes(status)) {
      // ok
    } else {
      status = 'ok';
    }
    const type = (s.type ?? s.seatType ?? 'danren').toString().toLowerCase();
    return {
      x: Number(x) || 0,
      y: Number(y) || 0,
      rowValue,
      columnValue,
      cineSeatId: Number(cineSeatId) || cineSeatId,
      status,
      type: type === 'road' ? 'road' : 'danren'
    };
  });
}

/**
 * 获取场次座位状态
 * @param {Object} opts
 * @param {string} opts.cid 影院代码（cinema_id）
 * @param {string} opts.playId 排期 ID
 * @param {string} [opts.playUpdateTime] 排期更新时间
 * @param {string} [opts.cinemaNum] 影院编号
 * @returns {Promise<Array<Object>>} 座位列表
 */
async function getSeatStatus(opts) {
  const { cid, playId, playUpdateTime, cinemaNum } = opts || {};
  if (!cid || !playId) {
    return Promise.reject(new Error('缺少 cid 或 playId'));
  }
  const params = { cid, play_id: playId };
  if (playUpdateTime) params.play_update_time = String(playUpdateTime);
  if (cinemaNum) params.cinema_num = String(cinemaNum);

  const data = await dingxin.get('/nonmember/get_play_seat_status_plus', params);
  const list = parseSeatList(data);
  console.log('[seatApi] getSeatStatus 解析座位数:', list.length);
  return list;
}

module.exports = {
  getSeatStatus,
  parseSeatList
};
