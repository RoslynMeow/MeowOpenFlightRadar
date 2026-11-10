<div align="center">

# MeowOpenFlightRadar

**基于 [MeowTileKit](https://github.com/RoslynMeow/MeowTileKit) 的全球航班追踪地图**

<!-- 状态 -->
[![build](https://github.com/RoslynMeow/MeowOpenFlightRadar/actions/workflows/build-release.yml/badge.svg)](https://github.com/RoslynMeow/MeowOpenFlightRadar/actions/workflows/build-release.yml) [![release](https://img.shields.io/github/v/release/RoslynMeow/MeowOpenFlightRadar?sort=semver&display_name=release&style=flat-square)](https://github.com/RoslynMeow/MeowOpenFlightRadar/releases/latest) [![downloads](https://img.shields.io/github/downloads/RoslynMeow/MeowOpenFlightRadar/total?style=flat-square&color=blue)](https://github.com/RoslynMeow/MeowOpenFlightRadar/releases) [![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-1f6feb?style=flat-square&logo=electron&logoColor=white)](https://github.com/RoslynMeow/MeowOpenFlightRadar/wiki/Installation) [![node](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)

<!-- 入口 -->
[![stars](https://img.shields.io/github/stars/RoslynMeow/MeowOpenFlightRadar?style=flat-square&logo=github)](https://github.com/RoslynMeow/MeowOpenFlightRadar/stargazers) [![docs](https://img.shields.io/badge/docs-Wiki-1f6feb?style=flat-square&logo=github)](https://github.com/RoslynMeow/MeowOpenFlightRadar/wiki) [![roadmap](https://img.shields.io/badge/roadmap-Projects-8250df?style=flat-square&logo=github)](https://github.com/users/RoslynMeow/projects/3)

<br>

[**Wiki 文档**](https://github.com/RoslynMeow/MeowOpenFlightRadar/wiki) · [**安装与运行**](https://github.com/RoslynMeow/MeowOpenFlightRadar/wiki/Installation) · [**配置**](https://github.com/RoslynMeow/MeowOpenFlightRadar/wiki/Configuration) · [**API**](https://github.com/RoslynMeow/MeowOpenFlightRadar/wiki/API) · [**数据源**](https://github.com/RoslynMeow/MeowOpenFlightRadar/wiki/Data-Sources) · [**路线图**](https://github.com/users/RoslynMeow/projects/3) · [**下载**](https://github.com/RoslynMeow/MeowOpenFlightRadar/releases/latest) · [**问题反馈**](https://github.com/RoslynMeow/MeowOpenFlightRadar/issues)

</div>

## 预览

<div align="center">
  <img src="docs/assets/preview.jpg" alt="MeowOpenFlightRadar 预览" width="100%" />
</div>

## Packages

| 包 | 说明 |
| --- | --- |
| [`meow-open-flight-core`](packages/core) | 静态航空数据、实时飞机数据源、轮询/SSE、天气/NOTAM、Hono API |
| [`meow-open-flight-airspace`](packages/airspace) | openAIP 全球空域数据（可选） |

## License

- **代码**：MIT，见 [`LICENSE`](LICENSE)。
- **数据**：按各自来源许可分发，见 [`packages/core/DATA-LICENSES.md`](packages/core/DATA-LICENSES.md) 和 [`packages/airspace/DATA-LICENSES.md`](packages/airspace/DATA-LICENSES.md)。
  - OurAirports：Public Domain
  - openAIP 空域 / VRP：CC BY-NC 4.0（仅限非商业用途）
  - VATSIM / VATSpy FIR：CC BY-SA 4.0

> 本项目仅供个人学习、研究与技术交流使用。实时飞机数据来自非官方接口，可能违反其服务条款；SkyVector 航图为 Jeppesen 授权数据，仅供个人测试，请勿公开分发。

