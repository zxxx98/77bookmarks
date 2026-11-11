# 77 Bookmarks

单用户的卡片式书签页。添加网址时自动拆分：域名成为一张卡片，子路径成为卡片上的链接。运行在 Cloudflare Pages + D1 上。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 设置 ADMIN_PASSWORD 和 SESSION_SECRET
npm run db:migrate:local
npm run build && npm run dev:api # 接口与静态文件：http://localhost:8788
npm run dev                      # 可选：带热更新的前端，/api 代理到 8788
```

`npm test` 运行 URL 解析的单元测试，`npm run typecheck` 做类型检查。

## 部署

```bash
npx wrangler d1 create 77bookmarks        # 把输出的 database_id 填入 wrangler.toml
npm run db:migrate:remote
npx wrangler pages project create 77bookmarks
npx wrangler pages secret put ADMIN_PASSWORD
npx wrangler pages secret put SESSION_SECRET   # 例如 openssl rand -hex 32
npm run deploy
```

升级已有的部署时，先执行 `npm run db:migrate:remote`（本地为 `npm run db:migrate:local`）再部署：新版本的接口依赖 `0002_desktops.sql` 建的表，迁移会把现有数据原样归入「主桌面」。

应用内没有登录限流，请使用强密码；需要时可在 Cloudflare 控制台为 `/api/login` 添加限流规则。

## 桌面

每个桌面是一套独立的分组和卡片（例如「工作」和「生活」），同一个网站可以在不同桌面各有一张卡片。在顶栏的桌面菜单里新建、重命名、删除桌面和拖动排序；编辑卡片时可以把它移到其他桌面。搜索只筛选当前桌面，其他桌面有匹配时会在下方给出跳转入口。

显示方式（大卡片、小卡片、列表）按桌面分别保存。当前所在的桌面按浏览器记住。

## 图标

卡片图标默认从网站自动获取并存入数据库。也可以在添加或编辑卡片时填写图片的网络地址：这种方式只保存地址，图片由浏览器直接加载，因此内网地址也能用。

## 备份

「更多 → 备份与恢复」可以导出全部桌面或仅当前桌面，得到一个包含图标的 JSON 文件。导入时可以选择「添加为新桌面」（不影响现有数据）或「替换全部数据」。旧版本（不含桌面）的备份文件会作为一个新桌面导入。

## 快捷键

| 按键 | 作用 |
|---|---|
| `←` `→` | 切换到上一个、下一个桌面（触屏上左右滑动） |
| `1`–`9` | 切换到第 N 个桌面 |
| `V` | 切换显示方式 |
| `N` | 添加书签 |
| `/` | 搜索，回车打开第一个结果 |
| `Esc` | 关闭弹窗或退出编辑 |

## 已知限制

- Cloudflare 无法访问内网地址，这类站点需要在编辑卡片时手动填标题、上传图标。
- 图标上限 100 KB。
- 用网络地址指定的图标不会包含在备份文件里（只备份地址），地址失效后卡片会退回到自动获取的图标或字母图标。
- 最多 20 个桌面。
