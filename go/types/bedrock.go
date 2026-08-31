package types

// BedrockModel 基岩版模型几何体摘要（用于 2D 预览）
type BedrockModel struct {
	BoneCount    int      `json:"boneCount"`
	CubeCount    int      `json:"cubeCount"`
	Texture      string   `json:"texture,omitempty"`      // 纹理图 base64 data URI（单纹理兼容）
	Textures     []string `json:"textures,omitempty"`     // 多纹理 base64 data URI 数组（全量，2D 预览用）
	TextureNames []string `json:"textureNames,omitempty"` // 纹理文件名（去扩展名），与 Textures 同序
	// TextureCategories 纹理分类标记，与 TextureNames 同序同长度。
	// "player" = player.texture[] 声明，可切换皮肤；
	// "projectile" / "vehicle" / "arrow" = 组件专属纹理（不可切换）；
	// "" = 未分类（无 ysm.json 时，前端兜底显示）。
	TextureCategories []string `json:"textureCategories,omitempty"`
	// ComponentTextures 每组件独立纹理（ADR-114 perComponent）。
	// key = 组件源模型名（main/arm/arrow/minecart/boat/foxcar/trident）
	// value = 该组件声明的纹理 base64 data URI 数组（通常 1 张）
	// 3D 渲染用此字段；为空时 fallback 到 Textures[0]。
	ComponentTextures map[string][]string `json:"componentTextures,omitempty"`
	SourceName        string              `json:"sourceName,omitempty"` // 组件源模型文件名（去扩展名，如 main/arm/arrow），UI 组件名用
	Format            string              `json:"format,omitempty"`     // "1.12.0" 等
	TexWidth          int                 `json:"texWidth,omitempty"`
	TexHeight         int                 `json:"texHeight,omitempty"`
	Bones             []Bone2D            `json:"bones,omitempty"`
	Animations        []string            `json:"animations,omitempty"`    // 动画 JSON 字符串数组
	SubModels         []SubModel          `json:"subModels,omitempty"`     // L0/L1 派生的子模型清单（多角色包内切换用）
	Metadata          *YsmMetadata        `json:"metadata,omitempty"`      // ysm.json metadata 段（名称/许可/作者/链接，详情页用）
	FileInventory     *FileInventory      `json:"fileInventory,omitempty"` // zip 内文件归属清单（parseGlobalResources 轻量版，只识别不解析）
}

// FileInventory zip 内文件归属清单（对齐 Modern YSM parseGlobalResources 的分流思想，
// 但只识别归属、不解析内容——不造双路径，前端直接消费准确清单，不再事后按文件名猜）。
type FileInventory struct {
	Animations   []string `json:"animations,omitempty"`   // *.animation.json（真动画文件路径）
	Controllers  []string `json:"controllers,omitempty"`  // *.animation_controller.json（动画控制器）
	LangFiles    []string `json:"langFiles,omitempty"`    // *.lang（本地化资源）
	IncFiles     []string `json:"incFiles,omitempty"`     // *.inc（include 资源）
	LegacyModels []string `json:"legacyModels,omitempty"` // 旧格式几何（main.json/arm.json/arrow.json/info.json，无 ysm.json 场景）
	Avatars      []string `json:"avatars,omitempty"`      // avatar/ 下的图片（作者头像，非主纹理）
	// Truncated 标记 classifyFileInventory 达到 maxClassifyEntries 封顶，
	// 返回的 inventory 不完整。调用方应据此向用户披露「清单可能不全」。
	// R29 code_review P3-1：旧实现静默截断，调用方无法区分完整 vs 截断。
	Truncated bool `json:"truncated,omitempty"`
}

// SubModel 子模型条目（多角色加载）。
// 来源优先级：L0（maid_model.json model[] 权威清单）→ L1（geoFiles 枚举兜底）。
type SubModel struct {
	Name       string `json:"name"`                 // 角色名（L0 直接取自 model[].name；L1 取自 geometry 文件名去后缀）
	SourcePath string `json:"sourcePath,omitempty"` // 条目的 zip 内相对路径（用于精确比对去重）
	TexSlot    int    `json:"texSlot,omitempty"`    // 默认绑定的纹理槽索引（对应 Textures 数组下标）
}

// Bone2D 骨骼简化信息（只用于 2D 线条图）
type Bone2D struct {
	Name     string     `json:"name"`
	Parent   string     `json:"parent,omitempty"`
	Pivot    [3]float64 `json:"pivot,omitempty"`
	Rotation [3]float64 `json:"rotation,omitempty"`
	Cubes    []Cube2D   `json:"cubes"`
	GroupID  string     `json:"groupId,omitempty"` // "player" / "projectile" / "vehicle"
}

// Cube2D 立方体信息
type Cube2D struct {
	Origin   [3]float64 `json:"origin"`
	Size     [3]float64 `json:"size"`
	Pivot    [3]float64 `json:"pivot,omitempty"`
	PivotSet bool       `json:"-"` // pivot 是否显式声明（区分"缺席"与显式 [0,0,0]，防误判为缺失）
	UV       [2]float64 `json:"uv,omitempty"`
	FaceUV   string     `json:"faceUV,omitempty"` // 每面独立 UV（JSON 字符串）
	Rotation [3]float64 `json:"rotation,omitempty"`
	TexSlot  int        `json:"texSlot"`           // 纹理槽（从 cube.texture 解析）
	Inflate  float64    `json:"inflate,omitempty"` // Blockbench 膨胀（正=外扩，负=收缩），渲染时 origin-=i、size+=2i
	Mirror   bool       `json:"mirror,omitempty"`  // Blockbench 镜像（沿 X 翻转几何）
	CubeTexW int        `json:"-"`                 // 来源文件 texture_width，不序列化
	CubeTexH int        `json:"-"`                 // 来源文件 texture_height，不序列化
}

// YsmMetadata ysm.json 的 metadata 段（模型详情：名称/许可/作者/链接）。
// 字段对齐 Modern YSM RawMetadata（RawYsmModel.java L191-208）+ 真实 ysm.json 格式
// （wine_fox：license 为 {type} 对象、authors[].contact 为平台→URL map、authors[].avatar 为路径字符串）。
type YsmMetadata struct {
	Name    string            `json:"name,omitempty"`    // 模型名（如 "Wine Fox（酒狐）"）
	Tips    string            `json:"tips,omitempty"`    // 提示/简介（可含 \n 多行）
	License *YsmLicense       `json:"license,omitempty"` // 许可信息
	Authors []YsmAuthor       `json:"authors,omitempty"` // 作者列表（模型/动画/材质等角色）
	Links   map[string]string `json:"links,omitempty"`   // 附加链接（平台→URL）
}

// YsmLicense 许可信息（wine_fox：{"type": "CC BY-NC-SA 4.0"}）
type YsmLicense struct {
	Type        string `json:"type,omitempty"`
	Description string `json:"description,omitempty"`
}

// YsmAuthor 作者条目
type YsmAuthor struct {
	Name    string            `json:"name,omitempty"`    // 作者名
	Role    string            `json:"role,omitempty"`    // 角色（模型原作/动画原作/材质等）
	Comment string            `json:"comment,omitempty"` // 作者留言
	Avatar  string            `json:"avatar,omitempty"`  // 头像路径（zip 内相对路径，如 avatar/wmdj.jpg）
	Contact map[string]string `json:"contact,omitempty"` // 联系方式（平台→URL，如 Bilibili/Afdian）
}
