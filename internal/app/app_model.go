// ========== YSM 模型解析 ==========
// 从 app.go 拆分：模型文件分析、几何体解析（.ysm 解码统一走内嵌 WASM，
// 2026-08-08 架构决策，exe sidecar 已停发）
package app

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/conc"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// 受限整读上限共用 types.MaxReadLimit（50MB 口径，防 YSMParser 被篡改输出 GB 级 JSON 撑爆内存）

// readLimitedFileBedrock 受限整读 JSON 文件（仅用于 parseBedrockGeometry 输入）
// 返回 nil 表示读失败或超限（对齐 fileops readLimitedFile 风格）
func readLimitedFileBedrock(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	return fsutil.ReadLimitedEntry(f, types.MaxReadLimit)
}

func (a *App) AnalyzeYSMModel(path string) ysm.YSMModelMeta {
	return ysm.AnalyzeYSMModel(path)
}

func (a *App) ExtractYsmSummary(path string) ysm.YsmSummary {
	summary, err := ysm.ExtractYsmSummary(path)
	if err != nil {
		// 解析失败不再完全静默——记录日志便于诊断。
		// 绑定签名保持单返回值（不破坏前端契约），前端 detail.ts 有 hasRealSummary 兜底 toast
		log.Printf("[ysm] ExtractYsmSummary 解析失败 %s: %v", path, err)
		summary = ysm.YsmSummary{
			Schema: "ysm-summary/v1",
			Source: filepath.Base(path),
		}
	}
	return summary
}

func (a *App) ExtractYSMHeader(path string) ysm.YSMHeader {
	return ysm.AnalyzeYSMHeader(path)
}

func (a *App) ExtractYSMHeaderFromBase64(base64Data string) ysm.YSMHeader {
	// base64 预大小守卫：与 DecodeBase64Limited 统一口径，防前端超大字符串解码内存尖刺
	data, err := fsutil.DecodeBase64Limited(base64Data, types.MaxReadLimit)
	if err != nil {
		return ysm.YSMHeader{}
	}
	return ysm.AnalyzeYSMHeaderFromBytes(data)
}

// previewTempTTL 临时预览文件存活期：写入前清扫过期文件，防长期运行累积磁盘
const previewTempTTL = 24 * time.Hour

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
func (a *App) SavePreviewTempFile(base64Data string) (string, error) {
	// base64 预大小守卫（同 ExtractYSMHeaderFromBase64）
	data, err := fsutil.DecodeBase64Limited(base64Data, types.MaxReadLimit)
	if err != nil {
		return "", err
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	if err := os.MkdirAll(tmpDir, fsutil.DirPerms); err != nil {
		return "", err
	}
	sweepPreviewTemp(tmpDir)
	tmpFile, err := os.CreateTemp(tmpDir, "preview-*.ysm")
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()
	_, err = tmpFile.Write(data)
	if err != nil {
		return "", err
	}
	return tmpFile.Name(), nil
}

// sweepPreviewTemp 清扫 ysm-preview 目录中超期的临时文件（TTL 淘汰，借鉴 texture_cache 模式）。
// 清扫失败静默忽略——临时目录清理不应阻塞预览主链路。
func sweepPreviewTemp(tmpDir string) {
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-previewTempTTL)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		_ = os.Remove(filepath.Join(tmpDir, e.Name()))
	}
}

