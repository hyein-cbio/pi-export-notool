import { Buffer } from "node:buffer";

const SESSION_DATA_SCRIPT = /(<script\b[^>]*\bid=(["'])session-data\2[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;

function copyString(target, source, key) {
  if (typeof source[key] === "string") target[key] = source[key];
}

function copyFiniteNumber(target, source, key) {
  if (typeof source[key] === "number" && Number.isFinite(source[key])) target[key] = source[key];
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;

  const sanitized = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
    copyFiniteNumber(sanitized, usage, key);
  }

  if (usage.cost && typeof usage.cost === "object" && !Array.isArray(usage.cost)) {
    const cost = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
      copyFiniteNumber(cost, usage.cost, key);
    }
    if (Object.keys(cost).length > 0) sanitized.cost = cost;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeVisibleContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const sanitized = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      sanitized.push({ type: "text", text: block.text });
    } else if (
      block.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      sanitized.push({ type: "image", data: block.data, mimeType: block.mimeType });
    }
  }
  return sanitized;
}

function sanitizeHeader(header) {
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new Error("The exported session header is missing or invalid.");
  }

  const sanitized = {};
  if (header.type === "session") sanitized.type = "session";
  copyFiniteNumber(sanitized, header, "version");
  copyString(sanitized, header, "id");
  copyString(sanitized, header, "timestamp");
  return sanitized;
}

function baseEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string") {
    return undefined;
  }

  const sanitized = { type: entry.type, id: entry.id, parentId: null };
  if (typeof entry.parentId === "string") sanitized.parentId = entry.parentId;
  if (typeof entry.timestamp === "string" || typeof entry.timestamp === "number") {
    sanitized.timestamp = entry.timestamp;
  }
  return sanitized;
}

function sanitizeMessageEntry(entry, stats) {
  const base = baseEntry(entry);
  const message = entry?.message;
  if (!base || !message || typeof message !== "object" || Array.isArray(message)) {
    stats.removedOpaqueEntries++;
    return undefined;
  }

  if (message.role === "toolResult") {
    stats.removedToolResults++;
    return undefined;
  }
  if (message.role === "bashExecution") {
    stats.removedBashExecutions++;
    return undefined;
  }

  if (message.role === "user") {
    const content = sanitizeVisibleContent(message.content);
    if (content === undefined) {
      stats.removedOpaqueEntries++;
      return undefined;
    }

    const sanitizedMessage = { role: "user", content };
    copyFiniteNumber(sanitizedMessage, message, "timestamp");
    return { ...base, message: sanitizedMessage };
  }

  if (message.role === "assistant") {
    if (!Array.isArray(message.content)) {
      stats.removedOpaqueEntries++;
      return undefined;
    }

    const content = [];
    for (const block of message.content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        stats.removedOpaqueBlocks++;
        continue;
      }
      if (block.type === "text" && typeof block.text === "string") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" || String(block.type).toLowerCase().includes("thinking")) {
        stats.removedThinkingBlocks++;
      } else if (block.type === "toolCall") {
        stats.removedToolCalls++;
      } else {
        stats.removedOpaqueBlocks++;
      }
    }

    const hasVisibleText = content.some((block) => block.text.trim().length > 0);
    const hasVisibleError = message.stopReason === "error" || message.stopReason === "aborted";
    if (!hasVisibleText && !hasVisibleError) {
      stats.removedAssistantMessages++;
      return undefined;
    }

    const sanitizedMessage = { role: "assistant", content };
    for (const key of ["api", "provider", "model", "stopReason", "errorMessage"]) {
      copyString(sanitizedMessage, message, key);
    }
    copyFiniteNumber(sanitizedMessage, message, "timestamp");
    const usage = sanitizeUsage(message.usage);
    if (usage) sanitizedMessage.usage = usage;
    return { ...base, message: sanitizedMessage };
  }

  stats.removedOpaqueEntries++;
  return undefined;
}

function sanitizeEntry(entry, stats) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    stats.removedOpaqueEntries++;
    return undefined;
  }

  if (entry.type === "message") return sanitizeMessageEntry(entry, stats);

  const base = baseEntry(entry);
  if (!base) {
    stats.removedOpaqueEntries++;
    return undefined;
  }

  if (
    entry.type === "compaction" &&
    typeof entry.summary === "string" &&
    typeof entry.tokensBefore === "number" &&
    Number.isFinite(entry.tokensBefore)
  ) {
    return { ...base, summary: entry.summary, tokensBefore: entry.tokensBefore };
  }

  if (entry.type === "branch_summary" && typeof entry.summary === "string") {
    const sanitized = { ...base, summary: entry.summary };
    copyString(sanitized, entry, "fromId");
    return sanitized;
  }

  if (entry.type === "custom_message" && entry.display === true) {
    const content = sanitizeVisibleContent(entry.content);
    if (content === undefined) {
      stats.removedOpaqueEntries++;
      return undefined;
    }
    const sanitized = { ...base, customType: "extension", content, display: true };
    copyString(sanitized, entry, "customType");
    return sanitized;
  }

  if (entry.type === "model_change") {
    const sanitized = { ...base };
    copyString(sanitized, entry, "provider");
    copyString(sanitized, entry, "modelId");
    return sanitized;
  }

  if (entry.type === "thinking_level_change") {
    const sanitized = { ...base };
    copyString(sanitized, entry, "thinkingLevel");
    return sanitized;
  }

  if (entry.type === "label" && typeof entry.targetId === "string" && typeof entry.label === "string") {
    return { ...base, targetId: entry.targetId, label: entry.label };
  }

  stats.removedOpaqueEntries++;
  return undefined;
}

