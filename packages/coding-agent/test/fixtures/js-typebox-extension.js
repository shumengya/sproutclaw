import { Type } from "typebox";

export default function (pi) {
	pi.registerTool({
		name: "js-tool",
		label: "js-tool",
		description: "Native JS extension tool",
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
	});
}