func (a *App) ReadFileBytes(path string) []byte {
	// 路径守卫：限制在任一合法扫描根（FilesRoot/McRoot/VrcRoot/…）内，防止读取系统任意文件。
	// 2026-08-16 修复：原用 isPathInRoot（只认 ysm 根），导致 VRM/MMD 等兄弟类型根（VrcRoot 等）
	// 下的文件被误拒 → 前端 vrm-adapter 报「ReadFileBytes 返回空」。改用 isPathInRootOrSelf，
	// 与 ScanModelEntries 等扫描口径一致：扫描能列出的文件就能读；仍拒绝 .. 越权/根外路径。
	if !a.isPathInRootOrSelf(path) {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
}

// ReadFileBytesBatch 批量读取多个文件（ADR-101：MMD 纹理加载优化）。
// 一次 RPC 返回多个文件字节，减少 Go↔JS IPC 往返（原 N 次 readFileBytes → 1 次 batch）。
// 路径守卫：逐个校验 isPathInRootOrSelf，非法路径跳过（值为 nil）。
// 返回 map[路径] → base64 字节（Wails []byte 自动序列化为 base64，map 保持键序）。
//
// 并发优化：I/O 密集型任务，使用 goroutine 池并行读取。
// 当 paths 数量 <= 4 时退化为顺序读取（goroutine 开销不划算）。
func (a *App) ReadFileBytesBatch(paths []string) map[string][]byte {
	if len(paths) <= 4 {
		return a.readFileBytesBatchSequential(paths)
	}
	return a.readFileBytesBatchConcurrent(paths)
}

// readFileBytesBatchSequential 顺序读取（小规模或单文件场景）
func (a *App) readFileBytesBatchSequential(paths []string) map[string][]byte {
	result := make(map[string][]byte, len(paths))
	for _, p := range paths {
		if !a.isPathInRootOrSelf(p) {
			continue
		}
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		result[p] = data
	}
	return result
}

// readFileBytesBatchConcurrent 并发批量读取（goroutine 池 + 分片调度）
// 收敛到 go/conc.Parallel（P0：统一手写 worker 池）——conc 内部 worker=NumCPU，
// 结果按输入序收集；ok=false 跳过（路径守卫失败 / 读失败）。
func (a *App) readFileBytesBatchConcurrent(paths []string) map[string][]byte {
	type fileRead struct {
		path string
		data []byte
	}
	reads := conc.Parallel(paths, func(_ int, p string) (fileRead, bool) {
		if !a.isPathInRootOrSelf(p) {
			return fileRead{}, false
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return fileRead{}, false
		}
		return fileRead{path: p, data: data}, true
	})
	result := make(map[string][]byte, len(reads))
	for _, r := range reads {
		result[r.path] = r.data
	}
	return result
}

// ReadFileMeta 是 ReadFileBytesBatchWithMeta 的单个文件元信息。
type ReadFileMeta struct {
	Data []byte `json:"data"` // 文件内容（Wails 自动 base64）
	Hash string `json:"hash"` // SHA256 十六进制
}

// readFileWithHash 读取文件并计算 SHA256，返回 data 和 hex hash。
// 路径守卫：与 ReadFileBytes 对齐（防御性编程——当前调用方已校验，但
// 未来新增调用方可能遗漏，此处兜底防止越权读取）。
func (a *App) readFileWithHash(path string) ([]byte, string) {
	if !a.isPathInRootOrSelf(path) {
		return nil, ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, ""
	}
	h := sha256.Sum256(data)
	hash := hex.EncodeToString(h[:])
	return data, hash
}

// ReadFileBytesBatchWithMeta 批量读取文件并返回内容 + SHA256 哈希。
// 一次 RPC 完成数据读取和 hash 计算，避免前端额外算 hash 或二次 RPC。
// 路径守卫和行为与 ReadFileBytesBatch 一致。
func (a *App) ReadFileBytesBatchWithMeta(paths []string) map[string]ReadFileMeta {
	if len(paths) <= 4 {
		result := make(map[string]ReadFileMeta, len(paths))
		for _, p := range paths {
			if !a.isPathInRootOrSelf(p) {
				continue
			}
			data, hash := a.readFileWithHash(p)
			if data == nil {
				continue
			}
			result[p] = ReadFileMeta{Data: data, Hash: hash}
		}
		return result
	}
	// 并发读取：收敛到 go/conc.Parallel（P0：统一手写 worker 池）
	type fileMeta struct {
		path string
		meta ReadFileMeta
	}
	metas := conc.Parallel(paths, func(_ int, p string) (fileMeta, bool) {
		if !a.isPathInRootOrSelf(p) {
			return fileMeta{}, false
		}
		data, hash := a.readFileWithHash(p)
		if data == nil {
			return fileMeta{}, false
		}
		return fileMeta{path: p, meta: ReadFileMeta{Data: data, Hash: hash}}, true
	})
	result := make(map[string]ReadFileMeta, len(metas))
	for _, m := range metas {
		result[m.path] = m.meta
	}
	return result
}

func (a *App) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	// 剥禁用后缀（.ban/.disabled），与 scanner 口径一致
	modelPath = types.StripDisableSuffix(modelPath)
	// 路径守卫：AnalyzeBedrockModel 是 Wails binding（public method），
	// 前端可传任意路径——原实现无校验，可读取系统任意文件（如 /etc/passwd）。
	// 与 ReadFileBytes 对齐 isPathInRootOrSelf（扫描能列出的文件就能分析）。
	if !a.isPathInRootOrSelf(modelPath) {
		return types.BedrockModel{}
	}
	ext := strings.ToLower(filepath.Ext(modelPath))
	if ext == ".ysm" {
		return a.runYSMParserOnFile(modelPath)
	}
	data, err := os.ReadFile(modelPath)
	if err != nil {
		return types.BedrockModel{}
	}
	var geoJSON *types.BedrockModel
	var texData [][]byte
	var animJSONs []string

	if ext == ".zip" {
		geoJSON, texData, animJSONs = parseBedrockFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		geoJSON, texData = parseBedrockFrom7z(data, int64(len(data)))
	} else if ext == ".json" {
		geoJSON, texData = ysm.FindGeometryInExtractedYSM(modelPath)
	}

	if geoJSON == nil && (ext == ".zip" || ext == ".7z") {
		g := a.runYSMParserOnFile(modelPath)
		geoJSON = &g
	}
	if geoJSON == nil {
		return types.BedrockModel{}
	}

	var textures []string
	for _, td := range texData {
		if len(td) > 0 {
			textures = append(textures, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(td))
		}
	}
	if len(textures) > 0 {
		geoJSON.Texture = textures[0]
		geoJSON.Textures = textures
	}
	if len(animJSONs) > 0 {
		geoJSON.Animations = animJSONs
	}
	return *geoJSON
}

