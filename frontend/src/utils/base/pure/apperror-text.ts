// ===== Go AppError 文案净化（跨语言契约，ADR-207 D2）=====
// 剥 Go 端 AppError.Error() 拼入的内部路径段（`源路径：...` / `目标路径：...`）——
// 日记持久化不引入完整路径（ADR-051）。
// 契约守卫：Go 侧 go/types/apperror_test.go 钉 AppError.Error() 全串 == 共享 fixture
// （tests/fixtures/apperror-sample.json）；Node 契约测试 tests/test_apperror_strip.ts 同 fixture。
// Go 文案变更 → Go 测试先红 → 同 PR 同步 fixture + 本正则。
/** Go AppError.Error() 内部路径段正则（dom/errors.ts stripPathSegments 同源共享） */
export const APP_ERROR_PATH_RE =
  /\s+(?:源路径|目标路径)：.*?(?=\s+(?:操作|目标路径|解决建议)：|$)/g;

export function stripAppErrorPaths(msg: string): string {
  return msg.replace(APP_ERROR_PATH_RE, "");
}
