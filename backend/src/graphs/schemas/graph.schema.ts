import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GraphDocument = Graph & Document;

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphNodeLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
  hidden?: boolean;
}

/** Canvas-only state. It intentionally lives apart from executable graph data. */
export interface GraphLayout {
  version: number;
  viewport: GraphViewport;
  nodes: Record<string, GraphNodeLayout>;
  edges: Record<string, Record<string, any>>;
}

export const defaultGraphLayout = (): GraphLayout => ({
  version: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: {},
  edges: {},
});

@Schema({ timestamps: true })
export class Graph {
  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Array, default: [] })
  nodes: Record<string, any>[];

  @Prop({ type: Array, default: [] })
  edges: Record<string, any>[];

  @Prop({ type: Object, default: defaultGraphLayout })
  layout: GraphLayout;

  /** @deprecated Stored in layout.viewport for new and updated graphs. */
  @Prop({
    type: Object,
    default: { x: 0, y: 0, zoom: 1 },
  })
  viewport: GraphViewport;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const GraphSchema = SchemaFactory.createForClass(Graph);
