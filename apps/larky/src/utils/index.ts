export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
	if (isRecord(value)) {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.fromEntries(value.entries());
	}
	return {};
}

export function asString(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}

	// // For exception
	// if (value instanceof Error) {
	//   return value.message
	// }

	return String(value);
}

export function asErrorString(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}
	return asString(value);
}
