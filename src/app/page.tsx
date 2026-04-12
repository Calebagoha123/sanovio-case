"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelMessage } from "ai";
import styles from "./page.module.css";
import type { ChatRequest, ChatStreamEvent } from "./api/chat/route";
import type {
  AgentUiArtifact,
  PendingApprovalPayload,
  ProductDetailsArtifact,
  ReorderRequestsArtifact,
  SearchResultsArtifact,
} from "@/lib/chat/ui-contract";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts: AgentUiArtifact[];
}

interface RuntimeContext {
  currentDate: string;
  timezone: string;
}

const STARTER_PROMPTS = [
  "Find nitrile gloves for ward restocking",
  "Compare syringe options for ward use",
  "List my current reorder requests",
];

const CAPABILITIES = [
  "Search the catalog in natural language",
  "Show pack size, order unit, price, and product identifiers",
  "Stage one reorder request at a time for confirmation",
  "List and cancel requests created in this session",
];

const LIMITATIONS = [
  "No stock visibility or live ERP access",
  "One product per reorder request",
  "No actions without explicit confirmation",
  "No memory across sessions",
];

const TIMEZONE_OPTIONS = [
  "Europe/Zurich",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
];

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={styles.sendIcon}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h12" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null || currency === null) {
    return "Unavailable";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 3 : 2,
  }).format(value);
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalPayload | null>(null);
  const [runtimeContext, setRuntimeContext] = useState<RuntimeContext | null>(null);
  const [selectedTimezone, setSelectedTimezone] = useState("Europe/Zurich");
  const [sessionId] = useState(() => crypto.randomUUID());
  const chatRailRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);

  function appendOrUpdateAssistantDraft(chunk: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") {
        return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: chunk, artifacts: [] },
      ];
    });
  }

  function removeEmptyAssistantDraft() {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && !last.content.trim() && last.artifacts.length === 0) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }

  function finalizeAssistantTurn(text: string, artifacts: AgentUiArtifact[]) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            content: last.content.trim() ? last.content : text,
            artifacts,
          },
        ];
      }

      if (!text && artifacts.length === 0) {
        return prev;
      }

      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: text,
          artifacts,
        },
      ];
    });
  }

  function appendAssistantMessage(content: string, artifacts: AgentUiArtifact[] = []) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", content, artifacts },
    ]);
  }

  async function consumeStream(res: Response) {
    if (!res.body) {
      throw new Error("Streaming response body not available.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawAssistantChunk = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame
          .split("\n")
          .find((entry) => entry.startsWith("data: "));

        if (!line) continue;

        const event = JSON.parse(line.slice(6)) as ChatStreamEvent;

        if (event.type === "assistant_chunk") {
          sawAssistantChunk = true;
          appendOrUpdateAssistantDraft(event.chunk);
          continue;
        }

        if (event.type === "approval") {
          removeEmptyAssistantDraft();
          setHistory(event.payload.updatedHistory);
          setPendingApproval(event.payload.pendingToolCall);
          continue;
        }

        if (event.type === "complete") {
          finalizeAssistantTurn(sawAssistantChunk ? "" : event.payload.text, event.payload.artifacts);
          setHistory(event.payload.updatedHistory);
          continue;
        }

        if (event.type === "error") {
          removeEmptyAssistantDraft();
          const friendly = runtimeContext
            ? formatOperationalMessage(event.message, runtimeContext.currentDate)
            : null;
          if (friendly) {
            appendAssistantMessage(friendly);
          } else {
            setError(event.message);
          }
        }
      }
    }
  }

  useEffect(() => {
    const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (deviceTimezone) {
      setSelectedTimezone(deviceTimezone);
    }
  }, []);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const rail = chatRailRef.current;
    if (rail) {
      rail.scrollTo({ top: rail.scrollHeight, behavior: "smooth" });
    }
  }, [messages, pendingApproval, loading]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const res = await fetch(
          `/api/runtime-context?timezone=${encodeURIComponent(selectedTimezone)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as RuntimeContext;
        if (active) setRuntimeContext(data);
      } catch {
        // Keep the UI usable if runtime context cannot be fetched.
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedTimezone]);

  function formatOperationalMessage(message: string, currentDate: string): string | null {
    if (/is in the past/i.test(message)) {
      return `That delivery date is already in the past relative to ${currentDate}. Please enter today, tomorrow, a weekday name, a date like 10 May, or a future date in YYYY-MM-DD format.`;
    }

    if (/cannot parse date phrase/i.test(message) || /invalid date/i.test(message)) {
      return "I couldn't understand that delivery date. Please enter today, tomorrow, a weekday name, a date like 10 May, or a future date in YYYY-MM-DD format.";
    }

    return null;
  }

  function extractIsoDate(text: string): string | null {
    return text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
  }

  async function sendMessage(message: string) {
    if (!message.trim() || loading) return;

    const isoDate = extractIsoDate(message);
    if (runtimeContext && isoDate && isoDate < runtimeContext.currentDate) {
      appendAssistantMessage(
        `That delivery date is already in the past relative to ${runtimeContext.currentDate}. Please enter today, tomorrow, a weekday name, a date like 10 May, or a future date in YYYY-MM-DD format.`
      );
      return;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      artifacts: [],
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);
    setPendingApproval(null);

    try {
      const body: ChatRequest = { sessionId, message, history, timezone: selectedTimezone };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await consumeStream(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleApproval(approved: boolean) {
    if (!pendingApproval) return;
    setLoading(true);
    setError(null);

    if (!approved) {
      appendAssistantMessage("Action cancelled. I can revise the request or help with another search.");
      setPendingApproval(null);
      setLoading(false);
      return;
    }

    try {
      const body: ChatRequest = {
        sessionId,
        message: "",
        history,
        approve: true,
        timezone: selectedTimezone,
        pendingToolCall: pendingApproval,
      };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPendingApproval(null);
      await consumeStream(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function triggerStructuredAction(message: string) {
    void sendMessage(message);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  function renderInline(content: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\$[^$]+\$|\[[^\]]+\]\([^)]+\))/g;
    let lastIndex = 0;
    let key = 0;

    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        parts.push(<span key={`text-${key++}`}>{content.slice(lastIndex, index)}</span>);
      }

      const token = match[0];
      if (token.startsWith("**") && token.endsWith("**")) {
        parts.push(<strong key={`bold-${key++}`}>{token.slice(2, -2)}</strong>);
      } else if (token.startsWith("`") && token.endsWith("`")) {
        parts.push(
          <code key={`code-${key++}`} className={styles.inlineCode}>
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith("$") && token.endsWith("$")) {
        parts.push(
          <span key={`math-${key++}`} className={styles.inlineMath}>
            {token.slice(1, -1)}
          </span>
        );
      } else if (token.startsWith("[")) {
        const parsed = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (parsed) {
          parts.push(
            <a
              key={`link-${key++}`}
              className={styles.inlineLink}
              href={parsed[2]}
              target="_blank"
              rel="noreferrer"
            >
              {parsed[1]}
            </a>
          );
        }
      }

      lastIndex = index + token.length;
    }

    if (lastIndex < content.length) {
      parts.push(<span key={`text-${key++}`}>{content.slice(lastIndex)}</span>);
    }

    return parts;
  }

  function renderRichText(content: string) {
    const lines = content.split("\n");
    const blocks: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trimEnd();

      if (!line.trim()) {
        i++;
        continue;
      }

      const trimmedLine = line.trim();
      const nextLine = lines[i + 1]?.trim() ?? "";

      if (
        trimmedLine.includes("|") &&
        nextLine.includes("|") &&
        /^[:|\-\s]+$/.test(nextLine.replace(/\|/g, "").trim())
      ) {
        const tableLines: string[] = [trimmedLine, nextLine];
        i += 2;

        while (i < lines.length && lines[i].trim().includes("|")) {
          tableLines.push(lines[i].trim());
          i++;
        }

        const parseRow = (row: string) =>
          row
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim());

        const headers = parseRow(tableLines[0]);
        const rows = tableLines.slice(2).map(parseRow);

        blocks.push(
          <div key={`table-${i}`} className={styles.tableWrap}>
            <table className={styles.richTable}>
              <thead>
                <tr>
                  {headers.map((header, index) => (
                    <th key={`${header}-${index}`}>{renderInline(header)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`}>
                    {headers.map((_, columnIndex) => (
                      <td key={`cell-${rowIndex}-${columnIndex}`}>
                        {renderInline(row[columnIndex] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      if (line.startsWith("```")) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        blocks.push(
          <pre key={`code-${i}`} className={styles.codeBlock}>
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        continue;
      }

      if (line.startsWith("$$") && line.endsWith("$$") && line.length > 4) {
        blocks.push(
          <div key={`math-${i}`} className={styles.mathBlock}>
            {line.slice(2, -2)}
          </div>
        );
        i++;
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
          i++;
        }
        blocks.push(
          <ul key={`ul-${i}`} className={styles.richList}>
            {items.map((item, index) => (
              <li key={`${item}-${index}`}>{renderInline(item)}</li>
            ))}
          </ul>
        );
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
          i++;
        }
        blocks.push(
          <ol key={`ol-${i}`} className={styles.richList}>
            {items.map((item, index) => (
              <li key={`${item}-${index}`}>{renderInline(item)}</li>
            ))}
          </ol>
        );
        continue;
      }

      const paragraph: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^[-*]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim()) &&
        !lines[i].startsWith("```")
      ) {
        paragraph.push(lines[i]);
        i++;
      }
      blocks.push(
        <p key={`p-${i}`} className={styles.messageParagraph}>
          {renderInline(paragraph.join(" "))}
        </p>
      );
    }

    return blocks;
  }

  function renderSearchResultsArtifact(artifact: SearchResultsArtifact) {
    if (artifact.results.length === 0) {
      return (
        <section className={styles.artifactPanel}>
          <div className={styles.artifactEyebrow}>Catalog results</div>
          <p className={styles.messageParagraph}>No catalog matches were found for “{artifact.query}”.</p>
        </section>
      );
    }

    return (
      <section className={styles.artifactPanel}>
        <div className={styles.artifactHeader}>
          <div>
            <div className={styles.artifactEyebrow}>Catalog results</div>
            <h3 className={styles.artifactTitle}>Matches for “{artifact.query}”</h3>
          </div>
          <div className={styles.artifactMeta}>{artifact.results.length} result(s)</div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.richTable}>
            <thead>
              <tr>
                <th>Internal ID</th>
                <th>Description</th>
                <th>Brand</th>
                <th>Order unit</th>
                <th>Unit price</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {artifact.results.map((result) => (
                <tr key={result.internalId}>
                  <td>{result.internalId}</td>
                  <td>{result.description}</td>
                  <td>{result.brand}</td>
                  <td>{result.orderUnit}</td>
                  <td>{formatCurrency(result.netTargetPrice, result.currency)}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() =>
                          triggerStructuredAction(
                            `Show product details for internal ID ${result.internalId}.`
                          )
                        }
                        disabled={loading}
                      >
                        View details
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() =>
                          triggerStructuredAction(
                            `Start a reorder request for internal ID ${result.internalId}.`
                          )
                        }
                        disabled={loading}
                      >
                        Reorder
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderProductDetailsArtifact(artifact: ProductDetailsArtifact) {
    const { product } = artifact;

    return (
      <section className={styles.artifactPanel}>
        <div className={styles.artifactHeader}>
          <div>
            <div className={styles.artifactEyebrow}>Product details</div>
            <h3 className={styles.artifactTitle}>{product.description}</h3>
          </div>
          <div className={styles.artifactMeta}>ID {product.internalId}</div>
        </div>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Brand</span>
            <strong>{product.brand}</strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Order unit</span>
            <strong>{product.orderUnit}</strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Pack conversion</span>
            <strong>
              1 {product.orderUnit} = {product.baseUnitsPerBme} {product.baseUnit}
            </strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Unit price</span>
            <strong>{formatCurrency(product.netTargetPrice, product.currency)}</strong>
          </div>
          {product.supplierArticleNo && (
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Supplier article</span>
              <strong>{product.supplierArticleNo}</strong>
            </div>
          )}
          {product.gtinEan && (
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>GTIN / EAN</span>
              <strong>{product.gtinEan}</strong>
            </div>
          )}
          {product.mdrClass && (
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>MDR class</span>
              <strong>{product.mdrClass}</strong>
            </div>
          )}
        </div>
        <div className={styles.inlineActions}>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={() =>
              triggerStructuredAction(`Start a reorder request for internal ID ${product.internalId}.`)
            }
            disabled={loading}
          >
            Start reorder request
          </button>
        </div>
      </section>
    );
  }

  function renderReorderRequestsArtifact(artifact: ReorderRequestsArtifact) {
    if (artifact.requests.length === 0) {
      return (
        <section className={styles.artifactPanel}>
          <div className={styles.artifactEyebrow}>Session requests</div>
          <p className={styles.messageParagraph}>No reorder requests have been created in this session yet.</p>
        </section>
      );
    }

    return (
      <section className={styles.artifactPanel}>
        <div className={styles.artifactHeader}>
          <div>
            <div className={styles.artifactEyebrow}>Session requests</div>
            <h3 className={styles.artifactTitle}>Requests created in this workspace</h3>
          </div>
          <div className={styles.artifactMeta}>{artifact.requests.length} request(s)</div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.richTable}>
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Product ID</th>
                <th>Quantity</th>
                <th>Delivery</th>
                <th>Needed by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {artifact.requests.map((request) => (
                <tr key={request.requestId}>
                  <td>{request.requestId}</td>
                  <td>{request.internalId}</td>
                  <td>
                    {request.quantity} {request.orderUnit}
                  </td>
                  <td>{request.deliveryLocation}</td>
                  <td>{request.requestedByDate}</td>
                  <td>{request.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderLifecycleArtifact(artifact: Extract<AgentUiArtifact, { type: "created_request" | "cancelled_request" }>) {
    const label =
      artifact.type === "created_request" ? "Request created" : "Request cancelled";

    return (
      <section className={styles.artifactPanel}>
        <div className={styles.artifactEyebrow}>{label}</div>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Request ID</span>
            <strong>{artifact.request.requestId}</strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Product ID</span>
            <strong>{artifact.request.internalId}</strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Quantity</span>
            <strong>
              {artifact.request.quantity} {artifact.request.orderUnit}
            </strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Needed by</span>
            <strong>{artifact.request.requestedByDate}</strong>
          </div>
        </div>
      </section>
    );
  }

  function renderArtifact(artifact: AgentUiArtifact, key: string) {
    if (artifact.type === "search_results") {
      return <div key={key}>{renderSearchResultsArtifact(artifact)}</div>;
    }
    if (artifact.type === "product_details") {
      return <div key={key}>{renderProductDetailsArtifact(artifact)}</div>;
    }
    if (artifact.type === "reorder_requests") {
      return <div key={key}>{renderReorderRequestsArtifact(artifact)}</div>;
    }
    if (artifact.type === "created_request" || artifact.type === "cancelled_request") {
      return <div key={key}>{renderLifecycleArtifact(artifact)}</div>;
    }
    return null;
  }

  function renderApprovalPreview() {
    if (!pendingApproval?.preview) {
      return <pre className={styles.approvalDetails}>{pendingApproval?.summary}</pre>;
    }

    if (pendingApproval.preview.type === "create_reorder_request") {
      const preview = pendingApproval.preview;
      return (
        <div className={styles.approvalPreview}>
          <div className={styles.approvalSection}>
            <div className={styles.approvalSectionTitle}>Product</div>
            <div className={styles.approvalHeadline}>
              {preview.product.description} <span>{preview.product.brand}</span>
            </div>
            <div className={styles.approvalMeta}>Internal ID {preview.product.internalId}</div>
          </div>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Quantity</span>
              <strong>
                {preview.quantity} {preview.orderUnit}
              </strong>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Base units</span>
              <strong>
                {preview.baseUnitQuantity} {preview.baseUnit}
              </strong>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Unit price</span>
              <strong>{formatCurrency(preview.unitPrice, preview.currency)}</strong>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Estimated total</span>
              <strong>{formatCurrency(preview.totalPrice, preview.currency)}</strong>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Delivery location</span>
              <strong>{preview.deliveryLocation}</strong>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Cost center</span>
              <strong>{preview.costCenter}</strong>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Requested by</span>
              <strong>{preview.requestedByDate}</strong>
            </div>
            {preview.justification && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Justification</span>
                <strong>{preview.justification}</strong>
              </div>
            )}
          </div>
        </div>
      );
    }

    const preview = pendingApproval.preview;
    return (
      <div className={styles.approvalPreview}>
        <div className={styles.approvalSection}>
          <div className={styles.approvalSectionTitle}>Cancellation</div>
          <div className={styles.approvalHeadline}>
            {preview.product.description} <span>{preview.product.brand}</span>
          </div>
          <div className={styles.approvalMeta}>
            Request {preview.requestId} • Internal ID {preview.product.internalId}
          </div>
        </div>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Quantity</span>
            <strong>
              {preview.quantity} {preview.orderUnit}
            </strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Delivery location</span>
            <strong>{preview.deliveryLocation}</strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Cost center</span>
            <strong>{preview.costCenter}</strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Requested by</span>
            <strong>{preview.requestedByDate}</strong>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Status</span>
            <strong>{preview.status}</strong>
          </div>
        </div>
      </div>
    );
  }

  const timezoneOptions = Array.from(new Set([selectedTimezone, ...TIMEZONE_OPTIONS]));

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGlow} />
      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerMeta}>
            <div className={styles.headerKicker}>
              <span>Challenge: Reorder Agent</span>
            </div>
            <div>
              <h1 className={styles.title}>Procurement workspace.</h1>
              <p className={styles.subtitle}>
                Search the catalog, compare plausible matches, inspect product records, and confirm a single reorder
                action only when the request is ready.
              </p>
            </div>
          </div>

          <div className={styles.brandBlock}>
            <div className={styles.brandName}>SANOVIO</div>
            <div className={styles.brandCaption}>Strategic medical procurement</div>
          </div>
        </header>

        <div className={styles.signalRow}>
          <div className={styles.signalPill}>
            {runtimeContext ? `Date ${runtimeContext.currentDate}` : "Refreshing date"}
          </div>
          <label className={`${styles.signalPill} ${styles.signalPillEditable}`}>
            <span className={styles.signalLabel}>Timezone</span>
            <select
              className={styles.timezoneSelect}
              value={selectedTimezone}
              onChange={(e) => setSelectedTimezone(e.target.value)}
            >
              {timezoneOptions.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.signalPill}>
            <span className={styles.signalLabel}>Session ID</span>
            <code className={styles.signalCode}>{sessionId}</code>
          </div>
        </div>

        <div className={styles.workspace}>
          <div ref={chatRailRef} className={styles.chatRail}>
            {messages.length === 0 && !pendingApproval && (
              <div className={styles.emptyState}>
                <div className={styles.assistantRow}>
                  <div className={styles.avatar}>S</div>
                  <article className={styles.assistantBubble}>
                    <div className={styles.messageContent}>
                      <p className={styles.messageParagraph}>
                        Welcome in. I can help you search the catalog, compare close matches, inspect product records,
                        and prepare reorder requests for confirmation.
                      </p>
                    </div>
                  </article>
                </div>

                <section className={styles.scopePanel}>
                  <div className={styles.scopeColumn}>
                    <div className={styles.scopeTitle}>What this agent can do</div>
                    <ul className={styles.scopeList}>
                      {CAPABILITIES.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.scopeColumn}>
                    <div className={styles.scopeTitle}>What it cannot do</div>
                    <ul className={styles.scopeList}>
                      {LIMITATIONS.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </section>

                <div className={styles.starterBlock}>
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className={styles.starterPrompt}
                      onClick={() => void sendMessage(prompt)}
                      disabled={loading}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <p className={styles.dateHint}>
                  {runtimeContext
                    ? `Date-sensitive requests are checked against ${runtimeContext.currentDate} in ${runtimeContext.timezone}.`
                    : "Date-sensitive requests are checked against the server's current date."}
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={msg.role === "assistant" ? styles.assistantRow : styles.userRow}
              >
                {msg.role === "assistant" && <div className={styles.avatar}>S</div>}
                <article className={msg.role === "assistant" ? styles.assistantBubble : styles.userBubble}>
                  <div className={styles.messageLabel}>{msg.role === "assistant" ? "Assistant" : "You"}</div>
                  <div className={styles.messageContent}>
                    {msg.content ? renderRichText(msg.content) : null}
                    {msg.artifacts.map((artifact, index) =>
                      renderArtifact(artifact, `${msg.id}-${artifact.type}-${index}`)
                    )}
                  </div>
                </article>
              </div>
            ))}

            {pendingApproval && (
              <section className={styles.approvalPanel}>
                <div className={styles.approvalEyebrow}>Confirmation required</div>
                <h2 className={styles.approvalTitle}>Review the request before the write executes.</h2>
                {renderApprovalPreview()}
                <div className={styles.approvalActions}>
                  <button
                    type="button"
                    className={styles.approveButton}
                    onClick={() => void handleApproval(true)}
                    disabled={loading}
                  >
                    Confirm request
                  </button>
                  <button
                    type="button"
                    className={styles.rejectButton}
                    onClick={() => void handleApproval(false)}
                    disabled={loading}
                  >
                    Cancel action
                  </button>
                </div>
              </section>
            )}

            {loading && (!messages.length || messages[messages.length - 1]?.role !== "assistant") && !pendingApproval && (
              <div className={styles.assistantRow}>
                <div className={styles.avatar}>S</div>
                <article className={styles.assistantBubble}>
                  <div className={styles.messageLabel}>Assistant</div>
                  <div className={styles.typingDots} aria-label="Loading">
                    <span />
                    <span />
                    <span />
                  </div>
                </article>
              </div>
            )}

            {error && (
              <div className={styles.errorBanner}>
                <strong>Operational issue:</strong> {error}
              </div>
            )}
          </div>
        </div>

        <footer className={styles.composerWrap}>
          <div className={styles.composer}>
            <textarea
              className={styles.textarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about products, request details, or stage a reorder."
              rows={2}
              disabled={loading}
            />
            <button
              type="button"
              className={styles.sendButton}
              onClick={() => void sendMessage(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </div>
          <p className={styles.disclaimer}>
            The assistant can explain validations and stage actions, but every write still requires explicit confirmation.
          </p>
        </footer>
      </section>
    </main>
  );
}
