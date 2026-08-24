import { describe, expect, it } from "vitest";
import type { LauncherInfo } from "../../../../bindings/ysm-model-manager/go/types/models.ts";
import { launcherChoicesOf } from "./path-cards.ts";

describe("launcher detection settings", () => {
  it("exposes only launcher instances with a YSM custom directory", () => {
    const launchers: LauncherInfo[] = [
      {
        type: "pcl",
        name: "PCL",
        root_dir: "C:/Games/.minecraft",
        instances: [
          {
            name: "1.20.1",
            version: "1.20.1",
            path: "C:/Games/.minecraft/versions/1.20.1",
            ysm_custom_dir: "C:/Games/.minecraft/config/yes_steve_model/custom",
            ysm_custom_exists: true,
            ysm_config_files: [],
            launcher_config_files: ["C:/Games/.minecraft/PCL/Setup.ini"],
          },
          {
            name: "empty",
            version: "",
            path: "C:/Games/.minecraft/versions/empty",
            ysm_custom_dir: "",
            ysm_custom_exists: false,
            ysm_config_files: null,
            launcher_config_files: null,
          },
        ],
      },
    ];

    expect(launcherChoicesOf(launchers)).toEqual([
      { launcher: launchers[0], instance: launchers[0].instances![0] },
    ]);
  });
});
