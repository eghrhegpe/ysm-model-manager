package litematic

import (
	"hash/fnv"
	"strings"
)

// MapColor 返回 minecraft 方块名对应的近似十六进制颜色。
// 常见方块有预定义映射，未知方块使用确定性哈希生成 HSL 颜色。
func MapColor(blockName string) string {
	name := blockName
	if idx := strings.Index(name, ":"); idx >= 0 {
		name = name[idx+1:]
	}

	if color, ok := blockColorMap[name]; ok {
		return color
	}

	// 模糊匹配：尝试匹配前缀（如 "oak_stairs" 匹配 "oak_planks" 的颜色）
	if color := fuzzyMatch(name); color != "" {
		return color
	}

	// 哈希回退：确定性 HSL(h, 50%, 60%)
	return hashColor(name)
}

// fuzzyMatch 尝试用名称前缀匹配已知颜色
func fuzzyMatch(name string) string {
	// 检查是否以已知材料名结尾（如 "stone_bricks" → "stone"）
	parts := strings.Split(name, "_")
	for n := len(parts); n >= 1; n-- {
		prefix := strings.Join(parts[:n], "_")
		if color, ok := blockColorMap[prefix]; ok {
			return color
		}
	}
	// 尝试去掉后缀（如 "oak_stairs" → "oak_planks"）
	for _, suffix := range []string{"stairs", "slab", "wall", "fence", "gate", "door", "trapdoor", "button", "pressure_plate"} {
		if strings.HasSuffix(name, "_"+suffix) {
			base := strings.TrimSuffix(name, "_"+suffix)
			if color := fuzzyMatch(base); color != "" {
				return color
			}
		}
	}
	return ""
}

// hashColor 对名称做哈希，生成一致的 HSL 颜色（饱和度 50%，亮度 60%）
func hashColor(name string) string {
	h := fnv.New32a()
	h.Write([]byte(name))
	hash := h.Sum32()
	hue := int(hash % 360)
	return hslToHex(hue, 50, 60)
}

// hslToHex 将 HSL 转为十六进制颜色字符串
func hslToHex(h, s, l int) string {
	hf := float64(h) / 360.0
	sf := float64(s) / 100.0
	lf := float64(l) / 100.0

	var r, g, b float64
	if sf == 0 {
		r, g, b = lf, lf, lf
	} else {
		var q float64
		if lf < 0.5 {
			q = lf * (1 + sf)
		} else {
			q = lf + sf - lf*sf
		}
		p := 2*lf - q
		r = hueToRgb(p, q, hf+1.0/3.0)
		g = hueToRgb(p, q, hf)
		b = hueToRgb(p, q, hf-1.0/3.0)
	}

	ri := int(r*255 + 0.5)
	gi := int(g*255 + 0.5)
	bi := int(b*255 + 0.5)
	return rgbToHex(ri, gi, bi)
}

func hueToRgb(p, q, t float64) float64 {
	if t < 0 {
		t += 1
	}
	if t > 1 {
		t -= 1
	}
	if t < 1.0/6.0 {
		return p + (q-p)*6*t
	}
	if t < 0.5 {
		return q
	}
	if t < 2.0/3.0 {
		return p + (q-p)*(2.0/3.0-t)*6
	}
	return p
}

func rgbToHex(r, g, b int) string {
	clamp := func(v int) int {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return v
	}
	r = clamp(r)
	g = clamp(g)
	b = clamp(b)
	hex := []byte{'#',
		hexChar(r >> 4), hexChar(r & 0xF),
		hexChar(g >> 4), hexChar(g & 0xF),
		hexChar(b >> 4), hexChar(b & 0xF),
	}
	return string(hex)
}

func hexChar(n int) byte {
	if n < 10 {
		return byte('0' + n)
	}
	return byte('a' + n - 10)
}

