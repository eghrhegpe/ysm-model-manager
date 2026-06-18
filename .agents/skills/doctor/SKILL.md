---
name: doctor
description: 项目健康诊断。一键检查 Go 编译、前端构建、文件完整性、治理红线、配置一致性。
runAs: subagent
---

# 项目诊断

说"doctor"或"诊断"，就会执行以下诊断。

```bash
python3 scripts/doctor.py
```

## 诊断日志

发现问题后记录到 `docs/doctor-report.md`（非永久，用完可删）。
