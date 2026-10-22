/**
 * Elicitation helpers for MCP tool handlers.
 * All functions gracefully return null if the client doesn't support elicitation.
 */
import { getServerRef } from "./server-ref.js";

export interface ElicitOption {
  value: string;
  label: string;
}

/**
 * Ask the user to select from a list of options.
 */
export async function elicitSelection(
  message: string,
  fieldName: string,
  options: ElicitOption[]
): Promise<string | null> {
  const server = getServerRef();
  if (!server) return null;

  try {
    const result = await server.elicitInput({
      message,
      requestedSchema: {
        type: "object" as const,
        properties: {
          [fieldName]: {
            type: "string" as const,
            title: fieldName,
            description: `Select a ${fieldName}`,
            enum: options.map((o) => o.value),
            enumNames: options.map((o) => o.label),
          },
        },
        required: [fieldName],
      },
    });

    if (result.action === "accept" && result.content) {
      return result.content[fieldName] as string;
    }
    return null;
  } catch {
    return null;
  }
}
