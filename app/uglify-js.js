import UglifyJS from "virtual:uglify-js-browser";

UglifyJS.minify = function(files, options) {
	options = UglifyJS.defaults(options, {
		outSourceMap: null,
		sourceRoot: null,
		warnings: false,
		mangle: {},
		output: null,
		compress: {},
	});
	if (typeof files === "string") {
		files = [files];
	}

	let toplevel = null;
	files.forEach((file) => {
		toplevel = UglifyJS.parse(file, {
			filename: "?",
			toplevel,
		});
	});

	if (options.compress) {
		const compress = { warnings: options.warnings };
		UglifyJS.merge(compress, options.compress);
		toplevel.figure_out_scope();
		const sq = UglifyJS.Compressor(compress);
		toplevel = toplevel.transform(sq);
	}

	if (options.mangle) {
		toplevel.figure_out_scope();
		toplevel.compute_char_frequency();
		toplevel.mangle_names(options.mangle);
	}

	let map = null;
	if (options.outSourceMap) {
		map = UglifyJS.SourceMap({
			file: options.outSourceMap,
			root: options.sourceRoot,
		});
	}
	const output = { source_map: map };
	if (options.output) {
		UglifyJS.merge(output, options.output);
	}
	const stream = UglifyJS.OutputStream(output);
	toplevel.print(stream);
	return {
		code: `${stream}`,
		map: `${map}`,
	};
};

export default UglifyJS;
