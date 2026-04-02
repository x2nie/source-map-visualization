var SourceMap = require("source-map");

var LINESTYLES = 5;
var MAX_LINES = 5000;

function createSparseRows() {
	return [];
}

function ensureContentRow(rows, rowNumber) {
	if(!rows[rowNumber]) {
		rows[rowNumber] = {
			key: "row-" + rowNumber,
			kind: "segments",
			segments: []
		};
	}
	return rows[rowNumber];
}

function pushText(rows, rowNumber, text) {
	var row = ensureContentRow(rows, rowNumber);
	if(typeof text === "undefined" || text === null) return;
	if(text === "") return;
	row.segments.push({
		key: "text-" + rowNumber + "-" + row.segments.length,
		text: text,
		className: "",
		title: "",
		mappingKey: ""
	});
}

function pushSegment(rows, rowNumber, text, options) {
	var row = ensureContentRow(rows, rowNumber);
	if(typeof text === "undefined" || text === null || text === "") return;
	var className = options.generated ? "generated-item" : options.mapping ? "mapping-item" : "original-item";
	className += " style-" + (options.line % LINESTYLES);
	row.segments.push({
		key: "segment-" + rowNumber + "-" + row.segments.length,
		text: text,
		className: className,
		title: options.name || "",
		mappingKey: typeof options.source !== "undefined" ? options.source + ":" + options.line + ":" + options.column : "",
		source: options.source,
		line: options.line,
		column: options.column
	});
}

function pushSourceHeader(rows, rowNumber, source) {
	rows[rowNumber] = {
		key: "source-" + rowNumber + "-" + source,
		kind: "sourceHeader",
		text: source
	};
}

function toDenseRows(rows) {
	var denseRows = [];
	var length = Math.max(rows.length, 1);
	for(var i = 1; i < length; i++) {
		denseRows.push(rows[i] || {
			key: "row-" + i,
			kind: "segments",
			segments: []
		});
	}
	if(denseRows.length === 0) {
		denseRows.push({
			key: "row-empty",
			kind: "segments",
			segments: []
		});
	}
	return denseRows;
}

