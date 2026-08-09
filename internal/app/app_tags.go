// ========== 模型标签系统：Binding 入口 ==========
package app

import (
	"ysm-model-manager/go/tags"
)

// getTagsStore 初始化或获取标签存储实例（懒加载，sync.Once 保护）
func (a *App) getTagsStore() *tags.Store {
	a.tagsStoreOnce.Do(func() {
		a.tagsStore = tags.NewStore(configDir())
	})
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
