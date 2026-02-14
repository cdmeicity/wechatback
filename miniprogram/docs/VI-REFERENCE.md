# Cinema 售票平台 - VI 视觉识别系统（小程序）

小程序端已按 VI 规范实现，统一使用以下样式变量。

## 引入方式

`app.wxss` 已引入 `@import './styles/vi.wxss'`，所有页面自动继承颜色、字体、间距、组件变量。

## 样式文件

| 文件 | 说明 |
|------|------|
| `styles/vi.wxss` | 统一入口，引入所有 VI 样式 |
| `styles/colors.wxss` | 颜色变量 |
| `styles/typography.wxss` | 字体变量与类 |
| `styles/spacing.wxss` | 间距、圆角、组件尺寸 |
| `styles/components.wxss` | 按钮、卡片、输入框等基础组件 |

## 使用示例

```css
/* 颜色 */
background: var(--primary);
color: var(--text-secondary);
border: 2rpx solid var(--border);

/* 间距 */
padding: var(--space-large);
margin-bottom: var(--space-medium);
gap: var(--space-small);

/* 圆角 */
border-radius: var(--radius-large);

/* 字体 */
font-size: var(--font-body2);
font-weight: 600;

/* 组件类 */
.btn-primary { } /* 主要按钮 */
.btn-secondary { } /* 次要按钮 */
.card { } /* 卡片 */
.input { } /* 输入框 */
```

## 颜色速查

- Primary: `#FE4A49`
- Secondary: `#4AD7D1`
- Accent: `#EDBA37`
- Success: `#00C896`
- Error: `#FF5252`
- 座位选中: `--seat-selected`
- 座位已售: `--seat-sold`
- VIP: `--seat-vip`

## 组件尺寸

- 按钮高度: `var(--height-button)` (96rpx)
- 输入框高度: `var(--height-input)` (112rpx)
- 底部导航: `var(--height-bottom-nav)` (128rpx)
