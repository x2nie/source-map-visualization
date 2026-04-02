var path = require("path");
var HtmlPlugin = require("html-webpack-plugin");

module.exports = {
	entry: "./app/app.js",
	output: {
		path: path.join(__dirname, "build"),
		filename: "bundle.js"
	},
	module: {
		loaders: [
			{ test: /\.json$/, loader: "json-loader" },
			{ test: /\.css$/,  loader: "style-loader!css-loader" },
			{ test: /\.less$/,  loader: "style-loader!css-loader!less-loader" },
			{ test: /\.png$/,  loader: "url-loader?limit=5000&minetype=image/png" }
		]
	},
	plugins: [
		new HtmlPlugin({
			title: "source-map-visualization"
		})
	],
	cache: true,
	devtool: "source-map"
};
