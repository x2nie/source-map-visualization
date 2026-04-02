import * as SourceMap from "source-map";

const LINESTYLES = 5;
const MAX_LINES = 5000;
const { SourceNode, SourceMapConsumer } = SourceMap;

function createSparseRows() {
	return [];
}

function ensureContentRow(rows, rowNumber) {
	if (!rows[rowNumber]) {
		rows[rowNumber] = {
			key: `row-${rowNumber}`,
			kind: "segments",
			segments: [],
		};
	}
	return rows[rowNumber];
}

function pushText(rows, rowNumber, text) {
	const row = ensureContentRow(rows, rowNumber);
	if (typeof text === "undefined" || text === null || text === "") return;
	row.segments.push({
		key: `text-${rowNumber}-${row.segments.length}`,
		text,
		className: "",
		title: "",
		mappingKey: "",
	});
}

function pushSegment(rows, rowNumber, text, options) {
	const row = ensureContentRow(rows, rowNumber);
	if (typeof text === "undefined" || text === null || text === "") return;
	let className = options.generated ? "generated-item" : options.mapping ? "mapping-item" : "original-item";
	className += ` style-${options.line % LINESTYLES}`;
	row.segments.push({
		key: `segment-${rowNumber}-${row.segments.length}`,
		text,
		className,
		title: options.name || "",
		mappingKey: typeof options.source !== "undefined" ? `${options.source}:${options.line}:${options.column}` : "",
		source: options.source,
		line: options.line,
		column: options.column,
	});
}

function pushSourceHeader(rows, rowNumber, source) {
	rows[rowNumber] = {
		key: `source-${rowNumber}-${source}`,
		kind: "sourceHeader",
		text: source,
	};
}

function toDenseRows(rows) {
	const denseRows = [];
	const length = Math.max(rows.length, 1);
	for (let i = 1; i < length; i++) {
		denseRows.push(
			rows[i] || {
				key: `row-${i}`,
				kind: "segments",
				segments: [],
			}
		);
	}
	if (denseRows.length === 0) {
		denseRows.push({
			key: "row-empty",
			kind: "segments",
			segments: [],
		});
	}
	return denseRows;
}

