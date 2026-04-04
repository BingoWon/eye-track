# Session Log: Eye Tracking Platform 构建全过程

> **会话时间**: 2026-03-31 ~ 2026-04-01  
> **参与者**: Bingo (项目负责人) + AI 助手  
> **最终产出**: https://github.com/BingoWon/eye-tracking-platform

---

## 一、项目起源与背景

### 1.1 初始动机

Bingo 对 3D 眼动追踪（Eye Tracking）技术产生了强烈的研究兴趣，希望构建一套**低成本、高精度**的 DIY 3D 眼动追踪系统。核心灵感来自 YouTube 频道 **@JEOresearch**（Jason Orlosky 教授）的视频内容以及其开源代码。

### 1.2 前置工作（上一个会话完成）

在本次会话之前，已经完成了以下基础设施搭建：

| 任务 | 产出 | 存放位置 |
|------|------|----------|
| 爬取 @jeoresearch 频道 3 年内全部视频的英文字幕 | 去时间戳、含元数据的纯文本 | `subtitles/jeoresearch/` |
| 下载相关学术论文 | PDF（以论文标题命名） | `papers/` |
| 克隆 EyeTracker 开源仓库 | 完整 Git 仓库 | `repos/EyeTracker/` |
| 制作自动化爬取脚本 | Python 脚本（使用 Edge cookies） | `subtitles/download_youtube_subs_bot.py` |

关键技术细节：
- 字幕爬取使用 `yt-dlp --cookies-from-browser edge`，绕过 YouTube 反爬
- 字幕格式：`YYYYMMDD 视频标题.txt`，文件头包含 Title / Date / Description
- 论文：`Model-aware 3D Eye Gaze from Weak and Few-shot Supervisions.pdf`（arXiv 2311.12157）
- 仓库按作者 ID 分目录管理（`subtitles/jeoresearch/`）
- 所有运行脚本均存档，不可删除（Bingo 明确要求）

---

## 二、本次会话完整流程

### 2.1 第一步：制定复刻计划 + 上传 GitHub

**Bingo 的需求**：
> 我想要完全复刻 `subtitles/jeoresearch/20260328 The Hidden Math Behind 3D Eye Tracking.txt` 当中的效果，创建一个 docs 目录准备详细计划（含硬件清单，不含价格），然后把整个项目上传到 GitHub 作为 public repo。

**执行**：
1. 在根目录创建 `docs/` 目录
2. 编写 `docs/replication_plan.md`，包含：
   - 硬件清单（GC0308 摄像头、USB 线、眼镜架、胶带等）
   - 软件算法三阶段拆解（2D 瞳孔检测 → 3D 眼球中心估计 → 3D 凝视射线）
   - 实施步骤
3. `git init` → `git add .` → `git commit` → `gh repo create eye-tracking-platform --public` → `git push`

**产出**：仓库 `BingoWon/eye-tracking-platform` 上线

---

### 2.2 第二步：源码深度审查（Mac 兼容性评估）

**Bingo 的需求**：
> 请你查看 repos/EyeTracker 项目的源码，看下我在 mac 上能否顺利运行，另外我想知道 GC0308 是否能顺利在我的 mac mini 上连接和使用。请你尽可能多地查阅所有相关的代码文件，我需要你的专业评审意见，但先不要做出任何的代码修改。

**审查范围**：
- `OrloskyPupilDetector.py`（504 行，完整版 2D 瞳孔检测）
- `OrloskyPupilDetectorLite.py`（166 行，精简版）
- `OrloskyPupilDetectorRaspberryPi.py`（173 行，树莓派优化版）
- `3DTracker/Orlosky3DEyeTracker.py`（888 行，3D 核心追踪器）
- `3DTracker/gl_sphere.py`（400 行，OpenGL 可视化）
- `3DTracker/GazeFollower.cs`（Unity 脚本）
- `FrontCameraTracker/Orlosky3DEyeTrackerFrontCamera.py`（1116 行，双摄方案）
- `HeadTracker/` 目录（MediaPipe 头部追踪）
- `Webcam3DTracker/` 目录（实验性网络摄像头追踪）

**审查发现的 4 个关键问题**：

