# Signal Desk 第三方依赖审计清单

审计日期：2026-09-05  
状态：阶段 A 初始清单；不是完整的法律声明或最终分发 notice

本清单根据当前 `package.json`、`package-lock.json`、已安装包元数据和 `worker/requirements.txt` 生成。正式发布 0.2 前必须生成包含全部传递依赖、许可证正文、版权声明和二进制构建信息的最终清单，并由项目所有者完成许可证合规审查。

## 1. 当前直接运行时依赖

| 组件 | 当前解析版本 | 元数据许可证 | 当前用途/状态 |
|---|---:|---|---|
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | UI 字体；包内含 `LICENSE` |
| `@fontsource/noto-sans-sc` | 5.3.0 | OFL-1.1 | 中文 UI 字体；包内含 `LICENSE` |
| `@ffmpeg-installer/ffmpeg` | 1.1.0 | LGPL-2.1 | FFmpeg 定位包装器 |
| `@ffmpeg-installer/win32-x64` | 4.1.0 | GPLv3 | 当前 Windows `ffmpeg.exe` 二进制包；会被 `asarUnpack` 带入构建 |
| `@ffprobe-installer/ffprobe` | 2.1.2 | LGPL-2.1 | FFprobe 定位包装器 |
| `@ffprobe-installer/win32-x64` | 5.1.0 | GPL-3.0 | 当前 Windows `ffprobe.exe` 二进制包；会被 `asarUnpack` 带入构建 |
| `react` | 19.2.8 | MIT | Renderer |
| `react-dom` | 19.2.8 | MIT | Renderer |
| `zod` | 4.4.3 | MIT | 运行时合同验证 |

重要：两个 installer 包的包装器声明 LGPL-2.1，但当前解析到的 Windows 二进制子包分别声明 GPLv3/GPL-3.0。不得只引用包装器许可证而忽略实际分发的二进制。0.2 正式分发前必须核对二进制的精确构建配置、完整 GPL 义务、许可证正文、源代码/对应源码提供方式及安装器内 notice。若产品分发策略不能满足这些义务，应更换为许可证和构建配置明确且与分发策略兼容的 FFmpeg/FFprobe 构建。

## 2. 当前直接开发/构建依赖

| 组件 | 当前解析版本 | 元数据许可证 |
|---|---:|---|
| `@types/node` | 24.13.3 | MIT |
| `@types/react` | 19.2.18 | MIT |
| `@types/react-dom` | 19.2.5 | MIT |
| `@vitejs/plugin-react` | 5.2.0 | MIT |
| `electron` | 39.8.10 | MIT |
| `electron-builder` | 26.15.3 | MIT |
| `electron-vite` | 4.0.1 | MIT |
| `jsdom` | 26.1.0 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `vite` | 7.3.6 | MIT |
| `vitest` | 3.2.7 | MIT |

Electron/Chromium/Node 及构建产物包含更多第三方组件和 notice；最终安装包必须保留并核验其随附许可证文件。上表不替代传递依赖审计。

## 3. Python 媒体依赖

`worker/requirements.txt` 当前声明：

```text
faster-whisper>=1.1,<2
paddleocr>=3.0,<4
paddlepaddle>=3.0,<4
```

默认安装器未完整携带这些大型包和模型。若未来通过 `scripts/prepare-python-runtime.ps1` 生成自包含运行时，必须基于实际锁定版本重新审计 Python 本体、所有 wheel、动态库、模型权重和传递依赖的许可证与再分发条件；当前清单不能作为该自包含构建的分发依据。

## 4. 外部工具和社区审计边界

- `D:\yt_dlp\yt-dlp.exe` 当前仅是本机已发现的外部工具，阶段 A 未集成、未复制、未打包，也未启用浏览器 Cookie 提取。若阶段 F 纳入分发或自动调用，需要单独记录版本、哈希、许可证和调用边界。
- 阶段 A 没有复制 `ai-boshu-crawler`、`video-parse-transcribe`、`duyi-douyin-video-breakdown` 或 `xhs-profile-breakdown-skill` 的源码、函数、常量表、注释或 fixture。
- 无公开许可证的社区仓库不得复制；CC BY-NC 4.0 代码不得直接用于商业或潜在商业版本；MIT 内容只有在实际纳入分发物时才添加对应版权和许可声明。

## 5. 发布前待办

1. 从锁文件和最终打包目录生成完整 SBOM/许可证清单，而不是仅列直接依赖。
2. 将所需许可证全文和版权声明加入安装器/应用内可访问位置。
3. 对实际 FFmpeg/FFprobe 二进制执行版本、构建配置、来源和哈希核验。
4. 确定并落实 GPL/LGPL 对应源码、修改、链接与再分发义务，或替换不合适的二进制构建。
5. 若打包 Python/模型，按最终解析版本重新审计。
6. 每次升级 Electron、媒体二进制、字体或 Python 运行时时重新生成并比较清单。
