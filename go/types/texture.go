// Package types 纹理扩展名单一事实源。
//
// 项目历史上四处消费方各自硬编码纹理扩展名检查，导致口径漂移：
//   - ysm/extracted.go collectTextureFiles 收 .png/.jpg/.tga（漏 .jpeg）
//   - ysm/extracted.go textureDataURI 认 .png/.jpg/.jpeg（不认 .tga——浏览器不解码）
//   - ysm/summary.go 计数 .png/.jpg/.jpeg（漏 .tga）
//   - avatar/avatar_extract.go 降级扫描 .png/.jpg/.jpeg（.tga 不可渲染，正确）
//
// 本文件收敛为单一事实源，分两层：
//   - SupportedTextureExts：所有受支持的纹理文件（含 .tga，用于命名索引/计数）
//   - RenderableTextureExts / TextureMIME：Web 可渲染（.tga 非 Web 格式，浏览器解码器不认）
package types

import "strings"

// SupportedTextureExts 返回项目认可的全部纹理扩展名（小写，含 .tga）。
// 用于文件收集（collectTextureFiles）、命名索引（buildPngNameMap）、
// 纹理计数（scanZipBasicStats）等"文件识别"场景。
//
// 注意：其中 .tga 非 Web 图像格式，浏览器解码器不认；仅用于文件识别/命名索引，
// 不得据此生成 data URI——用 TextureMIME 或 IsRenderableTextureExt 判断。
func SupportedTextureExts() []string {
	return []string{".png", ".jpg", ".jpeg", ".tga"}
}

// RenderableTextureExts 返回 Web 可渲染的纹理扩展名（小写，不含 .tga）。
// 用于头像显示（avatar_extract.go）、data URI 生成等浏览器渲染场景。
func RenderableTextureExts() []string {
	return []string{".png", ".jpg", ".jpeg"}
}

// IsTextureExt 是否为受支持的纹理扩展名（含 .tga）。
// 大小写不敏感（输入已小写化或就地 ToLower）。
func IsTextureExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg", ".tga":
		return true
	}
	return false
}

// IsRenderableTextureExt 是否为 Web 可渲染的纹理扩展名（不含 .tga）。
// 大小写不敏感。
func IsRenderableTextureExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg":
		return true
	}
	return false
}

// TextureMIME 按扩展名返回 Web 可解码的图像 MIME 类型。
// 非渲染格式（.tga 等）返回空串——调用方据此跳过 data URI 生成，
// 落回全局 texArr 路径（避免产出 data:image/png;base64,<TGA 字节> 的坏 URI）。
// 大小写不敏感。
func TextureMIME(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	}
	return ""
}
