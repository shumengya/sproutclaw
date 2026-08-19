/**
 * Localize common runtime / network error text fragments to Chinese for display.
 * Keep English in stored errorMessage so retry classifiers stay intact.
 */
export function localizeErrorText(message: string): string {
	let text = message;

	text = text.replace(
		/The socket connection was closed unexpectedly\.\s*For more information, pass `verbose: true` in the second argument\s+to fetch\(\)/gi,
		"流式连接中途断开。通常是网关/代理超时或上游断流，可自动重试。",
	);
	text = text.replace(
		/The socket connection was closed unexpectedly\.?/gi,
		"流式连接中途断开。通常是网关/代理超时或上游断流，可自动重试。",
	);
	text = text.replace(/socket hang up/gi, "连接意外断开");
	text = text.replace(/TypeError:\s*fetch failed:\s*/gi, "网络请求失败：");
	text = text.replace(/fetch failed:\s*/gi, "网络请求失败：");
	text = text.replace(/fetch failed/gi, "网络请求失败");

	return text;
}