// AnalyzeBedrockModelEntry 按 SubModel.SourcePath 只解析归档内单模型 geometry（多角色包角色切换用）。
//
// 路径守卫：与 AnalyzeBedrockModel 对齐 isPathInRootOrSelf；subPath 是 zip/7z 内 entry 路径，只用于
// 归档内 geoFile 匹配，不涉及文件系统。
//
// 返回规则：
//   - 单条目命中 → BedrockModel 为该单角色 Bones（BoneCount/CubeCount 对应单模型）；Textures/TextureNames 仍全量（切纹理不换 PNG 集合，只换 texIdx）
//   - 单条目未命中 → 空 BedrockModel{}（前端据此回退到全量解析 AnalyzeBedrockModel）
//   - ext == .ysm / .json（非压缩包）或 subPath 空 → 空 BedrockModel{}
func (a *App) AnalyzeBedrockModelEntry(modelPath, subPath string) types.BedrockModel {
	if subPath == "" {
		return types.BedrockModel{}
	}
	modelPath = types.StripDisableSuffix(modelPath)
	if !a.isPathInRootOrSelf(modelPath) {
		return types.BedrockModel{}
	}
	ext := strings.ToLower(filepath.Ext(modelPath))
	if ext == ".ysm" {
		// .ysm 为二进制不可分 entry；让前端回退到全量解析
		return types.BedrockModel{}
	}
	data, err := os.ReadFile(modelPath)
	if err != nil {
		return types.BedrockModel{}
	}
	var geoJSON *types.BedrockModel
	var texData [][]byte

	switch ext {
	case ".zip":
		geoJSON, texData = geometry.ParseFromZipEntry(data, int64(len(data)), subPath)
	case ".7z":
		geoJSON, texData = geometry.ParseFrom7zEntry(data, int64(len(data)), subPath)
	case ".json":
		// 提取目录：subPath 视为绝对 / 相对 FindGeometryInExtractedYSM 可读路径
		if filepath.IsAbs(subPath) && a.isPathInRootOrSelf(subPath) {
			geoJSON, texData = ysm.FindGeometryInExtractedYSM(subPath)
		}
	}

	if geoJSON == nil {
		return types.BedrockModel{}
	}
	var textures []string
	for _, td := range texData {
		if len(td) > 0 {
			textures = append(textures, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(td))
		}
	}
	if len(textures) > 0 {
		geoJSON.Texture = textures[0]
		geoJSON.Textures = textures
	}
	return *geoJSON
}

