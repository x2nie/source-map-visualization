var SourceMap = require("source-map");
var UglifyJS = require("./uglify-js");
var generateHtml = require("./generateHtml");
var owlScriptUrl = require("file!@odoo/owl/dist/owl.iife.min.js");

require("./app.less");

var exampleKinds = ["coffee", "simple-coffee", "typescript", "babel", "sass"];
var SOURCE_MAPPING_URL_REG_EXP = /\/\/[@#]\s*sourceMappingURL\s*=\s*data:[^\n]*?base64,([^\n]*)/;
var SOURCE_MAPPING_URL_REG_EXP2 = /\/\*\s*[@#]\s*sourceMappingURL\s*=\s*data:[^\n]*?base64,([^\n]*)\s*\*\//;

var examples = {
	coffee: {
		js: require("!raw!../example/coffee/example.js"),
		map: require("!json!../example/coffee/example.map"),
		original: require("!raw!../example/coffee/example")
	},
	"simple-coffee": {
		js: require("!raw!../example/simple-coffee/example.js"),
		map: require("!json!../example/simple-coffee/example.map"),
		original: require("!raw!../example/simple-coffee/example")
	},
	typescript: {
		js: require("!raw!../example/typescript/example.js"),
		map: require("!json!../example/typescript/example.map"),
		original: require("!raw!../example/typescript/example")
	},
	babel: {
		js: require("!raw!../example/babel/example.js"),
		map: require("!json!../example/babel/example.map"),
		original: require("!raw!../example/babel/example")
	},
	sass: {
		js: require("!raw!../example/sass/example.js"),
		map: require("!json!../example/sass/example.map"),
		original: require("!raw!../example/sass/example")
	}
};

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
			sourceFileIndex: -1
		}
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
	if(typeof atob !== "function") return null;
	if(!SOURCE_MAPPING_URL_REG_EXP.test(generatedSource) && !SOURCE_MAPPING_URL_REG_EXP2.test(generatedSource)) {
		return null;
	}
	var match = SOURCE_MAPPING_URL_REG_EXP.exec(generatedSource) || SOURCE_MAPPING_URL_REG_EXP2.exec(generatedSource);
	if(!match) return null;
	try {
		return {
			generatedSource: replaceInlineSourceMap(generatedSource),
			sourceMap: JSON.parse(decodeURIComponent(escape(atob(match[1]))))
		};
	} catch(err) {
		return null;
	}
}

