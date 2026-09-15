import { describe, expect, test } from "bun:test";
import type { Model } from "@oh-my-pi/pi-ai";
import {
	buildDefaultModelRolePreset,
	deleteModelRolePreset,
	getModelRolePreset,
	getModelRolePresetDefault,
	getModelRolePresetDefaultName,
	getModelRolePresetNames,
	isModelRolePresetName,
	resetModelRolePresetDefault,
	saveModelRolePreset,
	saveModelRolePresetDefault,
	setModelRolePresetDefault,
} from "../src/config/model-role-presets";

function model(provider: string, id: string, baseUrl: string = "https://api.example.test/v1"): Model {
	return { provider, id, baseUrl } as Model;
}

const opus = model("anthropic", "claude-opus-5");
const cheapRoles = { smol: "anthropic/claude-haiku-4-5" };
const qualityRoles = { plan: "anthropic/claude-opus-5", task: "anthropic/claude-opus-5" };

describe("built-in model role presets", () => {
	test("uses curated priority order within the selected provider without comparing generations", () => {
		const selected = { ...opus, identity: { revision: "9.0.0" } } as Model;
		const haiku = { ...model("anthropic", "claude-haiku-4-5"), identity: { revision: "4.5.0" } } as Model;
		const preset = buildDefaultModelRolePreset(selected, [
			selected,
			model("google", "gemini-3.8-flash"),
			model("openai-codex", "gpt-5.6-sol"),
			model("anthropic", "claude-fable-5"),
			model("anthropic", "claude-fable-5-1"),
			haiku,
		]);
		expect(preset).toEqual({
			smol: "anthropic/claude-haiku-4-5",
			tiny: "anthropic/claude-haiku-4-5",
			slow: "anthropic/claude-fable-5-1",
			task: "anthropic/claude-fable-5-1",
			commit: "anthropic/claude-fable-5-1",
			plan: "anthropic/claude-fable-5-1",
			advisor: "anthropic/claude-fable-5-1",
			vision: "anthropic/claude-opus-5",
		});
	});

	test("falls back to the selected model rather than fuzzy retired or foreign-provider matches", () => {
		const preset = buildDefaultModelRolePreset(opus, [
			opus,
			model("anthropic", "claude-3-haiku-20240307"),
			model("anthropic", "claude-haiku-4-5-custom"),
			model("other-provider", "claude-haiku-4-5"),
		]);
		expect(preset.smol).toBe("anthropic/claude-opus-5");
		expect(preset.tiny).toBe("anthropic/claude-opus-5");
	});

	test.each(["http://localhost:8000/v1", "http://127.0.0.2:8000/v1", "http://[::1]:8000/v1"])(
		"keeps all roles on a local model at %s even with same-provider curated alternatives",
		baseUrl => {
			const local = model("custom", "local-model", baseUrl);
			const preset = buildDefaultModelRolePreset(local, [
				local,
				model("custom", "claude-haiku-4-5"),
				model("custom", "claude-fable-5-1"),
			]);
			expect(preset).toEqual({
				smol: "custom/local-model",
				tiny: "custom/local-model",
				slow: "custom/local-model",
				task: "custom/local-model",
				commit: "custom/local-model",
				plan: "custom/local-model",
				advisor: "custom/local-model",
				vision: "custom/local-model",
			});
		},
	);
});

