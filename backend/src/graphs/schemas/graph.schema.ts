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

/** Executable board definition. It has no React Flow-specific fields. */
export interface GraphBlock {
  id: string;
  kind: string;
  name: string;
  label: string;
  definitionId?: string;
  definitionName?: string;
  config: Record<string, any>;
}

export interface GraphConnection {
  id: string;
  from: string;
  to: string;
  output?: string;
  input?: string;
  data?: Record<string, any>;
}

export interface GraphFlow {
  version: number;
  blocks: GraphBlock[];
  connections: GraphConnection[];
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

export const defaultGraphFlow = (): GraphFlow => ({
  version: 1,
  blocks: [],
  connections: [],
});

@Schema({ timestamps: true })
export class Graph {
  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Object, default: defaultGraphFlow })
  flow: GraphFlow;

  @Prop({ type: Object, default: defaultGraphLayout })
  layout: GraphLayout;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const GraphSchema = SchemaFactory.createForClass(Graph);
