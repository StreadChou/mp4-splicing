# Windows 版本打包方案

## 方案对比

### ❌ 方案 1: 在 macOS 上使用 Wine 交叉编译
**问题:**
- Tauri 依赖大量 Windows 特定的系统库
- 需要 Windows SDK 和 MSVC 工具链
- 即使使用 cargo-xwin,Tauri 的 WebView2 等组件也无法在 macOS 上编译
- 成功率极低,不推荐

### ✅ 方案 2: 使用 GitHub Actions 自动打包（推荐）
**优点:**
- 完全免费
- 自动在真实的 Windows 和 macOS 环境中打包
- 可以同时生成多个平台的版本
- 无需本地 Windows 环境

**使用步骤:**

1. **初始化 Git 仓库（如果还没有）**
```bash
cd /Users/stread/Project/002_LrsTool/mp4handler
git init
git add .
git commit -m "Initial commit"
```

2. **在 GitHub 上创建仓库**
- 访问 https://github.com/new
- 创建一个新仓库（可以是私有仓库）

3. **推送代码到 GitHub**
```bash
git remote add origin https://github.com/你的用户名/mp4handler.git
git branch -M main
git push -u origin main
```

4. **触发自动打包**

方式 A: 创建标签触发
```bash
git tag v0.1.0
git push origin v0.1.0
```

方式 B: 手动触发
- 访问 GitHub 仓库页面
- 点击 "Actions" 标签
- 选择 "Build and Release" workflow
- 点击 "Run workflow"

5. **下载打包结果**
- 等待 10-15 分钟（首次编译较慢）
- 在 Actions 页面查看构建进度
- 构建完成后,在 "Artifacts" 中下载:
  - `macos-build`: macOS 版本
  - `windows-build`: Windows 安装程序

### ✅ 方案 3: 在 Windows 电脑/虚拟机上打包

如果您有 Windows 电脑或虚拟机:

1. **安装依赖**
```powershell
# 安装 Rust
winget install Rustlang.Rustup

# 安装 Node.js
winget install OpenJS.NodeJS

# 安装 Yarn
npm install -g yarn
```

2. **打包**
```powershell
cd mp4handler
yarn install
yarn tauri build
```

3. **输出位置**
```
src-tauri\target\release\bundle\nsis\mp4handler_0.1.0_x64-setup.exe
src-tauri\target\release\bundle\msi\mp4handler_0.1.0_x64_en-US.msi
```

---

## 当前状态

### ✅ 已完成
- macOS 版本已打包完成
- Windows FFmpeg 二进制文件已准备
- GitHub Actions 配置文件已创建
- 所有代码和配置已就绪

### 📦 macOS 版本位置
```
/Users/stread/Project/002_LrsTool/mp4handler/src-tauri/target/release/bundle/macos/
├── mp4handler.app                    # 应用程序（164 MB）
└── mp4handler-macos-portable.zip    # 便携版压缩包（55 MB）
```

### 🎯 推荐操作
使用 GitHub Actions 方案,这样您可以:
1. 无需 Windows 环境
2. 自动化打包流程
3. 同时获得 Windows 和 macOS 版本
4. 完全免费

---

## GitHub Actions 配置说明

已创建的文件: `.github/workflows/build.yml`

**功能:**
- 自动在 Windows 和 macOS 环境中打包
- 自动下载对应平台的 FFmpeg
- 生成安装程序和便携版
- 支持手动触发和标签触发

**输出:**
- macOS: `.app` 文件和 `.zip` 压缩包
- Windows: `.exe` 安装程序和 `.msi` 安装包

---

## 总结

由于 Tauri 的架构限制,在 macOS 上交叉编译 Windows 版本几乎不可能。推荐使用 GitHub Actions,这是最简单、最可靠的方案。

如果您需要立即获得 Windows 版本,可以:
1. 使用 GitHub Actions（推荐,10-15 分钟）
2. 在 Windows 虚拟机中打包
3. 请有 Windows 电脑的朋友帮忙打包
