# 前端 API 加签方式（供 dingxin.meicity.net 对接）

本文档说明美承影院调用 **dingxin.meicity.net** 接口的统一加签规则。

## 一、约定

- **基础域名**：`https://dingxin.meicity.net/api`
- **应用标识**：`appid`，默认 `6755111259`
- **签名算法**：业务参数 + 系统参数 → 按 key 排序 → key=value& → MD5(UTF-8) → 32位小写 hex

## 二、系统参数

| 参数名 | 说明 |
|--------|------|
| appid | 应用 ID |
| nonce | 32 位随机字符串 |
| timestamp | 当前时间戳（秒级） |

## 三、小程序使用

```javascript
const dingxin = require('../../utils/dingxinRequest.js');

// GET
dingxin.get('/nonmember/get_play_seat_status_plus', { cid: 'xxx', play_id: 'xxx' })
  .then(data => console.log(data));

// POST
dingxin.post('/movie/getfuturemovieallinfo', { cinema_num: 'xxx' })
  .then(data => console.log(data));
```

加签逻辑位于 `utils/apiSign.js`，请求封装位于 `utils/dingxinRequest.js`。
