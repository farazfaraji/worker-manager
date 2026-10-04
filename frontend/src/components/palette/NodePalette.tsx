'use client';

import React, { useState, useEffect } from 'react';
import { NodeDefinition } from '@/lib/types';
import { fetchNodeDefinitions } from '@/lib/api';
import { getNodeIcon } from '../nodes/node-icons';
import {
  ChevronLeft,
  ChevronRight,
  Boxes,
  Search,
  Plus,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface NodePaletteProps {
  onAddNode: (definition: NodeDefinition) => void;
}

export const NodePalette: React.FC<NodePaletteProps> = ({ onAddNode }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [definitions, setDefinitions] = useState<NodeDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadDefinitions = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNodeDefinitions();
      setDefinitions(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load tool definitions.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDefinitions();
  }, []);

  // Group definitions by category
  const categoriesOrder = ['Flow', 'Agent', 'Integration', 'Knowledge', 'Artifact', 'Execution', 'Control', 'Function', 'App', 'Logic'];
  const filtered = definitions.filter(
    (d) =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.type.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const grouped = categoriesOrder.reduce((acc, cat) => {
    const items = filtered.filter((d) => d.category === cat);
    if (items.length > 0) {
      acc[cat] = items;
    }
    return acc;
  }, {} as Record<string, NodeDefinition[]>);

  // Add any definitions that don't match the standard 5 categories into 'Other'
  const otherItems = filtered.filter((d) => !categoriesOrder.includes(d.category));
  if (otherItems.length > 0) {
    grouped['Other'] = otherItems;
  }

  return (
    <aside className={`left-panel-container ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="panel-header">
        {!isCollapsed && (
          <div className="panel-title">
            <Boxes size={16} />
            <span>Node Palette</span>
          </div>
        )}
        <button
          type="button"
          className="collapse-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {!isCollapsed && (
        <div className="panel-content">
          {/* Search Bar */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 9,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 30, fontSize: 12.5, width: '100%' }}
              placeholder="Search nodes & tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '8px 10px',
                background: 'var(--danger-subtle)',
                color: 'var(--danger)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={loadDefinitions}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          )}

          {isLoading ? (
            <div
              style={{
                padding: '30px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              <Loader2 size={16} className="animate-spin" />
              <span>Loading node definitions...</span>
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <div
              style={{
                padding: '24px 10px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 12.5,
              }}
            >
              No nodes match your search.
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="node-category-section">
                <span className="node-category-label">
                  {category} ({items.length})
                </span>
                {items.map((def) => (
                  <div
                    key={def.id}
                    className="node-item-card"
                    onClick={() => onAddNode(def)}
                    title={`Click to add: ${def.description}`}
                  >
                    <div
                      className="node-icon-wrapper"
                      style={{ background: 'var(--bg-subtle)' }}
                    >
                      {getNodeIcon(def.type, 16)}
                    </div>
                    <div className="node-card-text" style={{ flex: 1, minWidth: 0 }}>
                      <span
                        className="node-card-title"
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {def.name}
                      </span>
                      <span
                        className="node-card-desc"
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {def.description}
                      </span>
                    </div>
                    <Plus
                      size={14}
                      style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                    />
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
};
