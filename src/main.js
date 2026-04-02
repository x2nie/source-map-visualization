import { loadFile, mount } from "@odoo/owl";

import "./app.less";
import App from "./app";

async function bootstrap() {
	const templates = await loadFile("/template/app.xml");
	const mountTarget = document.createElement("div");
	document.body.appendChild(mountTarget);
	await mount(App, mountTarget, {
		templates,
	});
}

bootstrap().catch((err) => {
	console.error(err);
	document.body.innerHTML = `<pre style="padding:16px;color:#b42318;font-family:monospace;">${err.message}</pre>`;
});