func (a *App) GetModel3DSpec(modelPath string) (*threejs.Model3DSpec, error) {
	// 剥禁用后缀（.ban/.disabled），与 scanner 口径一致
	modelPath = types.StripDisableSuffix(modelPath)
	// 路径守卫：GetModel3DSpec 是 Wails binding，原实现无校验可读取系统任意文件。
	// 与 ReadFileBytes/AnalyzeBedrockModel 对齐 isPathInRootOrSelf。
	if !a.isPathInRootOrSelf(modelPath) {
		return nil, fmt.Errorf("路径超出仓库目录")
	}
	// 多组件路径（YSMViewer 式）：.ysm（WASM 解码）/ .zip / 解压目录 ysm.json
	// 各自组件独立构建，合并 spec.models；纹理 texIdx 由解析层全局化（组件 i → i），
	// 前端 texArr 全局数组按序索引。
	ext := strings.ToLower(filepath.Ext(modelPath))
	if comps, texNames := a.collect3DComponents(modelPath, ext); len(comps) > 0 {
		specJSON, err := threejs.BuildMulti(comps, nil)
		if err == nil && specJSON != "{}" {
			var spec threejs.Model3DSpec
			if err := json.Unmarshal([]byte(specJSON), &spec); err != nil {
				return nil, fmt.Errorf("解析 Model3DSpec 失败: %w", err)
			}
			// R1 契约（texArrOrder）+ ADR-114 perComponent（componentTextures）：
			// typed 字段直填，不再走「拼 map → 注入 string → 再 Unmarshal」双轨——
			// 该双轨曾因结构体缺字段被 Unmarshal 静默丢弃（回归 936169b1）。
			// nil 字段经 omitempty 序列化即「不注入」，与旧空值语义一致。
			spec.TexArrOrder = texNames
			spec.ComponentTextures = buildComponentTextureMap(comps)
			return &spec, nil
		}
	}
	// 单组件兜底（.7z 或多组件失败时）
	model := a.AnalyzeBedrockModel(modelPath)
	specJSON, err := threejs.Build(model)
	if err != nil {
		return nil, err
	}
	if specJSON == "{}" {
		return &threejs.Model3DSpec{}, nil
	}
	var spec threejs.Model3DSpec
	if err := json.Unmarshal([]byte(specJSON), &spec); err != nil {
		return nil, fmt.Errorf("解析 Model3DSpec 失败: %w", err)
	}
	return &spec, nil
}

// Build3DSpecFromGeometryJSON 从 bedrock geometry JSON 构建 3D spec（纯 Go，无 Node 依赖）。
// 用途：Android 上 Go 端无 .ysm 解码通道（Node WASM 不可用，runYSMNodeJSDecode 恒 nil）时，
// 前端用 WebView 内 WASM 解码 .ysm 拿到 geometry JSON，再调本函数构建 spec——
// 复用 threejs.BuildMulti 全量顶点算法（ADR-004：Go 绑定为唯一事实来源），桌面端主路径不变。
// 返回 nil 表示不可用（前端据此决定是否报错/提示）。
func (a *App) Build3DSpecFromGeometryJSON(geometryJSON string) (*threejs.Model3DSpec, error) {
	if geometryJSON == "" {
		return nil, fmt.Errorf("geometryJSON 为空")
	}
	model := geometry.ParseBedrockGeometry([]byte(geometryJSON))
	if model == nil || len(model.Bones) == 0 {
		return &threejs.Model3DSpec{}, nil
	}
	specJSON, err := threejs.BuildMulti([]types.BedrockModel{*model}, nil)
	if err != nil {
		return nil, err
	}
	if specJSON == "{}" {
		return &threejs.Model3DSpec{}, nil
	}
	var spec threejs.Model3DSpec
	if err := json.Unmarshal([]byte(specJSON), &spec); err != nil {
		return nil, fmt.Errorf("解析 Model3DSpec 失败: %w", err)
	}
	return &spec, nil
}

