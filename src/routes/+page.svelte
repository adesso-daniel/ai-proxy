<script lang="ts">
	import type { RequestLog } from "$lib/types";
	import { prettyPrintJson } from "pretty-print-json";

	let logs = $state<RequestLog[]>([]);
	let selectedLog = $state<RequestLog | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let pollingInterval: ReturnType<typeof setInterval>;
	let bodyModal = $state<{
		type: "requestBody" | "responseBody";
		content: string;
		title: string;
	} | null>(null);

	function openBodyModal(
		type: "requestBody" | "responseBody",
		title: string,
	) {
		const content = selectedLog?.[type];
		console.log([type, selectedLog, content]);
		if (content) {
			bodyModal = { type, content, title };
		}
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
		if (status === "completed") return "#22c55e";
		if (status === "error") return "#ef4444";
		return "#6b7280";
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
		selectedLog = selectedLog?.id === log.id ? null : log;
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
				class:pending={log.status === "pending"}
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
					{:else}
						<span
							class="status"
							style="color: {statusCodeColor(log.statusCode)}"
							>{log.statusCode}</span
						>
					{/if}
					<span class="duration"
						>{log.status === "pending"
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
						<div class="modal-actions">
							<button
								class="copy-btn"
								onclick={(e) => {
									e.stopPropagation();
									navigator.clipboard.writeText(
										bodyModal!.content,
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
								onclick={() => (bodyModal = null)}>×</button
							>
						</div>
					</div>
					<div class="modal-body">
						<div class="modal-content">
							<pre
								class="json-container">{@html prettyPrintJson.toHtml(
									JSON.parse(bodyModal.content),
								)}</pre>
						</div>
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
