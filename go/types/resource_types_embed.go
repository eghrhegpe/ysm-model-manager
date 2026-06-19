// Code generated from resource_types.json; DO NOT EDIT.

package types

// embeddedRegistryJSON contains the compiled resource_types.json data.
// Used as fallback when the external file is not found at runtime.
var embeddedRegistryJSON = []byte(`{
  "resourceTypes": [
    {
      "id": "resourcepack",
      "name": "资源包",
      "icon": "🎨",
      "extensions": [".zip"],
      "storageSubDir": "resourcepacks",
      "configField": "ResourcepackRoot",
      "installDir": "resourcepacks/",
      "scanDir": "resourcepacks",
      "instanceLevel": false,
      "preview": "thumbnail",
      "detector": "mcmeta",
      "actions": ["import", "toggle", "delete", "openFolder"]
    },
    {
      "id": "shaderpack",
      "name": "光影包",
      "icon": "☀️",
      "extensions": [".zip"],
      "storageSubDir": "shaderpacks",
      "configField": "ShaderpackRoot",
      "installDir": "shaderpacks/",
      "scanDir": "shaderpacks",
      "instanceLevel": false,
      "preview": "thumbnail",
      "detector": "shader",
      "actions": ["import", "toggle", "delete", "openFolder"]
    },
    {
      "id": "ysm",
      "name": "YSM 模型",
      "icon": "💎",
      "extensions": [".ysm", ".zip", ".7z", ".json"],
      "storageSubDir": "ysm",
      "configField": "YsmRoot",
      "installDir": "versions/{instance}/ysm/",
      "scanDir": "config/yes_steve_model/custom",
      "instanceLevel": true,
      "preview": "3d",
      "detector": "ysm",
      "actions": ["view", "import", "delete"]
    },
    {
      "id": "create-blueprint",
      "name": "蓝图",
      "icon": "⚙️",
      "extensions": [".nbt", ".schematic"],
      "storageSubDir": "create-blueprint",
      "configField": "SchematicRoot",
      "installDir": "schematics/",
      "scanDir": "schematics",
      "instanceLevel": false,
      "preview": "none",
      "detector": "extension",
      "actions": ["import", "delete", "openFolder"]
    },
    {
      "id": "litematic",
      "name": "投影",
      "icon": "📐",
      "extensions": [".litematic"],
      "storageSubDir": "litematics",
      "configField": "LitematicRoot",
      "installDir": "schematics/",
      "scanDir": "schematics",
      "instanceLevel": false,
      "preview": "3d",
      "detector": "extension",
      "actions": ["import", "delete", "openFolder"]
    },
    {
      "id": "mmd-skin",
      "name": "MMD 角色模型",
      "icon": "🎭",
      "extensions": [".pmx", ".pmd"],
      "storageSubDir": "mmd",
      "configField": "MmdRoot",
      "installDir": "3d-skin/EntityPlayer/",
      "scanDir": "3d-skin/EntityPlayer",
      "instanceLevel": false,
      "preview": "none",
      "detector": "extension",
      "isDir": true,
      "actions": ["import", "delete", "openFolder"]
    },
    {
      "id": "vrchat-avatar",
      "name": "VRChat 模型",
      "icon": "🥽",
      "extensions": [".vrca", ".vrm"],
      "storageSubDir": "vrchat",
      "configField": "VrcRoot",
      "configFallback": "MmdRoot",
      "installDir": "vrchat-avatars/",
      "scanDir": "vrchat-avatars",
      "instanceLevel": false,
      "preview": "none",
      "detector": "extension",
      "isDir": true,
      "actions": ["import", "delete", "openFolder"]
    }
  ]
}`)
