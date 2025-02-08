// Don't send duplicate errors within this window
const ERROR_WINDOW = 60 * 60; // 1 hour

const IGNORE_PATTERNS = [
  /^favicon\.[^/]+$/,
  /^robots\.txt$/,
  /^apple-[^/]+\.png$/
];

export default {
  async tail(events, env) {
    for (const event of events) {
      if (event.outcome === "exception") {
        const context = extractContext(event);

        // Don't send emails for junk requests like favicon or robots
        if (IGNORE_PATTERNS.some(pattern => pattern.test(context.url))) {
          console.log(`Ignoring URL: ${context.url}`);
          continue;
        }

        // Check if we've seen this error recently
        const errorHash = await generateErrorHash(context);
        const isDuplicate = await checkDuplicateError(errorHash, env);

        if (!isDuplicate) {
          const aiSummary = await generateErrorSummary(context, env);
          const message = formatSlackMessage(context, aiSummary);
          await sendToSlack(message, env);

          // Store the error hash with a TTL
          await storeErrorHash(errorHash, env);
        } else {
          console.log(`Duplicate error detected, hash: ${errorHash}`);
        }
      }
    }
  }
} satisfies ExportedHandler<Env>;

async function generateErrorHash(context) {
  const errorDetails = {
    scriptName: context.scriptName,
    exceptions: context.exceptions,
    url: context.url,
    method: context.method
  };

  const text = JSON.stringify(errorDetails);
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkDuplicateError(errorHash, env) {
  try {
    const stored = await env.ERROR_DEDUP_KV.get(errorHash);
    return stored !== null;
  } catch (error) {
    console.error('Error checking duplicate:', error);
    return false; // If KV check fails, treat as new error
  }
}

async function storeErrorHash(errorHash, env) {
  try {
    await env.ERROR_DEDUP_KV.put(errorHash, 'true', { expirationTtl: ERROR_WINDOW });
  } catch (error) {
    console.error('Error storing hash:', error);
  }
}

function extractContext(event) {
  return {
    timestamp: new Date(event.eventTimestamp).toISOString(),
    scriptName: event.scriptName,
    url: event.event?.request?.url,
    method: event.event?.request?.method,
    logs: formatLogs(event.logs || []),
    exceptions: formatExceptions(event.exceptions || [])
  };
}

function formatLogs(logs) {
  return logs
    .map(log => `${new Date(log.timestamp).toISOString()} [${log.level}] ${log.message}`)
    .join('\n');
}

function formatExceptions(exceptions) {
  return exceptions
    .map(ex => `${ex.name}: ${ex.message}`)
    .join('\n');
}

async function generateErrorSummary(context, env) {
  try {
    // First AI call to analyze the error
    const analysisPrompt = createAIPrompt(context);
    const analysisResponse = await env.AI.run('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', {
      messages: [{
        role: 'user',
        content: analysisPrompt
      }]
    });

    const summaryPrompt = `Create a clear, concise summary (2-3 sentences max) of this error analysis and the suggested fix. Focus on the key problem and likely cause:

${analysisResponse.response}`;

    const summaryResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{
        role: 'user',
        content: summaryPrompt
      }]
    });

    return summaryResponse.response;
  } catch (error) {
    console.error('Error generating AI summary:', error);
    return 'Unable to generate AI analysis';
  }
}

function createAIPrompt(context) {
  return `Analyze this error and provide a concise summary explaining what went wrong and potential causes. Also think about what the developer could do to fix this error. Include any relevant context from the logs.

Context:
Script: ${context.scriptName}
URL: ${context.url}
Method: ${context.method}
Time: ${context.timestamp}

Exceptions:
${context.exceptions}

Logs:
${context.logs}`;
}

function formatSlackMessage(context, aiSummary) {
  return {
    username: "Error Monitor",
    icon_emoji: ":robot_face:",
    blocks: [
      createHeaderBlock(context),
      createAIAnalysisBlock(aiSummary),
      createContextBlock(context),
      createExceptionBlock(context)
    ]
  };
}

function createHeaderBlock(context) {
  return {
    type: "header",
    text: {
      type: "plain_text",
      text: `⚠️ Error in ${context.scriptName}`,
      emoji: true
    }
  };
}

function createAIAnalysisBlock(aiSummary) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*AI Analysis:*\n${aiSummary}`
    }
  };
}

function createContextBlock(context) {
  return {
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*URL:*\n${context.url || 'N/A'}`
      },
      {
        type: "mrkdwn",
        text: `*Method:*\n${context.method || 'N/A'}`
      },
      {
        type: "mrkdwn",
        text: `*Time:*\n${context.timestamp}`
      }
    ]
  };
}

function createExceptionBlock(context) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Exception Details:*\n\`\`\`${context.exceptions}\`\`\``
    }
  };
}

async function sendToSlack(message, env) {
  try {
    const response = await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`Slack API responded with status: ${response.status}`);
    }
  } catch (error) {
    console.error('Error sending to Slack:', error);
  }
}
