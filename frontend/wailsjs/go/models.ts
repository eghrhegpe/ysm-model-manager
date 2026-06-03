export namespace types {
	
	export class AppConfig {
	    repoRoot: string;
	    mcRoot: string;
	    linkMode: string;
	
	    static createFrom(source: any = {}) {
	        return new AppConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repoRoot = source["repoRoot"];
	        this.mcRoot = source["mcRoot"];
	        this.linkMode = source["linkMode"];
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

}

export namespace ysm {
	
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

}