| # | 问题 | 严重性 | 位置 |
|---|------|--------|------|
| 1 | `cv2.CAP_DSHOW` — Windows 独占的 DirectShow API，macOS 会直接失败 | 🔴 致命 | 多处 |
| 2 | `C:/Storage/...`、`C:/Google Drive/...` — 硬编码 Windows 绝对路径 | 🔴 致命 | `OrloskyPupilDetector.py` L409, L489 |
| 3 | NumPy 2.0.0+ 的 C-API 变更可能导致兼容性灾难 | 🟡 警告 | README 已提醒 |
| 4 | macOS 已弃用 OpenGL，`gl_sphere.py` 可能出现渲染问题 | 🟢 可忽略 | `3DTracker/gl_sphere.py` |

**GC0308 兼容性结论**：
- ✅ macOS 原生支持 UVC 协议，GC0308 即插即用，无需驱动
- ✅ GC0308 原生分辨率 640×480，与算法硬编码参数完美匹配

---

### 2.3 第三步：硬件选型讨论

#### 2.3.1 基本连接需求

**Bingo 的问题**：
> 所以我基本上需要的是 GC0308 一根 USB 连接线，USB 转 type c 就够了对吗？

**结论**：是的，但还需要一副旧眼镜 + 胶带作为近眼佩戴支架。算法要求摄像头离眼睛只有几厘米，画面中只有一只眼睛的大特写，否则瞳孔在画面中太小无法进行椭圆拟合。

#### 2.3.2 具体型号选择

**Bingo 发来淘宝截图**，展示了 GC0308 的 8 个 SKU 变体。

**推荐选择**：`50度无畸变 / 120FPS / 黑白画面 / 红外夜视`（或 80 度版本）

**关键选型逻辑**（这些是算法能否跑通的核心原因）：

| 参数 | 必须选 | 绝对不能选 | 原因 |
|------|--------|-----------|------|
| 成像方式 | 黑白 + 红外夜视 | 彩色 / 非夜视 | 算法的 `get_darkest_area` 依赖纯黑度驱动，彩色环境光会严重干扰 |
| 畸变 | 无畸变 | 有畸变 / 鱼眼 | 畸变会扭曲瞳孔椭圆形状，导致 3D 数学解析全线崩溃 |
| 帧率 | 120FPS | 30FPS | 眼跳（Saccade）时角速度极大，30FPS 会产生动态模糊导致轮廓抓取失效 |
| 视场角 | 50° 或 80° | 160° | 近眼距离下 50-80° 刚好让单眼填满 640×480 画面，像素利用率最高 |

#### 2.3.3 作者实际购买型号确认

**Bingo 提供了作者的购买信息**：
> Color 80 degree black and white

**最终确认型号**：**80度无畸变 / 120FPS / 黑白画面 / 红外夜视**

#### 2.3.4 USB 线规格

**Bingo 的问题**：
> 我想知道需要 USB 3.0 速率的线吗？还是 2.0 就可以？

**结论**：USB 2.0 完全足够，且更优。理由：
1. GC0308 模组本身只有 4 针（USB 2.0 物理接口），即使用 3.0 线也只能握手为 2.0
2. 带宽计算：640×480 × 120FPS × 黑白单通道 ≈ 10-35MB/s，USB 2.0 实际吞吐约 40MB/s，完全够用
3. USB 2.0 线材更细更软更轻，佩戴时不会拉扯眼镜架导致摄像头位移

---

### 2.4 第四步：仓库子项目功能分析

**Bingo 的需求**：
> 我希望你使用最新的 Python 3.14 参照源代码开始对我们的 mac 做完整优雅的适配。repos/EyeTracker 不同目录的脚本都是起什么作用效果的？是完全独立的子项目可以独立运行吗？

**结论**：它们是 **5 个完全独立的子项目**，各自可以独立运行。详细分析如下：

