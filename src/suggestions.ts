export interface SuggestionInput {
  name: string;
  status?: string;
  gitlabBranch?: string | null;
}

/**
 * Trap 7: after a pin, always point back at `unpin`.
 * Trap-adjacent: an `error` status always points at `logs` to see why.
 */
export function getSuggestions(input: SuggestionInput): string[] {
  const lines: string[] = [];
  if (input.gitlabBranch && input.gitlabBranch !== "main") {
    lines.push(
      `Run \`dokploy-axi service unpin ${input.name}\` to return to \`main\``,
    );
  }
  if (input.status === "error") {
    lines.push(`Run \`dokploy-axi logs ${input.name}\` to see why`);
  }
  return lines;
}
