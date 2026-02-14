/**
 * 排期列表页价格接口（场次价格接口规范 - 展示价）
 * GET /api/plays 获取场次基础信息 + 展示价（display_price），用于列表渲染，不区分用户身份
 *
 * 当前 play/imax 列表页已改为使用 supabase.getCinemaPlay 返回的 display_price
 * （数据来源：v_meicity_cinema_play LEFT JOIN price_play_cache），不再调用本模块。
 * 本模块保留供其他端或后续如需独立拉取展示价时使用。
 */
const dingxin = require('./dingxinRequest.js');

/**
 * 获取排期列表（含展示价）
 * @param {Object} opts - cinema_id, movie_id?, date?(YYYY-MM-DD), page?, page_size?
 * @returns {Promise<{ list: Array<{ play_id, start_time, movie_name, movie_format, display_price }>, page, page_size, total }>}
 */
function getPlaysList(opts) {
  const { cinema_id, movie_id, date, page, page_size } = opts || {};
  const params = {};
  if (cinema_id != null && cinema_id !== '') params.cinema_id = String(cinema_id);
  if (movie_id != null && movie_id !== '') params.movie_id = String(movie_id);
  if (date != null && date !== '') params.date = String(date);
  if (page != null && page !== '') params.page = Number(page);
  if (page_size != null && page_size !== '') params.page_size = Number(page_size);

  return dingxin.get('plays', params).then((res) => {
    const list = Array.isArray(res && res.list) ? res.list : [];
    return {
      list,
      page: res && (res.page != null ? res.page : 1),
      page_size: res && (res.page_size != null ? res.page_size : 20),
      total: res && (res.total != null ? res.total : list.length)
    };
  }).catch((err) => {
    console.warn('[playApi] getPlaysList 失败', err);
    return { list: [], page: 1, page_size: 20, total: 0 };
  });
}

module.exports = {
  getPlaysList
};