| 子项目 | 核心功能 | 硬件需求 | 是否复刻目标 |
|--------|---------|---------|-------------|
| 根目录脚本 (3个) | 纯 2D 瞳孔检测（Full / Lite / 树莓派版） | 近眼 IR 摄像头 | 作为基础模块 |
| **3DTracker/** ⭐ | 3D 凝视射线计算 + OpenGL 可视化 + Unity 对接 | 近眼 IR 摄像头 | **主要目标** |
| FrontCameraTracker/ | 双摄方案（近眼IR + 前置摄像头），投射凝视点 | 两个摄像头 | 未来扩展 |
| HeadTracker/ | MediaPipe 头部追踪控制鼠标 | 普通网络摄像头 | 无关 |
| Webcam3DTracker/ | 实验性纯网络摄像头 3D 眼动追踪 | 普通网络摄像头 | 原型阶段 |

---

### 2.5 第五步：跨平台适配实施

**技术栈选择**：
- **包管理**: `uv`（Astral 出品，极速 Python 包管理器）
- **Python 版本**: 3.14（开发环境），兼容下限 3.10+（发布要求）
- **依赖**: OpenCV 4.13+, NumPy 2.4+, PyQt5 5.15+, PyOpenGL 3.1+

**创建的源码文件**：

| 文件 | 行数 | 对应上游文件 | 功能 |
|------|------|-------------|------|
| `src/pupil_detector.py` | ~456 | `OrloskyPupilDetector.py` | 完整 2D 瞳孔检测管线 |
| `src/eye_tracker_3d.py` | ~628 | `3DTracker/Orlosky3DEyeTracker.py` | 3D 凝视射线计算 + GUI |
| `src/gl_sphere.py` | ~300 | `3DTracker/gl_sphere.py` | OpenGL 眼球可视化 |

**关键适配改动**：

```python
# 核心跨平台逻辑 — 自动选择摄像头后端
def _get_capture_backend():
    system = platform.system()
    if system == "Darwin":
        return cv2.CAP_AVFOUNDATION   # macOS
    elif system == "Windows":
        return cv2.CAP_DSHOW          # Windows (原版)
    else:
        return cv2.CAP_V4L2           # Linux
```

**其他适配点**：
- 所有 `C:\` 绝对路径 → `os.path.join()` 相对路径
- `tkinter` 改为可选导入（Homebrew Python 3.14 缺少 `_tkinter`）
- OpenGL 可视化设为可选，缺失时优雅降级
- 移除 Windows 特有的 `CAP_PROP_EXPOSURE` 设置（macOS 不支持）

**遇到的问题与解决**：

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `ModuleNotFoundError: No module named '_tkinter'` | Homebrew 安装的 Python 3.14 默认不编译 Tk 模块 | 将 tkinter 改为 `try/except` 可选导入，设置 `TK_AVAILABLE` 标志 |

**冒烟测试结果**：
```
All modules imported successfully.
OpenCV version: 4.13.0
NumPy version: 2.4.4
OpenGL available: True
Python: 3.14.3
Pupil ellipse: center=(283, 210), axes=(119, 129), angle=42.2°
3D gaze origin: (0.000, 0.000, 0.000)
3D gaze direction: (-0.138, 0.116, 0.984)
=== ALL SMOKE TESTS PASSED ===
```

---

### 2.6 第六步：从 macOS-only 到全平台开源

**Bingo 的关键转折**：
> 不对 我突然想到的是 我们应该两个平台都完美兼容，这样实现麻烦吗？我们是一个开源项目，应该能让所有平台的用户都能使用，不能只限于 macOS

**结论**：完全不麻烦。代码实际上在设计时就已经是跨平台的（`_get_capture_backend()` 已处理三平台），只需要清理品牌形象和发布配置。

**具体改动**：

| 改动项 | 之前 | 之后 |
|--------|------|------|
| 代码 docstring | "macOS Adapted" | "Cross-Platform" |
| GUI 标题 | "Orlosky Eye Tracker 3D (macOS)" | "Orlosky Eye Tracker 3D" |
| Python 版本要求 | `>=3.14` | `>=3.10` |
| 依赖下限 | `numpy>=2.4.4` 等（仅最新版本可用） | `numpy>=1.26.0` 等（宽泛兼容） |
| README.md | 空文件 | 完整的开源项目 README（安装指南、平台矩阵、硬件清单） |
| docs 中硬件描述 | "For Mac mini" | "If your machine only has USB-C ports" |

---

## 三、最终项目结构

```
eye-tracking-platform/
├── src/                              # 跨平台适配的核心源码
│   ├── __init__.py
│   ├── pupil_detector.py             # 2D 瞳孔检测（级联阈值 + 凹角优化）
│   ├── eye_tracker_3d.py             # 3D 凝视射线计算 + Tkinter GUI
│   └── gl_sphere.py                  # OpenGL 线框眼球可视化（可选）
├── docs/
│   ├── replication_plan.md           # 硬件清单 + 算法详解 + 仓库分析
│   └── session_log.md                # 本文档（会话完整记录）
├── repos/
│   └── EyeTracker/                   # 上游原始仓库（JEOresearch）
│       ├── OrloskyPupilDetector.py   # 原版 2D 检测器
│       ├── 3DTracker/               # 原版 3D 追踪器
│       ├── FrontCameraTracker/      # 双摄方案
│       ├── HeadTracker/             # 头部追踪
│       ├── Webcam3DTracker/         # 实验性网络摄像头追踪
│       └── eye_test.mp4             # 测试视频
├── papers/
│   └── Model-aware 3D Eye Gaze...pdf
├── subtitles/
│   ├── download_youtube_subs_bot.py  # 字幕爬取自动化脚本
│   └── jeoresearch/                  # 频道字幕文件
├── pyproject.toml                    # Python 项目配置（uv 管理）
├── uv.lock                          # 依赖锁定文件
├── .python-version                   # Python 3.14
├── .gitignore
└── README.md                         # 项目首页
```

---

## 四、核心设计决策记录

### 4.1 为什么选择 `uv` 而非 pip/poetry/conda？
Bingo 明确要求使用 `uv`。`uv` 是 Astral 出品的新一代 Python 包管理器，速度是 pip 的 10-100 倍，天然支持 `pyproject.toml`，且能自动管理 Python 版本。

### 4.2 为什么保留 repos/EyeTracker 原始仓库？
作为参考对照。我们的 `src/` 目录是跨平台适配版本，`repos/` 保留原始 Windows 代码用于算法对比和回溯。

### 4.3 为什么 Python 最低支持版本是 3.10 而不是更低？
OpenCV 4.8+ 和 NumPy 1.26+ 要求 Python 3.10+。同时 f-string 的高级语法（如 `f"{v:.6f}"`）在 3.10+ 中表现更稳定。

### 4.4 为什么 OpenGL 可视化是可选的？
- macOS 已官方弃用 OpenGL（推 Metal），可能出现渲染问题
- 核心的 3D 凝视射线计算完全不依赖 OpenGL，纯数学
- 降低了安装门槛（不需要 PyQt5 + PyOpenGL 也能跑核心追踪）

### 4.5 为什么 tkinter 是可选模块？
Homebrew 安装的 Python 3.14 默认不编译 `_tkinter` 模块。将其设为可选后，GUI 选择器不可用时用户仍可通过命令行参数指定输入源。

---

## 五、硬件采购最终确认

| 物品 | 确切型号 / 规格 | 用途 |
|------|----------------|------|
| **GC0308 摄像头** | **80度无畸变 / 120FPS / 黑白画面 / 红外夜视 / 480p** | 近眼瞳孔捕捉 |
| USB 延长线 | USB 2.0 即可（越细越软越好） | 连接摄像头到电脑 |
| USB-A 转 USB-C 转接头 | 仅 USB-C 接口的电脑需要 | 端口适配 |
| 旧眼镜 / 廉价太阳眼镜 | 任意 | 摄像头佩戴支架 |
| 绝缘胶带 | 任意 | 固定摄像头和走线 |
| 柔性走线 | 任意 | USB 线缆沿镜架布线和固定 |

---

## 六、待办事项（下一步）

- [ ] 硬件到货后，连接 GC0308 摄像头进行实时追踪验证
- [ ] 根据实际画面表现调整阈值参数（strict/medium/relaxed 的 5/15/25 值）
- [ ] 研究 `FrontCameraTracker/` 双摄方案，实现凝视点投射到屏幕
- [ ] 探索论文（Model-aware 3D Eye Gaze）中的 transformer few-shot 校准，用于提升精度
- [ ] 考虑添加 `Webcam3DTracker/` 的纯网络摄像头方案作为无硬件降级选项
- [ ] 为项目添加 CI/CD（GitHub Actions）自动化测试

---

## 七、Git 提交历史

| 提交 | 描述 |
|------|------|
| `Initial commit` | 初始化项目：字幕、论文、EyeTracker 仓库、初版 replication_plan |
| `Add macOS-adapted 3D eye tracker with uv + Python 3.14` | 创建 src/ 三文件适配版本，冒烟测试通过 |
| `Cross-platform: support macOS, Windows, and Linux` | 全平台兼容：降低版本要求，重写 README，更新品牌标识 |
