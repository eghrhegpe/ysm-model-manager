// ========== 模型标签系统：Binding 入口 ==========
package main

import (
	"os"
	"path/filepath"

	"ysm-model-manager/go/tags"
)

// configDir 返回应用配置目录（%APPDATA%/YSM-Model-Manager/）
func (a *App) configDir() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		cfgDir = "."
	}
	return filepath.Join(cfgDir, "YSM-Model-Manager")
}

// getTagsStore 初始化或获取标签存储实例（懒加载）
func (a *App) getTagsStore() *tags.Store {
	if a.tagsStore == nil {
		a.tagsStore = tags.NewStore(a.configDir())
	}
	return a.tagsStore
}

// GetModelTags 返回指定模型文件的所有标签
func (a *App) GetModelTags(modelPath string) ([]string, error) {
	return a.getTagsStore().GetTags(modelPath)
}

// SetModelTags 设置指定模型文件的标签列表（覆盖写入）
func (a *App) SetModelTags(modelPath string, tags []string) error {
	return a.getTagsStore().SetTags(modelPath, tags)
}

// ListByTag 返回所有打了指定标签的文件路径列表
func (a *App) ListByTag(tag string) ([]string, error) {
	return a.getTagsStore().ListByTag(tag)
}

// AllTags 返回所有被使用的标签（按使用次数降序）
func (a *App) AllTags() ([]string, error) {
	return a.getTagsStore().AllTags()
}
