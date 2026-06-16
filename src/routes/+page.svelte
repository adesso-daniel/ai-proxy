<script lang="ts">
	import type { RequestLog } from "$lib/types";
	import { prettyPrintJson } from "pretty-print-json";

	let logs = $state<RequestLog[]>([]);
	let selectedLogId = $state<string | null>(null);
	let selectedLog = $derived(
		selectedLogId ? logs.find((l) => l.id === selectedLogId) ?? null : null
	);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let pollingInterval: ReturnType<typeof setInterval>;
	let modalType = $state<"requestBody" | "responseBody" | null>(null);

	type DisplayContent =
		| { type: "json"; html: string }
		| { type: "reasoning"; content: string };

	/**
	 * Consolidate consecutive reasoning entries into one each.
	 * Keeps only the last entry in each consecutive run (most complete accumulated text).
	 */
	function consolidateReasoningEntries(
		content: DisplayContent[],
	): DisplayContent[] {
		const result: DisplayContent[] = [];
		let lastReasoning: DisplayContent | null = null;
		for (const item of content) {
			if (item.type === "reasoning") {
				lastReasoning = item;
			} else {
				if (lastReasoning) {
					result.push(lastReasoning);
					lastReasoning = null;
				}
				result.push(item);
			}
		}
		if (lastReasoning) result.push(lastReasoning);
		return result;
	}

	type ModalContent = {
		type: "requestBody" | "responseBody";
		content: Array<
			| { type: "json"; html: string }
			| { type: "reasoning"; content: string }
		>;
		title: string;
		objectCount: number;
		parseErrors: number;
	};

	/**
	 * Build modal content from a log entry and a modal type.
	 * Extracted from openBodyModal to be used by the computed bodyModal.
	 */
	function buildModalContent(
		type: "requestBody" | "responseBody",
		log: RequestLog,
		title: string,
	): ModalContent | null {
		if (type === "responseBody") {
			// Use pre-built display entries if available (already in arrival order)
			if (log.hasDisplayEntries && log.responseDisplayEntries && log.responseDisplayEntries.length > 0) {
				const consolidated = consolidateReasoningEntries(log.responseDisplayEntries);
				return {
					type,
					content: consolidated,
					title,
					objectCount: consolidated.length,
					parseErrors: 0,
				};
			}

			// Fallback: reconstruct from raw body + reasoning (legacy or non-structured responses)
			const reasoning = log.responseReasoning;
			const rawBody = log.responseBody;
			if (!reasoning && !rawBody) return null;

			const modalContent: Array<
				| { type: "json"; html: string }
				| { type: "reasoning"; content: string }
			> = [];
			let parseErrors = 0;

			if (reasoning) {
				modalContent.push({ type: "reasoning", content: reasoning });
			}

			// Extract non-reasoning JSON chunks from the raw body
			if (rawBody) {
				const objects = extractJsonObjects(rawBody);
				for (const obj of objects) {
					// Skip objects that have (reasoning_)content — they're already in the reasoning block
					if (obj.choices && Array.isArray(obj.choices)) {
						let hasReasoning = false;
						for (const choice of obj.choices) {
							if (
								choice.delta?.reasoning_content ||
								choice.delta?.content
							) {
								hasReasoning = true;
								break;
							}
						}
						if (hasReasoning) continue;
					}
					try {
						modalContent.push({
							type: "json",
							html: prettyPrintJson.toHtml(obj),
						});
					} catch {
						parseErrors++;
					}
				}
			}

			if (modalContent.length === 0) return null;

			const consolidated = consolidateReasoningEntries(modalContent);
			return {
				type,
				content: consolidated,
				title,
				objectCount: consolidated.length,
				parseErrors,
			};
		} else {
			const content = log[type];
			if (!content) return null;
			const html = prettyPrintJson.toHtml(JSON.parse(content));
			return {
				type,
				content: [{ type: "json" as const, html }],
				title,
				objectCount: 1,
				parseErrors: 0,
			};
		}
	}

	let bodyModal = $derived(
		modalType !== null && selectedLog
			? buildModalContent(
					modalType,
					selectedLog,
					modalType === "responseBody" ? "Response Body" : "Request Body",
			  )
			: null
	);

	function openBodyModal(
		type: "requestBody" | "responseBody",
		title: string,
	) {
		modalType = type;
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			fractionalSecondDigits: 3,
		});
	}

	function formatDuration(ms: number | undefined): string {
		if (ms == undefined) return `???`;
		if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
		return `${ms.toFixed(1)}ms`;
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
		return `${(bytes / 1048576).toFixed(1)}MB`;
	}

	function statusCodeColor(code: number | undefined): string {
		if (code == undefined) return "#ef4444";
		if (code >= 200 && code < 300) return "#22c55e";
		if (code >= 300 && code < 400) return "#eab308";
		if (code >= 400 && code < 500) return "#f97316";
		return "#ef4444";
	}

	function statusBadgeColor(status: string): string {
		if (status === "pending") return "#eab308";
		if (status === "streaming") return "#f59e0b";
		if (status === "completed") return "#22c55e";
		if (status === "error") return "#ef4444";
		return "#6b7280";
	}

	function parseResponseBody(raw: string): {
		objects: string[];
		errors: number;
	} {
		const objects: string[] = [];
		let errors = 0;

		// Try parsing the whole thing first (single JSON object)
		try {
			const parsed = JSON.parse(raw);
			objects.push(prettyPrintJson.toHtml(parsed));
			return { objects, errors };
		} catch {
			// Not a single valid JSON — try multiple strategies
			const extracted = extractJsonObjects(raw);
			if (extracted.length > 0) {
				for (const obj of extracted) {
					try {
						objects.push(prettyPrintJson.toHtml(obj));
					} catch {
						errors++;
					}
				}
			} else {
				// If no objects extracted, count non-empty lines as parse errors
				errors = raw.split("\n").filter((l) => l.trim()).length;
			}
		}
		return { objects, errors };
	}

	/**
	 * Extract JSON objects from raw streaming response text.
	 * Handles multiple formats: SSE, newline-separated, concatenated, mixed.
	 */
	function extractJsonObjects(raw: string): Record<string, unknown>[] {
		const results: Record<string, unknown>[] = [];

		// Strategy 1: Split by newlines, strip SSE prefix, parse each line
		const lines = raw.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			// Skip SSE sentinel values
			if (trimmed === "[DONE]" || trimmed === "data: [DONE]") continue;

			// Strip SSE "data: " prefix (handles both "data: {" and "data: ")
			const jsonLine = trimmed.replace(/^data:\s*/, "");
			if (!jsonLine) continue;

			try {
				const parsed = JSON.parse(jsonLine);
				results.push(parsed);
				continue;
			} catch {
				// fall through to next strategy
			}
		}

		// Strategy 2: If no objects found, try extracting JSON objects using brace matching
		// This handles concatenated JSON like {"id":"1"}{"id":"2"}
		if (results.length === 0) {
			const extracted = extractByBraces(raw);
			if (extracted.length > 0) {
				return extracted;
			}
		}

		return results;
	}

	/**
	 * Extract JSON objects from concatenated text using brace matching.
	 * Handles: {"id":"1"}{"id":"2"} or SSE payloads embedded in text.
	 */
	function extractByBraces(raw: string): Record<string, unknown>[] {
		const results: Record<string, unknown>[] = [];
		let depth = 0;
		let start = -1;
		let inString = false;
		let escapeNext = false;

		for (let i = 0; i < raw.length; i++) {
			const ch = raw[i];

			if (escapeNext) {
				escapeNext = false;
				continue;
			}

			if (ch === "\\" && inString) {
				escapeNext = true;
				continue;
			}

			if (ch === '"') {
				inString = !inString;
				continue;
			}

			if (inString) continue;

			if (ch === "{" && depth === 0) {
				start = i;
			}
			if (ch === "{") depth++;
			if (ch === "}") depth--;

			if (depth === 0 && start !== -1) {
				const slice = raw.slice(start, i + 1);
				try {
					results.push(JSON.parse(slice));
				} catch {
					// Not valid JSON at this boundary, reset
				}
				start = -1;
			}
		}

		return results;
	}

	function copyBodyContent(
		content:
			| string
			| Array<
					| { type: "json"; html: string }
					| { type: "reasoning"; content: string }
		  >,
	): string {
		if (Array.isArray(content)) {
			return content
				.map((c) => (c.type === "reasoning" ? c.content : c.html))
				.join("\n");
		}
		return content;
	}

	async function fetchLogs() {
		try {
			const res = await fetch("/api/logs");
			if (!res.ok) throw new Error(`Failed to fetch logs: ${res.status}`);
			logs = await res.json();
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function expandLog(log: RequestLog) {
		selectedLogId = selectedLogId === log.id ? null : log.id;
	}

	$effect(() => {
		fetchLogs();
		pollingInterval = setInterval(fetchLogs, 2000);
		return () => clearInterval(pollingInterval);
	});
</script>

<div class="container">
	<div class="header">
		<h1>Model Proxy</h1>
		<span class="status-badge">
			{logs.length} request{logs.length !== 1 ? "s" : ""}
			<span class="polling-dot"></span>
		</span>
	</div>

	{#if loading && logs.length === 0}
		<p class="loading">Loading requests...</p>
	{:else if error}
		<div class="error">
			<p>{error}</p>
			<button onclick={fetchLogs}>Retry</button>
		</div>
	{/if}

	<div class="logs-list">
		{#each logs as log, index (log.id)}
			<div
				class="log-card"
				class:expanded={selectedLog?.id === log.id}
				class:pending={log.status === "pending" ||
					log.status === "streaming"}
			>
				<div
					role="button"
					class="log-row"
					onclick={() => expandLog(log)}
					aria-expanded={selectedLog?.id === log.id}
					onkeydown={(e) => {
						if (e.key === "Enter") expandLog(log);
					}}
					tabindex={index * 10}
				>
					<span class="method">{log.method}</span>
					{#if log.status === "pending"}
						<span
							class="status pending-status"
							style="color: {statusBadgeColor(log.status)}"
							>pending</span
						>
					{:else if log.status === "streaming"}
						<span
							class="status streaming-status"
							style="color: {statusBadgeColor(log.status)}"
							>streaming…</span
						>
					{:else}
						<span
							class="status"
							style="color: {statusCodeColor(log.statusCode)}"
							>{log.statusCode}</span
						>
					{/if}
					<span class="duration"
						>{log.status === "pending" || log.status === "streaming"
							? "…"
							: formatDuration(log.duration)}</span
					>
					<span class="size"
						>{formatBytes(log.requestSize)}{log.responseSize !==
						undefined
							? " → " + formatBytes(log.responseSize)
							: ""}</span
					>
					<span class="time">{formatTime(log.timestamp)}</span>
					<span class="arrow"
						>{selectedLog?.id === log.id ? "▲" : "▼"}</span
					>
				</div>
				{#if selectedLog?.id === log.id}
					<div class="log-detail">
						<p class="log-url"><strong>URL:</strong> {log.url}</p>
						<p><strong>Provider:</strong> {log.providerUrl}</p>
						{#if log.status === "pending"}
							<p class="pending-msg">
								<strong>Status:</strong> Waiting for response…
							</p>
						{:else if log.status === "streaming"}
							<p class="streaming-msg">
								<strong>Status:</strong> Streaming… ({log
									.responseBody?.length ?? 0} bytes received)
							</p>
						{/if}
						{#if log.error}
							<p class="error-msg">
								<strong>Error:</strong>
								{log.error}
							</p>
						{/if}
						{#if log.requestBody}
							<div
								class="detail-section body-section"
								onclick={(e) => {
									e.stopPropagation();
									openBodyModal(
										"requestBody",
										"Request Body",
									);
								}}
								role="button"
								tabindex={index * 10 + 1}
								aria-label="Show full request body"
								onkeydown={(e) => {
									e.stopPropagation();
									openBodyModal(
										"requestBody",
										"Request Body",
									);
								}}
							>
								<div class="section-header">
									<strong>Request Body</strong>
									<a
										class="expand-icon"
										href="#bodyModal"
										onclick={(e) => {
											e.stopPropagation();
											openBodyModal(
												"requestBody",
												"Request Body",
											);
										}}>expand</a
									>
								</div>
								<div class="body-preview">
									<div class="body-label">JSON</div>
									<span class="truncate"
										>{log.requestBody.substring(0, 200)}{log
											.requestBody.length > 200
											? "..."
											: ""}</span
									>
								</div>
							</div>
						{/if}
						{#if log.responseBody}
							<div
								class="detail-section body-section"
								onclick={(e) => {
									e.stopPropagation();
									openBodyModal(
										"responseBody",
										"Response Body",
									);
								}}
								onkeydown={(e) => {
									e.stopPropagation();
									openBodyModal(
										"responseBody",
										"Response Body",
									);
								}}
								role="button"
								tabindex={index * 10 + 2}
								aria-label="Show full response body"
							>
								<div class="section-header">
									<strong>Response Body</strong>
									{#if log.status === "streaming"}
										<span class="streaming-indicator"
											>⟳</span
										>
									{/if}
									<a
										class="expand-icon"
										href="#bodyModal"
										onclick={(e) => {
											e.stopPropagation();
											openBodyModal(
												"responseBody",
												"Response Body",
											);
										}}>expand</a
									>
								</div>
								<div class="body-preview">
									<div class="body-label">JSON</div>
									<span class="truncate"
										>{log.responseBody.substring(
											0,
											200,
										)}{log.responseBody.length > 200
											? "..."
											: ""}</span
									>
									{#if log.status === "streaming"}
										<span class="streaming-chunks"
											>⟳ streaming</span
										>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
		<!-- Full body modal overlay -->
		{#if bodyModal}
			<div class="modal-overlay" role="dialog">
				<div class="modal">
					<div class="modal-header">
						<h2>{bodyModal.title}</h2>
						{#if bodyModal.objectCount || 0 > 1}
							<span class="modal-subtitle">
								{bodyModal.objectCount} chunks
								{#if bodyModal.parseErrors || 0 > 0}
									— {bodyModal.parseErrors} parse error{bodyModal.parseErrors !==
									1
										? "s"
										: ""}
								{/if}
							</span>
						{/if}
						<div class="modal-actions">
							<button
								class="copy-btn"
								onclick={(e) => {
									e.stopPropagation();
									navigator.clipboard.writeText(
										copyBodyContent(bodyModal!.content),
									);
									const btn = e.currentTarget;
									btn.textContent = "Copied!";
									setTimeout(() => {
										btn.textContent = "Copy";
									}, 1500);
								}}>Copy</button
							>
							<button
								class="close-btn"
								onclick={() => (modalType = null)}>×</button
							>
						</div>
					</div>
					<div class="modal-body">
						{#if Array.isArray(bodyModal.content)}
							<!-- Chunked modal: show reasoning and JSON chunks interleaved -->
							{#each bodyModal.content as chunk, i}
								{#if chunk.type === "reasoning"}
									<div class="reasoning-container">
										<div class="reasoning-header">
											Reasoning
										</div>
										<pre
											class="reasoning-content">{chunk.content}</pre>
									</div>
								{:else}
									<div class="modal-chunk">
										<div class="chunk-header">
											<span class="chunk-index"
												>Chunk {i + 1}</span
											>
											{#if i < bodyModal.content.length - 1}
												<div
													class="chunk-separator"
												></div>
											{/if}
										</div>
										<pre
											class="json-container chunk-content">{@html chunk.html}
										</pre>
									</div>
								{/if}
							{/each}
							{#if bodyModal.parseErrors || 0 > 0}
								<p class="parse-error">
									⚠ {bodyModal.parseErrors} line{bodyModal.parseErrors !==
									1
										? "s"
										: ""} couldn't be parsed as JSON
								</p>
							{/if}
							{#if bodyModal.content.length === 0}
								<p class="empty-body">No body content</p>
							{/if}
						{:else}
							<!-- Single object modal -->
							<div class="modal-content">
								<pre
									class="json-container">{@html bodyModal.content}</pre>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* $style(); */
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 20px;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
			sans-serif;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	.header h1 {
		margin: 0;
		font-size: 24px;
	}

	.status-badge {
		font-size: 14px;
		color: #666;
	}

	.polling-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		background: #22c55e;
		border-radius: 50%;
		margin-left: 8px;
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	.loading {
		text-align: center;
		color: #666;
	}

	.error {
		text-align: center;
		padding: 20px;
		color: #ef4444;
		background: #fef2f2;
		border-radius: 8px;
	}

	.error button {
		margin-top: 10px;
		padding: 6px 16px;
		background: #ef4444;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}

	.logs-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.log-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		cursor: pointer;
		transition: box-shadow 0.15s;
	}

	.log-card:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.log-card.expanded {
		border-color: #3b82f6;
		box-shadow: 0 2px 12px rgba(59, 130, 246, 0.15);
	}

	.log-card.pending {
		border-color: #eab308;
		background: #fefce8;
	}

	.log-card.pending:hover {
		box-shadow: 0 2px 8px rgba(234, 179, 8, 0.15);
	}

	.log-card.pending.expanded {
		border-color: #eab308;
		box-shadow: 0 2px 12px rgba(234, 179, 8, 0.25);
	}

	.log-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		font-size: 13px;
		font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
	}

	.log-row .method {
		font-weight: 600;
		color: #6366f1;
		min-width: 45px;
	}

	.log-row .status {
		font-weight: 700;
		min-width: 35px;
	}

	.log-row .pending-status {
		font-weight: 600;
		min-width: 60px;
	}

	@keyframes pending-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.log-row .duration {
		color: #6b7280;
		min-width: 70px;
	}

	.log-row .size {
		color: #9ca3af;
		min-width: 80px;
	}

	.log-row .time {
		color: #9ca3af;
		flex: 1;
	}

	.log-row .arrow {
		color: #9ca3af;
		font-size: 10px;
	}

	.log-detail {
		padding: 12px 16px;
		border-top: 1px solid #f3f4f6;
		background: #f9fafb;
	}

	.log-url {
		word-break: break-all;
		font-size: 13px;
		margin: 0 0 8px 0;
		color: #374151;
	}

	.detail-section {
		margin-top: 10px;
		font-size: 12px;
	}

	.detail-section pre {
		background: #1f2937;
		color: #e5e7eb;
		padding: 10px;
		border-radius: 6px;
		overflow-x: auto;
		font-size: 11px;
		line-height: 1.4;
		margin-top: 4px;
		max-height: 300px;
		overflow-y: auto;
	}

	.error-msg {
		color: #ef4444;
		margin-top: 8px;
	}

	.pending-msg {
		color: #eab308;
		margin-top: 8px;
		animation: pending-pulse 1.5s ease-in-out infinite;
	}

	/* Body section styles */
	.body-section {
		cursor: pointer;
		user-select: none;
		transition: background 0.1s;
	}

	.body-section:hover {
		background: #f3f4f6;
		border-radius: 4px;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 0;
		cursor: pointer;
	}

	.section-header a.expand-icon {
		color: #6366f1;
		text-decoration: none;
		font-size: 12px;
		cursor: pointer;
	}

	.section-header a.expand-icon:hover {
		text-decoration: underline;
	}

	.body-preview {
		margin-top: 4px;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}

	.body-label {
		color: #9ca3af;
		font-weight: 600;
		text-transform: uppercase;
	}

	.truncate {
		font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
		color: #4b5563;
		word-break: break-word;
	}

	/* Streaming indicator styles */
	.streaming-indicator {
		font-size: 14px;
		color: #f59e0b;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.streaming-chunks {
		color: #f59e0b;
		font-weight: 600;
		font-size: 11px;
		animation: pending-pulse 1.5s ease-in-out infinite;
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 0.15s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal {
		background: white;
		border-radius: 12px;
		width: 90vw;
		max-width: 900px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		animation: slideUp 0.2s ease;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px 20px;
		border-bottom: 1px solid #e5e7eb;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.modal-subtitle {
		font-size: 12px;
		color: #6b7280;
		font-weight: 400;
	}

	.modal-actions {
		display: flex;
		gap: 8px;
	}

	.copy-btn,
	.close-btn {
		padding: 6px 12px;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		background: white;
		cursor: pointer;
		font-size: 13px;
		transition: background 0.1s;
	}

	.copy-btn:hover,
	.close-btn:hover {
		background: #f3f4f6;
	}

	.close-btn {
		font-size: 18px;
		padding: 4px 10px;
	}

	.modal-body {
		padding: 16px 20px;
		overflow: auto;
		flex: 1;
	}

	.modal-content {
		font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
		font-size: 12px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Reasoning modal styles */
	.reasoning-container {
		margin-bottom: 16px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: hidden;
		background: #f0f9ff;
	}

	.reasoning-header {
		font-size: 11px;
		font-weight: 600;
		color: #0369a1;
		text-transform: uppercase;
		padding: 8px 12px;
		background: #e0f2fe;
		border-bottom: 1px solid #bae6fd;
	}

	.reasoning-content {
		margin: 0 !important;
		border-radius: 0 !important;
		background: #f0f9ff !important;
		color: #0c4a6e !important;
		padding: 12px !important;
		max-height: 400px !important;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 13px !important;
		line-height: 1.5 !important;
	}

	/* Multi-chunk modal styles */
	.modal-chunk {
		margin-bottom: 16px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: hidden;
	}

	.chunk-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
	}

	.chunk-index {
		font-size: 11px;
		font-weight: 600;
		color: #6366f1;
		text-transform: uppercase;
	}

	.chunk-separator {
		height: 4px;
		width: 24px;
		background: #e5e7eb;
		border-radius: 2px;
	}

	.chunk-content {
		margin: 0 !important;
		border-radius: 0 !important;
	}

	.parse-error {
		margin-top: 12px;
		padding: 8px 12px;
		background: #fef3c7;
		border: 1px solid #fbbf24;
		border-radius: 6px;
		font-size: 12px;
		color: #92400e;
	}

	.empty-body {
		margin-top: 12px;
		padding: 12px;
		background: #f3f4f6;
		border-radius: 6px;
		font-size: 13px;
		color: #6b7280;
		text-align: center;
	}

	:global {
		/* Syntax highlighting */
		.json-key {
			color: #6366f1;
		}

		.json-string {
			color: #22c55e;
			white-space: wrap;
		}

		.json-number {
			color: #f97316;
		}

		.json-boolean {
			color: #a855f7;
		}

		.json-null {
			color: #9ca3af;
			font-style: italic;
		}
	}
</style>
