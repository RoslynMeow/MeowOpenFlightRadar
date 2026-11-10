# MeowOpenFlightAirspace

> npm package: [`meow-open-flight-airspace`](https://www.npmjs.com/package/meow-open-flight-airspace)

[openAIP](https://www.openaip.net) 全球空域数据，以及按 bbox 查询的辅助函数。
配合 [`meow-open-flight-core`](https://www.npmjs.com/package/meow-open-flight-core) 使用。

## 安装

```bash
npm i meow-open-flight-airspace
```

## 使用

```ts
import { createCore } from 'meow-open-flight-core';
import { createAirspaceStore } from 'meow-open-flight-airspace';

const core = createCore({
  airspace: createAirspaceStore(),
});
```

也可以单独查询：

```ts
import { createAirspaceStore } from 'meow-open-flight-airspace';

const airspace = createAirspaceStore();
airspace.hasData();
airspace.countries();
airspace.inBBox({ lamin: 39, lomin: -75, lamax: 41, lomax: -73 });
```

## 配置

```ts
createAirspaceStore({
  airspaceDir: '/path/to/airspace', // 含 index.json 与各国 .geojson
});
```

环境变量：`FLIGHTRADAR_AIRSPACE_DIR`。

## 数据

- 来源：openAIP
- 许可：**CC BY-NC 4.0**（署名 + 仅限非商业用途）
- 规模：约 129 个国家 / 31,900 个要素 / 44.7 MB 原始数据

代码使用 MIT；数据不适用 MIT，详见 `NOTICE.md` 与 `DATA-LICENSES.md`。
