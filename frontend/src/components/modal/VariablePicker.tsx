'use client';

import React, { useState, useRef, useEffect } from 'react';
import { VariableItem } from '@/lib/types';
import { Variable, ChevronDown, Check, Sparkles } from 'lucide-react';

interface VariablePickerProps {
  value: string;
  onChange: (val: string) => void;
  availableVariables: VariableItem[];
  placeholder?: string;
  required?: boolean;
  accepts?: string[];
}

export const VariablePicker: React.FC<VariablePickerProps> = ({
  value,
  onChange,
  availableVariables,
  placeholder = 'Select or type variable path...',
  required = false,
  accepts,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as HTMLElement)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = availableVariables.filter((v) => {
    const matchesSearch =
      v.path.toLowerCase().includes(search.toLowerCase()) ||
      v.label.toLowerCase().includes(search.toLowerCase()) ||
      v.sourceNodeName.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    // Optional accepts filter
    if (accepts && accepts.length > 0 && v.type !== 'property') {
      return accepts.includes(v.type) || accepts.includes('any');
    }
    return true;
  });

  // Group filtered variables by type
  const grouped = filtered.reduce<Record<string, VariableItem[]>>((acc, item) => {
    const rawType = (item.type || 'property').toLowerCase();
    if (!acc[rawType]) {
      acc[rawType] = [];
    }
    acc[rawType].push(item);
    return acc;
  }, {});

  return (
    <div className="variable-picker-container" ref={containerRef} style={{ position: 'relative' }}>
      <div
        className="variable-input-wrapper"
        style={{
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ padding: '0 10px', color: 'var(--accent-primary)', display: 'flex' }}>
          <Variable size={15} />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          required={required}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            padding: '9px 4px',
            fontSize: 13.5,
            fontFamily: 'monospace',
            background: 'transparent',
            color: 'var(--text-primary)',
          }}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0 10px',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <ChevronDown size={15} />
        </button>
      </div>

      {isOpen && (
        <div
          className="variable-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: 'auto',
            background: '#ffffff',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 100,
            padding: '6px',
          }}
        >
          <div
            style={{
              padding: '6px 8px',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Sparkles size={12} color="var(--accent-primary)" />
            Available Graph Variables ({filtered.length})
          </div>

          {filtered.length === 0 ? (
            <div
              style={{
                padding: '12px',
                textAlign: 'center',
                fontSize: 12.5,
                color: 'var(--text-muted)',
              }}
            >
              {availableVariables.length === 0
                ? 'No upstream nodes in the flow yet.'
                : 'No matching variables.'}
            </div>
          ) : (
            Object.entries(grouped).map(([typeGroup, items]) => (
              <div key={typeGroup} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--bg-subtle)',
                    borderRadius: 4,
                    margin: '4px 0 2px 0',
                  }}
                >
                  <span>{typeGroup}</span>
                  <span style={{ fontSize: 9.5, opacity: 0.7 }}>{items.length}</span>
                </div>

                {items.map((item) => (
                  <div
                    key={item.path}
                    onClick={() => {
                      onChange(item.path);
                      setIsOpen(false);
                    }}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: value === item.path ? 'var(--accent-subtle)' : 'transparent',
                      transition: 'background 0.1s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (value !== item.path) (e.currentTarget as HTMLElement).style.background = 'var(--bg-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      if (value !== item.path) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 13,
                          fontWeight: 600,
                          color: value === item.path ? 'var(--accent-primary)' : 'var(--text-primary)',
                        }}
                      >
                        {item.path}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        From <strong style={{ color: 'var(--text-secondary)' }}>{item.sourceNodeName}</strong>
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--bg-subtle)',
                          color: 'var(--text-secondary)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {item.type}
                      </span>
                      {value === item.path && <Check size={14} color="var(--accent-primary)" />}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
