// ========== 纹理缓存（薄壳） ==========
// 纯逻辑已下沉到 go/texture_cache/，此处仅做 Wails 绑定适配。
// 前端调用 GetCachedTexture 获取纹理数据（优先返回 KTX2 缓存），
// 调用 SaveCachedTexture 存入前端 WASM 编码后的 KTX2 数据。
package app

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
)

// CachedTextureResult 是 GetCachedTexture 的返回值。
type CachedTextureResult struct {
	Format string `json:"format"` // "ktx2" | "png"
	Data   string `json:"data"`   // base64 编码的纹理数据
	Hash   string `json:"hash"`   // 纹理内容的 SHA256
}

// GetCachedTexture 读取纹理文件，计算内容哈希，检查 KTX2 缓存。
// 缓存命中时 Format="ktx2" Data=KTX2 base64；未命中时 Format="png" Data=PNG base64。
// 前端可根据 Format 决定使用 KTX2Loader 还是 TextureLoader。
func (a *App) GetCachedTexture(path string) (CachedTextureResult, error) {
	// 路径守卫：Wails binding 可被前端传入任意路径，须限制在合法仓库根内
	// （与 ReadFileBytes/AnalyzeBedrockModel 对齐 isPathInRootOrSelf）
	if !a.isPathInRootOrSelf(path) {
		return CachedTextureResult{}, fmt.Errorf("路径超出仓库目录")
	}
	// 计算内容哈希（基于文件内容，非路径）
	hash, err := texture_cache.TextureHash(path)
	if err != nil {
		return CachedTextureResult{}, err
	}

	// 检查 KTX2 缓存
	ktxData, ok, err := texture_cache.ReadCached(hash)
	if err != nil {
		// 缓存读取出错不阻断，降级为 PNG
		return readWithHash(path, hash)
	}
	if ok {
		return CachedTextureResult{
			Format: "ktx2",
			Data:   base64.StdEncoding.EncodeToString(ktxData),
			Hash:   hash,
		}, nil
	}

	// 缓存未命中，返回 PNG
	return readWithHash(path, hash)
}

// readWithHash 读取原始纹理文件并以 PNG 格式返回。
// 注意：路径守卫由调用方（GetCachedTexture）负责，本函数为内部辅助。
func readWithHash(path string, hash string) (CachedTextureResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return CachedTextureResult{}, err
	}
	return CachedTextureResult{
		Format: "png",
		Data:   base64.StdEncoding.EncodeToString(data),
		Hash:   hash,
	}, nil
}

// SaveCachedTexture 保存前端 WASM 编码后的 KTX2 数据到缓存。
// hash 是 GetCachedTexture 返回的 Hash 值，data 是 KTX2 字节的 base64。
func (a *App) SaveCachedTexture(hash string, b64Data string) error {
	data, err := fsutil.DecodeBase64Limited(b64Data, types.MaxReadLimit)
	if err != nil {
		return err
	}
	return texture_cache.WriteCached(hash, data)
}

// Deprecated: 前端已迁移统一入口（前端 0 消费），保留仅为兼容旧绑定面；待发版清理。
// ClearTextureCache 清空纹理缓存（用户主动清理用）。
func (a *App) ClearTextureCache() error {
	return texture_cache.ClearCache()
}

// HasCachedTexture 检查指定纹理的内容哈希是否已有 KTX2 缓存。
func (a *App) HasCachedTexture(hash string) (bool, error) {
	return texture_cache.HasCached(hash)
}

// GetCachedTextureByHash 通过哈希直接读取 KTX2 缓存（不读取原始文件，轻量操作）。
// hash 由前端从已读纹理数据计算 SHA256 得到。
// 返回 base64 编码的 KTX2 数据；缓存未命中时返回空字符串。
func (a *App) GetCachedTextureByHash(hash string) (string, error) {
	data, ok, err := texture_cache.ReadCached(hash)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", nil // 缓存未命中，返回空字符串
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// HasCachedTextures 批量检查多个哈希是否已有 KTX2 缓存。
// 一次 RPC 返回所有检查结果，map[hash] → 是否存在。
// 检查出错（IO/权限等，非「未命中」）时：记录日志 + 该 hash 置 false（视为未命中，
// 前端安全回退 PNG 解码），不让错误静默丢失（Go AGENTS「错误不要丢」）。
// 修复前 err 时静默跳过该 hash，前端读缺失 key 当「未缓存」，错误完全无留痕。
func (a *App) HasCachedTextures(hashes []string) map[string]bool {
	result := make(map[string]bool, len(hashes))
	for _, h := range hashes {
		ok, err := texture_cache.HasCached(h)
		if err != nil {
			log.Printf("[texture_cache] 检查缓存 %s 失败: %v", h, err)
			result[h] = false // 查询失败视为未命中，前端安全回退
			continue
		}
		result[h] = ok
	}
	return result
}
