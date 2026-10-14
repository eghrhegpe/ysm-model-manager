// ===== fsutil.IsRelinkBackupPath 谓词钉桩（ADR-342 D6）=====
// 口径从 go/sync 私有 isRelinkBackupPath 下沉而来，本测试随之下沉并扩展（sync 侧保留
// 转发函数 + 原调用点，判定逻辑只此一份）。
package fsutil

import (
	"path/filepath"
	"testing"
)

func TestIsRelinkBackupPath(t *testing.T) {
	sep := string(filepath.Separator)
	hit := []string{
		filepath.Join("C:\\mc\\resourcepacks", "m.ysm.relink-bak-1700000000") + sep + "ysm.json",
		"repo" + sep + "sub.relink-bak-42" + sep + "a.ysm",
		"X.RELINK-BAK-1" + sep + "ysm.json",         // 大小写不敏感
		filepath.Join("inst", "packA.relink-bak-9"), // 目录自身（scanner/dedup/repoaudit 按目录判）
	}
	miss := []string{
		filepath.Join("repo", "model.ysm"),
		filepath.Join("repo", "m.relinkbak-1", "ysm.json"), // 无连字符的中缀不误伤
		filepath.Join("repo", ".recycle", "m.ysm.ban"),
		"model.relink.txt",
	}
	for _, p := range hit {
		if !IsRelinkBackupPath(p) {
			t.Errorf("应命中备份谓词: %s", p)
		}
	}
	for _, p := range miss {
		if IsRelinkBackupPath(p) {
			t.Errorf("不应命中备份谓词: %s", p)
		}
	}
}
