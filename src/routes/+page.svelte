<script lang="ts">
	import { requestStore } from '$lib/store';
	import type { RequestLog } from '$lib/types';

	let logs = $state<RequestLog[]>([]);
	let selectedLog = $state<RequestLog | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let pollingInterval: ReturnType<typeof setInterval>;

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3,
		});
	}

	function formatDuration(ms: number): string {
		if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
		return `${ms.toFixed(1)}ms`;
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
		return `${(bytes / 1048576).toFixed(1)}MB`;
	}

	function statusCodeColor(code: number): string {
		if (code >= 200 && code < 300) return '#22c55e';
		if (code >= 300 && code < 400) return '#eab308';
		if (code >= 400 && code < 500) return '#f97316';
		return '#ef4444';
	}

	async function fetchLogs() {
		try {
			const res = await fetch('/api/logs');
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
			{logs.length} request{logs.length !== 1 ? 's' : ''}
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
		{#each logs as log (log.id)}
			<div class="log-card" class:expanded={selectedLog?.id === log.id} role="button" tabindex="0" aria-expanded={selectedLog?.id === log.id} onclick={() => expandLog(log)} onkeydown={(e) => { if (e.key === 'Enter') expandLog(log); }}>
				<div class="log-row">
					<span class="method">{log.method}</span>
					<span class="status" style="color: {statusCodeColor(log.statusCode)}">{log.statusCode}</span>
					<span class="duration">{formatDuration(log.duration)}</span>
					<span class="size">{formatBytes(log.requestSize)} → {formatBytes(log.responseSize)}</span>
					<span class="time">{formatTime(log.timestamp)}</span>
					<span class="arrow">{selectedLog?.id === log.id ? '▲' : '▼'}</span>
				</div>
				{#if selectedLog?.id === log.id}
					<div class="log-detail">
						<p class="log-url"><strong>URL:</strong> {log.url}</p>
						<p><strong>Provider:</strong> {log.providerUrl}</p>
						{#if log.error}
							<p class="error-msg"><strong>Error:</strong> {log.error}</p>
						{/if}
						{#if log.requestBody}
							<div class="detail-section">
								<strong>Request Body:</strong>
								<pre>{log.requestBody}</pre>
							</div>
						{/if}
						{#if log.responseBody}
							<div class="detail-section">
								<strong>Response Body:</strong>
								<pre>{log.responseBody}</pre>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 20px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
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
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}

	.log-card.expanded {
		border-color: #3b82f6;
		box-shadow: 0 2px 12px rgba(59,130,246,0.15);
	}

	.log-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		font-size: 13px;
		font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
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
</style>
