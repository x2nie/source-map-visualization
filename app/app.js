import { Component, mount, onMounted, onWillUnmount, useRef, useState, xml } from "@odoo/owl";
import * as SourceMap from "source-map";

import "./app.less";
import UglifyJS from "./uglify-js";
import generateHtml from "./generateHtml";

import coffeeJs from "../example/coffee/example.js?raw";
import coffeeMapText from "../example/coffee/example.map?raw";
import coffeeOriginal from "../example/coffee/example?raw";
import simpleCoffeeJs from "../example/simple-coffee/example.js?raw";
import simpleCoffeeMapText from "../example/simple-coffee/example.map?raw";
import simpleCoffeeOriginal from "../example/simple-coffee/example?raw";
import typescriptJs from "../example/typescript/example.js?raw";
import typescriptMapText from "../example/typescript/example.map?raw";
import typescriptOriginal from "../example/typescript/example?raw";
import babelJs from "../example/babel/example.js?raw";
import babelMapText from "../example/babel/example.map?raw";
import babelOriginal from "../example/babel/example?raw";
import sassJs from "../example/sass/example.js?raw";
import sassMapText from "../example/sass/example.map?raw";
import sassOriginal from "../example/sass/example?raw";

const exampleKinds = ["coffee", "simple-coffee", "typescript", "babel", "sass"];
const SOURCE_MAPPING_URL_REG_EXP = /\/\/[@#]\s*sourceMappingURL\s*=\s*data:[^\n]*?base64,([^\n]*)/;
const SOURCE_MAPPING_URL_REG_EXP2 = /\/\*\s*[@#]\s*sourceMappingURL\s*=\s*data:[^\n]*?base64,([^\n]*)\s*\*\//;

const examples = {
	coffee: {
		js: coffeeJs,
		map: JSON.parse(coffeeMapText),
		original: coffeeOriginal,
	},
	"simple-coffee": {
		js: simpleCoffeeJs,
		map: JSON.parse(simpleCoffeeMapText),
		original: simpleCoffeeOriginal,
	},
	typescript: {
		js: typescriptJs,
		map: JSON.parse(typescriptMapText),
		original: typescriptOriginal,
	},
	babel: {
		js: babelJs,
		map: JSON.parse(babelMapText),
		original: babelOriginal,
	},
	sass: {
		js: sassJs,
		map: JSON.parse(sassMapText),
		original: sassOriginal,
	},
};

const { SourceMapConsumer, SourceMapGenerator } = SourceMap;

function createInitialState() {
	return {
		visualization: null,
		currentExample: null,
		customLink: "",
		pageError: "",
		selectedMappingKey: "",
		currentHash: "",
		custom: {
			visible: false,
			step: "step1",
			error: "",
			hasPendingFile: false,
			generatedSource: "",
			sourceMap: null,
			sourcesContent: [],
			sourceFile: "",
			sourceFileIndex: -1,
		},
	};
}

function cloneMap(map) {
	return JSON.parse(JSON.stringify(map));
}

function replaceInlineSourceMap(generatedSource) {
	return generatedSource
		.replace(SOURCE_MAPPING_URL_REG_EXP, "/* base64 source map removed */")
		.replace(SOURCE_MAPPING_URL_REG_EXP2, "/* base64 source map removed */");
}

function extractInlineSourceMap(generatedSource) {
	if (typeof atob !== "function") return null;
	if (!SOURCE_MAPPING_URL_REG_EXP.test(generatedSource) && !SOURCE_MAPPING_URL_REG_EXP2.test(generatedSource)) {
		return null;
	}
	const match = SOURCE_MAPPING_URL_REG_EXP.exec(generatedSource) || SOURCE_MAPPING_URL_REG_EXP2.exec(generatedSource);
	if (!match) return null;
	try {
		return {
			generatedSource: replaceInlineSourceMap(generatedSource),
			sourceMap: JSON.parse(decodeURIComponent(escape(atob(match[1])))),
		};
	} catch (err) {
		return null;
	}
}

function readFile(file, callback) {
	const fileReader = new FileReader();
	fileReader.readAsText(file, "utf-8");
	fileReader.onload = function() {
		callback(null, fileReader.result);
	};
	fileReader.onabort = function() {
		callback(new Error("File read cancelled"));
	};
	fileReader.onerror = function(evt) {
		switch (evt.target.error.code) {
			case evt.target.error.NOT_FOUND_ERR:
				return callback(new Error("File Not Found!"));
			case evt.target.error.NOT_READABLE_ERR:
				return callback(new Error("File is not readable"));
			case evt.target.error.ABORT_ERR:
				return callback();
			default:
				return callback(new Error("An error occurred reading this file."));
		}
	};
}

function readFileAsText(file) {
	return new Promise((resolve, reject) => {
		readFile(file, (err, result) => {
			if (err) return reject(err);
			resolve(result);
		});
	});
}

function validateSourceMap(sourceMap) {
	if (!sourceMap || !sourceMap.sources) throw new Error("SourceMap has no sources field");
	if (!sourceMap.mappings) throw new Error("SourceMap has no mappings field");
}

function buildCustomHash(generatedSource, sourceMap, sourcesContent) {
	return (
		"#base64," +
		[generatedSource, JSON.stringify(sourceMap)]
			.concat(sourcesContent)
			.map((str) => btoa(unescape(encodeURIComponent(str))))
			.join(",")
	);
}

function getExample(kind) {
	return examples[kind] || examples.typescript;
}

class CodeBlock extends Component {
	getSegmentClass(segment) {
		let className = segment.className || "";
		if (segment.mappingKey && segment.mappingKey === this.props.selectedKey) {
			className += (className ? " " : "") + "selected";
		}
		return className;
	}

	onSegmentHover(ev) {
		const mappingKey = ev.currentTarget.dataset.mappingKey;
		if (mappingKey && this.props.onHover) {
			this.props.onHover(mappingKey);
		}
	}

	onSegmentClick(ev) {
		const mappingKey = ev.currentTarget.dataset.mappingKey;
		if (mappingKey && this.props.onActivate) {
			this.props.onActivate(ev, mappingKey);
		}
	}
}

CodeBlock.template = xml`
<section t-att-class="props.block.className">
	<h3><t t-esc="props.block.title"/></h3>
	<pre><code><table><tbody>
		<tr t-foreach="props.block.rows" t-as="row" t-key="row.key">
			<td>
				<t t-if="row.kind === 'sourceHeader'">
					<h4 class="source-header"><t t-esc="row.text"/></h4>
				</t>
				<t t-else="">
					<t t-foreach="row.segments" t-as="segment" t-key="segment.key">
						<t t-if="segment.className || segment.mappingKey">
							<span
								t-att-class="getSegmentClass(segment)"
								t-att-title="segment.title || undefined"
								t-att-data-mapping-key="segment.mappingKey || undefined"
								t-on-mouseenter="onSegmentHover"
								t-on-click="onSegmentClick"
							><t t-esc="segment.text"/></span>
						</t>
						<t t-else="" t-esc="segment.text"/>
					</t>
				</t>
			</td>
		</tr>
	</tbody></table></code></pre>
</section>`;

class App extends Component {
	setup() {
		this.rootRef = useRef("root");
		this.state = useState(createInitialState());
		this.oldHash = "";
		this.pendingCustomFile = null;

		this.handleHashChange = this.handleHashChange.bind(this);
		this.handleWindowDrag = this.handleWindowDrag.bind(this);
		this.handleWindowDrop = this.handleWindowDrop.bind(this);
		this.handleItemHover = this.handleItemHover.bind(this);
		this.handleItemActivate = this.handleItemActivate.bind(this);
		this.onCustomFileSelected = this.onCustomFileSelected.bind(this);
		this.onCustomContinue = this.onCustomContinue.bind(this);
		this.onCloseCustomModal = this.onCloseCustomModal.bind(this);
		this.onMinify = this.onMinify.bind(this);

		onMounted(() => {
			window.addEventListener("hashchange", this.handleHashChange);
			window.addEventListener("dragenter", this.handleWindowDrag);
			window.addEventListener("dragover", this.handleWindowDrag);
			window.addEventListener("drop", this.handleWindowDrop);
			this.handleHashChange();
		});

		onWillUnmount(() => {
			window.removeEventListener("hashchange", this.handleHashChange);
			window.removeEventListener("dragenter", this.handleWindowDrag);
			window.removeEventListener("dragover", this.handleWindowDrag);
			window.removeEventListener("drop", this.handleWindowDrop);
		});
	}

	get exampleKinds() {
		return exampleKinds;
	}

	hideCustomModal() {
		this.state.custom.visible = false;
		this.state.custom.error = "";
		this.state.custom.hasPendingFile = false;
		this.pendingCustomFile = null;
	}

	resetCustomState() {
		const custom = this.state.custom;
		custom.visible = true;
		custom.step = "step1";
		custom.error = "";
		custom.hasPendingFile = false;
		custom.generatedSource = "";
		custom.sourceMap = null;
		custom.sourcesContent = [];
		custom.sourceFile = "";
		custom.sourceFileIndex = -1;
		this.pendingCustomFile = null;
	}

	handleHashChange() {
		let exampleKind = window.location.hash.replace(/^#/, "");
		if (exampleKind !== "custom-choose") {
			this.hideCustomModal();
		}

		if (exampleKind.indexOf("base64") === 0) {
			const input = exampleKind.split(",").slice(1).map((str) => decodeURIComponent(escape(atob(str))));
			const generatedSource = input.shift();
			const sourceMap = JSON.parse(input.shift());
			this.loadCustomExample(input, generatedSource, sourceMap, "#" + exampleKind);
			this.oldHash = exampleKind;
			return;
		}

		exampleKind = exampleKind.toLowerCase();
		if (exampleKind === "custom") {
			this.state.currentHash = "custom";
			return;
		}
		if (exampleKind === "custom-choose") {
			this.resetCustomState();
			this.state.currentHash = "custom-choose";
			return;
		}

		if (exampleKinds.indexOf(exampleKind) < 0) exampleKind = "typescript";
		this.loadNamedExample(exampleKind);
		this.state.customLink = "";
		this.oldHash = exampleKind;
	}

	loadNamedExample(exampleKind) {
		const example = getExample(exampleKind);
		const exampleMap = cloneMap(example.map);
		const sources = exampleMap.sourcesContent ? exampleMap.sourcesContent.slice() : [example.original];
		this.loadExample(sources, example.js, exampleMap, {
			hash: exampleKind,
			customLink: "",
		});
	}

	loadExample(sources, generatedSource, sourceMap, options) {
		const mapData = cloneMap(sourceMap);
		mapData.file = mapData.file || "example.js";
		try {
			const map = new SourceMapConsumer(mapData);
			this.state.visualization = generateHtml(map, generatedSource, sources);
			this.state.currentExample = {
				sources: sources.slice(),
				generatedSource,
				sourceMap: mapData,
			};
			this.state.pageError = "";
			this.state.selectedMappingKey = "";
			this.state.currentHash = options.hash || this.state.currentHash;
			this.state.customLink = typeof options.customLink === "string" ? options.customLink : "";
		} catch (err) {
			this.state.pageError = err.message;
			throw err;
		}
	}

	loadCustomExample(sourcesContent, generatedSource, sourceMap, customHash) {
		this.loadExample(sourcesContent, generatedSource, sourceMap, {
			hash: "custom",
			customLink: customHash || buildCustomHash(generatedSource, sourceMap, sourcesContent),
		});
	}

	handleWindowDrag(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		if (this.state.custom.visible) return false;
		this.state.custom.visible = true;
		this.state.custom.step = "drag";
		this.state.custom.error = "";
		this.state.custom.hasPendingFile = false;
		return false;
	}

	handleWindowDrop(ev) {
		ev.preventDefault();
		ev.stopPropagation();

		const files =
			ev.dataTransfer?.files || ev.originalEvent?.dataTransfer?.files || null;
		if (!files || files.length === 0) return false;

		this.state.custom.visible = true;
		this.state.custom.step = "drag";
		this.state.custom.error = "";
		this.state.custom.hasPendingFile = false;

		this.readDroppedFiles(files)
			.then((result) => {
				this.loadCustomExample(result.sourcesContent, result.generatedSource, result.sourceMap);
				this.hideCustomModal();
				this.oldHash = "custom";
				window.location.hash = "custom";
			})
			.catch((err) => {
				this.state.custom.error = err.message;
			});

		return false;
	}

	readDroppedFiles(files) {
		return Promise.all(
			Array.prototype.map.call(files, (file) =>
				readFileAsText(file).then((result) => ({
					file,
					name: file.name,
					result,
				}))
			)
		).then((filesData) => {
			let sourceMapFile;
			let generatedFile;
			const javascriptWithSourceMap = filesData.filter((data) => {
				return (/\.js$/.test(data.name) && SOURCE_MAPPING_URL_REG_EXP.test(data.result)) ||
					(/\.(css|js)$/.test(data.name) && SOURCE_MAPPING_URL_REG_EXP2.test(data.result));
			})[0];

			if (javascriptWithSourceMap) {
				if (typeof atob !== "function") {
					throw new Error("Your browser doesn't support atob. Cannot decode base64.");
				}
				generatedFile = javascriptWithSourceMap;
				filesData.splice(filesData.indexOf(generatedFile), 1);
				const extracted = extractInlineSourceMap(generatedFile.result);
				if (!extracted) {
					throw new Error("Cannot decode embedded SourceMap.");
				}
				generatedFile.result = extracted.generatedSource;
				sourceMapFile = {
					result: JSON.stringify(extracted.sourceMap),
					json: extracted.sourceMap,
				};
			} else {
				const mapFiles = filesData.filter((data) => /\.map$/.test(data.name));
				if (mapFiles.length === 1) {
					sourceMapFile = mapFiles[0];
					filesData.splice(filesData.indexOf(sourceMapFile), 1);
				} else {
					const jsonFiles = filesData.filter((data) => /\.json$/.test(data.name));
					if (jsonFiles.length === 1) {
						sourceMapFile = jsonFiles[0];
						filesData.splice(filesData.indexOf(sourceMapFile), 1);
					} else {
						throw new Error("No SourceMap provided.");
					}
				}
				sourceMapFile.json = JSON.parse(sourceMapFile.result);
				validateSourceMap(sourceMapFile.json);

				const name = sourceMapFile.json.file;
				generatedFile =
					filesData.filter((data) => data.name === name)[0] ||
					filesData.filter((data) => /\.js$/.test(data.name))[0];
				if (!generatedFile) {
					throw new Error("No original file provided.");
				}
				filesData.splice(filesData.indexOf(generatedFile), 1);
			}

			const providedSourcesContent = filesData.map((data) => data.result);
			const sourcesContentSet = sourceMapFile.json.sourcesContent && sourceMapFile.json.sourcesContent.length > 0;
			if (providedSourcesContent.length > 0 && sourcesContentSet) {
				throw new Error("Provided source files, but sourcesContent already provided within SourceMap.");
			}
			return {
				sourcesContent: sourcesContentSet ? sourceMapFile.json.sourcesContent : providedSourcesContent,
				generatedSource: generatedFile.result,
				sourceMap: sourceMapFile.json,
			};
		});
	}

	handleItemHover(mappingKey) {
		this.state.selectedMappingKey = mappingKey;
	}

	handleItemActivate(ev, mappingKey) {
		this.state.selectedMappingKey = mappingKey;
		const root = this.rootRef.el || document.body;
		const items = root.querySelectorAll(`[data-mapping-key="${mappingKey}"]`);
		Array.prototype.forEach.call(items, (elem) => {
			if (elem === ev.currentTarget) return;
			if ("scrollIntoViewIfNeeded" in elem) {
				elem.scrollIntoViewIfNeeded();
				return;
			}
			elem.scrollIntoView({
				behavior: "smooth",
				block: "nearest",
				inline: "nearest",
			});
		});
	}

	onCustomFileSelected(ev) {
		this.pendingCustomFile = ev.target.files[0] || null;
		this.state.custom.hasPendingFile = !!this.pendingCustomFile;
	}

	onCloseCustomModal() {
		window.location.hash = this.oldHash || "typescript";
	}

	onCustomContinue() {
		if (!this.pendingCustomFile) return;
		const step = this.state.custom.step;
		this.state.custom.error = "";
		readFileAsText(this.pendingCustomFile)
			.then((result) => {
				this.pendingCustomFile = null;
				this.state.custom.hasPendingFile = false;
				if (step === "step1") {
					this.handleGeneratedSource(result);
					return;
				}
				if (step === "step2") {
					this.handleCustomSourceMap(result);
					return;
				}
				if (step === "step3") {
					this.handleCustomSource(result);
				}
			})
			.catch((err) => {
				this.state.custom.error = err.message;
			});
	}

	handleGeneratedSource(generatedSource) {
		const custom = this.state.custom;
		custom.generatedSource = generatedSource;
		const extracted = extractInlineSourceMap(generatedSource);
		if (extracted) {
			custom.generatedSource = extracted.generatedSource;
			custom.sourceMap = extracted.sourceMap;
			custom.sourcesContent = [];
			this.advanceCustomStep();
			return;
		}
		custom.step = "step2";
	}

	handleCustomSourceMap(sourceMapText) {
		try {
			const sourceMap = JSON.parse(sourceMapText);
			validateSourceMap(sourceMap);
			this.state.custom.sourceMap = sourceMap;
			this.state.custom.sourcesContent = [];
			this.advanceCustomStep();
		} catch (err) {
			this.state.custom.error = err.message;
		}
	}

	handleCustomSource(originalSource) {
		this.state.custom.sourcesContent[this.state.custom.sourceFileIndex] = originalSource;
		this.advanceCustomStep();
	}

	advanceCustomStep() {
		const custom = this.state.custom;
		if (!custom.sourceMap || !custom.sourceMap.sources || !custom.sourceMap.mappings) {
			custom.error = "This is not a valid SourceMap.";
			return;
		}
		if (custom.sourceMap.sourcesContent) {
			custom.sourcesContent = custom.sourceMap.sourcesContent.slice();
			this.finishCustomFlow();
			return;
		}
		for (let i = 0; i < custom.sourceMap.sources.length; i++) {
			if (!custom.sourcesContent[i]) {
				custom.sourceFile = custom.sourceMap.sources[i];
				custom.sourceFileIndex = i;
				custom.step = "step3";
				return;
			}
		}
		this.finishCustomFlow();
	}

	finishCustomFlow() {
		try {
			this.loadCustomExample(this.state.custom.sourcesContent, this.state.custom.generatedSource, this.state.custom.sourceMap);
			this.hideCustomModal();
			this.oldHash = "custom";
			window.location.hash = "custom";
		} catch (err) {
			this.state.custom.error = err.message;
			if (err.stack) {
				console.error(err.stack);
			}
		}
	}

	onMinify() {
		const currentExample = this.state.currentExample;
		if (!currentExample) return;
		try {
			const result = UglifyJS.minify(currentExample.generatedSource, {
				outSourceMap: "example.map",
				output: {
					beautify: true,
				},
			});
			let minmap = JSON.parse(result.map);
			minmap.file = "example";
			minmap = new SourceMapConsumer(result.map);
			minmap = SourceMapGenerator.fromSourceMap(minmap);
			minmap.setSourceContent("?", currentExample.generatedSource);
			currentExample.sourceMap.sourcesContent = currentExample.sources;
			minmap.applySourceMap(new SourceMapConsumer(currentExample.sourceMap), "?");
			minmap = minmap.toJSON();
			this.loadCustomExample(minmap.sourcesContent, result.code, minmap);
			this.oldHash = "custom";
			window.location.hash = "custom";
		} catch (err) {
			this.state.pageError = err.message;
		}
	}
}

App.components = {
	CodeBlock,
};

// App.template = xml`<h1>Hello!</h1>`
App.template = xml`
<div class="full-screen app-shell" t-ref="root">
	<header class="app-header">
		<div class="header-title">
			<h1>source-map-visualization</h1>
			<p class="header-actions">
				<a
					t-foreach="exampleKinds"
					t-as="kind"
					t-key="kind"
					t-att-href="'#' + kind"
					t-att-class="'btn example' + (state.currentHash === kind ? ' active' : '')"
				><t t-esc="kind"/></a>
				<a class="btn btn-primary custom" href="#custom-choose">custom...</a>
				<a t-if="state.customLink" class="custom-link" t-att-href="state.customLink">Link to this</a>
				<button class="btn btn-info js-minify" t-att-disabled="!state.currentExample" t-on-click="onMinify">minify generated</button>
			</p>
		</div>
		<small>made with ♡ by sokra &amp; paulirish. <a href="https://github.com/sokra/source-map-visualization/">repo</a></small>
	</header>

	<main>
		<div t-if="state.pageError" class="page-error"><t t-esc="state.pageError"/></div>
		<t t-if="state.visualization">
			<CodeBlock
				t-foreach="state.visualization.files"
				t-as="block"
				t-key="block.key"
				block="block"
				selectedKey="state.selectedMappingKey"
				onHover.bind="handleItemHover"
				onActivate.bind="handleItemActivate"
			/>
		</t>
		<div t-else="" class="page-empty">Choose an example or load your own SourceMap bundle.</div>
	</main>

	<footer>
		<t t-if="state.visualization">
			<CodeBlock
				block="state.visualization.mappings"
				selectedKey="state.selectedMappingKey"
				onHover.bind="handleItemHover"
				onActivate.bind="handleItemActivate"
			/>
		</t>
	</footer>

	<div t-if="state.custom.visible" class="modal-overlay" t-on-click.self="onCloseCustomModal">
		<section class="modal-card">
			<div class="modal-header">
				<h3>Custom SourceMap</h3>
				<button class="modal-close" t-on-click="onCloseCustomModal" type="button">×</button>
			</div>
			<div class="modal-body">
				<t t-if="state.custom.step === 'drag'">
					<h4>Drag'n'Drop</h4>
					<p>Drop all files anywhere to load them.</p>
					<p>The SourceMap must have the extension ".map", though ".json" is acceptable if it's the only JSON file.</p>
				</t>
				<t t-if="state.custom.step === 'step1'">
					<div class="alert alert-info">Note: You can drag 'n drop your generated/map files onto the app.</div>
					<h4>Step 1</h4>
					<p>Provide generated code file:</p>
					<div class="modal-actions">
						<input class="input file-input" type="file" t-on-change="onCustomFileSelected"/>
						<button class="btn btn-primary" type="button" t-att-disabled="!state.custom.hasPendingFile" t-on-click="onCustomContinue">Load</button>
					</div>
				</t>
				<t t-if="state.custom.step === 'step2'">
					<h4>Step 1</h4>
					<p>Generated code provided. (size=<t t-esc="state.custom.generatedSource.length"/>)</p>
					<h4>Step 2</h4>
					<p>Provide SourceMap file:</p>
					<div class="modal-actions">
						<input class="input file-input" type="file" t-on-change="onCustomFileSelected"/>
						<button class="btn btn-primary" type="button" t-att-disabled="!state.custom.hasPendingFile" t-on-click="onCustomContinue">Load</button>
					</div>
				</t>
				<t t-if="state.custom.step === 'step3'">
					<h4>Step 1</h4>
					<p>Generated code provided. (size=<t t-esc="state.custom.generatedSource.length"/>)</p>
					<h4>Step 2</h4>
					<p>SourceMap provided. (mappingsSize=<t t-esc="state.custom.sourceMap.mappings.length"/>)</p>
					<h4>Step 3</h4>
					<p>Provide original source file "<t t-esc="state.custom.sourceFile"/>":</p>
					<div class="modal-actions">
						<input class="input file-input" type="file" t-on-change="onCustomFileSelected"/>
						<button class="btn btn-primary" type="button" t-att-disabled="!state.custom.hasPendingFile" t-on-click="onCustomContinue">Load</button>
					</div>
				</t>
			</div>
			<div t-if="state.custom.error" class="alert alert-error"><t t-esc="state.custom.error"/></div>
		</section>
	</div>
</div>`;

const mountTarget = document.createElement("div");
document.body.appendChild(mountTarget);
mount(App, mountTarget);
