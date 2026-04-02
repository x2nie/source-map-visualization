import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

function uglifyBrowserPlugin() {
	const virtualId = "virtual:uglify-js-browser";
	const resolvedVirtualId = "\0" + virtualId;

	return {
		name: "uglify-js-browser-runtime",
		resolveId(id) {
			if (id === virtualId) {
				return resolvedVirtualId;
			}
			return null;
		},
		load(id) {
			if (id !== resolvedVirtualId) {
				return null;
			}

			const files = [
				"uglify-js/lib/utils.js",
				"uglify-js/lib/ast.js",
				"uglify-js/lib/parse.js",
				"uglify-js/lib/transform.js",
				"uglify-js/lib/scope.js",
				"uglify-js/lib/output.js",
				"uglify-js/lib/compress.js",
				"uglify-js/lib/sourcemap.js",
				"uglify-js/lib/mozilla-ast.js",
			].map((file) => {
				const resolved = require.resolve(file);
				return fs.readFileSync(resolved, "utf8");
			});

			return [
				'import * as SourceMapLibrary from "source-map";',
				"const exports = {};",
				"const module = { exports };",
				'const require = (id) => {',
				'  if (id === "source-map") return SourceMapLibrary;',
				'  if (id === "module") return module;',
				'  throw new Error("Unsupported browser require: " + id);',
				"};",
				files.join("\n\n"),
				"const UglifyBrowser = {",
				"  defaults,",
				"  parse,",
				"  Compressor,",
				"  SourceMap,",
				"  merge,",
				"  OutputStream,",
				"};",
				"export default UglifyBrowser;",
			].join("\n");
		},
	};
}

export default defineConfig({
	build: {
		outDir: "build",
		emptyOutDir: true,
		sourcemap: true,
	},
	plugins: [uglifyBrowserPlugin()],
	resolve: {
		alias: {
			"source-map": path.resolve("node_modules/source-map/source-map.js"),
		},
	},
});
