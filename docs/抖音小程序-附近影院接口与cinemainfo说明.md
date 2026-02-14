# 抖音小程序：首页「附近影院」接口与 app.cinemainfo 说明

本文档供抖音小程序侧实现「查找附近影院」、下拉列表展示、以及选择其它影院时更新全局影院信息（app.cinemainfo）时参考。

---

## 一、附近影院接口

### 1.1 接口基本信息

| 项目 | 说明 |
|------|------|
| **用途** | 根据用户经纬度获取附近影院列表（按距离排序） |
| **请求方式** | POST |
| **URL** | `{supabaseBaseUrl}/rest/v1/rpc/get_near_cinema_list` |
| **鉴权** | Header 需带 `apikey` 与 `Authorization: Bearer {key}` |

**当前微信小程序使用的 Supabase 配置（示例）：**

- Base URL: `https://sbp-2ze7l7u43497j0gq.supabase.opentrust.net`
- 完整请求 URL: `https://sbp-2ze7l7u43497j0gq.supabase.opentrust.net/rest/v1/rpc/get_near_cinema_list`
- 鉴权 Key：与项目约定的 anon key 或 service key（由后端/配置下发）

### 1.2 请求参数（Body JSON）

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_lat` | number | 是 | 用户纬度（WGS84） |
| `user_lng` | number | 是 | 用户经度（WGS84） |
| `max_results` | number | 否 | 最多返回条数，默认 10，建议 10～20 |

**请求示例：**

```json
{
  "user_lat": 47.0,
  "user_lng": 117.0,
  "max_results": 20
}
```

### 1.3 响应

- **成功**：HTTP 200，Body 为 **JSON 数组**，每项为一条影院对象。
- **失败**：非 2xx 时，Body 中可能有 `message` 或 `error_description` 等错误信息。

**单条影院对象字段说明（与当前微信端使用一致）：**

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string/number | 影院主键 ID |
| `cinemaid` | string | 影院 ID（与订票等接口一致时优先用） |
| `cinemaNumber` / `cinema_num` | string | 影院编号/编码，热映影片、排期等接口按此筛选 |
| `name` | string | 影院名称 |
| `distance_meters` | number | 与用户的直线距离（米） |
| 其他 | - | 地址、经纬度等若后端有返回可一并保留，整条对象会存入全局 cinemainfo |

**响应示例：**

```json
[
  {
    "id": "xxx-uuid",
    "cinemaid": "1001",
    "cinemaNumber": "1001",
    "cinema_num": "1001",
    "name": "美承影院XX店",
    "distance_meters": 1250,
    "address": "..."
  }
]
```

### 1.4 抖音侧请求示例（伪代码）

```javascript
// 1. 获取位置（抖音 API 替换 wx.getLocation）
const loc = await tt.getLocation({ type: 'wgs84' });
const user_lat = loc.latitude;
const user_lng = loc.longitude;

// 2. 请求附近影院
const res = await tt.request({
  url: 'https://sbp-2ze7l7u43497j0gq.supabase.opentrust.net/rest/v1/rpc/get_near_cinema_list',
  method: 'POST',
  header: {
    'Content-Type': 'application/json',
    'apikey': 'YOUR_ANON_OR_SERVICE_KEY',
    'Authorization': 'Bearer YOUR_ANON_OR_SERVICE_KEY'
  },
  data: {
    user_lat,
    user_lng,
    max_results: 20
  }
});

