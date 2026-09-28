import {
  Injectable,
  Logger,
  BadRequestException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { TavilySearchService } from './tavily-search.service';
import { WebSearchRunnerService } from './web-search-runner.service';
import { redactSecrets } from './redaction.util';
import { RuntimeNode } from './variable-resolver.service';

export interface AgentToolParamSchema {
  type: string;
  description?: string;
  enum?: string[];
  default?: any;
}

export interface AgentToolSchema {
  type: 'object';
  properties: Record<string, AgentToolParamSchema>;
  required?: string[];
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: AgentToolSchema;
  execute: (args: Record<string, any>, context?: any) => Promise<any>;
  validateArgs?: (
    args: Record<string, any>,
  ) => { isValid: boolean; error?: string; cleanArgs?: any };
  summarizeResult?: (result: any) => string;
}

export interface AgentToolTraceItem {
  id: string;
  tool: string;
  args: Record<string, any>;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  resultSummary?: string;
  result?: any;
  error?: string;
}

@Injectable()
export class AgentToolRegistryService {
  private readonly logger = new Logger(AgentToolRegistryService.name);
  private readonly tools = new Map<string, AgentToolDefinition>();

  constructor(
    @Optional()
    @Inject(forwardRef(() => WebSearchRunnerService))
    private readonly webSearchRunner?: WebSearchRunnerService,
    @Optional()
    private readonly tavilySearch?: TavilySearchService,
  ) {
    this.registerBuiltinTools();
  }

  /**
   * Register built-in autonomous tools (search_web and read_url)
   */
  private registerBuiltinTools() {
    // 1. search_web: Query the web using Tavily
    this.registerTool({
      name: 'search_web',
      description:
        'Search the public web for real-time information, facts, articles, documentation, or news.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The search query string. Keep it specific and concise.',
          },
          maxResults: {
            type: 'number',
            description:
              'Maximum number of search results to return (1-10, default: 5).',
          },
          searchDepth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description:
              'Depth of search: "basic" for quick answers, "advanced" for deeper research.',
          },
          topic: {
            type: 'string',
            enum: ['general', 'news'],
            description: 'Topic filter: "general" or "news".',
          },
        },
        required: ['query'],
      },
      validateArgs: (args) => {
        if (!args || typeof args !== 'object') {
          return { isValid: false, error: 'Arguments must be a valid JSON object.' };
        }
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) {
          return {
            isValid: false,
            error:
              'Missing or empty required argument "query". You must specify a non-empty search query string.',
          };
        }
        let maxResults = Number(args.maxResults);
        if (isNaN(maxResults) || maxResults < 1) maxResults = 5;
        if (maxResults > 10) maxResults = 10;

        const cleanArgs: Record<string, any> = { query, maxResults };
        if (args.searchDepth === 'advanced' || args.searchDepth === 'basic') {
          cleanArgs.searchDepth = args.searchDepth;
        }
        if (args.topic === 'news' || args.topic === 'general') {
          cleanArgs.topic = args.topic;
        }
        return { isValid: true, cleanArgs };
      },
      execute: async (args) => {
        const query = String(args.query).trim();
        const maxResults = Math.min(10, Math.max(1, Number(args.maxResults) || 5));
        const accessedAt = new Date().toISOString();
        const normalizeResults = (items: any[], provider: string, status: number) => items.slice(0, maxResults).map((item) => ({
          query,
          title: item.title || null,
          url: item.url || '',
          originalUrl: item.originalUrl || item.url || '',
          resolvedUrl: item.resolvedUrl || item.url || '',
          content: String(item.content || item.rawContent || '').slice(0, 1500).trim(),
          score: typeof item.score === 'number' ? item.score : null,
          publishedAt: item.publishedAt || item.publishedDate || null,
          accessedAt,
          provider,
          status,
        }));

        if (this.webSearchRunner) {
          const searchNode: RuntimeNode = {
            id: 'tool_search_web',
            data: {
              config: {
                mode: 'search',
                query,
                maxResults,
                searchDepth: args.searchDepth || 'basic',
                topic: args.topic || 'general',
              },
            },
          };
          const webRes = await this.webSearchRunner.executeWebSearchNode(
            searchNode,
            {},
            {},
            'agent-tool',
          );
          const rawResults = Array.isArray(webRes.results) ? webRes.results : [];
          const boundedResults = normalizeResults(rawResults, webRes.provider || 'tavily', webRes.status);

          return {
            query,
            provider: webRes.provider || 'tavily',
            status: webRes.status,
            accessedAt,
            resultsCount: boundedResults.length,
            answer: webRes.answer || undefined,
            results: boundedResults,
          };
        }

        const searchSvc = this.tavilySearch || new TavilySearchService();
        const searchResult = await searchSvc.search({
          query,
          maxResults,
          searchDepth: args.searchDepth,
          topic: args.topic,
        });

        const boundedResults = normalizeResults(searchResult.results || [], searchResult.provider, searchResult.status);

        return {
          query,
          provider: searchResult.provider,
          status: searchResult.status,
          accessedAt,
          resultsCount: boundedResults.length,
          answer: searchResult.answer || undefined,
          results: boundedResults,
        };
      },
      summarizeResult: (res) => {
        const count = res?.resultsCount ?? (Array.isArray(res?.results) ? res.results.length : 0);
        const queryStr = res?.query ? ` for "${res.query}"` : '';
        return `Found ${count} search results${queryStr}`;
      },
    });

    // 2. read_url: Fetch and extract article/page content from a known URL
    this.registerTool({
      name: 'read_url',
      description:
        'Fetch, clean, and extract readable content and hyperlinks from a specific webpage URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              'The HTTP or HTTPS URL of the webpage or article to inspect.',
          },
          mode: {
            type: 'string',
            enum: ['read_article', 'fetch_and_clean'],
            description:
              'Extraction focus: "read_article" extracts the primary article text; "fetch_and_clean" extracts general page text.',
          },
          maxContentLength: {
            type: 'number',
            description:
              'Maximum text characters to return (500-20000, default: 8000).',
          },
        },
        required: ['url'],
      },
      validateArgs: (args) => {
        if (!args || typeof args !== 'object') {
          return { isValid: false, error: 'Arguments must be a valid JSON object.' };
        }
        let rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
        if (!rawUrl) {
          return {
            isValid: false,
            error:
              'Missing or empty required argument "url". You must provide a valid target webpage URL.',
          };
        }
        if (!/^https?:\/\//i.test(rawUrl)) {
          if (rawUrl.includes('://')) {
            return {
              isValid: false,
              error: `Invalid URL format: "${rawUrl}". Only HTTP and HTTPS protocols are supported.`,
            };
          }
          if (rawUrl.includes('.') && !rawUrl.includes(' ')) {
            rawUrl = `https://${rawUrl}`;
          } else {
            return {
              isValid: false,
              error: `Invalid URL format: "${rawUrl}". URL must begin with http:// or https://.`,
            };
          }
        }

        let maxLen = Number(args.maxContentLength || args.maxLength);
        if (isNaN(maxLen) || maxLen < 100) maxLen = 8000;
        if (maxLen > 20000) maxLen = 20000;

        const mode =
          args.mode === 'fetch_and_clean' ? 'fetch_and_clean' : 'read_article';

        return {
          isValid: true,
          cleanArgs: {
            url: rawUrl,
            mode,
            maxContentLength: maxLen,
          },
        };
      },
      execute: async (args) => {
        const url = String(args.url).trim();
        const accessedAt = new Date().toISOString();
        const mode = args.mode || 'read_article';
        const maxContentLength = Math.min(
          20000,
          Math.max(100, Number(args.maxContentLength || args.maxLength) || 8000),
        );

        if (this.webSearchRunner) {
          const crawlNode: RuntimeNode = {
            id: 'tool_read_url',
            data: {
              config: {
                mode,
                url,
                maxContentLength,
              },
            },
          };
          const res = await this.webSearchRunner.executeWebSearchNode(
            crawlNode,
            {},
            {},
            'agent-tool',
          );

          const text = (res.text || '').slice(0, maxContentLength);
          const links = (res.links || [])
            .slice(0, 15)
            .map((l) => ({ text: l.text, href: l.href }));

          return {
            url: res.url || url,
            originalUrl: url,
            resolvedUrl: res.url || url,
            title: res.title && res.title !== 'Untitled Page' ? res.title : null,
            publishedAt: res.publishedAt ?? null,
            accessedAt,
            provider: res.provider || 'web-search',
            retrievalMethod: res.retrievalMethod || mode,
            status: res.status ?? null,
            text,
            characterCount: text.length,
            linksCount: res.linksCount || links.length,
            links,
            truncated: Boolean((res as any).truncated || (res.text || '').length > maxContentLength),
          };
        }

        // Direct HTTP fetch fallback if WebSearchRunnerService not injected
        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FlowBuilder/1.0',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(15000),
        });

        const rawHtml = await response.text();
        const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : null;

        const linkMatches = Array.from(rawHtml.matchAll(/<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi));
        const links = linkMatches
          .map((m) => m[1])
          .filter((href) => href && (href.startsWith('http://') || href.startsWith('https://')))
          .slice(0, 15);

        const fullCleanText = rawHtml
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const text = fullCleanText.slice(0, maxContentLength);
        const truncated = fullCleanText.length > maxContentLength;

        return {
          url: response.url || url,
          originalUrl: url,
          resolvedUrl: response.url || url,
          title,
          publishedAt: null,
          accessedAt,
          provider: 'http-fetch',
          retrievalMethod: mode,
          status: response.status,
          text,
          characterCount: text.length,
          linksCount: links.length,
          links,
          truncated,
        };
      },
      summarizeResult: (res) => {
        const title = res?.title ? `"${res.title}"` : res?.url || 'page';
        const chars = res?.text?.length || 0;
        return `Read ${chars} characters from ${title} (HTTP ${res?.status || 200})`;
      },
    });
  }

  /**
   * Register a new tool definition
   */
  registerTool(tool: AgentToolDefinition) {
    this.tools.set(tool.name, tool);
    this.logger.log(`🛠️ Registered Agent Tool: "${tool.name}"`);
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Look up a registered tool
   */
  getTool(name: string): AgentToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Return all registered tools that match the allowed list
   */
  getAllowedTools(allowedNames: string[] = []): AgentToolDefinition[] {
    const normalized = allowedNames
      .map((n) => String(n || '').trim())
      .filter(Boolean);
    const result: AgentToolDefinition[] = [];
    for (const name of normalized) {
      const tool = this.tools.get(name);
      if (tool) {
        result.push(tool);
      }
    }
    return result;
  }

  /**
   * List all registered tool names
   */
  getRegisteredToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Convert allowed tools to OpenAI Function Calling format
   */
  getOpenAiToolSchemas(allowedNames: string[] = []): any[] {
    const tools = this.getAllowedTools(allowedNames);
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Convert allowed tools to Anthropic Tool Use format
   */
  getAnthropicToolSchemas(allowedNames: string[] = []): any[] {
    const tools = this.getAllowedTools(allowedNames);
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /**
   * Validate a tool call against the allowlist and argument schema
   */
  validateToolCall(
    name: string,
    rawArgs: any,
    allowedNames: string[] = [],
  ): {
    isValid: boolean;
    tool?: AgentToolDefinition;
    cleanArgs?: any;
    error?: string;
  } {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        isValid: false,
        error: `Tool "${name}" is not a recognized tool. Available tools: ${this.getRegisteredToolNames().join(', ')}`,
      };
    }

    const isAllowed = allowedNames.includes(name);
    if (!isAllowed) {
      return {
        isValid: false,
        error: `Tool "${name}" is not in the allowed tools list for this agent. Allowed tools: ${allowedNames.join(', ')}`,
      };
    }

    let parsedArgs = rawArgs;
    if (typeof rawArgs === 'string') {
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch (err: any) {
        return {
          isValid: false,
          tool,
          error: `Failed to parse tool arguments as JSON: ${err.message}`,
        };
      }
    }

    if (tool.validateArgs) {
      const validation = tool.validateArgs(parsedArgs || {});
      if (!validation.isValid) {
        return {
          isValid: false,
          tool,
          error: validation.error || `Invalid arguments for tool "${name}".`,
        };
      }
      return {
        isValid: true,
        tool,
        cleanArgs: validation.cleanArgs !== undefined ? validation.cleanArgs : parsedArgs,
      };
    }

    return {
      isValid: true,
      tool,
      cleanArgs: parsedArgs,
    };
  }

  /**
   * Safely execute an approved tool call, returning bounded results and timing
   */
  async executeTool(
    name: string,
    args: Record<string, any>,
    context?: any,
  ): Promise<{
    success: boolean;
    result?: any;
    summary?: string;
    error?: string;
    durationMs: number;
  }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found.`,
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    try {
      this.logger.log(
        `   ⚙️ [Tool Registry] Executing tool "${name}" with args: ${JSON.stringify(redactSecrets(args))}`,
      );
      const rawResult = await tool.execute(args, context);
      const durationMs = Date.now() - startTime;
      const redactedResult = redactSecrets(rawResult);
      const summary = tool.summarizeResult
        ? tool.summarizeResult(redactedResult)
        : `Tool "${name}" completed in ${durationMs}ms`;

      this.logger.log(
        `   ✅ [Tool Registry] Tool "${name}" SUCCESS in ${durationMs}ms: ${summary}`,
      );

      return {
        success: true,
        result: redactedResult,
        summary,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const safeError = err.message || 'Tool execution encountered an unexpected error.';
      this.logger.error(
        `   ❌ [Tool Registry] Tool "${name}" FAILED in ${durationMs}ms: ${safeError}`,
      );

      return {
        success: false,
        error: safeError,
        durationMs,
      };
    }
  }
}