module.exports = function(map, generatedCode, sources) {
	var generatedSide = createSparseRows();
	var originalSide = createSparseRows();
	var mappingsSide = createSparseRows();

	var mapSources = map.sources;

	var generatedLine = 1;
	var nodes = SourceMap.SourceNode.fromStringWithSourceMap(generatedCode, map).children;
	nodes.forEach(function(item) {
		if(generatedLine > MAX_LINES) return;
		if(typeof item === "string") {
			item.split("\n").forEach(function(line) {
				pushText(generatedSide, generatedLine, line);
				generatedLine++;
			});
			generatedLine--;
		} else {
			var str = item.toString();
			var source = mapSources.indexOf(item.source);
			str.split("\n").forEach(function(line) {
				pushSegment(generatedSide, generatedLine, line, {
					generated: true,
					source: source,
					line: item.line,
					column: item.column,
					name: item.name
				});
				generatedLine++;
			});
			generatedLine--;
		}
	});

	var lastGenLine = 1;
	var lastOrgSource = "";
	var mappingsLine = 1;
	map.eachMapping(function(mapping) {
		if(mapping.generatedLine > MAX_LINES) return;
		while(lastGenLine < mapping.generatedLine) {
			mappingsLine++;
			lastGenLine++;
			pushText(mappingsSide, mappingsLine, lastGenLine + ": ");
		}
		if(typeof mapping.originalLine == "number") {
			if(lastOrgSource !== mapping.source && mapSources.length > 1) {
				pushText(mappingsSide, mappingsLine, "[" + mapping.source + "] ");
				lastOrgSource = mapping.source;
			}
			var source = mapSources.indexOf(mapping.source);
			pushSegment(mappingsSide, mappingsLine, mapping.generatedColumn + "->" + mapping.originalLine + ":" + mapping.originalColumn, {
				mapping: true,
				source: source,
				line: mapping.originalLine,
				column: mapping.originalColumn
			});
		} else {
			pushSegment(mappingsSide, mappingsLine, String(mapping.generatedColumn), {
				mapping: true,
				line: mappingsLine,
				column: mapping.generatedColumn
			});
		}
		pushText(mappingsSide, mappingsLine, "  ");
	});

	var originalLine = 1;
	var line = 1;
	var column = 0;
	var currentOutputLine = 1;
	var targetOutputLine = -1;
	var limited = false;
	var lastMapping = null;
	var currentSource = null;
	var exampleLines;
	var mappingsBySource = {};
	map.eachMapping(function(mapping) {
		if(typeof mapping.originalLine !== "number") return;
		if(mapping.generatedLine > MAX_LINES) {
			limited = true;
			return;
		}
		if(!mappingsBySource[mapping.source]) mappingsBySource[mapping.source] = [];
		mappingsBySource[mapping.source].push(mapping);
	}, undefined, SourceMap.SourceMapConsumer.ORIGINAL_ORDER);

	Object.keys(mappingsBySource).map(function(source) {
		return [source, mappingsBySource[source][0].generatedLine];
	}).sort(function(a, b) {
		if(a[0] === "?") return 1;
		if(b[0] === "?") return -1;
		return a[1] - b[1];
	}).forEach(function(arr) {
		var source = arr[0];
		var mappings = mappingsBySource[source];

		if(currentSource) endFile();
		lastMapping = null;
		line = 1;
		column = 0;
		targetOutputLine = -1;
		if(mapSources.length > 1) {
			currentOutputLine++;
		}
		var startLine = mappings.map(function(mapping) {
			return mapping.generatedLine - mapping.originalLine + 1;
		}).sort(function(a, b) {
			return a - b;
		})[0];
		while(currentOutputLine < startLine) {
			originalLine++;
			currentOutputLine++;
		}
		if(mapSources.length > 1) {
			pushSourceHeader(originalSide, originalLine, source);
			originalLine++;
		}
		var exampleSource = sources[mapSources.indexOf(source)];
		if(!exampleSource) throw new Error("Source '" + source + "' missing");
		exampleLines = exampleSource.split("\n");
		currentSource = source;
		mappings.forEach(function(mapping, idx) {
			if(lastMapping) {
				var previousSource = mapSources.indexOf(lastMapping.source);
				if(line < mapping.originalLine) {
					pushSegment(originalSide, originalLine, exampleLines.shift(), {
						original: true,
						source: previousSource,
						line: lastMapping.originalLine,
						column: lastMapping.originalColumn
					});
					originalLine++;
					line++;
					column = 0;
					currentOutputLine++;
					while(line < mapping.originalLine) {
						pushText(originalSide, originalLine, exampleLines.shift());
						originalLine++;
						line++;
						column = 0;
						currentOutputLine++;
					}
					startLine = [];
					for(var i = idx; i < mappings.length && mappings[i].originalLine <= mapping.originalLine + 1; i++) {
						startLine.push(mappings[i].generatedLine - mappings[i].originalLine + mapping.originalLine);
					}
					startLine.sort(function(a, b) {
						return a - b;
					});
					startLine = startLine[0];
					while(typeof startLine !== "undefined" && currentOutputLine < startLine) {
						originalLine++;
						currentOutputLine++;
					}
					if(column < mapping.originalColumn) {
						pushText(originalSide, originalLine, shiftColumns(mapping.originalColumn - column));
					}
				}
				if(mapping.originalColumn > column) {
					pushSegment(originalSide, originalLine, shiftColumns(mapping.originalColumn - column), {
						original: true,
						source: previousSource,
						line: lastMapping.originalLine,
						column: lastMapping.originalColumn
					});
				}
			} else {
				while(line < mapping.originalLine) {
					pushText(originalSide, originalLine, exampleLines.shift());
					originalLine++;
					line++;
					column = 0;
				}
				if(column < mapping.originalColumn) {
					pushText(originalSide, originalLine, shiftColumns(mapping.originalColumn - column));
				}
			}
			lastMapping = mapping;
		});
	});

	function endFile() {
		if(lastMapping) {
			var source = mapSources.indexOf(lastMapping.source);
			pushSegment(originalSide, originalLine, exampleLines.shift(), {
				original: true,
				source: source,
				line: lastMapping.originalLine,
				column: lastMapping.originalColumn
			});
		}
		if(!limited) {
			exampleLines.forEach(function(exampleLine) {
				originalLine++;
				currentOutputLine++;
				pushText(originalSide, originalLine, exampleLine);
			});
		}
	}

	endFile();

	function shiftColumns(count) {
		var nextLine = exampleLines[0] || "";
		exampleLines[0] = nextLine.substr(count);
		column += count;
		return nextLine.substr(0, count);
	}

	return {
		files: [
			{
				key: "generated",
				title: "generated",
				className: "genside codeblock",
				rows: toDenseRows(generatedSide)
			},
			{
				key: "original",
				title: "original",
				className: "origside codeblock",
				rows: toDenseRows(originalSide)
			}
		],
		mappings: {
			key: "mappings",
			title: "mappings",
			className: "genside codeblock",
			rows: toDenseRows(mappingsSide)
		}
	};
};
