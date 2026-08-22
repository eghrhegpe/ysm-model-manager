# ysm CLI — PowerShell 补全（自动生成，勿手改；来源：go/cli 注册表）
# 生成：node scripts/gen-cli-completion.mjs（顶层命令 39 个）
# 启用：Add-Content $PROFILE ". $(Resolve-Path ./completions/_ysm.ps1)"
$ysmTopCommands = @('analyze', 'analyze-mmd', 'avatar', 'benchmark', 'cache-clear', 'cache-diag', 'cache-status', 'cache-verify', 'concurrent-bench', 'config', 'config-show', 'copy', 'creator', 'dedup', 'download', 'export', 'file-bench', 'gui-flow', 'health-report', 'hub', 'install', 'instance', 'link-mode', 'list', 'move', 'perf-log', 'perf-snapshot', 'recycle', 'rename', 'repo-audit', 'resource-scan', 'scan', 'scan-dir', 'search', 'single-bench', 'tags', 'toggle', 'verify', 'workshop')
$ysmSubs = @{
  'avatar' = @('batch', 'cached', 'cache')
  'config' = @('show', 'path', 'mc-paths', 'mirror', 'link-mode')
  'creator' = @('scan', 'list', 'export', 'backup')
  'dedup' = @('scan', 'count', 'clean')
  'download' = @('enqueue', 'status', 'cancel', 'github')
  'hub' = @('models', 'search', 'model')
  'instance' = @('list', 'sync', 'push', 'pull')
  'recycle' = @('list', 'restore', 'empty')
  'scan' = @('models', 'authors', 'resources')
  'tags' = @('list', 'set', 'by', 'count', 'get')
  'workshop' = @('sites', 'validate')
}
$ysmFlags = @{
  'analyze' = @('--help', '--model')
  'analyze-mmd' = @('--help', '--dir')
  'avatar' = @('--help')
  'benchmark' = @('--help', '--iterations')
  'cache-clear' = @('--help', '--yes')
  'cache-diag' = @('--help')
  'cache-status' = @('--help')
  'cache-verify' = @('--help', '--dir', '--verbose')
  'concurrent-bench' = @('--help', '--workers', '--max-models')
  'config' = @('--help')
  'config-show' = @('--help')
  'copy' = @('--help', '--src', '--dst')
  'creator' = @('--help')
  'dedup' = @('--help')
  'download' = @('--help')
  'export' = @('--help', '--model', '--output')
  'file-bench' = @('--help', '--dir', '--file', '--iterations', '--output', '--compare')
  'gui-flow' = @('--help', '--model', '--verbose')
  'health-report' = @('--help', '--dir', '--output', '--bench')
  'hub' = @('--help')
  'install' = @('--help', '--model', '--mc-root', '--custom-dir')
  'instance' = @('--help')
  'link-mode' = @('--help', '--mode')
  'list' = @('--help', '--limit', '--format')
  'move' = @('--help', '--src', '--dst')
  'perf-log' = @('--help')
  'perf-snapshot' = @('--help', '--model', '--iterations')
  'recycle' = @('--help')
  'rename' = @('--help', '--path', '--name')
  'repo-audit' = @('--help', '--dir', '--output')
  'resource-scan' = @('--help', '--dir', '--output')
  'scan' = @('--help')
  'scan-dir' = @('--help', '--dir', '--detail', '--output')
  'search' = @('--help', '--keyword', '--min-bones', '--max-bones', '--min-cubes', '--max-cubes', '--min-tex', '--max-tex', '--format')
  'single-bench' = @('--help', '--model', '--iterations', '--baseline', '--save-baseline', '--threshold', '--format')
  'tags' = @('--help')
  'toggle' = @('--help', '--path')
  'verify' = @('--help', '--repair')
  'workshop' = @('--help')
}
Register-ArgumentCompleter -Native -CommandName ysm,app,ysm-cli -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $els = $commandAst.CommandElements | ForEach-Object { $_.ToString() } | Select-Object -Skip 1
  $n = $els.Count
  if ($n -le 1) { return $ysmTopCommands | Where-Object { $_ -like "$wordToComplete*" } }
  $cmd = $els[0]
  if ($n -eq 2 -and $ysmSubs.ContainsKey($cmd)) { return $ysmSubs[$cmd] | Where-Object { $_ -like "$wordToComplete*" } }
  if ($ysmFlags.ContainsKey($cmd)) { return $ysmFlags[$cmd] | Where-Object { $_ -like "$wordToComplete*" } }
  return @()
}
