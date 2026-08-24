# ysm CLI — bash 补全（自动生成，勿手改；来源：go/cli 注册表）
# 生成：node scripts/gen-cli-completion.mjs（顶层命令 44 个）
# 启用：echo "source $(pwd)/completions/ysm.bash" >> ~/.bashrc
_ysm_complete() {
  local cur prev words cword
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  words="${COMP_WORDS[@]}"

  # 第一参数：顶层命令
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "analyze analyze-mmd avatar benchmark cache-clear cache-diag cache-status cache-verify concurrent-bench config config-show copy creator dedup download export file-bench gui-flow health-report hub hub-download hub-login hub-model hub-models hub-search install instance link-mode list move perf-log perf-snapshot recycle rename repo-audit resource-scan resource-types scan scan-dir search single-bench tags toggle verify workshop" -- "$cur") )
    return
  fi

  cmd="${COMP_WORDS[1]}"
  # 父命令第二参数：子命令
  case "$cmd" in
    avatar) COMPREPLY=( $(compgen -W "batch cached cache" -- "$cur") ); return ;;
    config) COMPREPLY=( $(compgen -W "show path mc-paths mirror link-mode" -- "$cur") ); return ;;
    creator) COMPREPLY=( $(compgen -W "scan list export backup" -- "$cur") ); return ;;
    dedup) COMPREPLY=( $(compgen -W "scan count clean" -- "$cur") ); return ;;
    download) COMPREPLY=( $(compgen -W "enqueue status cancel github" -- "$cur") ); return ;;
    hub) COMPREPLY=( $(compgen -W "models search model download login logout me" -- "$cur") ); return ;;
    instance) COMPREPLY=( $(compgen -W "list sync push pull" -- "$cur") ); return ;;
    recycle) COMPREPLY=( $(compgen -W "list restore empty" -- "$cur") ); return ;;
    scan) COMPREPLY=( $(compgen -W "models authors resources" -- "$cur") ); return ;;
    tags) COMPREPLY=( $(compgen -W "list set by count get" -- "$cur") ); return ;;
    workshop) COMPREPLY=( $(compgen -W "sites validate" -- "$cur") ); return ;;
  esac

  # 选项补全：--xxx 或首字符为 -
  case "$cur" in
    -*)
      case "$cmd" in
    analyze) COMPREPLY=( $(compgen -W "--help --model" -- "$cur") ); return ;;
    analyze-mmd) COMPREPLY=( $(compgen -W "--help --dir" -- "$cur") ); return ;;
    avatar) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    benchmark) COMPREPLY=( $(compgen -W "--help --iterations" -- "$cur") ); return ;;
    cache-clear) COMPREPLY=( $(compgen -W "--help --yes" -- "$cur") ); return ;;
    cache-diag) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    cache-status) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    cache-verify) COMPREPLY=( $(compgen -W "--help --dir --verbose" -- "$cur") ); return ;;
    concurrent-bench) COMPREPLY=( $(compgen -W "--help --workers --max-models" -- "$cur") ); return ;;
    config) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    config-show) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    copy) COMPREPLY=( $(compgen -W "--help --src --dst" -- "$cur") ); return ;;
    creator) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    dedup) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    download) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    export) COMPREPLY=( $(compgen -W "--help --model --output" -- "$cur") ); return ;;
    file-bench) COMPREPLY=( $(compgen -W "--help --dir --file --iterations --output --compare" -- "$cur") ); return ;;
    gui-flow) COMPREPLY=( $(compgen -W "--help --model --verbose" -- "$cur") ); return ;;
    health-report) COMPREPLY=( $(compgen -W "--help --dir --output --bench" -- "$cur") ); return ;;
    hub) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    hub-download) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    hub-login) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    hub-model) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    hub-models) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    hub-search) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    install) COMPREPLY=( $(compgen -W "--help --model --mc-root --custom-dir" -- "$cur") ); return ;;
    instance) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    link-mode) COMPREPLY=( $(compgen -W "--help --mode" -- "$cur") ); return ;;
    list) COMPREPLY=( $(compgen -W "--help --limit --format" -- "$cur") ); return ;;
    move) COMPREPLY=( $(compgen -W "--help --src --dst" -- "$cur") ); return ;;
    perf-log) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    perf-snapshot) COMPREPLY=( $(compgen -W "--help --model --iterations" -- "$cur") ); return ;;
    recycle) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    rename) COMPREPLY=( $(compgen -W "--help --path --name" -- "$cur") ); return ;;
    repo-audit) COMPREPLY=( $(compgen -W "--help --dir --output" -- "$cur") ); return ;;
    resource-scan) COMPREPLY=( $(compgen -W "--help --dir --output" -- "$cur") ); return ;;
    resource-types) COMPREPLY=( $(compgen -W "--help --type --format" -- "$cur") ); return ;;
    scan) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    scan-dir) COMPREPLY=( $(compgen -W "--help --dir --detail --output" -- "$cur") ); return ;;
    search) COMPREPLY=( $(compgen -W "--help --keyword --min-bones --max-bones --min-cubes --max-cubes --min-tex --max-tex --format" -- "$cur") ); return ;;
    single-bench) COMPREPLY=( $(compgen -W "--help --model --iterations --baseline --save-baseline --threshold --format" -- "$cur") ); return ;;
    tags) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
    toggle) COMPREPLY=( $(compgen -W "--help --path" -- "$cur") ); return ;;
    verify) COMPREPLY=( $(compgen -W "--help --repair" -- "$cur") ); return ;;
    workshop) COMPREPLY=( $(compgen -W "--help" -- "$cur") ); return ;;
      esac
      ;;
    *)
      # 常见取值提示
      case "$prev" in
        --format) COMPREPLY=( $(compgen -W "table json text" -- "$cur") ); return ;;
        --mode)   COMPREPLY=( $(compgen -W "symlink hardlink copy" -- "$cur") ); return ;;
        --link-mode) COMPREPLY=( $(compgen -W "symlink hardlink copy" -- "$cur") ); return ;;
      esac
      COMPREPLY=( $(compgen -f -- "$cur") )
      ;;
  esac
}
complete -F _ysm_complete ysm app ysm-cli
