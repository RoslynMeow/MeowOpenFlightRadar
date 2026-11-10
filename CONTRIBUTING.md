# Contributing

## 分支策略

本项目只保留两个长期分支：

| 分支 | 用途 |
| --- | --- |
| `dev` | 唯一开发分支。新功能、修复、文档、重构都直接提交到这里。 |
| `main` | 稳定 / 发布分支。只从 `dev` 合并，不直接开发。 |

- 不再创建长期 feature / release 分支。
- 临时分支用完即删，避免仓库里堆积历史分支。
- 发布时从 `dev` 开一个 `dev → main` PR，合并后再打版本 tag。

## 任务记录

项目用 **GitHub Issues** 记录开发，不使用 GitHub Projects。

- 新功能 / 修复 / 文档任务先开 Issue。
- 完成时关闭 Issue，并在提交信息或关闭评论里引用 PR / commit。
- **开始时间 = Issue 创建时间；完成时间 = Issue 关闭时间。**
- 不再创建 `project-*` 工作流，也不维护 Project 的日期字段。

## 提交记录

在 `dev` 上保持清晰、可追溯的提交：

```text
feat: ...
fix: ...
docs: ...
refactor: ...
test: ...
chore: ...
```

每个提交尽量只做一件事；较大的改动拆成多个提交，不要把所有内容压成一个巨大的提交。

## 提交前检查

```bash
npm run typecheck
npm test
npm run verify:data
```

涉及前端构建时再跑：

```bash
npm run build -w @flightradar/web
```

## 数据

`packages/core/data/` 和 `packages/airspace/data/` 是生成目录，已 gitignore，不需要提交。需要重新生成时：

```bash
npm run setup:data
```
