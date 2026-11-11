# 77 Bookmarks

单用户的卡片式书签页。添加网址时自动拆分：域名成为一张卡片，子路径成为卡片上的链接。运行在 Cloudflare Pages + D1 上。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zxxx98/77bookmarks)

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 设置 ADMIN_PASSWORD 和 SESSION_SECRET
npm run db:migrate:local
npm run build && npm run dev:api # 接口与静态文件：http://localhost:8788
npm run dev                      # 可选：带热更新的前端，/api 代理到 8788
```

`npm test` 运行单元测试，`npm run typecheck` 做类型检查。

## 部署

### 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zxxx98/77bookmarks)

点击上方按钮即可将项目一键部署到 Cloudflare。

部署完成后，请在 Cloudflare 控制台中完成以下配置：
1. **D1 数据库**：创建并绑定一个 D1 数据库（变量名为 `DB`），并执行数据库迁移（或导入 `migrations/` 目录下的 SQL 文件）。
2. **环境变量 / Secrets**：
   - `ADMIN_PASSWORD`：管理员密码
   - `SESSION_SECRET`：会话签名密钥（例如通过 `openssl rand -hex 32` 生成）

### 命令行部署

```bash
npx wrangler d1 create 77bookmarks        # 把输出的 database_id 填入 wrangler.toml
npm run db:migrate:remote
npx wrangler pages project create 77bookmarks
npx wrangler pages secret put ADMIN_PASSWORD
npx wrangler pages secret put SESSION_SECRET   # 例如 openssl rand -hex 32
npm run deploy
```

升级已有的部署时，先执行 `npm run db:migrate:remote`（本地为 `npm run db:migrate:local`）再部署。`0002_desktops.sql` 会把现有数据原样归入「主桌面」，`0003_settings.sql` 新增系统设置表。

应用内没有登录限流，请使用强密码；需要时可在 Cloudflare 控制台为 `/api/login` 添加限流规则。

## 桌面

每个桌面是一套独立的分组和卡片（例如「工作」和「生活」），同一个网站可以在不同桌面各有一张卡片。在顶栏的桌面菜单里新建、重命名、删除桌面和拖动排序；编辑卡片时可以把它移到其他桌面。搜索只筛选当前桌面，其他桌面有匹配时会在下方给出跳转入口。

显示方式（大卡片、小卡片、列表）按桌面分别保存。当前所在的桌面按浏览器记住。

## 图标

卡片图标默认从网站自动获取并存入数据库。也可以在添加或编辑卡片时填写图片的网络地址：这种方式只保存地址，图片由浏览器直接加载，因此内网地址也能用。

## 系统设置与备份

「更多 → 系统设置 → 基本设置」可以配置网站名称（最多 60 个字符），保存后会显示在顶栏、登录页和浏览器标题中，并在不同设备间共用。

「在新标签页打开」默认勾选，适用于书签卡片、子链接和搜索框按 Enter 打开的结果。取消勾选并保存后，这些链接会在当前标签页打开；刷新页面后仍保留设置。

「更多 → 系统设置 → 备份与恢复」可以导出全部桌面或仅当前桌面，得到一个包含图标的 JSON 文件。导入时可以选择「添加为新桌面」（不影响现有数据）或「替换全部数据」。旧版本（不含桌面）的备份文件会作为一个新桌面导入。书签备份不包含系统设置。

## 快捷键

| 按键 | 作用 |
|---|---|
| `←` `→` | 切换到上一个、下一个桌面（触屏上左右滑动） |
| `Tab` / `Shift+Tab` | 切换到下一个、上一个桌面 |
| 数字、英文字母 | 聚焦搜索框并输入该字符，继续键入即可搜索 |
| `Ctrl+V`（macOS 为 `⌘V`） | 剪贴板是有效网址时，打开添加书签窗口并填入网址 |
| `Ctrl+L` | 锁定页面，输入管理员密码后解锁；也可使用「更多 → 锁定」 |
| `Enter` | 完成布局编辑；在搜索框中打开第一个结果 |
| `Esc` | 关闭弹窗或退出编辑 |

除 `Ctrl+L` 外，全局快捷键在没有弹窗或展开菜单、且焦点不在输入框时生效；输入框中保留正常输入、粘贴和 Tab 行为。拖动完成后，`Enter` 和 `Esc` 都会退出布局编辑，已保存的排序会保留。

锁定会立即隐藏书签、关闭弹窗并清除登录会话，刷新页面后仍需密码。同一浏览器中的其他标签页也会同步锁定。解锁使用部署时配置的 `ADMIN_PASSWORD`。

## 已知限制

- Cloudflare 无法访问内网地址，这类站点需要在编辑卡片时手动填标题、上传图标。
- 图标上限 100 KB。
- 用网络地址指定的图标不会包含在备份文件里（只备份地址），地址失效后卡片会退回到自动获取的图标或字母图标。
- 最多 20 个桌面。
