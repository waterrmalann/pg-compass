import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerAppImage } from "@reforged/maker-appimage";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    // node-pty's native addon (and macOS spawn-helper) cannot load from
    // inside the archive; node-pty resolves the unpacked copy itself.
    asar: { unpack: "**/node_modules/node-pty/**" },
    icon: "./resources/icon",
    executableName: "pg-compass",
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: "PGCompass" }),
    new MakerZIP({}, ["darwin"]),
    new MakerDeb({ options: { bin: "pg-compass" } }),
    new MakerAppImage({ options: { bin: "pg-compass" } }),
  ],
  hooks: {
    packageAfterPrune: async (_config, buildPath) => {
      // https://github.com/electron/forge/issues/3738
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const { execSync } = await import("node:child_process");

      const pkgPath = path.join(buildPath, "package.json");

      console.log(pkgPath);
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));

      // Remove workspace deps that break npm
      delete pkg.devDependencies;

      // Only keep runtime deps
      pkg.dependencies = {
        pg: pkg.dependencies?.pg,
        "electron-store": pkg.dependencies?.["electron-store"],
        "node-pty": pkg.dependencies?.["node-pty"],
      };

      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

      // Install only the runtime deps into the packaged node_modules
      execSync("npm install --omit=dev --no-package-lock", {
        cwd: buildPath,
        stdio: "inherit",
      });
    },
  },
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
