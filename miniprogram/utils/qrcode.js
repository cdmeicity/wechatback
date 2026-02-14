/**
 * 二维码绘制（用于影票取票码）
 * 通过 selector 获取 canvas 2d 并绘制二维码，尺寸适中不超出边界
 */
var drawQrcodeLib;
try {
  drawQrcodeLib = require('weapp-qrcode-canvas-2d');
} catch (e) {
  drawQrcodeLib = null;
}
var drawQrcodeFn = drawQrcodeLib && (drawQrcodeLib.default || drawQrcodeLib);

var DEFAULT_SIZE = 260;
var MAX_SIZE = 280;
var PADDING = 15;

/**
 * 通过 selector 获取 canvas 2d 并绘制二维码
 * @param {string} selector - 如 '#barcodeCanvas0'
 * @param {string} text - 二维码内容（取票码）
 * @param {object} opts - { size?: number } 可选，二维码边长（px）
 * @param {object} context - 页面实例 this
 * @returns {Promise<void>}
 */
function drawQrcode(selector, text, opts, context) {
  return new Promise(function (resolve, reject) {
    if (!drawQrcodeFn) {
      reject(new Error('weapp-qrcode-canvas-2d 未安装，请在 miniprogram 目录执行 npm install 并在微信开发者工具中 构建 npm'));
      return;
    }
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
        var width = (res[0].width || 0);
        var height = (res[0].height || 0);
        var size = (opts && opts.size) > 0 ? opts.size : DEFAULT_SIZE;
        var maxW = Math.max(width, 200);
        var maxH = Math.max(height, 200);
        if (size > maxW - 32 || size > maxH - 32) {
          size = Math.min(maxW - 32, maxH - 32, MAX_SIZE);
        }
        if (size < 120) size = 120;
        drawQrcodeFn({
          canvas: canvas,
          canvasId: selector.slice(1),
          text: String(text || ''),
          width: size,
          padding: PADDING,
          background: '#ffffff',
          foreground: '#000000'
        }).then(resolve).catch(reject);
      });
  });
}

module.exports = {
  drawQrcode: drawQrcode
};
