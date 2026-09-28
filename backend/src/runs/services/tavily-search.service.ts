import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  BadGatewayException,
  GatewayTimeoutException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../../settings/settings.service';

export interface TavilySearchParams {
  query: string;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced' | string;
  topic?: 'general' | 'news' | 'finance' | string;
  timeRange?: 'day' | 'week' | 'month' | 'year' | string;
  includeDomains?: string[] | string;
  excludeDomains?: string[] | string;
  includeAnswer?: boolean | string;
  includeRawContent?: boolean | string;
  includeImages?: boolean | string;
  language?: string;
  apiKey?: string;
}

export interface NormalizedSearchResultItem {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
  rawContent?: string;
  favicon?: string;
}

export interface NormalizedSearchResponse {
  query: string;
  provider: 'tavily';
  status: number;
  results: NormalizedSearchResultItem[];
  resultsCount: number;
  responseTime?: number;
  answer?: string;
  images?: string[];
  usage?: Record<string, any>;
}

export const SAFE_MAX_RESULTS = 20;
export const DEFAULT_MAX_RESULTS = 5;
export const MIN_RESULTS = 1;

@Injectable()
export class TavilySearchService {
  private readonly logger = new Logger(TavilySearchService.name);
  private readonly apiUrl =
    process.env.TAVILY_API_URL || 'https://api.tavily.com/search';

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly settingsService?: SettingsService,
  ) {}

  /**
   * Resolves the Tavily API key from parameters, server environment, or project settings.
   * Never logs or exposes the key.
   */
  async resolveApiKey(overrideKey?: string): Promise<string> {
    if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim()) {
      return overrideKey.trim();
    }

    const envKey =
      this.configService?.get<string>('TAVILY_API_KEY') ||
      process.env.TAVILY_API_KEY;
    if (envKey && typeof envKey === 'string' && envKey.trim()) {
      return envKey.trim();
    }

    if (this.settingsService) {
      try {
        const settings = await this.settingsService.getSettings();
        const settingsKey =
          settings?.customSettings?.tavilyApiKey ||
          (settings as any)?.tavilyApiKey;
        if (
          settingsKey &&
          typeof settingsKey === 'string' &&
          settingsKey.trim()
        ) {
          return settingsKey.trim();
        }
      } catch (err: any) {
        this.logger.debug(
          `Unable to retrieve Tavily key from SettingsService: ${err?.message}`,
        );
      }
    }

    return '';
  }

  /**
   * Sanitizes and validates user-provided options to ensure safe boundaries.
   */
  sanitizeParams(params: TavilySearchParams): {
    query: string;
    maxResults: number;
    searchDepth: 'basic' | 'advanced';
    topic: 'general' | 'news' | 'finance';
    timeRange?: string;
    includeDomains?: string[];
    excludeDomains?: string[];
    includeAnswer: boolean;
    includeRawContent: boolean;
    includeImages: boolean;
    language?: string;
  } {
    if (
      !params.query ||
      typeof params.query !== 'string' ||
      !params.query.trim()
    ) {
      throw new BadRequestException(
        'Search query is required and cannot be empty',
      );
    }

    let maxResults = Number(params.maxResults);
    if (isNaN(maxResults) || maxResults < MIN_RESULTS) {
      maxResults = DEFAULT_MAX_RESULTS;
    } else if (maxResults > SAFE_MAX_RESULTS) {
      maxResults = SAFE_MAX_RESULTS;
    } else {
      maxResults = Math.floor(maxResults);
    }

    const searchDepth =
      params.searchDepth === 'advanced' ? 'advanced' : 'basic';

    let topic: 'general' | 'news' | 'finance' = 'general';
    if (params.topic === 'news' || params.topic === 'finance') {
      topic = params.topic;
    }

    let timeRange: string | undefined = undefined;
    if (
      params.timeRange &&
      ['day', 'week', 'month', 'year'].includes(
        String(params.timeRange).toLowerCase(),
      )
    ) {
      timeRange = String(params.timeRange).toLowerCase();
    }

    const parseDomains = (val?: string[] | string): string[] | undefined => {
      if (!val) return undefined;
      let list: string[] = [];
      if (Array.isArray(val)) {
        list = val
          .map((d) =>
            String(d)
              .trim()
              .replace(/^https?:\/\//i, '')
              .replace(/\/.*$/, ''),
          )
          .filter(Boolean);
      } else if (typeof val === 'string') {
        list = val
          .split(',')
          .map((d) =>
            d
              .trim()
              .replace(/^https?:\/\//i, '')
              .replace(/\/.*$/, ''),
          )
          .filter(Boolean);
      }
      return list.length > 0 ? list : undefined;
    };

    const includeDomains = parseDomains(params.includeDomains);
    const excludeDomains = parseDomains(params.excludeDomains);

    const includeAnswer =
      params.includeAnswer === true ||
      params.includeAnswer === 'true' ||
      params.includeAnswer === 'basic' ||
      params.includeAnswer === 'advanced';

    const includeRawContent =
      params.includeRawContent === true || params.includeRawContent === 'true';

    const includeImages =
      params.includeImages === true || params.includeImages === 'true';

    const language =
      params.language &&
      typeof params.language === 'string' &&
      params.language.trim()
        ? params.language.trim()
        : undefined;

    return {
      query: params.query.trim(),
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
    };
  }

  /**
   * Executes web search via Tavily Search API, enforcing timeouts, safe boundaries,
   * error mapping, and result normalization.
   */
  async search(params: TavilySearchParams): Promise<NormalizedSearchResponse> {
    const apiKey = await this.resolveApiKey(params.apiKey);
    if (!apiKey) {
      throw new BadRequestException(
        'Tavily API key is missing. Please set the TAVILY_API_KEY environment variable in your server configuration.',
      );
    }

    const sanitized = this.sanitizeParams(params);

    const payload: Record<string, any> = {
      query: sanitized.query,
      search_depth: sanitized.searchDepth,
      topic: sanitized.topic,
      max_results: sanitized.maxResults,
      include_answer: sanitized.includeAnswer,
      include_raw_content: sanitized.includeRawContent,
      include_images: sanitized.includeImages,
    };

    if (sanitized.timeRange) {
      payload.time_range = sanitized.timeRange;
    }
    if (sanitized.includeDomains && sanitized.includeDomains.length > 0) {
      payload.include_domains = sanitized.includeDomains;
    }
    if (sanitized.excludeDomains && sanitized.excludeDomains.length > 0) {
      payload.exclude_domains = sanitized.excludeDomains;
    }
    if (sanitized.language) {
      payload.language = sanitized.language;
    }

    const timeoutMs =
      Number(
        this.configService?.get<string>('TAVILY_TIMEOUT_MS') ||
          process.env.TAVILY_TIMEOUT_MS,
      ) || 20000;

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'FlowBuilder/1.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new GatewayTimeoutException(
          `Tavily search request timed out after ${timeoutMs}ms`,
        );
      }
      this.logger.error(`Tavily search network error: ${err.message}`);
      throw new BadGatewayException(
        `Failed to reach Tavily search provider: ${err.message}`,
      );
    }

    if (!response.ok) {
      let errorBody: any = null;
      try {
        errorBody = await response.json();
      } catch {
        try {
          errorBody = await response.text();
        } catch {
          errorBody = null;
        }
      }

      const errorMessage =
        (typeof errorBody === 'object' && errorBody !== null
          ? errorBody.detail?.error ||
            errorBody.detail ||
            errorBody.message ||
            errorBody.error
          : typeof errorBody === 'string'
          ? errorBody
          : '') || `Tavily returned HTTP ${response.status}`;

      this.logger.warn(
        `Tavily API error: Status ${response.status} - ${String(
          errorMessage,
        ).slice(0, 200)}`,
      );

      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(
          'Tavily search rejected request: Invalid or unauthorized API key',
        );
      }
      if (response.status === 429) {
        throw new HttpException(
          'Tavily search rate limit or credit quota exceeded. Please check your Tavily plan.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (response.status === 400) {
        throw new BadRequestException(
          `Tavily rejected search request: ${errorMessage}`,
        );
      }
      if (response.status >= 500) {
        throw new BadGatewayException(
          `Tavily search provider is currently unavailable (HTTP ${response.status})`,
        );
      }

      throw new HttpException(
        `Tavily search error: ${errorMessage}`,
        response.status,
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      this.logger.error('Failed to parse Tavily response as JSON');
      throw new BadGatewayException(
        'Malformed response received from Tavily search API',
      );
    }

    if (!data || typeof data !== 'object') {
      throw new BadGatewayException(
        'Invalid response structure received from Tavily search API',
      );
    }

    const results: NormalizedSearchResultItem[] = Array.isArray(data.results)
      ? data.results.map((r: any) => {
          const item: NormalizedSearchResultItem = {
            title:
              typeof r.title === 'string'
                ? r.title
                : typeof r.url === 'string'
                ? r.url
                : 'Untitled',
            url: typeof r.url === 'string' ? r.url : '',
            content:
              typeof r.content === 'string'
                ? r.content
                : typeof r.snippet === 'string'
                ? r.snippet
                : '',
          };
          if (typeof r.score === 'number' && !isNaN(r.score)) {
            item.score = r.score;
          }
          if (typeof r.published_date === 'string' && r.published_date) {
            item.publishedDate = r.published_date;
          }
          if (typeof r.raw_content === 'string' && r.raw_content) {
            item.rawContent = r.raw_content;
          }
          if (typeof r.favicon === 'string' && r.favicon) {
            item.favicon = r.favicon;
          }
          return item;
        })
      : [];

    const responseTime =
      typeof data.response_time === 'number' ? data.response_time : undefined;
    const answer =
      typeof data.answer === 'string' && data.answer.trim()
        ? data.answer.trim()
        : undefined;
    const images = Array.isArray(data.images)
      ? data.images.filter((img: any) => typeof img === 'string')
      : undefined;
    const usage =
      data.usage && typeof data.usage === 'object' ? data.usage : undefined;

    return {
      query: typeof data.query === 'string' ? data.query : sanitized.query,
      provider: 'tavily',
      status: response.status,
      results,
      resultsCount: results.length,
      responseTime,
      answer,
      images,
      usage,
    };
  }
}
