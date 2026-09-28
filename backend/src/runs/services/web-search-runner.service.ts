import {
  Injectable,
  Logger,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import {
  VariableResolverService,
  RuntimeNode,
} from './variable-resolver.service';
import { BrowserRunnerService } from './browser-runner.service';
import {
  TavilySearchService,
  NormalizedSearchResponse,
  NormalizedSearchResultItem,
} from './tavily-search.service';

export interface WebSearchResult {
  status: number;
  url: string;
  title: string;
  originalUrl?: string;
  resolvedUrl?: string;
  accessedAt?: string;
  publishedAt?: string | null;
  retrievalMethod?: string;
  html?: string;
  text?: string;
  links?: Array<{ text: string; href: string }>;
  linksCount?: number;
  query?: string;
  provider?: string;
  results?: NormalizedSearchResultItem[];
  resultsCount?: number;
  responseTime?: number;
  answer?: string;
  images?: string[];
  usage?: Record<string, any>;
}

@Injectable()
export class WebSearchRunnerService {
  private readonly logger = new Logger(WebSearchRunnerService.name);

  constructor(
    private readonly variableResolver: VariableResolverService,
    private readonly browserRunner: BrowserRunnerService,
    @Optional() private readonly tavilySearch?: TavilySearchService,
  ) {}

  async executeWebSearchNode(
    node: RuntimeNode,
    nodeInput: any,
    context: Record<string, any>,
    runId: string,
  ): Promise<WebSearchResult> {
    const data = node.data || {};
    const config = { ...(data.config || {}), ...(nodeInput || {}) };

    const rawMode = config.mode || config.operation;
    let mode = 'search';
    if (rawMode) {
      mode = String(rawMode).toLowerCase();
    } else if (config.url && !config.query) {
      mode = 'fetch_and_clean';
    }

    if (mode === 'search' || mode === 'web_search' || mode === 'query') {
      return this.executeSearchMode(config, nodeInput, context, runId);
    }

    return this.executeCrawlMode(config, nodeInput, context, runId, mode);
  }

  private async executeSearchMode(
    config: Record<string, any>,
    nodeInput: any,
    context: Record<string, any>,
    runId: string,
  ): Promise<WebSearchResult> {
    let rawQuery = config.query || nodeInput?.query || nodeInput?.input || '';
    rawQuery = this.variableResolver.resolveValue(rawQuery, context);

    if (typeof rawQuery === 'object' && rawQuery !== null) {
      rawQuery =
        rawQuery.query ||
        rawQuery.value ||
        rawQuery.q ||
        rawQuery.prompt ||
        JSON.stringify(rawQuery);
    }

    if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
      throw new BadRequestException(
        'Web Search query mode requires a valid non-empty "query" parameter',
      );
    }

    const query = rawQuery.trim();
    const provider = String(
      this.variableResolver.resolveValue(config.provider, context) || 'tavily',
    ).toLowerCase();

    if (provider !== 'tavily') {
      throw new BadRequestException(
        `Unsupported web search provider "${provider}". Supported providers: tavily`,
      );
    }

    const rawMaxResults = this.variableResolver.resolveValue(
      config.maxResults,
      context,
    );
    const maxResults =
      rawMaxResults !== undefined && rawMaxResults !== null && rawMaxResults !== ''
        ? Number(rawMaxResults)
        : undefined;
    const searchDepth = this.variableResolver.resolveValue(
      config.searchDepth,
      context,
    );
    const topic = this.variableResolver.resolveValue(config.topic, context);
    const timeRange = this.variableResolver.resolveValue(
      config.timeRange,
      context,
    );
    const includeDomains = this.variableResolver.resolveValue(
      config.includeDomains,
      context,
    );
    const excludeDomains = this.variableResolver.resolveValue(
      config.excludeDomains,
      context,
    );
    const includeAnswer = this.variableResolver.resolveValue(
      config.includeAnswer,
      context,
    );
    const includeRawContent = this.variableResolver.resolveValue(
      config.includeRawContent,
      context,
    );
    const includeImages = this.variableResolver.resolveValue(
      config.includeImages,
      context,
    );
    const language = this.variableResolver.resolveValue(
      config.language,
      context,
    );

    this.logger.log(
      `   🌐 [Web Search Execution] Query: "${query}" | Provider: ${provider} | Max: ${
        maxResults || 5
      }`,
    );

    const searchService = this.tavilySearch || new TavilySearchService();
    const searchResult = await searchService.search({
      query,
      maxResults,
      searchDepth,
      topic,
      timeRange,
      includeDomains,
      excludeDomains,
      includeAnswer,
      includeRawContent,
      includeImages,
      language,
    });

    this.logger.log(
      `   ✅ [Web Search Complete] Returned ${searchResult.resultsCount} results via ${provider}`,
    );

    return {
      status: searchResult.status,
      accessedAt: new Date().toISOString(),
      query: searchResult.query,
      provider: searchResult.provider,
      results: searchResult.results,
      resultsCount: searchResult.resultsCount,
      responseTime: searchResult.responseTime,
      answer: searchResult.answer,
      images: searchResult.images,
      usage: searchResult.usage,
      // Convenience aliases for downstream nodes
      title: searchResult.results[0]?.title || '',
      url: searchResult.results[0]?.url || '',
      text: searchResult.answer || searchResult.results[0]?.content || '',
    };
  }

  private async executeCrawlMode(
    config: Record<string, any>,
    nodeInput: any,
    context: Record<string, any>,
    runId: string,
    mode: string,
  ): Promise<WebSearchResult> {
    let rawUrl = config.url || nodeInput?.url || nodeInput?.input || '';
    rawUrl = this.variableResolver.resolveValue(rawUrl, context);

    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new BadRequestException(
        'Web Search block requires a valid "url" parameter',
      );
    }

    rawUrl = rawUrl.trim();
    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }

    const engine = String(config.engine || 'fetch').toLowerCase();
    const maxContentLength = Number(config.maxContentLength) || 25000;

    this.logger.log(
      `   🌐 [Web Search Execution] URL: "${rawUrl}" | Mode: ${mode} | Engine: ${engine}`,
    );

    let rawHtml = '';
    let pageTitle = '';
    let finalUrl = rawUrl;
    let httpStatus = 200;

    const isCloudflareChallenge = (
      status: number,
      html: string,
      title: string,
    ) => {
      const lHtml = (html || '').toLowerCase();
      const lTitle = (title || '').toLowerCase();
      return (
        status === 403 ||
        status === 503 ||
        lTitle.includes('just a moment') ||
        lTitle.includes('attention required') ||
        lHtml.includes('cf-mitigated') ||
        lHtml.includes('challenges.cloudflare.com')
      );
    };

    if (engine === 'playwright') {
      try {
        const pwRes = await this.playwrightFetch(rawUrl);
        rawHtml = pwRes.html;
        pageTitle = pwRes.title;
        httpStatus = pwRes.status;
        finalUrl = pwRes.finalUrl;
      } catch (err: any) {
        this.logger.warn(
          `   ⚠️ Playwright fetch failed: ${err.message}. Falling back to HTTP fetch.`,
        );
        const res = await this.httpFetch(rawUrl);
        rawHtml = res.html;
        httpStatus = res.status;
        finalUrl = res.finalUrl;
      }
    } else {
      const res = await this.httpFetch(rawUrl);
      rawHtml = res.html;
      httpStatus = res.status;
      finalUrl = res.finalUrl;

      // Automatic stealth bypass: If HTTP fetch hits a Cloudflare challenge, auto-upgrade to Playwright
      if (isCloudflareChallenge(httpStatus, rawHtml, '')) {
        this.logger.warn(
          `   🛡️ Cloudflare / WAF challenge detected on "${rawUrl}". Auto-upgrading to Playwright stealth browser...`,
        );
        try {
          const pwRes = await this.playwrightFetch(rawUrl);
          if (!isCloudflareChallenge(pwRes.status, pwRes.html, pwRes.title)) {
            this.logger.log(
              `   ✨ Cloudflare challenge successfully bypassed via Playwright stealth!`,
            );
            rawHtml = pwRes.html;
            pageTitle = pwRes.title;
            httpStatus = pwRes.status;
            finalUrl = pwRes.finalUrl;
          }
        } catch (pwErr: any) {
          this.logger.warn(
            `   ⚠️ Auto-upgrade to Playwright stealth failed: ${pwErr.message}`,
          );
        }
      }
    }

    // Extract Title if not already set
    if (!pageTitle && rawHtml) {
      const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        pageTitle = this.decodeHtmlEntities(titleMatch[1].trim());
      }
    }

    // Extract Hyperlinks
    const links = this.extractLinks(rawHtml, finalUrl);

    // Clean HTML & Text
    const { cleanHtml, cleanText } = this.processHtmlContent(
      rawHtml,
      mode,
      maxContentLength,
    );

    this.logger.log(
      `   ✅ [Web Search Complete] Extracted ${links.length} links | Text Length: ${cleanText.length} chars`,
    );

    return {
      status: httpStatus,
      url: finalUrl,
      originalUrl: rawUrl,
      resolvedUrl: finalUrl,
      accessedAt: new Date().toISOString(),
      publishedAt: null,
      provider: engine,
      retrievalMethod: mode,
      title: pageTitle || '',
      html: cleanHtml,
      text: cleanText,
      links,
      linksCount: links.length,
    };
  }

  private async httpFetch(
    targetUrl: string,
  ): Promise<{ html: string; status: number; finalUrl: string }> {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FlowBuilder/1.0',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    const html = await response.text();
    return {
      html,
      status: response.status,
      finalUrl: response.url || targetUrl,
    };
  }

  private async playwrightFetch(
    targetUrl: string,
  ): Promise<{ html: string; status: number; title: string; finalUrl: string }> {
    let playwright: any;
    try {
      playwright = require('playwright');
    } catch {
      throw new Error('Playwright is not installed for stealth browser engine');
    }

    const browser = await playwright.chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
      ],
    });

    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
      });

      const page = await context.newPage();

      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        try {
          // @ts-ignore
          window.chrome = { runtime: {} };
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
          });
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
          });
        } catch {}
      });

      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      // Wait for Cloudflare Turnstile or security scripts to settle
      await page.waitForTimeout(3500);

      let title = (await page.title().catch(() => '')) || '';
      if (
        title.toLowerCase().includes('just a moment') ||
        title.toLowerCase().includes('attention required')
      ) {
        await page.waitForTimeout(3000);
        title = (await page.title().catch(() => '')) || '';
      }

      const html = await page.content();
      const finalUrl = page.url() || targetUrl;
      const status = response ? response.status() : 200;

      return {
        html,
        status,
        title,
        finalUrl,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private extractLinks(
    html: string,
    baseUrl: string,
  ): Array<{ text: string; href: string }> {
    const links: Array<{ text: string; href: string }> = [];
    const seenHrefs = new Set<string>();

    const linkRegex =
      /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = (match[1] || '').trim();
      const rawText = (match[2] || '').replace(/<[^>]*>/g, '').trim();

      if (
        !rawHref ||
        rawHref.startsWith('#') ||
        rawHref.startsWith('javascript:') ||
        rawHref.startsWith('mailto:') ||
        rawHref.startsWith('tel:')
      ) {
        continue;
      }

      // Ignore common static asset extensions
      if (
        /\.(png|jpg|jpeg|gif|webp|svg|css|js|woff|woff2|ttf|eot|ico|pdf|zip)$/i.test(
          rawHref.split('?')[0],
        )
      ) {
        continue;
      }

      try {
        const resolved = new URL(rawHref, baseUrl).href;
        if (!seenHrefs.has(resolved)) {
          seenHrefs.add(resolved);
          const cleanText = this.decodeHtmlEntities(rawText).replace(
            /\s+/g,
            ' ',
          );
          links.push({
            href: resolved,
            text: cleanText || resolved,
          });
        }
      } catch {
        // Skip invalid URLs
      }
    }

    return links;
  }

  private processHtmlContent(
    rawHtml: string,
    mode: string,
    maxContentLength: number,
  ): { cleanHtml: string; cleanText: string } {
    let stripped = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    if (mode === 'read_article') {
      // Focus on main article body
      const articleMatch =
        stripped.match(/<article[\s\S]*?<\/article>/i) ||
        stripped.match(/<main[\s\S]*?<\/main>/i) ||
        stripped.match(
          /<div[^>]*class=["'][^"']*(?:article|post|content|entry|blog-body)[^"']*["'][^>]*>[\s\S]*?<\/div>/i,
        );
      if (articleMatch) {
        stripped = articleMatch[0];
      }
    }

    // Strip header and footer navigation noise
    stripped = stripped
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    // Format text into readable markdown paragraphs
    let markdownLike = stripped
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n')
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n* $1')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    markdownLike = this.decodeHtmlEntities(markdownLike)
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    const cleanHtml =
      stripped.length > maxContentLength
        ? stripped.slice(0, maxContentLength) + '... [truncated]'
        : stripped;
    const cleanText =
      markdownLike.length > maxContentLength
        ? markdownLike.slice(0, maxContentLength) + '... [truncated]'
        : markdownLike;

    return { cleanHtml, cleanText };
  }

  private decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }
}
