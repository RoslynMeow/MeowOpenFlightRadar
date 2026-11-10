# Data licenses

本包的代码使用 MIT 许可；`data/` 下的数据集按各自许可分发。

## OurAirports — Public Domain

- 文件：`airports.json`、`navaids.json`
- 来源：https://ourairports.com/data/
- 许可：Public Domain
- 说明：可自由使用、修改、再分发，无需署名（本项目仍保留来源说明）。

## openAIP — CC BY-NC 4.0

- 文件：`reporting-points.json`
- 来源：https://www.openaip.net
- 许可：Creative Commons Attribution-NonCommercial 4.0 International
- 要求：
  - 署名 openAIP（https://www.openaip.net）。
  - **仅限非商业用途**。
  - 不得附加额外法律限制。
- 许可全文：https://creativecommons.org/licenses/by-nc/4.0/

## VATSIM / VATSpy — CC BY-SA 4.0

- 文件：`fir.geojson`
- 来源：https://github.com/vatsimnetwork/vatspy-data-project
- 许可：Creative Commons Attribution-ShareAlike 4.0 International
- 要求：
  - 署名 VATSIM / VATSpy。
  - 修改后的数据必须以相同许可（CC BY-SA 4.0）共享。
- 许可全文：https://creativecommons.org/licenses/by-sa/4.0/

## 组合说明

本包把多个数据集聚合在同一个 npm 包中。每个数据集仍受其自身许可约束；
不能因为代码是 MIT 就把数据当作 MIT 授权。再分发本包时请保留 `NOTICE.md`
和本文件。