describe("saved model role presets", () => {
	test("rejects reserved Default names in every case without hidden saves or lost defaults", () => {
		const original = saveModelRolePresetDefault({}, opus, qualityRoles);
		for (const name of ["default", "Default", "dEfAuLt"]) {
			expect(isModelRolePresetName(name)).toBe(false);
			expect(saveModelRolePreset(original, opus, name, cheapRoles)).toEqual(original);
			expect(setModelRolePresetDefault(original, opus, name)).toEqual(original);
			expect(deleteModelRolePreset(original, opus, name)).toEqual(original);
			expect(getModelRolePreset(original, opus, name)).toBeUndefined();
		}
		expect(getModelRolePresetNames(original, opus)).toEqual([]);
		expect(getModelRolePresetDefault(original, opus)).toEqual(qualityRoles);
	});

	test("accepts valid names and filters malformed names and stored role values", () => {
		const name = "Cheap roles_2-fast";
		expect(isModelRolePresetName(name)).toBe(true);
		const saved = saveModelRolePreset({}, opus, name, { ...cheapRoles, default: "other/model", slow: undefined });
		expect(getModelRolePreset(saved, opus, name)).toEqual(cheapRoles);
		const malformed = {
			"anthropic/claude-opus-5": {
				presets: {
					[name]: { ...cheapRoles, plan: 4, default: "other/model" },
					"bad/name": cheapRoles,
					Default: cheapRoles,
					broken: [],
				},
			},
		};
		expect(getModelRolePresetNames(malformed, opus)).toEqual([name]);
		expect(getModelRolePreset(malformed, opus, name)).toEqual(cheapRoles);
		expect(saveModelRolePreset(saved, opus, "bad/name", qualityRoles)).toEqual(saved);
	});

	test("updates and deletes names without mutating inputs or other models and options", () => {
		const other = model("other-provider", opus.id);
		const original = saveModelRolePreset({ autoLoad: false, applyOnSelect: true }, other, "cheap", qualityRoles);
		const cheap = saveModelRolePreset(original, opus, "cheap", cheapRoles);
		const saved = saveModelRolePreset(cheap, opus, "quality", qualityRoles);
		const updated = saveModelRolePreset(saved, opus, "cheap", { tiny: "custom/model" });
		expect(getModelRolePresetNames(original, opus)).toEqual([]);
		expect(getModelRolePresetNames(updated, opus)).toEqual(["cheap", "quality"]);
		expect(getModelRolePreset(saved, opus, "cheap")).toEqual(cheapRoles);
		expect(getModelRolePreset(updated, opus, "cheap")).toEqual({ tiny: "custom/model" });
		const deleted = deleteModelRolePreset(updated, opus, "quality");
		expect(getModelRolePresetNames(deleted, opus)).toEqual(["cheap"]);
		expect(getModelRolePresetNames(updated, opus)).toEqual(["cheap", "quality"]);
		expect(getModelRolePreset(deleted, other, "cheap")).toEqual(qualityRoles);
		expect(deleted.autoLoad).toBe(false);
		expect(deleted.applyOnSelect).toBe(true);
	});

	test("ignores obsolete flat presets while retaining direct and named defaults in current storage", () => {
		const flat = { "anthropic/claude-opus-5": { cheap: cheapRoles, default: "cheap" } };
		expect(getModelRolePresetNames(flat, opus)).toEqual([]);
		expect(getModelRolePreset(flat, opus, "cheap")).toBeUndefined();
		expect(getModelRolePresetDefault(flat, opus)).toBeUndefined();
		expect(getModelRolePresetDefaultName(flat, opus)).toBeUndefined();
		const named = { "anthropic/claude-opus-5": { presets: { cheap: cheapRoles }, default: "cheap" } };
		expect(getModelRolePresetDefault(named, opus)).toEqual(cheapRoles);
		expect(getModelRolePresetDefaultName(named, opus)).toBe("cheap");
		const direct = { "anthropic/claude-opus-5": { default: qualityRoles } };
		expect(getModelRolePresetDefault(direct, opus)).toEqual(qualityRoles);
		expect(getModelRolePresetDefaultName(direct, opus)).toBeUndefined();
	});

	test("transitions between built-in, direct and named defaults without losing named presets or options", () => {
		const original = saveModelRolePreset({ autoLoad: false }, opus, "cheap", cheapRoles);
		expect(getModelRolePresetDefault(original, opus)).toBeUndefined();
		const direct = saveModelRolePresetDefault(original, opus, qualityRoles);
		expect(getModelRolePresetDefault(direct, opus)).toEqual(qualityRoles);
		expect(getModelRolePresetDefaultName(direct, opus)).toBeUndefined();
		const named = setModelRolePresetDefault(direct, opus, "cheap");
		expect(getModelRolePresetDefault(named, opus)).toEqual(cheapRoles);
		expect(getModelRolePresetDefaultName(named, opus)).toBe("cheap");
		expect(setModelRolePresetDefault(named, opus, "missing")).toEqual(named);
		const edited = saveModelRolePreset(named, opus, "cheap", { tiny: "custom/model" });
		expect(getModelRolePresetDefault(edited, opus)).toEqual({ tiny: "custom/model" });
		expect(getModelRolePresetDefault(named, opus)).toEqual(cheapRoles);
		const restored = setModelRolePresetDefault(edited, opus, undefined);
		expect(getModelRolePresetDefault(restored, opus)).toBeUndefined();
		expect(getModelRolePresetDefaultName(restored, opus)).toBeUndefined();
		expect(getModelRolePresetNames(restored, opus)).toEqual(["cheap"]);
		expect(restored.autoLoad).toBe(false);
		const overwritten = saveModelRolePresetDefault(named, opus, qualityRoles);
		expect(getModelRolePresetDefaultName(overwritten, opus)).toBeUndefined();
		expect(getModelRolePresetDefault(overwritten, opus)).toEqual(qualityRoles);
		expect(resetModelRolePresetDefault(overwritten, opus)).toEqual(original);
		const empty = saveModelRolePresetDefault(named, opus, {});
		expect(getModelRolePresetDefault(empty, opus)).toEqual({});
		expect(getModelRolePresetDefaultName(empty, opus)).toBeUndefined();
	});

	test("deleting a named default restores built-in while unrelated deletion preserves direct defaults", () => {
		const saved = saveModelRolePreset({}, opus, "cheap", cheapRoles);
		const named = setModelRolePresetDefault(saved, opus, "cheap");
		const deleted = deleteModelRolePreset(named, opus, "cheap");
		expect(getModelRolePresetDefault(deleted, opus)).toBeUndefined();
		expect(getModelRolePresetDefaultName(deleted, opus)).toBeUndefined();
		expect(getModelRolePresetDefault(named, opus)).toEqual(cheapRoles);
		const direct = saveModelRolePresetDefault(saved, opus, qualityRoles);
		expect(getModelRolePresetDefault(deleteModelRolePreset(direct, opus, "cheap"), opus)).toEqual(qualityRoles);
		expect(deleteModelRolePreset(direct, opus, "missing")).toEqual(direct);
		expect(deleted).toEqual({});
		expect(deleteModelRolePreset(direct, opus, "cheap")).toEqual({
			"anthropic/claude-opus-5": { default: qualityRoles },
		});
	});
});

test("resetting the last Default removes its model entry without removing other settings", () => {
	const original = {
		applyOnSelect: false,
		"anthropic/claude-opus-5": { presets: {}, default: {} },
		"other/model": { default: cheapRoles },
	};
	expect(resetModelRolePresetDefault(original, opus)).toEqual({
		applyOnSelect: false,
		"other/model": { default: cheapRoles },
	});
	expect(original["anthropic/claude-opus-5"]).toEqual({ presets: {}, default: {} });
});
