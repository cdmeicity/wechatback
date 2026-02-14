/**
 * lingshi.meicity.net API 请求封装
 * 即将上映等接口，与 dingxin 使用相同加签规则
 */
const apiSign = require('./apiSign.js');

const LINGSHI_BASE = 'https://lingshi.meicity.net';

/**
 * 获取即将上映电影列表
 * POST /movie/getfuturemovieallinfo，业务参数为空对象
 */
function getFutureMovies() {
  const signed = apiSign.buildSignedParams({});
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${LINGSHI_BASE}/movie/getfuturemovieallinfo`,
      method: 'POST',
      data: signed,
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.statusCode !== 200) {
          reject(new Error(res.data?.message || `HTTP ${res.statusCode}`));
          return;
        }
        const data = res.data;
        const code = data?.code;
        if (code === 200 || code === 0) {
          const list = data.data || [];
          resolve(list.map((item, i) => normalizeMovie(item, i)));
        } else {
          reject(new Error(data?.message || '请求失败'));
        }
      },
      fail: reject
    });
  });
}

/**
 * 将接口返回的影片对象统一为 { id, name, logo, type, duration, ... }
 */
function normalizeMovie(item, index) {
  const id = item.id ?? item.movieId ?? item.movie_id ?? item.movie_code ?? item.movieCode ?? `f${index}`;
  return Object.assign({
    id,
    name: item.name ?? item.movieName ?? item.movie_name,
    logo: item.logo ?? item.poster ?? item.posterUrl ?? item.poster_url,
    type: item.type ?? item.movieType ?? item.movie_type ?? item.genre,
    duration: item.duration ?? item.movieDuration ?? item.movie_duration ?? item.length,
    movie_code: item.movie_code ?? item.movieCode,
    description: item.description ?? item.synopsis ?? item.intro,
    release_date: item.release_date ?? item.releaseDate ?? item.releaseTime
  }, item);
}

module.exports = {
  getFutureMovies,
  normalizeMovie
};