if (res.statusCode >= 200 && res.statusCode < 300) {
  const cinemaList = res.data || [];
  // 使用 cinemaList 渲染下拉、并更新 app.cinemainfo（见下）
} else {
  // 根据 res.data.message 等提示失败
}
```

---

## 二、距离展示（displayDistance）

接口返回的是 `distance_meters`（米）。前端可做一层格式化便于展示，例如：

- `meters < 1000` → 显示为 `"500m"`
- `meters >= 1000` → 显示为 `"1.2km"`

微信端实现参考：

```javascript
function formatDistance(meters) {
  if (meters == null) return '';
  if (meters < 1000) return meters.toFixed(0) + 'm';
  return (meters / 1000).toFixed(1) + 'km';
}
```

列表项展示时可使用：`影院名称 (1.2km)` 这类格式。

---

## 三、下拉列表展示

- **数据来源**：上一节请求得到的 `cinemaList` 数组。
- **展示内容**：每条显示「影院名称 + 距离」，例如：`美承影院XX店 (1.2km)`。
- **交互**：用户点击某一条即视为「选择该影院」，需执行：
  1. 更新页面当前选中影院（currentCinema）。
  2. **更新 app 全局 cinemainfo**（见第四节）。
  3. 若有依赖当前影院的列表（如热映影片、排期），需重新拉取。

微信端用 `wx.showActionSheet` 做下拉选择，抖音可改用自家组件（如 picker、自定义弹层列表等），逻辑一致即可。

---

## 四、app.cinemainfo 的更新与使用

### 4.1 含义

`cinemainfo` 是**当前选中的影院**的完整信息对象，应放在**应用全局**（如 `getApp().globalData.cinemainfo`），在首页、选座、支付、会员卡等页面都会用到。

### 4.2 何时更新

1. **首页拉取附近影院成功后**  
   取列表**第一条**作为默认选中影院，写入全局：
   - `app.globalData.cinemainfo = 第一条影院完整对象（深拷贝）`

2. **用户在下拉列表中选择了其它影院时**  
   将**选中的那条影院对象**写入全局：
   - `app.globalData.cinemainfo = 选中的影院完整对象（深拷贝）`

建议使用「整对象覆盖」而不是只改个别字段，保证各页拿到的都是一条完整的影院信息。

### 4.3 影院对象必须保留的字段

以下字段在后续接口或页面中会被读取，请保证从「附近影院」接口拿到的对象中保留（若后端字段名不同，可在前端做一次映射）：

| 字段 | 用途 |
|------|------|
| `id` | 影院主键，部分接口用 id |
| `cinemaid` | 订票/会员卡等接口的影院 ID |
| `cinemaNumber` 或 `cinema_num` | 热映影片、排期、拦截规则等按影院编号筛选 |
| `name` | 展示用影院名称 |

其它字段（如 `address`、`distance_meters`）若有也一并存入，便于展示或扩展。

### 4.4 各页如何使用 cinemainfo

- **影院 ID 的取法**（三选一，按优先级）：  
  `cinemainfo.cinemaid` → `cinemainfo.cinemaNumber` → `cinemainfo.id`

- **影院编号（用于热映、排期等）**：  
  `cinemainfo.cinemaNumber` 或 `cinemainfo.cinema_num`

典型用法示例：

- 热映影片列表：按 `cinemaNumber` 请求「该影院」的热映数据。
- 选座/下单/支付：用上面「影院 ID 的取法」得到 `cinemaId` 传给后端。
- 会员卡：用同一 `cinemaId` 查会员卡规则、余额等。
- 问题反馈：提交时带当前影院 ID。

抖音实现时，只要在「首页拉取附近影院」和「用户切换影院」两处正确写入 `app.globalData.cinemainfo`，其余页面统一从 `getApp().globalData.cinemainfo` 读即可。

### 4.5 代码参考（与微信端逻辑一致）

**① 首页加载附近影院成功后：**

```javascript
const list = res.data || [];
const cinemaListWithDist = list.map(c => ({
  ...c,
  displayDistance: formatDistance(c.distance_meters)
}));
const first = cinemaListWithDist[0];

const app = getApp();
if (app && app.globalData) {
  app.globalData.cinemainfo = first ? { ...first } : null;
}

// 页面 data：cinemaList = cinemaListWithDist, currentCinema = first
```

**② 用户在下拉里选择了其它影院时：**

```javascript
// selected = 当前选中的那条影院对象（来自 cinemaList）
const app = getApp();
if (app && app.globalData && selected) {
  app.globalData.cinemainfo = { ...selected };
}
// 并执行：重新加载依赖当前影院的列表（如热映影片）
```

---

## 五、流程小结（给抖音实现用）

1. **首页 onLoad / 下拉刷新**  
   - 获取定位 → 调用「附近影院」接口 → 得到 `cinemaList`。  
   - 取第一条设为当前影院，`app.globalData.cinemainfo = 第一条`，页面展示第一条名称+距离。  
   - 用 `cinemaList` 渲染下拉列表（名称 + displayDistance）。

2. **用户点击「选择影院」弹出下拉**  
   - 展示 `cinemaList` 中每项：`名称 (displayDistance)`。  
   - 用户选某一项后：`app.globalData.cinemainfo = 该项`，并刷新热映/排期等依赖影院的接口。

3. **其它页面**  
   - 需要影院 ID 或影院编号时，统一从 `getApp().globalData.cinemainfo` 取，按上文「影院 ID 的取法」和「影院编号」使用。

按上述接口与 cinemainfo 约定实现即可与现有后端、业务逻辑对齐；若抖音侧有统一请求封装（如 baseUrl、apikey 配置），只需把 URL 与 Header 替换成同一套配置即可。
