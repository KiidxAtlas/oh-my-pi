import { describe, expect, test } from "bun:test";
import type { Model } from "@oh-my-pi/pi-ai";
import { resolveFamilyRoleRouting } from "../src/config/model-family-routing";

function model(provider: string, id: string): Model {
	return { provider, id } as Model;
}

describe("family-aware model role routing", () => {
	test("maps Claude roles to available Claude tiers without crossing providers", () => {
		const opus = model("anthropic", "claude-opus-5");
		const routes = resolveFamilyRoleRouting(opus, [
			opus,
			model("anthropic", "claude-haiku-4-5"),
			model("anthropic", "claude-sonnet-5"),
		]);
		expect(routes.default).toBe("anthropic/claude-opus-5");
		expect(routes.smol).toBe("anthropic/claude-haiku-4-5");
		expect(routes.slow).toBe("anthropic/claude-sonnet-5");
		expect(routes.plan).toBe("anthropic/claude-opus-5");
	});

	test("uses the selected local model for every built-in role", () => {
		const local = model("omlx", "Qwen3.8-27B-MLX-5bit");
		const routes = resolveFamilyRoleRouting(local, [local, model("anthropic", "claude-haiku-4-5")]);
		for (const selector of Object.values(routes)) expect(selector).toBe("omlx/Qwen3.8-27B-MLX-5bit");
	});

	test("falls back to the selected model when a cloud sibling is unavailable", () => {
		const terra = model("openai-codex", "gpt-5.6-terra");
		const routes = resolveFamilyRoleRouting(terra, [terra, model("anthropic", "claude-haiku-4-5")]);
		expect(routes.smol).toBe("openai-codex/gpt-5.6-terra");
		expect(routes.advisor).toBe("openai-codex/gpt-5.6-terra");
	});
});
