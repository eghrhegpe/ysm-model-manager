package types

// BedrockModel 基岩版模型几何体摘要（用于 2D 预览）
type BedrockModel struct {
	BoneCount  int       `json:"boneCount"`
	CubeCount  int       `json:"cubeCount"`
	Texture    string    `json:"texture,omitempty"`    // 纹理图 base64 data URI
	Format     string    `json:"format,omitempty"`     // "1.12.0" 等
	TexWidth   int       `json:"texWidth,omitempty"`
	TexHeight  int       `json:"texHeight,omitempty"`
	Bones      []Bone2D  `json:"bones,omitempty"`
}

// Bone2D 骨骼简化信息（只用于 2D 线条图）
type Bone2D struct {
	Name      string    `json:"name"`
	Cubes     []Cube2D  `json:"cubes"`
}

// Cube2D 立方体信息
type Cube2D struct {
	Origin  [3]float64 `json:"origin"`
	Size    [3]float64 `json:"size"`
	Pivot   [3]float64 `json:"pivot,omitempty"`
	UV      [2]float64 `json:"uv,omitempty"`
}
