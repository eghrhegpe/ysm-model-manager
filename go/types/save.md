package main

// ========== 原子写入保护 ==========
// SaveWorkshopCreators 的改进版：先写到临时文件再 rename，
// 防止写入中途崩溃导致数据丢失。
// 同时只更新指定站点的条目，不覆写其他站点数据。
func (a *App) SaveWorkshopCreatorsSafe(list []types.WorkshopCreator) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	path := creatorsPath()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
