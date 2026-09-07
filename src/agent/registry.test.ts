import { describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { DefaultToolRegistry } from "./registry";
import type { AgentServices } from "./services";
import type { AgentToolContext, AgentToolDefinition } from "./contracts";

const services = {} as AgentServices;
const schema = Type.Object({ value: Type.String() });

function context(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return { sessionId: "test-session", services, ...overrides };
}

describe("DefaultToolRegistry", () => {
  it("registers and exposes tools through the AgentTool adapter", async () => {
    const registry = new DefaultToolRegistry();
    const tool: AgentToolDefinition<typeof schema, { value: string }> = {
      id: "test.echo",
      label: "Echo",
      description: "Returns its input",
      permission: "read",
      schema,
      async execute(_context, params) {
        return { data: params, modelText: params.value };
      },
    };
    registry.register(tool);

    expect(registry.get("test.echo")).toBe(tool);
    expect(registry.list()).toHaveLength(1);
    const [agentTool] = registry.createAgentTools(context());
    await expect(agentTool.execute("call-1", { value: "ok" })).resolves.toMatchObject({
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("rejects duplicate ids and gates write tools behind confirmation", async () => {
    const registry = new DefaultToolRegistry();
    const tool: AgentToolDefinition<typeof schema, null> = {
      id: "test.write",
      label: "Write",
      description: "Writes something",
      permission: "write",
      schema,
      execute: vi.fn(async () => ({ data: null, modelText: "done" })),
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow("重复注册");

    const [agentTool] = registry.createAgentTools(context({ confirm: vi.fn(async () => false) }));
    await expect(agentTool.execute("call-2", { value: "x" })).rejects.toThrow("用户拒绝");
    expect(tool.execute).not.toHaveBeenCalled();
  });
});
