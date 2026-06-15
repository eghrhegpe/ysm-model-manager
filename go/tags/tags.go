// Package tags 提供模型标签的持久化存储。
// 标签存放在 %APPDATA%/YSM-Model-Manager/tags.json，
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
	s.data = make(map[string][]string)
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 首次使用，无文件
		}
		return fmt.Errorf("读取标签文件失败: %w", err)
	}
	if err := json.Unmarshal(data, &s.data); err != nil {
		return fmt.Errorf("解析标签文件失败: %w", err)
	}
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
	if err := os.WriteFile(s.path, data, 0644); err != nil {
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

// SetTags 设置指定路径的标签列表（覆盖写入）
func (s *Store) SetTags(modelPath string, tags []string) error {
	if err := s.load(); err != nil {
		return err
	}
	s.mu.Lock()
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
		s.data[modelPath] = unique
	}
	s.mu.Unlock()
	return s.save()
}

// AddTag 追加单个标签（不会重复）
func (s *Store) AddTag(modelPath, tag string) error {
	tag = trimTag(tag)
	if tag == "" {
		return nil
	}
	current, err := s.GetTags(modelPath)
	if err != nil {
		return err
	}
	for _, t := range current {
		if t == tag {
			return nil // 已存在
		}
	}
	return s.SetTags(modelPath, append(current, tag))
}

// RemoveTag 移除单个标签
func (s *Store) RemoveTag(modelPath, tag string) error {
	tag = trimTag(tag)
	if tag == "" {
		return nil
	}
	current, err := s.GetTags(modelPath)
	if err != nil {
		return err
	}
	var kept []string
	for _, t := range current {
		if t != tag {
			kept = append(kept, t)
		}
	}
	if len(kept) == len(current) {
		return nil // 无变化
	}
	return s.SetTags(modelPath, kept)
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
