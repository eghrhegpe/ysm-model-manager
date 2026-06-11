export namespace main {
	
	export class DownloadTask {
	    url: string;
	    saveDir: string;
	    name: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new DownloadTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.saveDir = source["saveDir"];
	        this.name = source["name"];
	        this.size = source["size"];
	    }
	}

}

export namespace types {
	
	export class AppConfig {
	    repoRoot: string;
	    mcRoot: string;
	    linkMode: string;
	    theme: string;
	    mirror: string;
	
	    static createFrom(source: any = {}) {
	        return new AppConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repoRoot = source["repoRoot"];
	        this.mcRoot = source["mcRoot"];
	        this.linkMode = source["linkMode"];
	        this.theme = source["theme"];
	        this.mirror = source["mirror"];
	    }
	}
	export class AuthorInfo {
	    Name: string;
	    Count: number;
	
	    static createFrom(source: any = {}) {
	        return new AuthorInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Count = source["Count"];
	    }
	}
	export class Cube2D {
	    origin: number[];
	    size: number[];
	    pivot?: number[];
	    uv?: number[];
	    faceUV?: string;
	    rotation?: number[];
	
	    static createFrom(source: any = {}) {
	        return new Cube2D(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.origin = source["origin"];
	        this.size = source["size"];
	        this.pivot = source["pivot"];
	        this.uv = source["uv"];
	        this.faceUV = source["faceUV"];
	        this.rotation = source["rotation"];
	    }
	}
	export class Bone2D {
	    name: string;
	    parent?: string;
	    pivot?: number[];
	    rotation?: number[];
	    cubes: Cube2D[];
	
