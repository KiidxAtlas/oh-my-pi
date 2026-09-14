import type { Model } from "@oh-my-pi/pi-ai";

/**
 * Built-in roles that should follow the selected default model. Custom roles
 * are deliberately left alone: they are usually a user's named workflow.
 */
export const FAMILY_ROUTED_MODEL_ROLES = [
	"default",
	"smol",
	"slow",
	"vision",
	"plan",
	"commit",
	"tiny",
	"task",
	"advisor",
] as const;

type RoutedRole = (typeof FAMILY_ROUTED_MODEL_ROLES)[number];

function selector(model: Model): string {
	return `${model.provider}/${model.id}`;
}

function chooseSameProvider(selected: Model, available: readonly Model[], patterns: readonly RegExp[]): Model {
	const candidates = available.filter(model => model.provider === selected.provider);
	for (const pattern of patterns) {
		const match = candidates.find(model => pattern.test(model.id));
		if (match) return match;
	}
	return selected;
}

function isLocalProvider(provider: string): boolean {
	return new Set(["omlx", "ollama", "llama.cpp", "lm-studio", "vllm", "localai"]).has(provider);
}

/**
 * Resolve same-provider role assignments for a selected default model.
 *
 * This is intentionally conservative. A missing sibling never escapes to a
 * different provider; it falls back to the selected model instead. That makes
 * local selection strictly local and avoids surprise API use.
 */
export function resolveFamilyRoleRouting(selected: Model, available: readonly Model[]): Record<RoutedRole, string> {
	const roles = Object.fromEntries(FAMILY_ROUTED_MODEL_ROLES.map(role => [role, selector(selected)])) as Record<
		RoutedRole,
		string
	>;

	if (isLocalProvider(selected.provider)) return roles;

	if (selected.provider === "anthropic") {
		const fast = chooseSameProvider(selected, available, [/claude-haiku/i]);
		const standard = chooseSameProvider(selected, available, [/claude-sonnet/i]);
		const strong = chooseSameProvider(selected, available, [/claude-opus/i]);
		for (const role of ["smol", "tiny"] as const) roles[role] = selector(fast);
		for (const role of ["slow", "task", "commit"] as const) roles[role] = selector(standard);
		for (const role of ["plan", "advisor"] as const) roles[role] = selector(strong);
		return roles;
	}

	if (selected.provider === "openai-codex") {
		const fast = chooseSameProvider(selected, available, [/gpt-5\.6-luna/i, /gpt-5\.3-codex-spark/i, /mini/i]);
		const standard = chooseSameProvider(selected, available, [/gpt-5\.6-terra/i, /gpt-5\.6-sol/i]);
		const strong = chooseSameProvider(selected, available, [/gpt-6-astra/i, /gpt-5\.6-sol/i, /gpt-5\.6-terra/i]);
		for (const role of ["smol", "tiny"] as const) roles[role] = selector(fast);
		for (const role of ["slow", "task", "commit"] as const) roles[role] = selector(standard);
		for (const role of ["plan", "advisor"] as const) roles[role] = selector(strong);
	}

	return roles;
}
