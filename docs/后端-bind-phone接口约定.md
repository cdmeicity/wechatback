# 后端 bind-phone 接口约定（确保 users.phone 被更新）

## 问题现象

获取用户微信手机号后，**users.phone 未被成功更新**，导致前端或下次恢复 session 时仍认为未绑定手机号。

## 接口：POST /auth/wechat-mp/bind-phone

- **Header**：`Authorization: Bearer <静默登录的 access_token>`
- **Body**：`{ "code": "getPhoneNumber 回调返回的 code" }`
- **后端需完成**：
  1. 用 `code` 向微信服务端换取用户手机号（解密得到纯手机号）。
  2. **将手机号写入对应用户**：根据当前 token 对应的用户（或 openid 对应用户），在 **users 表** 中更新该用户的 **phone** 字段（建议同时更新 **mobile** 若存在）。
  3. **响应中必须带回带 phone 的 user**：返回 200 且 body 中 `user` 对象必须包含 **phone**（或 **mobile**）字段，且值为刚写入的手机号，这样前端和下次 session 恢复才能拿到手机号。

## 推荐响应格式

```json
{
  "access_token": "可选，新 token",
  "user": {
    "id": "用户 uuid",
    "openid": "...",
    "phone": "13800138000",
    "mobile": "13800138000"
  }
}
```

若后端把手机号放在顶层也可，前端已兼容：

```json
{
  "user": { "id": "...", "openid": "..." },
  "phone": "13800138000"
}
```

前端会将顶层 `phone` / `purePhoneNumber` 合并进 `user` 再存本地。

## 检查清单（后端）

- [ ] 收到 code 后是否调微信接口解密得到手机号？
- [ ] 是否对当前登录用户执行 **UPDATE users SET phone = ?, mobile = ? WHERE id = ?**（或等价更新）？
- [ ] 200 响应里的 **user** 是否包含 **phone**（或 **mobile**）且值与库中一致？

只要后端做到：**库表更新 users.phone + 响应里 user 带 phone**，前端即可正确更新并持久化手机号。