	    static createFrom(source: any = {}) {
	        return new Bone2D(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.parent = source["parent"];
	        this.pivot = source["pivot"];
	        this.rotation = source["rotation"];
	        this.cubes = this.convertValues(source["cubes"], Cube2D);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BedrockModel {
	    boneCount: number;
	    cubeCount: number;
	    texture?: string;
	    textures?: string[];
	    format?: string;
	    texWidth?: number;
	    texHeight?: number;
	    bones?: Bone2D[];
	    animations?: string[];
	
	    static createFrom(source: any = {}) {
	        return new BedrockModel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.boneCount = source["boneCount"];
	        this.cubeCount = source["cubeCount"];
	        this.texture = source["texture"];
	        this.textures = source["textures"];
	        this.format = source["format"];
	        this.texWidth = source["texWidth"];
	        this.texHeight = source["texHeight"];
	        this.bones = this.convertValues(source["bones"], Bone2D);
	        this.animations = source["animations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class CustomFileInfo {
	    Name: string;
	    LinkType: string;
	
	    static createFrom(source: any = {}) {
	        return new CustomFileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.LinkType = source["LinkType"];
	    }
	}
	export class ImportLog {
	    ModelName: string;
	    SourcePath: string;
	    TargetDir: string;
	    FileSize: number;
	    Status: string;
	    ErrorMsg?: string;
	    Timestamp: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ModelName = source["ModelName"];
	        this.SourcePath = source["SourcePath"];
	        this.TargetDir = source["TargetDir"];
	        this.FileSize = source["FileSize"];
	        this.Status = source["Status"];
	        this.ErrorMsg = source["ErrorMsg"];
	        this.Timestamp = source["Timestamp"];
	    }
	}
	export class InstanceStatus {
	    Name: string;
	    CustomDir: string;
	    Status: string;
	    Missing: string[];
	    Extra: string[];
	    Disabled: string[];
	    HasYSM: boolean;
	    Files: CustomFileInfo[];
	
	    static createFrom(source: any = {}) {
	        return new InstanceStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.CustomDir = source["CustomDir"];
	        this.Status = source["Status"];
	        this.Missing = source["Missing"];
	        this.Extra = source["Extra"];
	        this.Disabled = source["Disabled"];
	        this.HasYSM = source["HasYSM"];
	        this.Files = this.convertValues(source["Files"], CustomFileInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ModelEntry {
	    Name: string;
	    Size: number;
	    Path: string;
	    Ext: string;
	    Hash: string;
	    ModTime: number;
	
	    static createFrom(source: any = {}) {
	        return new ModelEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Size = source["Size"];
	        this.Path = source["Path"];
	        this.Ext = source["Ext"];
	        this.Hash = source["Hash"];
	        this.ModTime = source["ModTime"];
	    }
	}
	export class PackInfo {
	    name: string;
	    description: string;
	    imageBase64?: string;
	
	    static createFrom(source: any = {}) {
	        return new PackInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.imageBase64 = source["imageBase64"];
	    }
	}
	export class SearchResult {
	    name: string;
	    path: string;
	    boneCount: number;
	    cubeCount: number;
	    texWidth: number;
	    texHeight: number;
	    hasError: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.boneCount = source["boneCount"];
	        this.cubeCount = source["cubeCount"];
	        this.texWidth = source["texWidth"];
	        this.texHeight = source["texHeight"];
	        this.hasError = source["hasError"];
	    }
	}
	export class VersionInstance {
	    Name: string;
	    VersionDir: string;
	    CustomDir: string;
	    Exists: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VersionInstance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.VersionDir = source["VersionDir"];
	        this.CustomDir = source["CustomDir"];
	        this.Exists = source["Exists"];
	    }
	}
	export class WindowState {
	    x: number;
	    y: number;
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new WindowState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class WorkshopCreator {
	    name: string;
	    desc: string;
	    type?: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopCreator(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.desc = source["desc"];
	        this.type = source["type"];
	    }
	}
	export class WorkshopPresetSearch {
	    label: string;
	    q: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopPresetSearch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.q = source["q"];
	    }
	}
	export class WorkshopSite {
	    id: string;
	    icon: string;
	    label: string;
	    url: string;
	    desc: string;
	    group: string;
	    searchUrl?: string;
	    presetSearches?: WorkshopPresetSearch[];
	
	    static createFrom(source: any = {}) {
	        return new WorkshopSite(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.icon = source["icon"];
	        this.label = source["label"];
	        this.url = source["url"];
	        this.desc = source["desc"];
	        this.group = source["group"];
	        this.searchUrl = source["searchUrl"];
	        this.presetSearches = this.convertValues(source["presetSearches"], WorkshopPresetSearch);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace updater {
	
	export class UpdateInfo {
	    available: boolean;
	    latest: string;
	    current: string;
	    url: string;
	    releaseNotes?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.latest = source["latest"];
	        this.current = source["current"];
	        this.url = source["url"];
	        this.releaseNotes = source["releaseNotes"];
	    }
	}

}

export namespace ysm {
	
	export class AnimGroup {
	    id: string;
	    name: string;
	    items: string[];
	
	    static createFrom(source: any = {}) {
	        return new AnimGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.items = source["items"];
	    }
	}
	export class Author {
	    name: string;
	    roles?: string;
	    bilibili?: string;
	
	    static createFrom(source: any = {}) {
	        return new Author(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.roles = source["roles"];
	        this.bilibili = source["bilibili"];
	    }
	}
	export class ConfigMenu {
	    id: string;
	    name: string;
	    controls: string[];
	
	    static createFrom(source: any = {}) {
	        return new ConfigMenu(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.controls = source["controls"];
	    }
	}
	export class Link {
	    home?: string;
	    donate?: string;
	
	    static createFrom(source: any = {}) {
	        return new Link(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.home = source["home"];
	        this.donate = source["donate"];
	    }
	}
	export class PreviewInfo {
	    defaultTexture?: string;
	    hasGui: boolean;
	    heightScale?: number;
	    widthScale?: number;
	
	    static createFrom(source: any = {}) {
	        return new PreviewInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultTexture = source["defaultTexture"];
	        this.hasGui = source["hasGui"];
	        this.heightScale = source["heightScale"];
	        this.widthScale = source["widthScale"];
	    }
	}
	export class Stats {
	    textures: number;
	    models: number;
	    animations: number;
	    texWidth: number;
	    texHeight: number;
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.textures = source["textures"];
	        this.models = source["models"];
	        this.animations = source["animations"];
	        this.texWidth = source["texWidth"];
	        this.texHeight = source["texHeight"];
	    }
	}
	export class TexInfo {
	    path: string;
	    texWidth: number;
	    texHeight: number;
	
	    static createFrom(source: any = {}) {
	        return new TexInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.texWidth = source["texWidth"];
	        this.texHeight = source["texHeight"];
	    }
	}
	export class YSMHeader {
	    isYsm: boolean;
	    isFree: boolean;
	    hasFree: boolean;
	    hash?: string;
	    name: string;
	    license?: string;
	    authorName?: string;
	    authorRole?: string;
	    authorBilibili?: string;
	    authorAfdian?: string;
	    linkHome?: string;
	    linkUpdate?: string;
	    format?: number;
	    crypto?: number;
	    tips?: string;
	
	    static createFrom(source: any = {}) {
	        return new YSMHeader(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.isYsm = source["isYsm"];
	        this.isFree = source["isFree"];
	        this.hasFree = source["hasFree"];
	        this.hash = source["hash"];
	        this.name = source["name"];
	        this.license = source["license"];
	        this.authorName = source["authorName"];
	        this.authorRole = source["authorRole"];
	        this.authorBilibili = source["authorBilibili"];
	        this.authorAfdian = source["authorAfdian"];
	        this.linkHome = source["linkHome"];
	        this.linkUpdate = source["linkUpdate"];
	        this.format = source["format"];
	        this.crypto = source["crypto"];
	        this.tips = source["tips"];
	    }
	}
	export class YSMModelMeta {
	    name: string;
	    author: string;
	    version: string;
	    bones: number;
	    textures: number;
	    animations: number;
	    vertices: number;
	    faces: number;
	    hasError: boolean;
	    errorMsg?: string;
	
	    static createFrom(source: any = {}) {
	        return new YSMModelMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.author = source["author"];
	        this.version = source["version"];
	        this.bones = source["bones"];
	        this.textures = source["textures"];
	        this.animations = source["animations"];
	        this.vertices = source["vertices"];
	        this.faces = source["faces"];
	        this.hasError = source["hasError"];
	        this.errorMsg = source["errorMsg"];
	    }
	}
	export class YsmSummary {
	    schema: string;
	    source: string;
	    name: string;
	    tips?: string;
	    license?: string;
	    authors?: Author[];
	    links?: Link;
	    spec: number;
	    format: string;
	    size: number;
	    stats: Stats;
	    animGroups?: AnimGroup[];
	    configMenus?: ConfigMenu[];
	    preview: PreviewInfo;
	
	    static createFrom(source: any = {}) {
	        return new YsmSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.source = source["source"];
	        this.name = source["name"];
	        this.tips = source["tips"];
	        this.license = source["license"];
	        this.authors = this.convertValues(source["authors"], Author);
	        this.links = this.convertValues(source["links"], Link);
	        this.spec = source["spec"];
	        this.format = source["format"];
	        this.size = source["size"];
	        this.stats = this.convertValues(source["stats"], Stats);
	        this.animGroups = this.convertValues(source["animGroups"], AnimGroup);
	        this.configMenus = this.convertValues(source["configMenus"], ConfigMenu);
	        this.preview = this.convertValues(source["preview"], PreviewInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

