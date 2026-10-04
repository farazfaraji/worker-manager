'use client';

import React from 'react';
import {
  PlayCircle,
  Bot,
  Globe,
  GitBranch,
  CheckSquare,
  Code2,
  FileCode2,
  Network,
  Variable,
  PlusCircle,
  MinusCircle,
  Repeat,
  Layers,
  Server,
  Send,
  Search,
  KeyRound,
  FolderOpen,
  Database,
  ScrollText,
} from 'lucide-react';

export const getNodeIcon = (type: string, size = 16) => {
  switch (type.toLowerCase()) {
    case 'trigger':
      return <PlayCircle size={size} color="#10b981" />;
    case 'subgraph':
      return <Network size={size} color="#06b6d4" />;
    case 'agent':
      return <Bot size={size} color="#4f46e5" />;
    case 'app':
    case 'browser':
    case 'brower':
      return <Globe size={size} color="#0284c7" />;
    case 'web-search':
    case 'websearch':
    case 'web_search':
      return <Search size={size} color="#06b6d4" />;
    case 'repo-inspect':
      return <FileCode2 size={size} color="#0d9488" />;
    case 'condition':
      return <GitBranch size={size} color="#8b5cf6" />;
    case 'validator':
      return <CheckSquare size={size} color="#10b981" />;
    case 'transform':
      return <Code2 size={size} color="#f59e0b" />;
    case 'script':
      return <Code2 size={size} color="#eab308" />;
    case 'increment':
    case 'increment-variable':
      return <PlusCircle size={size} color="#10b981" />;
    case 'decrement':
    case 'decrement-variable':
      return <MinusCircle size={size} color="#f43f5e" />;
    case 'variable':
    case 'set-variable':
      return <Variable size={size} color="#ec4899" />;
    case 'foreach':
      return <Repeat size={size} color="#f97316" />;
    case 'aggregate':
      return <Layers size={size} color="#8b5cf6" />;
    case 'webserver':
      return <Server size={size} color="#3b82f6" />;
    case 'route':
      return <Globe size={size} color="#10b981" />;
    case 'http-response':
    case 'httpresponse':
      return <Send size={size} color="#8b5cf6" />;
    case 'output':
      return <Send size={size} color="#f97316" />;
    case 'telegram':
      return <Send size={size} color="#0088cc" />;
    case 'secrets':
      return <KeyRound size={size} color="#f59e0b" />;
    case 'file':
      return <FolderOpen size={size} color="#0ea5e9" />;
    case 'database':
      return <Database size={size} color="#6366f1" />;
    case 'log':
      return <ScrollText size={size} color="#64748b" />;
    case 'artifact':
      return <FileCode2 size={size} color="#f59e0b" />;
    case 'function':
    default:
      return <FileCode2 size={size} color="#6366f1" />;
  }
};
