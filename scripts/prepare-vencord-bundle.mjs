import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const source = process.env.VENCORD_DIST
    ? resolve(process.env.VENCORD_DIST)
    : join(process.env.USERPROFILE ?? "", "Vencord", "dist");
const sourceRoot = resolve(source, "..");
const destination = resolve("src-tauri", "resources", "vencord-dist");

const runtimeFiles = [
    "patcher.js",
    "preload.js",
    "renderer.css",
    "renderer.js",
    "vencordDesktopMain.js",
    "vencordDesktopPreload.js",
    "vencordDesktopRenderer.css",
    "vencordDesktopRenderer.js",
];

for (const file of runtimeFiles) {
    if (!existsSync(join(source, file))) {
        throw new Error(`Build do Vencord ausente: ${join(source, file)}`);
    }
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });

for (const file of runtimeFiles) {
    copyFileSync(join(source, file), join(destination, file));
}

const license = join(sourceRoot, "LICENSE");
if (existsSync(license)) copyFileSync(license, join(destination, "LICENSE-VENCORD.txt"));

writeFileSync(
    join(destination, "SOURCE.txt"),
    [
        "This bundle contains a modified Vencord build with the Telinha userplugin.",
        "Vencord is licensed under GPL-3.0-or-later.",
        "Corresponding source: https://github.com/llorenzocardoso/telinha",
        "Upstream source: https://github.com/Vendicated/Vencord",
        "",
    ].join("\n"),
);

console.log(`Vencord bundle prepared from ${source}`);
