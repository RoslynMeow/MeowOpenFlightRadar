<div align="center">

# FlightRadar

**基于 [MeowTileKit](https://github.com/RoslynMeow/MeowTileKit) 的全球航班追踪地图**
实时飞机 · 全球机场 / 跑道 / 导航台 / 空域 / 情报区叠加 · 桌面版（Electron）+ 浏览器版

[![build](https://github.com/RoslynMeow/MeowOpenFlightRadar/actions/workflows/build-release.yml/badge.svg)](https://github.com/RoslynMeow/MeowOpenFlightRadar/actions/workflows/build-release.yml)
[![release](https://img.shields.io/github/v/release/RoslynMeow/MeowOpenFlightRadar?sort=semver&display_name=release)](https://github.com/RoslynMeow/MeowOpenFlightRadar/releases/latest)
[![downloads](https://img.shields.io/github/downloads/RoslynMeow/MeowOpenFlightRadar/total)](https://github.com/RoslynMeow/MeowOpenFlightRadar/releases)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-1f6feb?logo=electron&logoColor=white)](#下载)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a?logo=nodedotjs&logoColor=white)](https://nodejs.org)

</div>

---

## 下载

到 [**Releases**](https://github.com/RoslynMeow/MeowOpenFlightRadar/releases/latest) 下载 Windows 便携版（单文件、免安装，双击即用）：

| 平台 | 形式 | 获取方式 |
| --- | --- | --- |
| **Windows** | 便携版单文件 `.exe` | [Releases](https://github.com/RoslynMeow/MeowOpenFlightRadar/releases/latest)（每次推 `main` 且版本号变化时自动构建发布） |
| **macOS** | `.app`（zip） | 由 GitHub Actions 构建，见 [Actions](https://github.com/RoslynMeow/MeowOpenFlightRadar/actions) 产物 |
| **Linux** | AppImage | 由 GitHub Actions 构建，见 [Actions](https://github.com/RoslynMeow/MeowOpenFlightRadar/actions) 产物 |

> 桌面版内置 Chromium 用于抓取，无需额外安装浏览器或 Node。

---

## 功能

- **实时飞机** — SSE 稳定长连接推流，在上报位置之间逐帧插值平滑移动（**默认不预测**，仅当数据源明确 `predictable` 时才有限外推）；图标按机型、颜色按高度着色；跨日期变更线连续显示。
- **跟随标注** — 点击飞机 / 跑道 / 管制分区 / 情报区，在旁边弹出信息框并用引线指向目标，随地图与目标移动；可多选、可拖动、可缩放、可单独关闭。
- **多航迹** — 每架选中的飞机各画一条航迹。
- **航空叠加** — 机场 / 跑道 / 导航台（OurAirports）、空域（openAIP）、FIR/UIR 情报区（VATSIM/VATSpy），全部 Canvas 渲染。
- **机场面板**（底部可拖动，可折叠，占视口 20%）—— 航班板分四列、各自独立滚动，并在「在途 / 离港」列按**当前时间**画一条随时间为移动的分割线；点击某航班即把视角移到该机并选中，相关飞机在图上高亮并显示航迹。
- **机场天气** — 机场上叠加**风玫瑰**罗盘，颜色对应当前飞行条件（VFR 绿 / MVFR 蓝 / IFR 红 / LIFR 品红）；旁边悬浮框显示机场信息 + METAR / TAF 原文。
- **底部搜索** — 居中搜索框 + 可点击结果，选中后定位并打开机场面板。
- **多底图切换** — Esri（默认）/ OSM / 高德卫星。
- **桌面版** — Electron 打包，Windows 便携单文件；macOS / Linux 由 CI 构建。

---

## 数据源

| 数据 | 来源 | 授权 |
| --- | --- | --- |
| 实时飞机 | FlightAware（网页抓取，实验性） | 非官方，仅供试用 |
| 机场 / 跑道 / 导航台 | [OurAirports](https://ourairports.com/data/) | 公有领域 |
| 空域 | [openAIP](https://www.openaip.net) | CC BY-NC 4.0 |
| FIR/UIR 情报区 | [VATSIM / VATSpy](https://github.com/vatsimnetwork/vatspy-data-project) | CC-BY-SA-4.0 |
| 机场天气 METAR/TAF | [aviationweather.gov](https://aviationweather.gov) | 公有领域 |

---

## 结构

```
packages/
  shared/    共享类型与工具（Aircraft / Airport / Runway / Navaid / TrackPoint / BBox）
  server/    Hono API：数据源适配器 + 后台轮询缓存 + 静态航空数据 + SSE
             data/      生成的静态数据（setup:data 生成，已 gitignore）
             scripts/   导入脚本 import-*.mjs + setup-data.mjs
  web/       Vite + meow-tile-kit + Leaflet：地图与各叠加图层
  desktop/   Electron 主进程（内置 Chromium 抓取）+ electron-builder 打包
```

技术栈：**Hono** · **Vite** · **Leaflet / MeowTileKit** · **Electron** · **Playwright**（仅独立 server 用）

---

## 快速开始

```bash
npm install
npm run install:chromium   # 仅独立 server 需要：下载 Playwright Chromium（过 Cloudflare 盾用）
npm run dev                # 自动准备数据后启动 API + 前端（同一进程）
```

打开 http://localhost:5173 ，拖动地图，飞机位置按可视范围自动刷新。

**桌面版开发 / 打包：**

```bash
npm run build -w @flightradar/web        # 先构建前端
npm run build -w @flightradar/desktop    # esbuild 打包主进程
npm run start -w @flightradar/desktop    # 本地跑 Electron

npm run dist:win     # Windows 便携版（release/）
npm run dist:dir     # 免打包，仅生成解包目录
```

> `dev` / `build` / `start` 前会自动运行 `setup:data`，**只导入缺失的数据**（机场/导航台、空域、情报区），已存在则跳过；强制刷新删掉 `packages/server/data/` 下对应文件，或用 `npm run import:*`。

---

## 配置

服务端环境变量（见 `packages/server/.env.example`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 服务端口 |
| `AIRCRAFT_PROVIDER` | `flightaware` | 飞机数据源（当前仅 `flightaware`） |
| `POLL_INTERVAL_MS` | `2000` | 后台轮询上游间隔（毫秒） |
| `CACHE_TTL_MS` | `4000` | REST 结果缓存时间（毫秒） |
| `WEB_ORIGIN` | `*` | CORS 允许来源 |
| `SKYLINK_API_KEY` | 空 | NOTAM 源 SkyLink 的 API key（空则 NOTAM 不可用） |

若本机经代理访问外网，Node 的 `fetch` 默认不读 `HTTP(S)_PROXY`；server 脚本已用 `cross-env NODE_USE_ENV_PROXY=1` 启用 Node 内置代理支持（无代理时无副作用）。

---

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查（含各数据集是否就绪） |
| GET | `/api/aircraft?bbox=lamin,lomin,lamax,lomax` | 范围内实时飞机 |
| GET | `/api/airports?q=pek` | 机场搜索 |
| GET | `/api/airports?bbox=...` | 视野内机场 |
| GET | `/api/navaids?bbox=...` | 视野内导航台（VOR/DME/NDB） |
| GET | `/api/airspace?bbox=...` | 视野内空域（openAIP GeoJSON） |
| GET | `/api/fir?bbox=...` | 视野内 FIR/UIR 边界 |
| GET | `/api/runways?bbox=...` | 视野内跑道（GeoJSON LineString） |
| GET | `/api/airports/:ident` | 机场详情（含跑道） |
| GET | `/api/airports/:ident/runways.geojson` | 跑道 GeoJSON |
| GET | `/api/airports/:ident/flights` | 机场航班板（到达/出发/在途/计划，60s 缓存） |
| GET | `/api/weather/:ident` | 机场 METAR / TAF（5min 缓存） |
| GET | `/api/notam?q=<FIR/机场/空域>` | 分区 NOTAM（需 `SKYLINK_API_KEY`） |
| GET | `/api/tracks/:icao24` | 飞机历史航迹（点列） |
| GET | `/api/settings` | 当前数据源 + 可用数据源列表 |
| PUT | `/api/settings` | 切换数据源 `{provider}` |
| GET | `/event/aircraft?sid=&bbox=...` | SSE 实时推流（稳定长连接） |
| GET | `/api/viewport?sid=&bbox=...` | 更新会话视野（不重连） |

<details>
<summary><b>航迹来源</b></summary>

`/api/tracks/:icao24` 返回 `origin` 字段：

- `flightaware`：FlightAware 上游完整航迹（从起飞起）。
- `buffer`：服务端累计的位置缓冲，从服务器首次看到该机起累计。

> FlightAware 的 `vicinity` 端点不提供 icao24（hexid），本项目用其 `ident`（呼号/注册号）作为 key，因此对该源传入的 `:icao24` 实为 ident。

</details>

---

## FlightAware 抓取说明

- **桌面版**：用 **Electron 内置 Chromium**（隐藏窗口）过 Cloudflare 盾并读取 `VICINITY_TOKEN`，再在页面内 `fetch` 数据 —— 无需额外打包浏览器。
- **独立 server**：用 **Playwright 无头浏览器**做同样的事（`npm run install:chromium` 安装）。
- token 每 20 分钟或遇挑战自动重过盾；轮询器对 429 自动退避；后台按订阅视野独立刷新并缓存，SSE 客户端只读缓存，相同视野共享一次上游请求。
- **非官方、可能违反其服务条款，风险自负，仅供本地试用。**

---

## 路线图

- [x] 飞机详情与历史航迹
- [x] 位置插值 / 航位推算平滑移动
- [x] 全球航空叠加：机场 / 跑道 / 导航台（OurAirports）
- [x] 全球空域叠加（openAIP）
- [x] 全球 FIR/UIR 情报区边界（VATSIM/VATSpy）
- [x] FlightAware 数据源 + 设置面板
- [x] Electron 桌面版（Windows 便携版自动发布）
- [ ] SID/STAR 进离场程序（FAA CIFP + d-TPP 航图）
- [ ] 美国航路（airways/fixes，FAA NASR）
- [ ] 自建全球观测走廊（聚合 ADS-B 轨迹）
- [ ] 自建 FAA 航图瓦片（GeoTIFF + GDAL，脱离 Esri）

---

## 声明

本项目**仅供个人学习、研究与技术交流使用**，禁止任何商业用途，且不提供任何担保。

实时飞机数据来自 FlightAware 网页抓取，属**非官方**方式，可能违反其服务条款，使用风险自负；其余数据的版权与授权归各自来源所有（见[数据源](#数据源)）。
