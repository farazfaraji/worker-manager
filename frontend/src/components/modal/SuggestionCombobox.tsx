'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Sparkles, X } from 'lucide-react';

export interface SuggestionOption {
  label: string;
  value: any;
}

interface SuggestionComboboxProps {
  value: string;
  onChange: (val: string) => void;
  options: SuggestionOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
}

export const SuggestionCombobox: React.FC<SuggestionComboboxProps> = ({
  value,
  onChange,
  options = [],
  placeholder = 'Select from suggestions or enter custom string...',
  required = false,
  disabled = false,
  id,
  name,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as HTMLElement)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const rawVal = value !== undefined && value !== null ? String(value) : '';

  // Filter options based on typed input if user is actively searching
  const filteredOptions = options.filter((opt) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const labelMatch = (opt.label || '').toLowerCase().includes(term);
    const valueMatch = String(opt.value || '').toLowerCase().includes(term);
    return labelMatch || valueMatch;
  });

  const selectedOpt = options.find((opt) => String(opt.value) === rawVal);
  const hasExactMatch = options.some((opt) => String(opt.value).toLowerCase() === rawVal.toLowerCase());

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value;
    onChange(nextVal);
    setSearchTerm(nextVal);
    if (!isOpen) setIsOpen(true);
  };

  const handleSelectOption = (optValue: any) => {
    onChange(String(optValue));
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleToggleDropdown = () => {
    if (disabled) return;
    if (isOpen) {
      setIsOpen(false);
    } else {
      setSearchTerm(''); // Show all suggestions when explicitly opening
      setIsOpen(true);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        flex: 1,
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          className="form-input"
          value={rawVal}
          onChange={handleInputChange}
          onFocus={() => {
            setSearchTerm('');
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsOpen(false);
            } else if (e.key === 'ArrowDown' && !isOpen) {
              setIsOpen(true);
              setSearchTerm('');
            }
          }}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          style={{
            width: '100%',
            paddingRight: options.length > 0 ? 56 : 10,
          }}
        />

        {/* Action icons on right */}
        {options.length > 0 && !disabled && (
          <div
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {rawVal && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('');
                  setSearchTerm('');
                  inputRef.current?.focus();
                }}
                title="Clear input"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 4,
                }}
                tabIndex={-1}
              >
                <X size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleDropdown}
              title={isOpen ? 'Close suggestions' : 'Open suggestions'}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 4,
              }}
              tabIndex={-1}
            >
              <ChevronDown
                size={14}
                style={{
                  transform: isOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>
        )}
      </div>

      {/* Floating Suggestions Dropdown */}
      {isOpen && options.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 250,
            overflowY: 'auto',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: 'var(--radius-md, 6px)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
            zIndex: 150,
            padding: '4px',
          }}
        >
          {/* Header Note */}
          <div
            style={{
              padding: '6px 8px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted, #64748b)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--border-color, #f1f5f9)',
              marginBottom: 4,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Sparkles size={11} color="var(--accent-primary, #6366f1)" />
              Suggestions ({options.length})
            </span>
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>
              Pick or enter custom text
            </span>
          </div>

          {/* Options List */}
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, i) => {
              const optValStr = String(opt.value);
              const isSelected = optValStr === rawVal;
              return (
                <div
                  key={`${optValStr}-${i}`}
                  onClick={() => handleSelectOption(opt.value)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 'var(--radius-sm, 4px)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 12.5,
                    background: isSelected
                      ? 'var(--accent-subtle, rgba(99, 102, 241, 0.08))'
                      : 'transparent',
                    color: isSelected
                      ? 'var(--accent-primary, #4f46e5)'
                      : 'var(--text-primary, #1e293b)',
                    fontWeight: isSelected ? 600 : 400,
                    transition: 'background 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--bg-subtle, #f8fafc)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opt.label}
                    </span>
                    {opt.label !== optValStr && optValStr !== '' && (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontFamily: 'monospace',
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: 'var(--bg-subtle, #f1f5f9)',
                          color: 'var(--text-muted, #64748b)',
                          flexShrink: 0,
                        }}
                      >
                        {optValStr}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <Check size={14} color="var(--accent-primary, #4f46e5)" style={{ marginLeft: 6, flexShrink: 0 }} />
                  )}
                </div>
              );
            })
          ) : (
            <div
              style={{
                padding: '10px 8px',
                fontSize: 12,
                color: 'var(--text-muted, #64748b)',
                textAlign: 'center',
              }}
            >
              No matching suggestions for &ldquo;<strong>{searchTerm}</strong>&rdquo;.
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--accent-primary, #6366f1)' }}>
                Press Enter or click outside to keep custom input.
              </div>
            </div>
          )}

          {/* Custom value indicator if user typed something custom */}
          {rawVal && !hasExactMatch && (
            <div
              style={{
                marginTop: 4,
                padding: '6px 8px',
                fontSize: 11.5,
                background: 'var(--bg-subtle, #f8fafc)',
                borderTop: '1px solid var(--border-color, #f1f5f9)',
                borderRadius: '0 0 var(--radius-sm, 4px) var(--radius-sm, 4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: 'var(--text-secondary, #475569)',
              }}
            >
              <span>Custom value: <strong>{rawVal}</strong></span>
              <span style={{ fontSize: 10.5, color: '#059669', fontWeight: 600 }}>Active</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