export default function generateHtml(map, generatedCode, sources) {
	const generatedSide = createSparseRows();
	const originalSide = createSparseRows();
	const mappingsSide = createSparseRows();

	const mapSources = map.sources;

	let generatedLine = 1;
	const nodes = SourceNode.fromStringWithSourceMap(generatedCode, map).children;
	nodes.forEach((item) => {
		if (generatedLine > MAX_LINES) return;
		if (typeof item === "string") {
			item.split("\n").forEach((line) => {
				pushText(generatedSide, generatedLine, line);
				generatedLine++;
			});
			generatedLine--;
		} else {
			const source = mapSources.indexOf(item.source);
			item.toString().split("\n").forEach((line) => {
				pushSegment(generatedSide, generatedLine, line, {
					generated: true,
					source,
					line: item.line,
					column: item.column,
					name: item.name,
				});
				generatedLine++;
			});
			generatedLine--;
		}
	});

	let lastGenLine = 1;
	let lastOrgSource = "";
	let mappingsLine = 1;
	map.eachMapping((mapping) => {
		if (mapping.generatedLine > MAX_LINES) return;
		while (lastGenLine < mapping.generatedLine) {
			mappingsLine++;
			lastGenLine++;
			pushText(mappingsSide, mappingsLine, `${lastGenLine}: `);
		}
		if (typeof mapping.originalLine === "number") {
			if (lastOrgSource !== mapping.source && mapSources.length > 1) {
				pushText(mappingsSide, mappingsLine, `[${mapping.source}] `);
				lastOrgSource = mapping.source;
			}
			const source = mapSources.indexOf(mapping.source);
			pushSegment(mappingsSide, mappingsLine, `${mapping.generatedColumn}->${mapping.originalLine}:${mapping.originalColumn}`, {
				mapping: true,
				source,
				line: mapping.originalLine,
				column: mapping.originalColumn,
			});
		} else {
			pushSegment(mappingsSide, mappingsLine, String(mapping.generatedColumn), {
				mapping: true,
				line: mappingsLine,
				column: mapping.generatedColumn,
			});
		}
		pushText(mappingsSide, mappingsLine, "  ");
	});

	let originalLine = 1;
	let line = 1;
	let column = 0;
	let currentOutputLine = 1;
	let limited = false;
	let lastMapping = null;
	let currentSource = null;
	let exampleLines;
	const mappingsBySource = {};

	map.eachMapping(
		(mapping) => {
			if (typeof mapping.originalLine !== "number") return;
			if (mapping.generatedLine > MAX_LINES) {
				limited = true;
				return;
			}
			if (!mappingsBySource[mapping.source]) mappingsBySource[mapping.source] = [];
			mappingsBySource[mapping.source].push(mapping);
		},
		undefined,
		SourceMapConsumer.ORIGINAL_ORDER
	);

	Object.keys(mappingsBySource)
		.map((source) => [source, mappingsBySource[source][0].generatedLine])
		.sort((a, b) => {
			if (a[0] === "?") return 1;
			if (b[0] === "?") return -1;
			return a[1] - b[1];
		})
		.forEach((arr) => {
			const source = arr[0];
			const mappings = mappingsBySource[source];

			if (currentSource) endFile();
			lastMapping = null;
			line = 1;
			column = 0;
			if (mapSources.length > 1) {
				currentOutputLine++;
			}
			let startLine = mappings
				.map((mapping) => mapping.generatedLine - mapping.originalLine + 1)
				.sort((a, b) => a - b)[0];
			while (currentOutputLine < startLine) {
				originalLine++;
				currentOutputLine++;
			}
			if (mapSources.length > 1) {
				pushSourceHeader(originalSide, originalLine, source);
				originalLine++;
			}
			const exampleSource = sources[mapSources.indexOf(source)];
			if (!exampleSource) throw new Error(`Source '${source}' missing`);
			exampleLines = exampleSource.split("\n");
			currentSource = source;
			mappings.forEach((mapping, idx) => {
				if (lastMapping) {
					const previousSource = mapSources.indexOf(lastMapping.source);
					if (line < mapping.originalLine) {
						pushSegment(originalSide, originalLine, exampleLines.shift(), {
							original: true,
							source: previousSource,
							line: lastMapping.originalLine,
							column: lastMapping.originalColumn,
						});
						originalLine++;
						line++;
						column = 0;
						currentOutputLine++;
						while (line < mapping.originalLine) {
							pushText(originalSide, originalLine, exampleLines.shift());
							originalLine++;
							line++;
							column = 0;
							currentOutputLine++;
						}
						startLine = [];
						for (let i = idx; i < mappings.length && mappings[i].originalLine <= mapping.originalLine + 1; i++) {
							startLine.push(mappings[i].generatedLine - mappings[i].originalLine + mapping.originalLine);
						}
						startLine.sort((a, b) => a - b);
						startLine = startLine[0];
						while (typeof startLine !== "undefined" && currentOutputLine < startLine) {
							originalLine++;
							currentOutputLine++;
						}
						if (column < mapping.originalColumn) {
							pushText(originalSide, originalLine, shiftColumns(mapping.originalColumn - column));
						}
					}
					if (mapping.originalColumn > column) {
						pushSegment(originalSide, originalLine, shiftColumns(mapping.originalColumn - column), {
							original: true,
							source: previousSource,
							line: lastMapping.originalLine,
							column: lastMapping.originalColumn,
						});
					}
				} else {
					while (line < mapping.originalLine) {
						pushText(originalSide, originalLine, exampleLines.shift());
						originalLine++;
						line++;
						column = 0;
					}
					if (column < mapping.originalColumn) {
						pushText(originalSide, originalLine, shiftColumns(mapping.originalColumn - column));
					}
				}
				lastMapping = mapping;
			});
		});

	function endFile() {
		if (lastMapping) {
			const source = mapSources.indexOf(lastMapping.source);
			pushSegment(originalSide, originalLine, exampleLines.shift(), {
				original: true,
				source,
				line: lastMapping.originalLine,
				column: lastMapping.originalColumn,
			});
		}
		if (!limited) {
			exampleLines.forEach((exampleLine) => {
				originalLine++;
				currentOutputLine++;
				pushText(originalSide, originalLine, exampleLine);
			});
		}
	}

	function shiftColumns(count) {
		const nextLine = exampleLines[0] || "";
		exampleLines[0] = nextLine.substr(count);
		column += count;
		return nextLine.substr(0, count);
	}

	endFile();

	return {
		files: [
			{
				key: "generated",
				title: "generated",
				className: "genside codeblock",
				rows: toDenseRows(generatedSide),
			},
			{
				key: "original",
				title: "original",
				className: "origside codeblock",
				rows: toDenseRows(originalSide),
			},
		],
		mappings: {
			key: "mappings",
			title: "mappings",
			className: "genside codeblock",
			rows: toDenseRows(mappingsSide),
		},
	};
}
