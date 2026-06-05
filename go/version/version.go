package version

// Version 是编译时注入的版本号，默认 "dev"
// 构建时通过 -ldflags 注入：
// go build -ldflags "-X ysm-model-manager/go/version.Version=v1.0.0" .
var Version = "dev"