function readFile(file, callback) {
	var fileReader = new FileReader();
	fileReader.readAsText(file, "utf-8");
	fileReader.onload = function() {
		callback(null, fileReader.result);
	};
	fileReader.onabort = function() {
		callback(new Error("File read cancelled"));
	};
	fileReader.onerror = function(evt) {
		switch(evt.target.error.code) {
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
	return new Promise(function(resolve, reject) {
		readFile(file, function(err, result) {
			if(err) return reject(err);
			resolve(result);
		});
	});
}

function validateSourceMap(sourceMap) {
	if(!sourceMap || !sourceMap.sources) throw new Error("SourceMap has no sources field");
	if(!sourceMap.mappings) throw new Error("SourceMap has no mappings field");
}

function buildCustomHash(generatedSource, sourceMap, sourcesContent) {
	return "#base64," + [generatedSource, JSON.stringify(sourceMap)].concat(sourcesContent).map(function(str) {
		return btoa(unescape(encodeURIComponent(str)));
	}).join(",");
}

function getExample(kind) {
	if(examples[kind]) return examples[kind];
	return examples.typescript;
}

function loadOwlRuntime() {
	return new Promise(function(resolve, reject) {
		if(window.owl) {
			resolve(window.owl);
			return;
		}
		var script = document.createElement("script");
		script.src = owlScriptUrl;
		script.async = true;
		script.onload = function() {
			if(window.owl) {
				resolve(window.owl);
				return;
			}
			reject(new Error("Owl runtime loaded without exposing window.owl"));
		};
		script.onerror = function() {
			reject(new Error("Unable to load Owl runtime"));
		};
		document.head.appendChild(script);
	});
}

loadOwlRuntime().then(function(owl) {
	var Component = owl.Component;
	var mount = owl.mount;
	var onMounted = owl.onMounted;
	var onWillUnmount = owl.onWillUnmount;
	var useRef = owl.useRef;
	var useState = owl.useState;
	var xml = owl.xml;

	class CodeBlock extends Component {
		getSegmentClass(segment) {
			var className = segment.className || "";
			if(segment.mappingKey && segment.mappingKey === this.props.selectedKey) {
				className += (className ? " " : "") + "selected";
			}
			return className;
		}

		onSegmentHover(ev) {
			var mappingKey = ev.currentTarget.dataset.mappingKey;
			if(mappingKey && this.props.onHover) {
				this.props.onHover(mappingKey);
			}
		}

		onSegmentClick(ev) {
			var mappingKey = ev.currentTarget.dataset.mappingKey;
			if(mappingKey && this.props.onActivate) {
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
							<t t-else=""><t t-esc="segment.text"/></t>
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

			onMounted(function() {
				window.addEventListener("hashchange", this.handleHashChange);
				window.addEventListener("dragenter", this.handleWindowDrag);
				window.addEventListener("dragover", this.handleWindowDrag);
				window.addEventListener("drop", this.handleWindowDrop);
				this.handleHashChange();
			}.bind(this));

			onWillUnmount(function() {
				window.removeEventListener("hashchange", this.handleHashChange);
				window.removeEventListener("dragenter", this.handleWindowDrag);
				window.removeEventListener("dragover", this.handleWindowDrag);
				window.removeEventListener("drop", this.handleWindowDrop);
			}.bind(this));
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
			var custom = this.state.custom;
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
			var exampleKind = window.location.hash.replace(/^#/, "");
			if(exampleKind !== "custom-choose") {
				this.hideCustomModal();
			}

			if(exampleKind.indexOf("base64") === 0) {
				var input = exampleKind.split(",").slice(1).map(function(str) {
					return decodeURIComponent(escape(atob(str)));
				});
				var generatedSource = input.shift();
				var sourceMap = JSON.parse(input.shift());
				this.loadCustomExample(input, generatedSource, sourceMap, "#" + exampleKind);
				this.oldHash = exampleKind;
				return;
			}

			exampleKind = exampleKind.toLowerCase();
			if(exampleKind === "custom") {
				this.state.currentHash = "custom";
				return;
			}
			if(exampleKind === "custom-choose") {
				this.resetCustomState();
				this.state.currentHash = "custom-choose";
				return;
			}

			if(exampleKinds.indexOf(exampleKind) < 0) exampleKind = "typescript";
			this.loadNamedExample(exampleKind);
			this.state.customLink = "";
			this.oldHash = exampleKind;
		}

		loadNamedExample(exampleKind) {
			var example = getExample(exampleKind);
			var exampleMap = cloneMap(example.map);
			var sources = exampleMap.sourcesContent ? exampleMap.sourcesContent.slice() : [example.original];
			this.loadExample(sources, example.js, exampleMap, {
				hash: exampleKind,
				customLink: ""
			});
		}

		loadExample(sources, generatedSource, sourceMap, options) {
			var mapData = cloneMap(sourceMap);
			mapData.file = mapData.file || "example.js";
			try {
				var map = new SourceMap.SourceMapConsumer(mapData);
				this.state.visualization = generateHtml(map, generatedSource, sources);
				this.state.currentExample = {
					sources: sources.slice(),
					generatedSource: generatedSource,
					sourceMap: mapData
				};
				this.state.pageError = "";
				this.state.selectedMappingKey = "";
				this.state.currentHash = options.hash || this.state.currentHash;
				this.state.customLink = typeof options.customLink === "string" ? options.customLink : "";
			} catch(err) {
				this.state.pageError = err.message;
				throw err;
			}
		}

		loadCustomExample(sourcesContent, generatedSource, sourceMap, customHash) {
			this.loadExample(sourcesContent, generatedSource, sourceMap, {
				hash: "custom",
				customLink: customHash || buildCustomHash(generatedSource, sourceMap, sourcesContent)
			});
		}

		handleWindowDrag(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if(this.state.custom.visible) return false;
			this.state.custom.visible = true;
			this.state.custom.step = "drag";
			this.state.custom.error = "";
			this.state.custom.hasPendingFile = false;
			return false;
		}

		handleWindowDrop(ev) {
			ev.preventDefault();
			ev.stopPropagation();

			var files = ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files : ev.originalEvent && ev.originalEvent.dataTransfer ? ev.originalEvent.dataTransfer.files : null;
			if(!files || files.length === 0) return false;

			this.state.custom.visible = true;
			this.state.custom.step = "drag";
			this.state.custom.error = "";
			this.state.custom.hasPendingFile = false;

			this.readDroppedFiles(files).then(function(result) {
				this.loadCustomExample(result.sourcesContent, result.generatedSource, result.sourceMap);
				this.hideCustomModal();
				this.oldHash = "custom";
				window.location.hash = "custom";
			}.bind(this)).catch(function(err) {
				this.state.custom.error = err.message;
			}.bind(this));

			return false;
		}

		readDroppedFiles(files) {
			return Promise.all(Array.prototype.map.call(files, function(file) {
				return readFileAsText(file).then(function(result) {
					return {
						file: file,
						name: file.name,
						result: result
					};
				});
			})).then(function(filesData) {
				var sourceMapFile;
				var generatedFile;
				var javascriptWithSourceMap = filesData.filter(function(data) {
					return (/\.js$/.test(data.name) && SOURCE_MAPPING_URL_REG_EXP.test(data.result)) ||
						(/\.(css|js)$/.test(data.name) && SOURCE_MAPPING_URL_REG_EXP2.test(data.result));
				})[0];

				if(javascriptWithSourceMap) {
					if(typeof atob !== "function") {
						throw new Error("Your browser doesn't support atob. Cannot decode base64.");
					}
					generatedFile = javascriptWithSourceMap;
					filesData.splice(filesData.indexOf(generatedFile), 1);
					var extracted = extractInlineSourceMap(generatedFile.result);
					if(!extracted) {
						throw new Error("Cannot decode embedded SourceMap.");
					}
					generatedFile.result = extracted.generatedSource;
					sourceMapFile = {
						result: JSON.stringify(extracted.sourceMap),
						json: extracted.sourceMap
					};
				} else {
					var mapFiles = filesData.filter(function(data) {
						return /\.map$/.test(data.name);
					});
					if(mapFiles.length === 1) {
						sourceMapFile = mapFiles[0];
						filesData.splice(filesData.indexOf(sourceMapFile), 1);
					} else {
						var jsonFiles = filesData.filter(function(data) {
							return /\.json$/.test(data.name);
						});
						if(jsonFiles.length === 1) {
							sourceMapFile = jsonFiles[0];
							filesData.splice(filesData.indexOf(sourceMapFile), 1);
						} else {
							throw new Error("No SourceMap provided.");
						}
					}
					sourceMapFile.json = JSON.parse(sourceMapFile.result);
					validateSourceMap(sourceMapFile.json);

					var name = sourceMapFile.json.file;
					generatedFile = filesData.filter(function(data) {
						return data.name === name;
					})[0] || filesData.filter(function(data) {
						return /\.js$/.test(data.name);
					})[0];
					if(!generatedFile) {
						throw new Error("No original file provided.");
					}
					filesData.splice(filesData.indexOf(generatedFile), 1);
				}

				var providedSourcesContent = filesData.map(function(data) {
					return data.result;
				});
				var sourcesContentSet = sourceMapFile.json.sourcesContent && sourceMapFile.json.sourcesContent.length > 0;
				if(providedSourcesContent.length > 0 && sourcesContentSet) {
					throw new Error("Provided source files, but sourcesContent already provided within SourceMap.");
				}
				return {
					sourcesContent: sourcesContentSet ? sourceMapFile.json.sourcesContent : providedSourcesContent,
					generatedSource: generatedFile.result,
					sourceMap: sourceMapFile.json
				};
			});
		}

		handleItemHover(mappingKey) {
			this.state.selectedMappingKey = mappingKey;
		}

		handleItemActivate(ev, mappingKey) {
			this.state.selectedMappingKey = mappingKey;
			var root = this.rootRef.el || document.body;
			var items = root.querySelectorAll('[data-mapping-key="' + mappingKey + '"]');
			Array.prototype.forEach.call(items, function(elem) {
				if(elem === ev.currentTarget) return;
				if("scrollIntoViewIfNeeded" in elem) {
					elem.scrollIntoViewIfNeeded();
					return;
				}
				elem.scrollIntoView({
					behavior: "smooth",
					block: "nearest",
					inline: "nearest"
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
			if(!this.pendingCustomFile) return;
			var step = this.state.custom.step;
			this.state.custom.error = "";
			readFileAsText(this.pendingCustomFile).then(function(result) {
				this.pendingCustomFile = null;
				this.state.custom.hasPendingFile = false;
				if(step === "step1") {
					this.handleGeneratedSource(result);
					return;
				}
				if(step === "step2") {
					this.handleCustomSourceMap(result);
					return;
				}
				if(step === "step3") {
					this.handleCustomSource(result);
				}
			}.bind(this)).catch(function(err) {
				this.state.custom.error = err.message;
			}.bind(this));
		}

		handleGeneratedSource(generatedSource) {
			var custom = this.state.custom;
			custom.generatedSource = generatedSource;
			var extracted = extractInlineSourceMap(generatedSource);
			if(extracted) {
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
				var sourceMap = JSON.parse(sourceMapText);
				validateSourceMap(sourceMap);
				this.state.custom.sourceMap = sourceMap;
				this.state.custom.sourcesContent = [];
				this.advanceCustomStep();
			} catch(err) {
				this.state.custom.error = err.message;
			}
		}

		handleCustomSource(originalSource) {
			this.state.custom.sourcesContent[this.state.custom.sourceFileIndex] = originalSource;
			this.advanceCustomStep();
		}

		advanceCustomStep() {
			var custom = this.state.custom;
			if(!custom.sourceMap || !custom.sourceMap.sources || !custom.sourceMap.mappings) {
				custom.error = "This is not a valid SourceMap.";
				return;
			}
			if(custom.sourceMap.sourcesContent) {
				custom.sourcesContent = custom.sourceMap.sourcesContent.slice();
				this.finishCustomFlow();
				return;
			}
			for(var i = 0; i < custom.sourceMap.sources.length; i++) {
				if(!custom.sourcesContent[i]) {
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
			} catch(err) {
				this.state.custom.error = err.message;
				if(err.stack) {
					console.error(err.stack);
				}
			}
		}

		onMinify() {
			var currentExample = this.state.currentExample;
			if(!currentExample) return;
			try {
				var result = UglifyJS.minify(currentExample.generatedSource, {
					outSourceMap: "example.map",
					output: {
						beautify: true
					}
				});
				var minmap = JSON.parse(result.map);
				minmap.file = "example";
				minmap = new SourceMap.SourceMapConsumer(result.map);
				minmap = SourceMap.SourceMapGenerator.fromSourceMap(minmap);
				minmap.setSourceContent("?", currentExample.generatedSource);
				currentExample.sourceMap.sourcesContent = currentExample.sources;
				minmap.applySourceMap(new SourceMap.SourceMapConsumer(currentExample.sourceMap), "?");
				minmap = minmap.toJSON();
				this.loadCustomExample(minmap.sourcesContent, result.code, minmap);
				this.oldHash = "custom";
				window.location.hash = "custom";
			} catch(err) {
				this.state.pageError = err.message;
			}
		}
	}

	App.components = {
		CodeBlock: CodeBlock
	};

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
					onHover="handleItemHover"
					onActivate="handleItemActivate"
				/>
			</t>
			<div t-else="" class="page-empty">Choose an example or load your own SourceMap bundle.</div>
		</main>

		<footer>
			<t t-if="state.visualization">
				<CodeBlock
					block="state.visualization.mappings"
					selectedKey="state.selectedMappingKey"
					onHover="handleItemHover"
					onActivate="handleItemActivate"
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

	var mountTarget = document.createElement("div");
	document.body.appendChild(mountTarget);
	mount(App, mountTarget);
}).catch(function(err) {
	console.error(err);
	document.body.innerHTML = '<pre style="padding:16px;color:#b42318;font-family:monospace;">' + err.message + "</pre>";
});
