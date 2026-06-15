import { type ProviderConfig, resolveAPIKey } from "../config/config";

const MODEL_FETCH_TIMEOUT_MS = 3000;

export async function fetchModelContextWindow(
	config: ProviderConfig,
): Promise<number> {
	if (config.protocol !== "anthropic") {
		return 0;
	}
	const apiKey = resolveAPIKey(config);
	const base = config.base_url.replace(/\/+$/, "");
	const url = `${base}/api/models/${encodeURIComponent(config.model)}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "GET",
			headers: {
				"anthropic-version": "2023-06-01",
				...(apiKey ? { "x-api-key": apiKey } : {}),
			},
			signal: controller.signal,
		});
	} catch (e) {
		console.error(e);
		return 0;
	} finally {
		clearTimeout(timer);
	}

	return 0;
}