// blockColorMap 常用 Minecraft 方块 → 近似颜色
var blockColorMap = map[string]string{
	// Stone & variants
	"stone":          "#7F7F7F",
	"granite":        "#9F6B4A",
	"diorite":        "#CBCBCB",
	"andesite":       "#868788",
	"cobblestone":    "#6F6F6F",
	"mossy_cobblestone": "#5D6E45",
	"stone_bricks":   "#7A7A7A",
	"cracked_stone_bricks": "#767676",
	"mossy_stone_bricks": "#636E4A",
	"chiseled_stone_bricks": "#7C7C7C",
	"smooth_stone":   "#A6A6A6",
	"bedrock":        "#404040",
	"obsidian":       "#1A1024",
	"crying_obsidian": "#1E1236",

	// Dirt & grass
	"dirt":                 "#9B6B3D",
	"coarse_dirt":          "#8C6137",
	"podzol":               "#5D3C1E",
	"rooted_dirt":          "#8F6B48",
	"grass_block":          "#7C9E4C",
	"mycelium":             "#6F6478",
	"farmland":             "#735E3C",
	"dirt_path":            "#907A48",
	"mud":                  "#3E3835",
	"packed_mud":           "#9A8B6E",
	"mud_bricks":           "#938261",
	"clay":                 "#9DA4B2",

	// Sand & sandstone
	"sand":           "#DFD3A8",
	"red_sand":       "#C16C33",
	"sandstone":      "#D8CCA5",
	"red_sandstone":  "#B65423",
	"gravel":         "#807F7D",

	// Wood (planks)
	"oak_planks":     "#BA8E4A",
	"spruce_planks":  "#735C3C",
	"birch_planks":   "#D9CB9E",
	"jungle_planks":  "#A57A5A",
	"acacia_planks":  "#B05C38",
	"dark_oak_planks": "#3C2D1F",
	"mangrove_planks": "#732E38",
	"cherry_planks":  "#DEB3B6",
	"bamboo_planks":  "#C5B94A",
	"crimson_planks": "#643A54",
	"warped_planks":  "#2D7064",

	// Logs
	"oak_log":        "#8E7B56",
	"spruce_log":     "#4A3928",
	"birch_log":      "#D9D0B8",
	"jungle_log":     "#6E592B",
	"acacia_log":     "#6B6B6B",
	"dark_oak_log":   "#302416",
	"mangrove_log":   "#632E1F",
	"cherry_log":     "#3B2B24",
	"bamboo_block":   "#8EA849",
	"crimson_stem":   "#805969",
	"warped_stem":    "#41897C",

	// Leaves
	"oak_leaves":     "#4C8E2E",
	"spruce_leaves":  "#34661C",
	"birch_leaves":   "#528C38",
	"jungle_leaves":  "#3E731C",
	"acacia_leaves":  "#5D8623",
	"dark_oak_leaves":"#406E23",
	"mangrove_leaves":"#5E9234",
	"cherry_leaves":  "#E3909D",

	// Ores
	"coal_ore":       "#6B6B6B",
	"iron_ore":       "#C6A28B",
	"copper_ore":     "#C3744F",
	"gold_ore":       "#D0AA37",
	"redstone_ore":   "#B52B24",
	"lapis_ore":      "#254D9E",
	"diamond_ore":    "#6FE0DF",
	"emerald_ore":    "#2DB74B",
	"deepslate_coal_ore":   "#4F4F4F",
	"deepslate_iron_ore":   "#867664",
	"deepslate_copper_ore": "#8B5A41",
	"deepslate_gold_ore":   "#90813A",
	"deepslate_redstone_ore": "#73201C",
	"deepslate_lapis_ore":  "#1F3270",
	"deepslate_diamond_ore":"#52B3B2",
	"deepslate_emerald_ore":"#268C3E",

	// Mineral blocks
	"coal_block":     "#343434",
	"iron_block":     "#D8D8D8",
	"copper_block":   "#D0734B",
	"gold_block":     "#F9E14B",
	"redstone_block": "#B5121C",
	"lapis_block":    "#1947AF",
	"diamond_block":  "#5DE5E5",
	"emerald_block":  "#2DE06B",
	"netherite_block":"#44342B",
	"quartz_block":   "#E6DEC9",
	"amethyst_block": "#9A5CC7",

	// Concrete
	"white_concrete":  "#D0D5D9",
	"orange_concrete": "#DF6200",
	"magenta_concrete":"#C44D9D",
	"light_blue_concrete":"#2A93CD",
	"yellow_concrete": "#F1B021",
	"lime_concrete":   "#60B91C",
	"pink_concrete":   "#D47489",
	"gray_concrete":   "#3E4147",
	"light_gray_concrete":"#828282",
	"cyan_concrete":   "#157788",
	"purple_concrete": "#7B2EAE",
	"blue_concrete":   "#2D3291",
	"brown_concrete":  "#5F453B",
	"green_concrete":  "#4B572B",
	"red_concrete":    "#932922",
	"black_concrete":  "#0F1117",

	// Wool
	"white_wool":   "#EAEAEC",
	"orange_wool":  "#F07F1E",
	"magenta_wool": "#C0508A",
	"light_blue_wool":"#6A9ECF",
	"yellow_wool":  "#F9C930",
	"lime_wool":    "#6FB91A",
	"pink_wool":    "#F0A2B1",
	"gray_wool":    "#404449",
	"light_gray_wool":"#909090",
	"cyan_wool":    "#16838A",
	"purple_wool":  "#7E32B3",
	"blue_wool":    "#323590",
	"brown_wool":   "#664B38",
	"green_wool":   "#4C5427",
	"red_wool":     "#9D2E29",
	"black_wool":   "#14161B",

	// Terracotta
	"terracotta":         "#985F45",
	"white_terracotta":   "#C3BDB7",
	"orange_terracotta":  "#A27332",
	"magenta_terracotta": "#915763",
	"light_blue_terracotta":"#706A8A",
	"yellow_terracotta":  "#B99033",
	"lime_terracotta":    "#6E7537",
	"pink_terracotta":    "#A1706C",
	"gray_terracotta":    "#3E2E2A",
	"light_gray_terracotta":"#81746A",
	"cyan_terracotta":    "#585B59",
	"purple_terracotta":  "#704670",
	"blue_terracotta":    "#494B6B",
	"brown_terracotta":   "#4D332E",
	"green_terracotta":   "#4A5131",
	"red_terracotta":     "#90533E",
	"black_terracotta":   "#261D1A",

	// Glass
	"glass":          "#BFD9EF",
	"tinted_glass":   "#474D52",
	"white_stained_glass":"#D0D5D9",
	"orange_stained_glass":"#DF6200",
	// ... (其余染色玻璃用 concrete 颜色近似)

	// Bricks & building
	"bricks":         "#9E5E44",
	"polished_granite":"#A06E54",
	"polished_diorite":"#D0D0D0",
	"polished_andesite":"#9A9A9A",
	"polished_deepslate":"#37383B",
	"deepslate":         "#4F4E52",
	"deepslate_bricks":  "#41424A",
	"deepslate_tiles":   "#3C3D45",
	"tuff":              "#5F645A",
	"calcite":           "#D9D7CF",
	"dripstone_block":   "#8E7051",
	"pointed_dripstone":"#837355",
	"basalt":            "#484A4C",
	"smooth_basalt":     "#4E4F51",
	"blackstone":        "#2D2C33",
	"gilded_blackstone": "#47382C",
	"polished_blackstone":"#34333C",
	"netherrack":        "#6F3236",
	"crimson_nylium":    "#78252B",
	"warped_nylium":     "#176153",
	"nether_bricks":     "#381D20",
	"red_nether_bricks": "#4C1C1F",
	"soul_sand":         "#453326",
	"soul_soil":         "#4D3C2D",
	"magma_block":       "#CF5300",
	"glowstone":         "#C4B168",
	"shroomlight":       "#F0AF4A",
	"sea_lantern":       "#8CC7B3",
	"prismarine":        "#64A396",
	"prismarine_bricks": "#62AA99",
	"dark_prismarine":   "#385B4C",
	"end_stone":         "#D9D7A2",
	"end_stone_bricks":  "#D3D1A0",
	"purpur_block":      "#A87DA8",
	"purpur_pillar":     "#A67BA6",
	"bookshelf":         "#A07448",

	// Water & lava
	"water":    "#3F76E4",
	"lava":     "#CF5300",
	"ice":      "#92B9FC",
	"packed_ice":"#8BB3F0",
	"blue_ice": "#749AF0",
	"snow":     "#F0F8FF",
	"snow_block":"#F9FDFF",

	// Vegetation
	"grass":             "#568C30",
	"tall_grass":        "#48752E",
	"fern":              "#48752E",
	"dead_bush":         "#735E3C",
	"vine":              "#3D6B24",
	"lily_pad":          "#3A7728",
	"cactus":            "#527A38",
	"sugar_cane":        "#81A54A",
	"bamboo":            "#547A28",
	"wheat":             "#889E41",
	"carrots":           "#889E41",
	"potatoes":          "#889E41",
	"beetroots":         "#5E8230",
	"melon":             "#84A124",
	"pumpkin":           "#D08E31",
	"hay_block":         "#A38F2F",
	"moss_block":        "#506E30",
	"moss_carpet":       "#577A31",
	"azalea":            "#5A7A34",
	"flowering_azalea":  "#866B9C",
	"spore_blossom":     "#D87A9C",
	"big_dripleaf":      "#5C824B",
	"small_dripleaf":    "#598241",

	// Flowers & decor
	"dandelion":         "#F4D031",
	"poppy":             "#DA2417",
	"blue_orchid":       "#7CC6EF",
	"allium":            "#C26BC6",
	"azure_bluet":       "#DCE0D4",
	"red_tulip":         "#D63223",
	"orange_tulip":      "#E38B23",
	"white_tulip":       "#F0F0F0",
	"pink_tulip":        "#F2B2CC",
	"oxeye_daisy":       "#EAE4B4",
	"cornflower":        "#5893D4",
	"lily_of_the_valley":"#F4F4F4",
	"wither_rose":       "#202020",
	"sunflower":         "#F2D031",
	"lilac":             "#D999CC",
	"rose_bush":         "#C94438",
	"peony":             "#E88EBD",
	"torchflower":       "#D96E45",

	// Redstone components
	"redstone_wire":       "#BB1212",
	"redstone_torch":      "#BB1212",
	"repeater":            "#7A9292",
	"comparator":          "#7A9292",
	"piston":              "#8C8A6E",
	"sticky_piston":       "#7AA36E",
	"observer":            "#7B7B7B",
	"dropper":             "#787878",
	"dispenser":           "#787878",
	"hopper":              "#696969",
	"note_block":          "#795D40",
	"jukebox":             "#7F513F",
	"target":              "#BDB9AB",
	"lightning_rod":       "#BA8053",
	"sculk_sensor":        "#0C283F",
	"calibrated_sculk_sensor":"#0C2A42",

	// Rails
	"rail":            "#B5A562",
	"powered_rail":    "#C3A534",
	"detector_rail":   "#9E9292",
	"activator_rail":  "#B5A562",

	// Utility
	"crafting_table":  "#8E6F45",
	"furnace":         "#7F7F7F",
	"smoker":          "#73655A",
	"blast_furnace":   "#5F5F5F",
	"chest":           "#AE8B56",
	"ender_chest":     "#23585A",
	"barrel":          "#7E6643",
	"shulker_box":     "#975B79",
	"enchanting_table":"#612320",
	"anvil":           "#4D4D4D",
	"brewing_stand":   "#9F9F94",
	"cauldron":        "#474747",
	"beacon":          "#5DEAE3",
	"conduit":         "#6B5E44",
	"lodestone":       "#8C8B8F",
	"respawn_anchor":  "#2E1E2A",
	"bell":            "#C09A3B",
	"loom":            "#7E6543",
	"grindstone":      "#838383",
	"stonecutter":     "#838383",
	"cartography_table":"#8E6F45",
	"fletching_table": "#AE8B56",
	"smithing_table":  "#4C4C4C",
	"lectern":         "#8E6F45",
	"composter":       "#7E5E3D",

	// Air / barrier
	"air":       "",
	"cave_air":  "",
	"void_air":  "",
	"barrier":   "#CC3333",
	"light":     "#FFFF99",
	"structure_void":"#CC3333",

	// Spawner / command
	"spawner":          "#182B3E",
	"command_block":    "#BE8A6B",
	"chain_command_block":"#97BBA0",
	"repeating_command_block":"#9999BE",

	// Copper family (oxidized variants)
	"exposed_copper":   "#A58C73",
	"weathered_copper": "#718A66",
	"oxidized_copper":  "#4DA69F",
	"cut_copper":       "#C5734B",
	"exposed_cut_copper":"#A58C73",
	"weathered_cut_copper":"#718A66",
	"oxidized_cut_copper":"#4DA69F",

	// Froglights
	"ochre_froglight": "#E8C970",
	"pearlescent_froglight":"#C5AFC9",
	"verdant_froglight":"#557E3E",

	// Nether wood variant blocks
	"crimson_hyphae": "#643A54",
	"warped_hyphae":  "#2D7064",

	// Mangrove / cherry / bamboo variants (simplified)
	"mangrove_roots": "#632E1F",
	"muddy_mangrove_roots":"#4A382D",
}
