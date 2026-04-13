type PromptfooAssertionContext = {
  config?: Record<string, unknown>;
  providerResponse?: {
    metadata?: {
      durationMs?: number;
      requiresApproval?: boolean;
      pendingToolName?: string | null;
      pendingPreviewType?: string | null;
      pendingSummary?: string | null;
      pendingCreatedAt?: string | null;
      pendingExpiresAt?: string | null;
      toolCallsMade?: string[];
      toolErrors?: string[];
      artifactTypes?: string[];
      rawText?: string;
    };
  };
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function containsEvery(haystack: string[], needles: string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

function containsNone(haystack: string[], needles: string[]): boolean {
  return needles.every((needle) => !haystack.includes(needle));
}

function textContainsEvery(haystack: string, needles: string[]): boolean {
  const lowered = haystack.toLowerCase();
  return needles.every((needle) => lowered.includes(needle.toLowerCase()));
}

function textContainsAny(haystack: string, needles: string[]): boolean {
  if (needles.length === 0) {
    return true;
  }
  const lowered = haystack.toLowerCase();
  return needles.some((needle) => lowered.includes(needle.toLowerCase()));
}

function textContainsNone(haystack: string, needles: string[]): boolean {
  const lowered = haystack.toLowerCase();
  return needles.every((needle) => !lowered.includes(needle.toLowerCase()));
}

function textMatchesAnyRegex(haystack: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => new RegExp(pattern, "i").test(haystack));
}

function textMatchesNoRegex(haystack: string, patterns: string[]): boolean {
  return patterns.every((pattern) => !new RegExp(pattern, "i").test(haystack));
}

function hasMarkdownTable(text: string): boolean {
  return /^\s*\|.+\|\s*$/m.test(text);
}

export default function checkAgentTurn(output: string, context: PromptfooAssertionContext) {
  const config = context.config ?? {};
  const metadata = context.providerResponse?.metadata ?? {};
  const toolCallsMade = asStringArray(metadata.toolCallsMade);
  const toolErrors = asStringArray(metadata.toolErrors);
  const artifactTypes = asStringArray(metadata.artifactTypes);
  const outputText = `${metadata.rawText ?? ""}\n${output}`.trim();

  const failures: string[] = [];

  if (
    typeof config.requiresApproval === "boolean" &&
    metadata.requiresApproval !== config.requiresApproval
  ) {
    failures.push(
      `requiresApproval expected ${String(config.requiresApproval)} but got ${String(metadata.requiresApproval)}`
    );
  }

  if (
    typeof config.pendingToolName === "string" &&
    metadata.pendingToolName !== config.pendingToolName
  ) {
    failures.push(
      `pendingToolName expected ${config.pendingToolName} but got ${String(metadata.pendingToolName)}`
    );
  }

  if (
    typeof config.pendingPreviewType === "string" &&
    metadata.pendingPreviewType !== config.pendingPreviewType
  ) {
    failures.push(
      `pendingPreviewType expected ${config.pendingPreviewType} but got ${String(metadata.pendingPreviewType)}`
    );
  }

  const mustIncludeToolCalls = asStringArray(config.mustIncludeToolCalls);
  if (!containsEvery(toolCallsMade, mustIncludeToolCalls)) {
    failures.push(`missing required tool calls: ${mustIncludeToolCalls.join(", ")}`);
  }

  const mustExcludeToolCalls = asStringArray(config.mustExcludeToolCalls);
  if (!containsNone(toolCallsMade, mustExcludeToolCalls)) {
    failures.push(`forbidden tool calls present: ${mustExcludeToolCalls.join(", ")}`);
  }

  const mustExcludeArtifactTypes = asStringArray(config.mustExcludeArtifactTypes);
  if (!containsNone(artifactTypes, mustExcludeArtifactTypes)) {
    failures.push(`forbidden artifact types present: ${mustExcludeArtifactTypes.join(", ")}`);
  }

  const mustIncludeArtifactTypes = asStringArray(config.mustIncludeArtifactTypes);
  if (!containsEvery(artifactTypes, mustIncludeArtifactTypes)) {
    failures.push(`missing required artifact types: ${mustIncludeArtifactTypes.join(", ")}`);
  }

  const textMustContainAll = asStringArray(config.textMustContainAll);
  if (!textContainsEvery(outputText, textMustContainAll)) {
    failures.push(`output missing required phrases: ${textMustContainAll.join(", ")}`);
  }

  const textMustContainAny = asStringArray(config.textMustContainAny);
  if (!textContainsAny(outputText, textMustContainAny)) {
    failures.push(`output missing any of: ${textMustContainAny.join(", ")}`);
  }

  const textMustNotContainAny = asStringArray(config.textMustNotContainAny);
  if (!textContainsNone(outputText, textMustNotContainAny)) {
    failures.push(`output contained forbidden phrases: ${textMustNotContainAny.join(", ")}`);
  }

  const textMustMatchAnyRegex = asStringArray(config.textMustMatchAnyRegex);
  if (!textMatchesAnyRegex(outputText, textMustMatchAnyRegex)) {
    failures.push(`output missing regex match for any of: ${textMustMatchAnyRegex.join(", ")}`);
  }

  const textMustNotMatchAnyRegex = asStringArray(config.textMustNotMatchAnyRegex);
  if (!textMatchesNoRegex(outputText, textMustNotMatchAnyRegex)) {
    failures.push(`output matched forbidden regex: ${textMustNotMatchAnyRegex.join(", ")}`);
  }

  const toolErrorsMustContainAny = asStringArray(config.toolErrorsMustContainAny);
  if (
    toolErrorsMustContainAny.length > 0 &&
    !textContainsAny(toolErrors.join("\n"), toolErrorsMustContainAny)
  ) {
    failures.push(`tool errors missing any of: ${toolErrorsMustContainAny.join(", ")}`);
  }

  if (config.requireNoToolErrors === true && toolErrors.length > 0) {
    failures.push(`unexpected tool errors present: ${toolErrors.join(" | ")}`);
  }

  if (
    typeof config.maxToolCalls === "number" &&
    toolCallsMade.length > config.maxToolCalls
  ) {
    failures.push(`tool call count ${toolCallsMade.length} exceeded ${config.maxToolCalls}`);
  }

  if (config.forbidMarkdownTables === true && hasMarkdownTable(outputText)) {
    failures.push("output contained a markdown table");
  }

  if (config.requirePendingCreatedAt === true && typeof metadata.pendingCreatedAt !== "string") {
    failures.push("pending approval was missing createdAt metadata");
  }

  if (config.requirePendingExpiresAt === true && typeof metadata.pendingExpiresAt !== "string") {
    failures.push("pending approval was missing expiresAt metadata");
  }

  if (
    typeof config.maxDurationMs === "number" &&
    typeof metadata.durationMs === "number" &&
    metadata.durationMs > config.maxDurationMs
  ) {
    failures.push(`duration ${metadata.durationMs}ms exceeded ${config.maxDurationMs}ms`);
  }

  return failures.length === 0
    ? {
        pass: true,
        score: 1,
        reason: `Checks passed in ${metadata.durationMs ?? "unknown"}ms`,
      }
    : {
        pass: false,
        score: 0,
        reason: failures.join("; "),
      };
}
