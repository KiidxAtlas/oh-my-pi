import type { Model } from "@oh-my-pi/pi-ai";
import { isRecord } from "@oh-my-pi/pi-utils";
import { isLoopbackUrl } from "../utils/loopback";
import { formatModelStringWithRouting } from "./model-resolver";

/** Built-in roles a preset always covers. The selected model remains the default role. */
export const MODEL_PRESET_ROLES = ["smol", "slow", "vision", "plan", "commit", "tiny", "task", "advisor"] as const;

/**
 * One saved role profile. Built-in roles are always represented; user-defined
 * roles created in the Roles view are carried verbatim so saving a preset does
 * not silently drop them.
 */
export type ModelRolePreset = Partial<Record<string, string>>;

const MODEL_ROLE_PRESET_NAME_PATTERN = /^[a-zA-Z][\w -]*$/;

export function isModelRolePresetName(value: string): boolean {
	return value.toLowerCase() !== "default" && MODEL_ROLE_PRESET_NAME_PATTERN.test(value);
}

/**
 * Roles a preset assigns: its built-in set, any custom roles it carries, and any
 * `extraRoleKeys` a caller must also visit — replacement semantics pass the
 * target scope's stored role keys so a custom role omitted from the incoming
 * preset is still cleared.
 */
export function modelRolePresetRoles(preset: ModelRolePreset | undefined, extraRoleKeys?: Iterable<string>): string[] {
	const roles: string[] = [...MODEL_PRESET_ROLES];
	const add = (role: string): void => {
		if (role !== "default" && !roles.includes(role)) roles.push(role);
	};
	for (const role in preset) add(role);
	if (extraRoleKeys) for (const role of extraRoleKeys) add(role);
	return roles;
}

function toRolePreset(value: unknown): ModelRolePreset | undefined {
	if (!isRecord(value)) return undefined;
	const result: ModelRolePreset = {};
	// Every configured role except `default` (the preset's own model) round-trips,
	// so a custom role survives a save/apply cycle.
	for (const role in value) {
		if (role === "default") continue;
		const assignment = value[role];
		if (typeof assignment === "string") result[role] = assignment;
	}
	return result;
}

function selector(model: Model): string {
	return `${model.provider}/${model.id}`;
}

function storedPresets(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	return isRecord(value.presets) ? value.presets : undefined;
}

function curatedModel(selected: Model, available: readonly Model[], role: "smol" | "slow"): Model {
	let best = selected;
	let bestPriority = Infinity;
	for (const candidate of available) {
		if (candidate.provider !== selected.provider) continue;
		const priority = candidate.rolePresetPriority?.[role];
		if (priority === undefined) continue;
		if (priority < bestPriority || (priority === bestPriority && candidate.id < best.id)) {
			best = candidate;
			bestPriority = priority;
		}
	}
	return best;
}

/** Same-provider catalog-ranked choices; eligibility and priority are authored in KDL. */
export function buildDefaultModelRolePreset(selected: Model, available: readonly Model[]): ModelRolePreset {
	const selectedSelector = formatModelStringWithRouting(selected);
	const sameModel = Object.fromEntries(MODEL_PRESET_ROLES.map(role => [role, selectedSelector])) as ModelRolePreset;
	if (isLoopbackUrl(selected.baseUrl)) return sameModel;
	const fast = curatedModel(selected, available, "smol");
	const comprehensive = curatedModel(selected, available, "slow");
	return {
		...sameModel,
		smol: formatModelStringWithRouting(fast),
		tiny: formatModelStringWithRouting(fast),
		slow: formatModelStringWithRouting(comprehensive),
		task: formatModelStringWithRouting(comprehensive),
		commit: formatModelStringWithRouting(comprehensive),
		plan: formatModelStringWithRouting(comprehensive),
		advisor: formatModelStringWithRouting(comprehensive),
	};
}

/** Return valid saved-preset names for one selected model. */
export function getModelRolePresetNames(value: unknown, model: Model): string[] {
	if (!isRecord(value)) return [];
	const presets = storedPresets(value[selector(model)]);
	if (!presets) return [];
	return Object.keys(presets)
		.filter(name => isModelRolePresetName(name) && isRecord(presets[name]))
		.sort((a, b) => a.localeCompare(b));
}

