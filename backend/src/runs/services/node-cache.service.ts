import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NodeCache, NodeCacheDocument } from '../schemas/node-cache.schema';

@Injectable()
export class NodeCacheService {
  private readonly logger = new Logger(NodeCacheService.name);

  constructor(
    @InjectModel(NodeCache.name)
    private readonly nodeCacheModel: Model<NodeCacheDocument>,
  ) {}

  /**
   * Retrieves the cached result for a specific node in a graph.
   */
  async getCachedResult(graphId: string, nodeId: string): Promise<NodeCache | null> {
    try {
      const record = await this.nodeCacheModel.findOne({ graphId, nodeId }).lean().exec();
      return (record as NodeCache) || null;
    } catch (err: any) {
      this.logger.error(`Failed to get cached result for graph ${graphId} node ${nodeId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Stores or updates the cached result for a node (one cache entry per node).
   */
  async saveCachedResult(
    graphId: string,
    nodeId: string,
    nodeName: string,
    nodeType: string,
    result: any,
    input?: any,
    graphName?: string,
    projectId?: string,
  ): Promise<void> {
    try {
      const updatePayload: any = {
        graphId,
        nodeId,
        nodeName,
        nodeType,
        result,
        input,
        updatedAt: new Date(),
      };
      if (graphName) updatePayload.graphName = graphName;
      if (projectId) updatePayload.projectId = projectId;

      await this.nodeCacheModel.findOneAndUpdate(
        { graphId, nodeId },
        updatePayload,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).exec();
      this.logger.log(`💾 [NodeCache] Saved cache for graph "${graphName || graphId}", node "${nodeName}" (${nodeId})`);
    } catch (err: any) {
      this.logger.error(`Failed to save cache for graph ${graphId} node ${nodeId}: ${err.message}`);
    }
  }

  /**
   * Returns all node caches, optionally filtered by graphId, projectId, or nodeType.
   */
  async getAllCaches(filters?: {
    graphId?: string;
    projectId?: string;
    nodeType?: string;
    search?: string;
  }): Promise<NodeCache[]> {
    try {
      const query: any = {};
      if (filters?.graphId) query.graphId = filters.graphId;
      if (filters?.projectId) query.projectId = filters.projectId;
      if (filters?.nodeType && filters.nodeType !== 'all') query.nodeType = filters.nodeType;

      if (filters?.search && filters.search.trim()) {
        const regex = new RegExp(filters.search.trim(), 'i');
        query.$or = [
          { nodeName: regex },
          { nodeId: regex },
          { nodeType: regex },
          { graphName: regex },
        ];
      }

      return (await this.nodeCacheModel.find(query).sort({ updatedAt: -1 }).lean().exec()) as NodeCache[];
    } catch (err: any) {
      this.logger.error(`Failed to get all caches: ${err.message}`);
      return [];
    }
  }

  /**
   * Returns all cached node results for a graph.
   */
  async getGraphCaches(graphId: string): Promise<NodeCache[]> {
    try {
      return (await this.nodeCacheModel.find({ graphId }).sort({ updatedAt: -1 }).lean().exec()) as NodeCache[];
    } catch (err: any) {
      this.logger.error(`Failed to get graph caches for ${graphId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Updates an existing cached result.
   */
  async updateCachedResult(
    graphId: string,
    nodeId: string,
    result: any,
    extra?: { nodeName?: string; nodeType?: string; graphName?: string; projectId?: string },
  ): Promise<NodeCache | null> {
    try {
      const updateData: any = { result, updatedAt: new Date() };
      if (extra?.nodeName) updateData.nodeName = extra.nodeName;
      if (extra?.nodeType) updateData.nodeType = extra.nodeType;
      if (extra?.graphName) updateData.graphName = extra.graphName;
      if (extra?.projectId) updateData.projectId = extra.projectId;

      const updated = await this.nodeCacheModel.findOneAndUpdate(
        { graphId, nodeId },
        updateData,
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean().exec();
      return (updated as NodeCache) || null;
    } catch (err: any) {
      this.logger.error(`Failed to update cache for graph ${graphId} node ${nodeId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Clears the cache for an entire graph or a single node in that graph.
   */
  async clearCache(graphId?: string, nodeId?: string, projectId?: string): Promise<{ deletedCount: number }> {
    try {
      const query: any = {};
      if (graphId) query.graphId = graphId;
      if (nodeId) query.nodeId = nodeId;
      if (projectId) query.projectId = projectId;
      const res = await this.nodeCacheModel.deleteMany(query).exec();
      this.logger.log(`🗑️ [NodeCache] Cleared cache${graphId ? ` for graph "${graphId}"` : ''}${nodeId ? ` node "${nodeId}"` : ''} (${res.deletedCount} entries)`);
      return { deletedCount: res.deletedCount || 0 };
    } catch (err: any) {
      this.logger.error(`Failed to clear cache: ${err.message}`);
      return { deletedCount: 0 };
    }
  }
}