function nearestRetainedId(startId, originalById, retainedIds) {
  let currentId = typeof startId === "string" ? startId : undefined;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    if (retainedIds.has(currentId)) return currentId;
    visited.add(currentId);
    const current = originalById.get(currentId);
    currentId = typeof current?.parentId === "string" ? current.parentId : undefined;
  }

  return null;
}

function validateRetainedTree(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    const visited = new Set();
    let current = entry;

    while (current) {
      if (visited.has(current.id)) {
        throw new Error(`Cycle in published session tree at entry: ${current.id}`);
      }
      visited.add(current.id);

      if (current.parentId === null || current.parentId === current.id) break;
      current = byId.get(current.parentId);
      if (!current) throw new Error(`Missing parent in published session tree for entry: ${entry.id}`);
    }
  }
}

/**
 * Reduce Pi's embedded session data to fields needed to render shareable content.
 * Tool results, shell executions, thinking/tool-call blocks, hidden custom state,
 * tool definitions, rendered tool HTML, system prompts, and path-bearing header
 * metadata are deliberately not copied.
 */
export function sanitizeSessionData(sessionData) {
  if (!sessionData || typeof sessionData !== "object" || Array.isArray(sessionData)) {
    throw new Error("The exported session data is invalid.");
  }
  if (!Array.isArray(sessionData.entries)) {
    throw new Error("The exported session does not contain an entries array.");
  }

  const stats = {
    removedToolCalls: 0,
    removedToolResults: 0,
    removedThinkingBlocks: 0,
    removedBashExecutions: 0,
    removedAssistantMessages: 0,
    removedOpaqueEntries: 0,
    removedOpaqueBlocks: 0,
  };

  const originalById = new Map();
  for (const entry of sessionData.entries) {
    if (entry && typeof entry === "object" && typeof entry.id === "string") {
      if (originalById.has(entry.id)) throw new Error(`Duplicate session entry id: ${entry.id}`);
      originalById.set(entry.id, entry);
    }
  }

  let entries = sessionData.entries.map((entry) => sanitizeEntry(entry, stats)).filter(Boolean);
  let retainedIds = new Set(entries.map((entry) => entry.id));

  // A label for removed content is itself hidden metadata, so omit it too.
  entries = entries.filter((entry) => {
    if (entry.type !== "label" || retainedIds.has(entry.targetId)) return true;
    stats.removedOpaqueEntries++;
    return false;
  });
  retainedIds = new Set(entries.map((entry) => entry.id));

  for (const entry of entries) {
    entry.parentId = nearestRetainedId(entry.parentId, originalById, retainedIds);
    if (entry.type === "branch_summary" && entry.fromId && !retainedIds.has(entry.fromId)) {
      const fromId = nearestRetainedId(entry.fromId, originalById, retainedIds);
      if (fromId) entry.fromId = fromId;
      else delete entry.fromId;
    }
  }

  validateRetainedTree(entries);

  const leafId = nearestRetainedId(sessionData.leafId, originalById, retainedIds)
    ?? entries.at(-1)?.id
    ?? null;

  return {
    sessionData: {
      header: sanitizeHeader(sessionData.header),
      entries,
      leafId,
    },
    stats,
  };
}

/** Extract and decode the single session-data script from a Pi HTML export. */
export function extractSessionData(html) {
  const matches = [...html.matchAll(SESSION_DATA_SCRIPT)];
  if (matches.length !== 1) {
    throw new Error("Expected exactly one Pi session-data script in the exported HTML.");
  }

  const encoded = matches[0][3].trim();
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("The Pi session-data script is not valid base64.");
  }

  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("The Pi session-data script could not be decoded.");
  }
}

/** Replace Pi's embedded session payload with a physically sanitized payload. */
export function createPublishHtml(html) {
  const matches = [...html.matchAll(SESSION_DATA_SCRIPT)];
  if (matches.length !== 1) {
    throw new Error("Expected exactly one Pi session-data script in the exported HTML.");
  }

  const originalData = extractSessionData(html);
  const { sessionData, stats } = sanitizeSessionData(originalData);
  const encoded = Buffer.from(JSON.stringify(sessionData), "utf8").toString("base64");
  const match = matches[0];
  const replacement = `${match[1]}${encoded}${match[4]}`;
  const start = match.index;
  const publishedHtml = html.slice(0, start) + replacement + html.slice(start + match[0].length);

  return { html: publishedHtml, sessionData, stats };
}
