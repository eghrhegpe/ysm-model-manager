# vendored: yaml@2.9.1（eemeli/yaml）

来源：npm `yaml` 2.9.1（https://github.com/eemeli/yaml），2026-10-08 从根 node_modules 拷贝。

- license：ISC（见 LICENSE）
- 运行时依赖：**零**（package.json dependencies 为空）——满足本仓 scripts「零依赖」纪律，
  契约测试可在不装前端依赖的 CI contracts job 中直接执行。
- 用途：知识卡 / ADR / guide frontmatter 与 workflow YAML 的**完整语法 + 结构校验**
  （scripts/_lib/frontmatter.ts 是行级正则解析，对 `**` alias、`>` block scalar、全角冒号字段
  等 YAML 结构雷失明；本 vendor 供 test_knowledge_frontmatter_yaml.ts 做完整 parseDocument）。
- 升级：npm pack yaml 或从 node_modules/yaml 整目录拷贝（dist/ + LICENSE + package.json）。
- 与 VitePress 同源：vitepress 依赖树即此包，校验口径与站点构建解析器一致。

入口（CJS）：`scripts/_lib/vendor/yaml/dist/index.js`（main 指向，相对 require 子目录，
须整目录保留）。