/** Look up a saved preset. Undefined means use OMP's curated default. */
export function getModelRolePreset(
	value: unknown,
	model: Model,
	name: string | undefined,
): ModelRolePreset | undefined {
	if (!name || !isModelRolePresetName(name) || !isRecord(value)) return undefined;
	const presets = storedPresets(value[selector(model)]);
	if (!presets || !isRecord(presets[name])) return undefined;
	return toRolePreset(presets[name]);
}

/** A model's saved Default, or undefined for OMP's built-in Default. */
export function getModelRolePresetDefault(value: unknown, model: Model): ModelRolePreset | undefined {
	if (!isRecord(value)) return undefined;
	const entry = value[selector(model)];
	if (!isRecord(entry)) return undefined;
	const direct = toRolePreset(entry.default);
	if (direct) return direct;
	return typeof entry.default === "string" ? getModelRolePreset(value, model, entry.default) : undefined;
}

/** The named preset selected as Default, if any. Undefined means the Default row. */
export function getModelRolePresetDefaultName(value: unknown, model: Model): string | undefined {
	if (!isRecord(value)) return undefined;
	const entry = value[selector(model)];
	if (!isRecord(entry) || typeof entry.default !== "string" || !isModelRolePresetName(entry.default)) {
		return undefined;
	}
	return getModelRolePreset(value, model, entry.default) ? entry.default : undefined;
}

/** Add or replace one named preset while preserving presets for other models. */
export function saveModelRolePreset(
	value: unknown,
	model: Model,
	name: string,
	roles: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
	const next: Record<string, unknown> = isRecord(value) ? { ...value } : {};
	if (!isModelRolePresetName(name)) return next;
	const current = next[selector(model)];
	next[selector(model)] = {
		...(isRecord(current) ? current : {}),
		presets: { ...storedPresets(current), [name]: toRolePreset(roles) },
	};
	return next;
}

/** Save the current role assignment map as this model's Default preset. */
export function saveModelRolePresetDefault(
	value: unknown,
	model: Model,
	roles: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
	const next: Record<string, unknown> = isRecord(value) ? { ...value } : {};
	const current = next[selector(model)];
	next[selector(model)] = {
		...(isRecord(current) ? current : {}),
		default: toRolePreset(roles),
	};
	return next;
}

/** Remove a model's saved Default and restore OMP's built-in Default. */
export function resetModelRolePresetDefault(value: unknown, model: Model): Record<string, unknown> {
	const next: Record<string, unknown> = isRecord(value) ? { ...value } : {};
	const current = next[selector(model)];
	if (isRecord(current)) {
		const entry = { ...current };
		delete entry.default;
		if (isRecord(entry.presets) && Object.keys(entry.presets).length === 0) delete entry.presets;
		if (Object.keys(entry).length === 0) delete next[selector(model)];
		else next[selector(model)] = entry;
	}
	return next;
}

/** Select a named preset as Default; undefined restores OMP's built-in Default. */
export function setModelRolePresetDefault(
	value: unknown,
	model: Model,
	name: string | undefined,
): Record<string, unknown> {
	if (name === undefined) return resetModelRolePresetDefault(value, model);
	const next: Record<string, unknown> = isRecord(value) ? { ...value } : {};
	if (!isModelRolePresetName(name)) return next;
	const current = next[selector(model)];
	const presets = storedPresets(current);
	if (!presets || !isRecord(presets[name])) return next;
	next[selector(model)] = { ...(isRecord(current) ? current : {}), default: name };
	return next;
}

/** Delete a named preset; deleting the named Default restores OMP's built-in Default. */
export function deleteModelRolePreset(value: unknown, model: Model, name: string): Record<string, unknown> {
	const next: Record<string, unknown> = isRecord(value) ? { ...value } : {};
	if (!isModelRolePresetName(name)) return next;
	const current = next[selector(model)];
	const presets = storedPresets(current);
	if (!isRecord(current) || !presets || !Object.hasOwn(presets, name)) return next;
	const remaining = { ...presets };
	delete remaining[name];
	const entry: Record<string, unknown> = { ...current, presets: remaining };
	if (entry.default === name) delete entry.default;
	if (Object.keys(remaining).length === 0) delete entry.presets;
	if (Object.keys(entry).length === 0) delete next[selector(model)];
	else next[selector(model)] = entry;
	return next;
}
