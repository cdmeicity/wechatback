// API 配置 - 开发时使用你的后端地址，上线前改为正式域名
const config = {
  // 开发环境：本地后端
  development: 'http://localhost:3000/api',
  // 生产环境：部署后的后端地址
  production: 'https://your-api-domain.com/api'
};

// 根据编译模式切换
const env = '__ENV__' === 'production' ? 'production' : 'development';

module.exports = {
  baseUrl: config[env]
};
