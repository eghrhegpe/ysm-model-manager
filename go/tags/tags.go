// Package tags 提供模型标签的持久化存储。
// 标签存放在用户配置目录/YSM-Model-Manager/tags.json（跨平台：Windows %APPDATA%，Linux ~/.config，macOS ~/Library/Application Support），
// 以文件路径为 key，标签列表为 value。
package tags

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Store 是标签存储，线程安全
type Store struct {
	mu   sync.RWMutex
	path string
	data map[string][]string // key: 文件绝对路径, value: 标签列表
}

// NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取）
func NewStore(configDir string) *Store {
	return &Store{
		path: filepath.Join(configDir, "tags.json"),
	}
}

// load 从磁盘读取 tags.json（如果存在）
func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data != nil {
		return nil // 已加载
	}
	// P2 修复：data 的初始化移到读取成功之后——原实现在 ReadFile/Unmarshal 之前
	// 就 `s.data = make(...)`，tags.json 损坏或不可读时 load 返回 error 但 data 已非 nil，
	// 后续所有 Get/Set 静默视为「已加载空数据」，损坏被永久掩盖（且 SetTags 会覆盖损坏文件）。
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.data = make(map[string][]string) // 首次使用，无文件
			return nil
		}
		return fmt.Errorf("读取标签文件失败: %w", err)
	}
	var m map[string][]string
	if err := json.Unmarshal(data, &m); err != nil {
		// P2 修复（code_review）：损坏文件备份为 .corrupt 并重建空存储——
		// 若不恢复，load 每次调用都报错，Get/Set/Add/Remove 全部永久失败（写路径也被阻塞）。
		// 备份保留现场供人工排查；重建后 SetTags 可写回全新文件完成自我修复。
		corrupt := s.path + ".corrupt"
		if renErr := os.Rename(s.path, corrupt); renErr != nil {
			return fmt.Errorf("解析标签文件失败: %w（备份失败: %v）", err, renErr)
		}
		s.data = make(map[string][]string)
		return nil
	}
	// P3 修复：Unmarshal 成功但内容恰为 JSON `null` 时 m 为 nil map——
	// `s.data = m` 使 data != nil 守卫失效，每次 Get/Set 都重复整文件读盘（load 单次守卫边缘破口）
	if m == nil {
		m = make(map[string][]string)
	}
	s.data = m
	return nil
}

// save 将内存数据写入磁盘
func (s *Store) save() error {
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化标签失败: %w", err)
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建标签目录失败: %w", err)
	}
	// P2 修复：写临时文件 + rename 原子替换，避免崩溃/断电留下半截 tags.json
	// （原 os.WriteFile 直接覆盖，下次 load 报解析失败且无恢复路径）
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return fmt.Errorf("写入标签文件失败: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("替换标签文件失败: %w", err)
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

// SetTags 设置指定路径的标签列表（覆盖写入）
func (s *Store) SetTags(modelPath string, tags []string) error {
	if err := s.load(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
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
		// P3 修复：全空白串（如 ["  "," "]）trim 后为空集合，应走 delete 分支而非写入空数组
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
	if err := s.load(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.data[modelPath]
	for _, t := range current {
		if t == tag {
			return nil // 已存在
		}
	}
	s.data[modelPath] = append(current, tag)
	// P3 修复：AddTag 后保持存储排序不变量（SetTags 存的是有序的，GetTags 依赖排序去重缓存）
	sort.Strings(s.data[modelPath])
	return s.save()
}

// RemoveTag 移除单个标签
func (s *Store) RemoveTag(modelPath, tag string) error {
	tag = trimTag(tag)
	if tag == "" {
		return nil
	}
	if err := s.load(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
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

func trimTag(t string) string {
	return strings.TrimSpace(t)
}