// buildComponentTextureMap 从组件列表提取 componentTextures（ADR-114 perComponent）。
// 键 = comps[i].SourceName（如 "main"/"arm"/"arrow"），与 spec.models[i].name 同源——
// BuildMulti 中 Name = SourceName（若无则 fallback compID = "comp_N"），前端 ysm-object
// 以 mg.name || mg.id 查表，两者均须能命中；用 SourceName 直连，避免 index-based 错位。
// 全部为空时返回 nil（typed 字段 omitempty → 序列化不注入）。
func buildComponentTextureMap(comps []types.BedrockModel) map[string][]string {
	compTex := make(map[string][]string)
	for i := range comps {
		if len(comps[i].Bones) == 0 || len(comps[i].ComponentTextures) == 0 {
			continue
		}
		for _, arr := range comps[i].ComponentTextures {
			if len(arr) > 0 {
				key := comps[i].SourceName
				if key == "" {
					key = fmt.Sprintf("comp_%d", i)
				}
				if _, exists := compTex[key]; exists {
					// SourceName 碰撞（如 zip 内两个子目录同名 geometry 文件）：后写覆盖前写，
					// 前一个组件的纹理映射被静默丢弃 → 前端查表命中错图。诚实告警暴露数据问题。
					log.Printf("[app] buildComponentTextureMap: SourceName 碰撞 key=%q（组件 %d 与先前组件同名），纹理映射被覆盖，检查模型组件命名", key, i)
				}
				compTex[key] = arr
				break // 每组件取第一条有效纹理（当前口径单张主纹理）
			}
		}
	}
	if len(compTex) == 0 {
		return nil
	}
	return compTex
}

// collect3DComponents 收集多组件列表（含 arm/载具等独立组件，不合并 bones）。
// 返回 (组件列表, 组件序纹理名数组)——后者仅 zip/解压目录路径有（R1 契约）；
// .ysm WASM 路径无 ysm.json texture 声明，返回 nil（前端跳过比对）。
func (a *App) collect3DComponents(modelPath, ext string) ([]types.BedrockModel, []string) {
	switch ext {
	case ".ysm":
		if data, err := os.ReadFile(modelPath); err == nil {
			return decodeYSMComponentsViaNodeJS(data)
		}
	case ".zip":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFromZip(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".7z":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFrom7z(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".json":
		// 解压目录的 ysm.json 路径
		if types.IsYsmEntryJSON(filepath.Base(modelPath)) {
			return ysm.FindComponentsInExtractedYSM(modelPath)
		}
	}
	return nil, nil
}

// SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用）
// 路径守卫：限制在 os.TempDir()/ysm-preview 内，禁止绝对路径与路径穿越（.. 段）
func (a *App) SaveScreenshotFile(filename string, base64Data string) error {
	clean := filepath.Clean(filename)
	// 用 filepath.Base 比对：合法纯文件名 Clean 后等于自身；含目录/穿越段会被拒绝。
	// 不能用 strings.Contains(clean, "..") —— 会误杀 my..file.png 这类合法文件名
	if filepath.IsAbs(clean) || filepath.Base(clean) != clean {
		return fmt.Errorf("文件名不能包含路径")
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	if err := os.MkdirAll(tmpDir, fsutil.DirPerms); err != nil {
		return err
	}
	dest := filepath.Join(tmpDir, clean)
	// base64 预大小守卫：PNG 截图正常量级为 MB 级，50MB 上限拦截异常输入的解码内存尖刺
	data, err := fsutil.DecodeBase64Limited(base64Data, types.MaxReadLimit)
	if err != nil {
		return err
	}
	// 原子写入（与 importer.WriteFileAtomic 对齐）——
	// 原 os.WriteFile 直写在磁盘满/IO 中断时留半截文件，前端重试会命中「文件已存在」
	return fsutil.WriteFileAtomic(dest, data)
}

func (a *App) runYSMParserOnFile(modelPath string) types.BedrockModel {
	// 2026-08-08 架构决策：YSMParser.exe sidecar 已停发（FindCLI 恒空已删除），
	// 统一走内嵌 WASM 解码（decodeYSMViaNodeJS：Node 子进程 + WASM，无 Node 时返回 nil）
	if data, err := os.ReadFile(modelPath); err == nil {
		if m := decodeYSMViaNodeJS(data); m != nil {
			return *m
		}
	}
	return types.BedrockModel{}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func parseBedrockFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	return geometry.ParseFromZip(data, size)
}

func parseBedrockFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	return geometry.ParseFrom7z(data, size)
}

func parseBedrockGeometry(data []byte) *types.BedrockModel {
	return geometry.ParseBedrockGeometry(data)
}
