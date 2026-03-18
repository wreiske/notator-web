import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party scripts:
    "public/webaudiofont/**",
    // Auto-generated wasm-bindgen output:
    "lib/son-parser-wasm/**",
    // Electron main/preload (CommonJS, not part of Next.js):
    "electron/**",
  ]),
]);

export default eslintConfig;
