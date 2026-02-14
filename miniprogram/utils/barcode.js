/**
 * Code128 条形码绘制（仅支持数字与常见 ASCII，Set B）
 * 用于影票详情页在 canvas 上绘制条形码图形
 */

// Code128 Set B 编码表：每码 11 个模块，数字表示条/空宽度 1~4
var CODE128B = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

var START_B = 104;
var STOP = 106;

function getCode128BIndex(c) {
  var code = c.charCodeAt(0);
  if (code >= 32 && code <= 127) {
    return code - 32;
  }
  return -1;
}

/**
 * 将字符串编码为 Code128 条空序列（1=黑 0=白，每个元素为模块宽度）
 * @param {string} text
 * @returns {number[]} 条空宽度序列
 */
function encodeCode128B(text) {
  if (!text || typeof text !== 'string') return [];
  var seq = [];
  var i;
  for (i = 0; i < CODE128B[START_B].length; i++) {
    seq.push(parseInt(CODE128B[START_B][i], 10));
  }
  for (var k = 0; k < text.length; k++) {
    var idx = getCode128BIndex(text[k]);
    if (idx < 0) continue;
    var pat = CODE128B[idx];
    for (i = 0; i < pat.length; i++) {
      seq.push(parseInt(pat[i], 10));
    }
  }
  for (i = 0; i < CODE128B[STOP].length; i++) {
    seq.push(parseInt(CODE128B[STOP][i], 10));
  }
  return seq;
}

/**
 * 在 Canvas 2D 上绘制 Code128 条形码
 * @param {Canvas} canvas - type="2d" 的 canvas 节点
 * @param {string} data - 条形码内容（建议仅数字与 ASCII）
 * @param {object} opts - { width, height, barColor, bgColor }
 */
function drawBarcodeOnCanvas(canvas, data, opts) {
  if (!canvas || !data) return;
  var width = (opts && opts.width) || 600;
  var height = (opts && opts.height) || 100;
  var barColor = (opts && opts.barColor) || '#000000';
  var bgColor = (opts && opts.bgColor) || '#FFFFFF';

  var seq = encodeCode128B(String(data));
  if (seq.length === 0) return;

  var totalModules = 0;
  for (var i = 0; i < seq.length; i++) {
    totalModules += seq[i];
  }

  var dpr = wx.getSystemInfoSync().pixelRatio || 2;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  var barWidth = (width / totalModules) * dpr;
  var x = 0;
  var isBar = true;

  for (var j = 0; j < seq.length; j++) {
    var w = seq[j] * barWidth;
    if (isBar) {
      ctx.fillStyle = barColor;
      ctx.fillRect(x, 0, w, canvas.height);
    }
    x += w;
    isBar = !isBar;
  }
}

/**
 * 通过 selector 获取 canvas 2d 节点并绘制条形码（用于页面内调用）
 * @param {string} selector - 如 '#barcodeCanvas0'
 * @param {string} data
 * @param {object} opts
 * @param {object} context - 页面实例 this，用于 SelectorQuery.in(this)
 * @returns {Promise<void>}
 */
function drawBarcode(selector, data, opts, context) {
  return new Promise(function (resolve, reject) {
    var query = wx.createSelectorQuery();
    if (context) query = query.in(context);
    query.select(selector)
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('canvas node not found'));
          return;
        }
        var canvas = res[0].node;
        var width = res[0].width || 600;
        var height = res[0].height || 100;
        drawBarcodeOnCanvas(canvas, data, Object.assign({ width: width, height: height }, opts));
        resolve();
      });
  });
}

module.exports = {
  drawBarcodeOnCanvas,
  drawBarcode,
  encodeCode128B
};
