# packaging

当前发行以GA源码目录为根，桌面组件位于 `frontends/`。Windows两种ZIP
共享完全相同的公共文件，完整版只增加预装依赖的 `python/`，不使用 `runtime/app`。

- `python-runtime-requirements.txt`：Windows完整包的Python依赖版本锁定（尚未锁wheel哈希）。
- `../scripts/prepare_windows_python.py`：固定版本Python下载校验、UCRT与依赖预装。
- `../scripts/package_windows.py`：从GA提交导出干净源码并组装两种ZIP。
- `../scripts/verify_windows_release.py`：公共文件一致性、解压搬迁、包内bridge验收。
- `scripts/`：历史安装/卸载脚本，保留旧部署兼容；新Windows源码包不调用它们。

Desktop workflow默认输出三平台组件；手动启用 `windows_release` 才组装Windows源码包。
产物只上传Actions，不自动发布公共Release。macOS/Linux完整包不在本轮恢复范围内。

## 自动化测试体系

打包前通过 `npm run test:all` 一键验证。测试分四层：

| 层 | 命令 | 说明 |
|---|---|---|
| Layer 1 | `npm run test` | UI/store/逻辑测试（vitest + happy-dom） |
| Layer 2 | `npm run test:bridge` | Bridge 连接协议、状态机、API 契约 |
| Layer 3 | `npm run test:bundle` | 构建产物完整性（dist 结构、JS bundle 存在性） |
| Layer 4 | `npm run test:packaging` | 打包前置条件（tauri.conf、icons、脚本语法） |

分层跑：

```bash
npm run test              # Layer 1 全部
npm run test:stress       # Layer 1 压力子集
npm run test:bridge       # Layer 2
npm run test:bundle       # Layer 3（需先 npm run build）
npm run test:packaging    # Layer 4
npm run test:all          # Layer 1-3 一键
```
