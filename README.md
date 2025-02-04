# Error Monitor

A Cloudflare Workers application that provides intelligent error monitoring with AI-powered analysis and Slack notifications. The system includes deduplication to prevent alert fatigue and detailed contextual information for better debugging.

## Overview

This Workers application handles error events by:
- Capturing and analyzing exceptions
- Deduplicating similar errors within a configurable time window
- Generating AI-powered analysis of the error context
- Formatting and sending detailed Slack notifications

It heavily makes use of [Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/) to efficiently process error events. Tail Workers require a subscription to the Workers Paid plan.

## Key Features

### Error Deduplication

The system prevents duplicate notifications within a 1-hour window using a SHA-256 hash of error details stored in Workers KV:

```js
const ERROR_WINDOW = 60 * 60; // 1 hour

async function generateErrorHash(context) {
  const errorDetails = {
    scriptName: context.scriptName,
    exceptions: context.exceptions,
    url: context.url,
    method: context.method
  };
  // ... hash generation
}
```

### AI Analysis

The system uses two AI models in sequence to provide intelligent error analysis:
1. Deep analysis using `deepseek-r1-distill-qwen-32b`
2. Concise summary using `llama-3.3-70b-instruct`

### Slack Integration

Notifications are formatted with a clear, structured layout including:
- Error header and script identification
- AI-generated analysis
- Request context (URL, method, timestamp)
- Exception details

## Configuration

Required environment variables:
- `ERROR_DEDUP_KV`: Workers KV namespace for deduplication
- `SLACK_WEBHOOK_URL`: Webhook URL for Slack notifications
- `AI`: Cloudflare AI binding

## Usage

The application exports a single `tail` function that processes error events:

```js
export default {
  async tail(events, env) {
    // Process error events
  }
} satisfies ExportedHandler<Env>;
```

This entrypoint handles the error monitoring pipeline, from detection through notification.

## Development

This codebase requires Cloudflare Workers with access to:
- Workers KV
- Cloudflare AI
- Slack webhooks

Remember to configure your `wrangler.json` with the necessary bindings and environment variables.

