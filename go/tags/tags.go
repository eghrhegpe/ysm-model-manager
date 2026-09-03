// Package tags 提供模型标签的持久化存储。
// 标签存放在用户配置目录/YSM-Model-Manager/tags.json（跨平台：Windows %APPDATA%，Linux ~/.config，macOS ~/Library/Application Support），
// 以文件路径为 key，标签列表为 value。
package tags

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"ysm-model-manager/go/fsutil"
)

// Store 是标签存储，线程安全
type Store struct {
	mu   sync.RWMutex
	path string
	data map[string][]string // key: 文件绝对路径, value: 标签列表
}

// NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取）
func NewStore(configDir string) *Store {
	if configDir == "" {
		// 平台数据根缺失（Android 沙盒不可用等）：内存态存储——
		// load/save 为 no-op，绝不退化为相对路径 tags.json（P1 审核）
		return &Store{path: ""}
	}
	return &Store{
		path: filepath.Join(configDir, "tags.json"),
	}
}

// load 从磁盘读取 tags.json（如果存在）
func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data != nil {
		return nil // 已加载（内存态与磁盘态统一：仅首次调用初始化）
	}
	if s.path == "" {
		s.data = make(map[string][]string) // 内存态：首次初始化，后续 SetTags 写入会话内保留
		return nil
	}
	// data 的初始化移到读取成功之后——原实现在 ReadFile/Unmarshal 之前
	// 就 `s.data = make(...)`，tags.json 损坏或不可读时 load 返回 error 但 data 已非 nil，
	// 后续所有 Get/Set 静默视为「已加载空数据」，损坏被永久掩盖（且 SetTags 会覆盖损坏文件）。
	data, err := os.ReadFile(s.path)
	if err != nil {
		// 锐评 #17：os.IsNotExist 不能穿透包装错误；errors.Is + fs.ErrNotExist
		// 是 Go 1.13+ 标准（PathError 内外层均可命中）。
		if errors.Is(err, fs.ErrNotExist) {
			s.data = make(map[string][]string) // 首次使用，无文件
			return nil
		}
		return fmt.Errorf("读取标签文件失败: %w", err)
	}
	var m map[string][]string
	if err := json.Unmarshal(data, &m); err != nil {
		// 损坏文件备份为 .corrupt 并重建空存储——
		// 若不恢复，load 每次调用都报错，Get/Set/Add/Remove 全部永久失败（写路径也被阻塞）。
		// 备份保留现场供人工排查；重建后 SetTags 可写回全新文件完成自我修复。
		corrupt := s.path + ".corrupt"
		if renErr := os.Rename(s.path, corrupt); renErr != nil {
			// 双 %w 链式包装（Go 1.20+）：解析错误与备份失败均可经 errors.Is 分类，
			// 禁止调用方对错误文本做 strings.Contains 匹配（陷阱 #11）
			return fmt.Errorf("解析标签文件失败: %w（备份失败: %w）", err, renErr)
		}
		s.data = make(map[string][]string)
		return nil
	}
	// Unmarshal 成功但内容恰为 JSON `null` 时 m 为 nil map——
	// `s.data = m` 使 data != nil 守卫失效，每次 Get/Set 都重复整文件读盘（load 单次守卫边缘破口）
	if m == nil {
		m = make(map[string][]string)
	}
	s.data = m
	return nil
}

// save 将内存数据写入磁盘
func (s *Store) save() error {
	if s.path == "" {
		// P1 修复：内存态显式返回错误，让调用方感知持久化不可用，
		// 避免进程崩溃后标签静默丢失
		return fmt.Errorf("tags 存储不可用：平台数据根未就绪，标签仅保留在会话内存中")
	}
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化标签失败: %w", err)
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, fsutil.DirPerms); err != nil {
		return fmt.Errorf("创建标签目录失败: %w", err)
	}
	// ADR-044 策略 A：落盘统一走 fsutil.WriteFileAtomic（CreateTemp + rename 原子替换）——
	// 原固定 `s.path + ".tmp"` 路径并发 save 时互相覆盖（两个 goroutine 写同一 tmp），
	// 且崩溃/断电留半截 JSON 下次 load 报解析失败；CreateTemp 唯一临时文件消除竞争
	if err := fsutil.WriteFileAtomic(s.path, data); err != nil {
		return fmt.Errorf("写入标签文件失败: %w", err)
	}
	return nil
}

// GetTags 返回指定路径的所有标签（已排序）
func (s *Store) GetTags(modelPath string) ([]string, error) {
	if err := s.load(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	tags := s.data[modelPath]
	if tags == nil {
		return []string{}, nil
	}
	cp := make([]string, len(tags))
	copy(cp, tags)
	sort.Strings(cp)
	return cp, nil
}

// checkModelPath 拒绝含 NUL 字节的 modelPath（BUG(NUL-1) 安全边界，SetTags/AddTag/RemoveTag 共用）：
// 含 NUL 的 key 写入 tags.json 后，Linux 路径操作会静默截断 NUL 后内容
// （"safe.ysm\x00..\evil.json" → "safe.ysm"），可能指向非预期文件。
// fsutil.WriteFileAtomic 已校验 s.path 的 NUL，但 modelPath 作为 JSON key 需独立校验。
func checkModelPath(modelPath string) error {
	if strings.Contains(modelPath, "\x00") {
		return fmt.Errorf("modelPath 含 NUL 字节")
	}
	return nil
}

// prepareWrite 校验 modelPath 并加载底层数据，随后获取写锁（s.mu），
// 返回解锁函数与错误。与 SetTags / AddTag 等写路径共用前置逻辑
// （jscpd 报告的文件内自重复）。临界区由调用方 defer unlock 覆盖整段写操作。
func (s *Store) prepareWrite(modelPath string) (func(), error) {
	if err := checkModelPath(modelPath); err != nil {
		return nil, err
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	return func() { s.mu.Unlock() }, nil
}

// SetTags 设置指定路径的标签列表（覆盖写入）
func (s *Store) SetTags(modelPath string, tags []string) error {
	unlock, err := s.prepareWrite(modelPath)
	if err != nil {
		return err
	}
	defer unlock()
	if len(tags) == 0 {
		delete(s.data, modelPath) // 空列表 → 删除条目
	} else {
		// 去重 + 排序
		set := make(map[string]bool)
		for _, t := range tags {
			if t = trimTag(t); t != "" {
				set[t] = true
			}
		}
		unique := make([]string, 0, len(set))
		for t := range set {
			unique = append(unique, t)
		}
		sort.Strings(unique)
		// 全空白串（如 ["  "," "]）trim 后为空集合，应走 delete 分支而非写入空数组
		if len(unique) == 0 {
			delete(s.data, modelPath)
		} else {
			s.data[modelPath] = unique
		}
	}
	return s.save()
}

// AddTag 追加单个标签（不会重复）
func (s *Store) AddTag(modelPath, tag string) error {
	tag = trimTag(tag)
	if tag == "" {
		return nil
	}
	unlock, err := s.prepareWrite(modelPath)
	if err != nil {
		return err
	}
	defer unlock()
	current := s.data[modelPath]
	for _, t := range current {
		if t == tag {
			return nil // 已存在
		}
	}
	s.data[modelPath] = append(current, tag)
	// AddTag 后保持存储排序不变量（SetTags 存的是有序的，GetTags 依赖排序去重缓存）
	sort.Strings(s.data[modelPath])
	return s.save()
}

// RemoveTag 移除单个标签
func (s *Store) RemoveTag(modelPath, tag string) error {
	tag = trimTag(tag)
	if tag == "" {
		return nil
	}
	unlock, err := s.prepareWrite(modelPath)
	if err != nil {
		return err
	}
	defer unlock()
	current := s.data[modelPath]
	var kept []string
	for _, t := range current {
		if t != tag {
			kept = append(kept, t)
		}
	}
	if len(kept) == len(current) {
		return nil // 无变化
	}
	if len(kept) == 0 {
		delete(s.data, modelPath)
	} else {
		s.data[modelPath] = kept
	}
	return s.save()
}

// ListByTag 返回所有打了指定标签的文件路径列表
func (s *Store) ListByTag(tag string) ([]string, error) {
	tag = trimTag(tag)
	if tag == "" {
		return nil, nil
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []string
	for path, tags := range s.data {
		for _, t := range tags {
			if t == tag {
				result = append(result, path)
				break
			}
		}
	}
	sort.Strings(result)
	return result, nil
}

// AllTags 返回所有被使用的标签（按使用次数降序）
func (s *Store) AllTags() ([]string, error) {
	if err := s.load(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	counts := make(map[string]int)
	for _, tags := range s.data {
		for _, t := range tags {
			counts[t]++
		}
	}
	type tagCount struct {
		name  string
		count int
	}
	var list []tagCount
	for name, count := range counts {
		list = append(list, tagCount{name, count})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].count != list[j].count {
			return list[i].count > list[j].count
		}
		return list[i].name < list[j].name
	})
	result := make([]string, len(list))
	for i, tc := range list {
		result[i] = tc.name
	}
	return result, nil
}

// maxTagLen 单标签长度上限（ADR-044② 数值守卫：Go 侧信任边界，前端 maxlength 可绕过）
const maxTagLen = 50

// trimTag 规范化标签：trim 空白 + 剔除控制字符 + 截断超长。
// 原仅 TrimSpace——任意长度/含 \n/控制符的标签可经
// Wails binding 直接写入 tags.json（文件无界增长、渲染错位）。
func trimTag(t string) string {
	t = strings.TrimSpace(t)
	if t == "" {
		return ""
	}
	// 剔除 ASCII 控制字符（\n \t \r 等会破坏 JSON 渲染/展示）
	var b strings.Builder
	for _, r := range t {
		if r < 0x20 && r != '\t' {
			continue
		}
		b.WriteRune(r)
	}
	cleaned := b.String()
	// 截断到上限（按 rune 计，防中文等宽字符半截）
	runes := []rune(cleaned)
	if len(runes) > maxTagLen {
		cleaned = string(runes[:maxTagLen])
	}
	return cleaned
}
