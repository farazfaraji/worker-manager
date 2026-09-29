'use client';

import React, { useState, useEffect } from 'react';
import { ToolInput, VariableItem } from '@/lib/types';
import { VariablePicker } from './VariablePicker';
import { CodeEditor } from './CodeEditor';
import { RevisePromptModal } from './RevisePromptModal';
import { SchemaAiGenerator } from './SchemaAiGenerator';
import { SuggestionCombobox } from './SuggestionCombobox';
import { Code, Code2, AlignLeft, Sliders, ToggleLeft, ToggleRight, Check, AlertCircle, Sparkles, Wand2, Variable } from 'lucide-react';

interface DynamicFieldRendererProps {
  input: ToolInput;
  value: any;
  onChange: (val: any) => void;
  formValues: Record<string, any>;
  availableVariables: VariableItem[];
}

export const DynamicFieldRenderer: React.FC<DynamicFieldRendererProps> = ({
  input,
  value,
  onChange,
  formValues,
  availableVariables,
}) => {
  const [dynamicOptions, setDynamicOptions] = useState<{ label: string; value: any }[]>([]);
  const [isReviseModalOpen, setIsReviseModalOpen] = useState(false);
  const [schemaTab, setSchemaTab] = useState<'code' | 'ai'>('code');
  const [isVarDropdownOpen, setIsVarDropdownOpen] = useState(false);
  const [varSearch, setVarSearch] = useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const varDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVarDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (varDropdownRef.current && !varDropdownRef.current.contains(e.target as HTMLElement)) {
        setIsVarDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVarDropdownOpen]);

  const handleInsertVariable = (varPath: string) => {
    const textToInsert = `{{${varPath}}}`;
    const textarea = textareaRef.current;
    const currentVal = typeof effectiveValue === 'string' ? effectiveValue : String(effectiveValue || '');
    if (textarea) {
      const start = textarea.selectionStart ?? currentVal.length;
      const end = textarea.selectionEnd ?? currentVal.length;
      const nextVal = currentVal.substring(0, start) + textToInsert + currentVal.substring(end);
      onChange(nextVal);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + textToInsert.length;
        }
      }, 0);
    } else {
      onChange(currentVal ? `${currentVal} ${textToInsert}` : textToInsert);
    }
    setIsVarDropdownOpen(false);
    setVarSearch('');
  };

  // Parse value and mode for valueOrVariable
  const parseValueOrVariable = () => {
    if (typeof value === 'object' && value !== null && (value.mode === 'literal' || value.mode === 'variable')) {
      return {
        mode: value.mode as 'literal' | 'variable',
        valStr: value.value !== undefined && value.value !== null ? String(value.value) : '',
      };
    }
    if (typeof value === 'string' && value.trim()) {
      const isVar = availableVariables.some((v) => v.path === value.trim());
      return {
        mode: isVar ? ('variable' as const) : ('literal' as const),
        valStr: value,
      };
    }
    const defaultText = input.defaultValue !== undefined ? String(input.defaultValue) : '';
    return {
      mode: 'literal' as const,
      valStr: defaultText,
    };
  };

  const parsedValOrVar = parseValueOrVariable();
  const [isValueMode, setIsValueMode] = useState<boolean>(parsedValOrVar.mode === 'literal');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [multiInputText, setMultiInputText] = useState<string>('');

  useEffect(() => {
    if (input.type === 'valueOrVariable' && typeof value === 'object' && value !== null && value.mode) {
      setIsValueMode(value.mode === 'literal');
    }
  }, [input.type, value]);

  // Fetch dynamic dataSource if configured
  useEffect(() => {
    if (input.dataSource?.type === 'endpoint' && input.dataSource.url) {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:6300/api';
      let url = input.dataSource.url;
      if (!url.startsWith('http')) {
        if (url.startsWith('/api')) {
          url = `http://localhost:6300${url}`;
        } else {
          url = `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`;
        }
      }

      fetch(url, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : []))
        .then((data: any[]) => {
          if (Array.isArray(data) && data.length > 0) {
            const formatted = data.map((item) => ({
              label: item[input.dataSource!.labelKey] || item.label || item.name || item.id,
              value: item[input.dataSource!.valueKey] || item.modelId || item.id || item.value,
            }));
            setDynamicOptions(formatted);
          }
        })
        .catch(() => {
          setDynamicOptions([]);
        });
    }
  }, [input.dataSource]);

  // Check dependsOn condition
  if (input.dependsOn) {
    let dependentValue = formValues[input.dependsOn.field];
    if (dependentValue === undefined || dependentValue === null || dependentValue === '') {
      if (input.dependsOn.field === 'operation') {
        dependentValue = 'create';
      }
    }
    const expected = input.dependsOn.equals;
    const notEquals = input.dependsOn.notEquals;
    const inList = input.dependsOn.in;

    let matches = false;
    if (Array.isArray(inList)) {
      matches = inList.some(
        (item) => String(item).toLowerCase() === String(dependentValue ?? '').toLowerCase(),
      );
    } else if (expected !== undefined) {
      matches =
        dependentValue === expected ||
        (typeof expected === 'boolean' && Boolean(dependentValue) === expected) ||
        String(dependentValue ?? '').toLowerCase() === String(expected).toLowerCase();
    } else if (notEquals !== undefined) {
      matches = String(dependentValue ?? '').toLowerCase() !== String(notEquals).toLowerCase();
    }

    if (!matches) {
      return null;
    }
  }

  const effectiveValue = value !== undefined ? value : input.defaultValue !== undefined ? input.defaultValue : '';

  // Render based on field type
  const renderFieldControl = () => {
    switch (input.type) {
      case 'textarea':
        return (
          <textarea
            ref={textareaRef}
            className="form-input"
            rows={input.rows || 4}
            value={effectiveValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={input.placeholder}
            required={input.required}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        );

      case 'select': {
        const optionsList = dynamicOptions.length > 0 ? dynamicOptions : (input.options || []);
        const hasCurrentValue = !effectiveValue || optionsList.some((opt) => String(opt.value) === String(effectiveValue));
        return (
          <select
            className="form-input"
            value={effectiveValue}
            onChange={(e) => onChange(e.target.value)}
            required={input.required}
          >
            <option value="">-- Select an option --</option>
            {optionsList.map((opt) => (
              <option key={String(opt.value)} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {effectiveValue && !hasCurrentValue && (
              <option value={effectiveValue}>
                {effectiveValue} (Custom / Configured)
              </option>
            )}
          </select>
        );
      }

      case 'combobox': {
        const optionsList = dynamicOptions.length > 0 ? dynamicOptions : (input.options || []);
        return (
          <SuggestionCombobox
            value={effectiveValue}
            onChange={(val) => onChange(val)}
            options={optionsList}
            placeholder={input.placeholder}
            required={input.required}
          />
        );
      }

      case 'slug': {
        const prefix = input.prefix || '';
        const rawValue = typeof effectiveValue === 'string' ? effectiveValue : String(effectiveValue || '');
        const suffix = rawValue.startsWith(prefix) ? rawValue.slice(prefix.length) : rawValue;
        const slugify = (raw: string) => raw
          .toLowerCase()
          .replace(/[^a-z0-9\-_]+/g, '-')
          .replace(/-{2,}/g, '-');

        return (
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            {prefix && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0 9px',
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRight: 0,
                  borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)',
                  color: 'var(--text-muted)',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                {prefix}
              </span>
            )}
            <input
              type="text"
              className="form-input"
              value={suffix}
              onChange={(e) => onChange(`${prefix}${slugify(e.target.value)}`)}
              placeholder={input.placeholder}
              required={input.required}
              style={prefix ? { borderRadius: '0 var(--radius-sm) var(--radius-sm) 0' } : undefined}
            />
          </div>
        );
      }

      case 'radio':
        return (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
            {(input.options || []).map((opt) => {
              const isChecked = effectiveValue === opt.value;
              return (
                <label
                  key={String(opt.value)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontSize: 13.5,
                    fontWeight: isChecked ? 600 : 400,
                    color: isChecked ? 'var(--accent-primary)' : 'var(--text-primary)',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${isChecked ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: isChecked ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="radio"
                    name={input.name}
                    value={opt.value}
                    checked={isChecked}
                    onChange={() => onChange(opt.value)}
                    style={{ display: 'none' }}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
        );

      case 'json':
      case 'object': {
        const strVal = typeof effectiveValue === 'object' ? JSON.stringify(effectiveValue, null, 2) : effectiveValue;

        const handleJsonChange = (raw: string) => {
          onChange(raw);
          try {
            if (raw.trim()) {
              const testStr = raw.replace(/{{\s*([^{}]+?)\s*}}/g, '"__var__"');
              JSON.parse(testStr);
              setJsonError(null);
            } else {
              setJsonError(null);
            }
          } catch (err: any) {
            setJsonError(err.message);
          }
        };

        const handleFormatJson = () => {
          try {
            const parsed = JSON.parse(strVal);
            onChange(JSON.stringify(parsed, null, 2));
            setJsonError(null);
          } catch (err: any) {
            setJsonError('Invalid JSON structure');
          }
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                {jsonError ? (
                  <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertCircle size={12} /> Invalid JSON
                  </span>
                ) : (
                  <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Check size={12} /> Valid JSON format
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-default"
                style={{ padding: '3px 8px', fontSize: 11.5 }}
                onClick={handleFormatJson}
              >
                Format JSON
              </button>
            </div>
            <textarea
              className="form-input"
              rows={4}
              value={strVal}
              onChange={(e) => handleJsonChange(e.target.value)}
              placeholder={input.placeholder || '{\n  "key": "value"\n}'}
              style={{
                fontFamily: 'monospace',
                fontSize: 12.5,
                background: '#fafafa',
              }}
            />
          </div>
        );
      }

      case 'functionCode':
        return (
          <CodeEditor
            value={typeof effectiveValue === 'string' ? effectiveValue : String(effectiveValue || '')}
            onChange={(val) => onChange(val)}
            language={input.language || 'javascript'}
            isFunctionWrapper={true}
            placeholder={input.placeholder}
            defaultValue={input.defaultValue}
            required={input.required}
            minHeight={150}
          />
        );

      case 'code': {
        const hasAiSchemaGenerator = Boolean(
          input.supportsAiGenerator ||
          input.name === 'outputType' ||
          input.name.toLowerCase().includes('schema')
        );

        if (!hasAiSchemaGenerator) {
          return (
            <CodeEditor
              value={typeof effectiveValue === 'string' ? effectiveValue : String(effectiveValue || '')}
              onChange={(val) => onChange(val)}
              language={input.language || 'typescript'}
              isFunctionWrapper={false}
              placeholder={input.placeholder}
              defaultValue={input.defaultValue}
              required={input.required}
              minHeight={input.language === 'javascript' ? 120 : 90}
            />
          );
        }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Tabs Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                backgroundColor: '#f1f5f9',
                padding: '3px',
                borderRadius: 8,
                width: 'fit-content',
              }}
            >
              <button
                type="button"
                onClick={() => setSchemaTab('code')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: schemaTab === 'code' ? '#ffffff' : 'transparent',
                  color: schemaTab === 'code' ? '#1e293b' : '#64748b',
                  boxShadow: schemaTab === 'code' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Code2 size={13} color={schemaTab === 'code' ? 'var(--accent-primary)' : '#64748b'} />
                Schema Code
              </button>

              <button
                type="button"
                onClick={() => setSchemaTab('ai')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: schemaTab === 'ai' ? '#ffffff' : 'transparent',
                  color: schemaTab === 'ai' ? '#4f46e5' : '#64748b',
                  boxShadow: schemaTab === 'ai' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Sparkles size={13} color={schemaTab === 'ai' ? '#6366f1' : '#64748b'} />
                Explain & Generate (AI)
              </button>
            </div>

            {/* Tab 1: Code Editor */}
            {schemaTab === 'code' ? (
              <CodeEditor
                value={typeof effectiveValue === 'string' ? effectiveValue : String(effectiveValue || '')}
                onChange={(val) => onChange(val)}
                language={input.language || 'typescript'}
                isFunctionWrapper={false}
                placeholder={input.placeholder}
                defaultValue={input.defaultValue}
                required={input.required}
                minHeight={input.language === 'javascript' ? 120 : 90}
              />
            ) : (
              /* Tab 2: Explain & Generate (AI) */
              <SchemaAiGenerator
                currentSchema={typeof effectiveValue === 'string' ? effectiveValue : String(effectiveValue || '')}
                onApply={(val) => onChange(val)}
                onSwitchToCodeTab={() => setSchemaTab('code')}
                placeholder={input.placeholder}
              />
            )}
          </div>
        );
      }

      case 'variable': {
        const currentVarStr =
          typeof effectiveValue === 'object' && effectiveValue !== null && effectiveValue.value !== undefined
            ? effectiveValue.value
            : typeof effectiveValue === 'string'
            ? effectiveValue
            : '';

        return (
          <VariablePicker
            value={currentVarStr}
            onChange={(selectedVar) => onChange(selectedVar)}
            availableVariables={availableVariables}
            placeholder={input.placeholder || 'Select variable...'}
            required={input.required}
            accepts={input.accepts}
          />
        );
      }

      case 'valueOrVariable': {
        const { valStr } = parseValueOrVariable();

        // Extract selected items for multiselect
        const selectedItems: string[] = (() => {
          if (!input.multiselect) return [];
          if (Array.isArray(effectiveValue)) return effectiveValue.map(String).filter(Boolean);
          if (typeof effectiveValue === 'object' && effectiveValue !== null && effectiveValue.value !== undefined) {
            if (Array.isArray(effectiveValue.value)) return effectiveValue.value.map(String).filter(Boolean);
            if (typeof effectiveValue.value === 'string') {
              return effectiveValue.value.split(/[\r\n,]+/).map((s: string) => s.trim()).filter(Boolean);
            }
          }
          if (typeof valStr === 'string' && valStr.trim()) {
            try {
              const parsed = JSON.parse(valStr);
              if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
            } catch {}
            return valStr.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
          }
          return [];
        })();

        const handleAddMultiItem = (itemToAdd: string) => {
          const clean = String(itemToAdd || '').trim();
          if (!clean) return;
          if (!selectedItems.includes(clean)) {
            const nextList = [...selectedItems, clean];
            onChange({
              mode: 'literal',
              value: nextList,
            });
          }
        };

        const handleRemoveMultiItem = (itemToRemove: string) => {
          const nextList = selectedItems.filter((i) => i !== itemToRemove);
          onChange({
            mode: 'literal',
            value: nextList,
          });
        };

        const handleModeSwitch = (literalMode: boolean) => {
          setIsValueMode(literalMode);
          onChange({
            mode: literalMode ? 'literal' : 'variable',
            value: input.multiselect ? (literalMode ? selectedItems : (valStr || '')) : valStr,
          });
        };

        const handleTextChange = (newVal: string) => {
          onChange({
            mode: 'literal',
            value: newVal,
          });
        };

        const handleVariableSelect = (selectedVar: string) => {
          onChange({
            mode: 'variable',
            value: selectedVar,
          });
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className={`btn ${isValueMode ? 'btn-primary' : 'btn-default'}`}
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => handleModeSwitch(true)}
              >
                Literal Value
              </button>
              <button
                type="button"
                className={`btn ${!isValueMode ? 'btn-primary' : 'btn-default'}`}
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => handleModeSwitch(false)}
              >
                Variable Reference
              </button>
            </div>
            {isValueMode ? (
              input.multiselect ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Selected items badges / chips */}
                  {selectedItems.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {selectedItems.map((itemId) => {
                        const allOpts = dynamicOptions.length > 0 ? dynamicOptions : (input.options || []);
                        const matchedOpt = allOpts.find((o) => String(o.value) === String(itemId));
                        const label = matchedOpt ? matchedOpt.label : itemId;
                        return (
                          <span
                            key={itemId}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              background: 'var(--accent-subtle, rgba(99, 102, 241, 0.12))',
                              color: 'var(--accent-primary, #6366f1)',
                              border: '1px solid var(--accent-primary, #6366f1)',
                              padding: '3px 8px',
                              borderRadius: 'var(--radius-sm, 4px)',
                              fontSize: 12,
                              fontWeight: 500,
                            }}
                          >
                            <span title={itemId}>{label}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveMultiItem(itemId)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'inherit',
                                cursor: 'pointer',
                                padding: 0,
                                fontSize: 14,
                                lineHeight: 1,
                              }}
                              title="Remove item"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Dropdown to pick from options */}
                  {(() => {
                    const multiOpts = dynamicOptions.length > 0 ? dynamicOptions : (input.options || []);
                    if (multiOpts.length === 0) return null;
                    return (
                      <select
                        className="form-input"
                        style={{ fontSize: 12 }}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAddMultiItem(e.target.value);
                          }
                        }}
                      >
                        <option value="">-- Add {input.label || 'option'} ({multiOpts.length} available) --</option>
                        {multiOpts.map((opt, i) => (
                          <option key={i} value={opt.value} disabled={selectedItems.includes(String(opt.value))}>
                            {selectedItems.includes(String(opt.value)) ? `✓ ${opt.label}` : opt.label}
                          </option>
                        ))}
                      </select>
                    );
                  })()}

                  {/* Manual custom ID input */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={multiInputText}
                      onChange={(e) => setMultiInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (multiInputText.trim()) {
                            handleAddMultiItem(multiInputText.trim());
                            setMultiInputText('');
                          }
                        }
                      }}
                      placeholder={input.placeholder || 'Type custom artifact ID / pattern and press Enter...'}
                      style={{ flex: 1, fontSize: 12 }}
                    />
                    <button
                      type="button"
                      className="btn btn-default"
                      style={{ fontSize: 12, padding: '0 12px' }}
                      onClick={() => {
                        if (multiInputText.trim()) {
                          handleAddMultiItem(multiInputText.trim());
                          setMultiInputText('');
                        }
                      }}
                    >
                      + Add
                    </button>
                  </div>
                </div>
              ) : input.multiline ? (
                <textarea
                  className="form-input"
                  rows={input.rows || 6}
                  value={valStr}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder={input.placeholder || 'Enter literal text or content...'}
                  required={input.required}
                  style={{
                    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12.5,
                    resize: 'vertical',
                    lineHeight: 1.5,
                  }}
                />
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                  {(() => {
                    const optionsList = dynamicOptions.length > 0 ? dynamicOptions : (input.options || []);
                    if (optionsList.length > 0) {
                      return (
                        <SuggestionCombobox
                          value={valStr}
                          onChange={(newVal) => handleTextChange(newVal)}
                          options={optionsList}
                          placeholder={input.placeholder || 'Enter literal value or pick suggestion...'}
                          required={input.required}
                        />
                      );
                    }
                    return (
                      <input
                        type="text"
                        className="form-input"
                        value={valStr}
                        onChange={(e) => handleTextChange(e.target.value)}
                        placeholder={input.placeholder || 'Enter literal value...'}
                        required={input.required}
                        style={{ flex: 1 }}
                      />
                    );
                  })()}
                  {input.supportsUuid && (
                    <button
                      type="button"
                      className="btn btn-default"
                      title="Generate a random UUID"
                      style={{
                        fontSize: 11.5,
                        padding: '0 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        whiteSpace: 'nowrap',
                        background: 'var(--bg-subtle)',
                      }}
                      onClick={() => {
                        const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
                          ? crypto.randomUUID()
                          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                              const r = (Math.random() * 16) | 0;
                              return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
                            });
                        if (valStr.includes('{{uuid}}') || valStr.includes('{{UUID}}') || valStr.includes('{{$uuid}}')) {
                          handleTextChange(valStr.replace(/{{\s*\$?uuid\s*}}/gi, uuid));
                        } else if (valStr.endsWith('-') || valStr.endsWith('_')) {
                          handleTextChange(`${valStr}${uuid}`);
                        } else {
                          handleTextChange(uuid);
                        }
                      }}
                    >
                      <Sparkles size={13} color="var(--accent-primary)" />
                      Generate UUID
                    </button>
                  )}
                </div>
              )
            ) : (
              <VariablePicker
                value={
                  typeof effectiveValue === 'object' && effectiveValue !== null && effectiveValue.value !== undefined
                    ? String(effectiveValue.value)
                    : typeof effectiveValue === 'string'
                    ? effectiveValue
                    : valStr
                }
                onChange={handleVariableSelect}
                availableVariables={availableVariables}
                placeholder={input.placeholder || 'Pick variable reference...'}
                required={input.required}
                accepts={input.accepts || (input.multiselect ? ['array', 'string'] : ['string'])}
              />
            )}
          </div>
        );
      }

      case 'checkbox':
      case 'boolean': {
        const isChecked = Boolean(effectiveValue);
        return (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              userSelect: 'none',
              padding: '4px 0',
            }}
          >
            <div
              style={{
                width: 38,
                height: 22,
                borderRadius: 12,
                background: isChecked ? 'var(--accent-primary)' : 'var(--border-color)',
                position: 'relative',
                transition: 'background 0.2s ease',
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: '#ffffff',
                  position: 'absolute',
                  top: 3,
                  left: isChecked ? 19 : 3,
                  transition: 'left 0.2s ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </div>
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => onChange(e.target.checked)}
              style={{ display: 'none' }}
            />
            <span style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: isChecked ? 600 : 400 }}>
              {isChecked ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        );
      }

      case 'number':
        return (
          <input
            type="number"
            className="form-input"
            value={effectiveValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={input.placeholder}
            required={input.required}
          />
        );

      case 'text':
      default:
        return (
          <input
            type="text"
            className="form-input"
            value={effectiveValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={input.placeholder}
            required={input.required}
          />
        );
    }
  };

  const canRevise = Boolean(
    input.canRevise ||
    input.name === 'systemPrompt' ||
    (input.type === 'textarea' && input.name.toLowerCase().includes('prompt'))
  );

  return (
    <div className="form-group" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="form-label" style={{ marginBottom: 0 }}>
            {input.label}
            {input.required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
          </label>
          {canRevise && (
            <button
              type="button"
              onClick={() => setIsReviseModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                fontSize: 11.5,
                fontWeight: 600,
                borderRadius: 5,
                background: 'rgba(99, 102, 241, 0.08)',
                color: '#4f46e5',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title="Revise prompt with Flow Helper LLM"
            >
              <Sparkles size={11} color="#6366f1" />
              Revise
            </button>
          )}
          {input.type === 'textarea' && availableVariables && availableVariables.length > 0 && (
            <div style={{ position: 'relative' }} ref={varDropdownRef}>
              <button
                type="button"
                onClick={() => setIsVarDropdownOpen((prev) => !prev)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  borderRadius: 5,
                  background: 'rgba(59, 130, 246, 0.08)',
                  color: '#2563eb',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                title="Insert variable like {{variable}}"
              >
                <Variable size={11} color="#2563eb" />
                Insert Variable
              </button>
              {isVarDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 4,
                    width: 280,
                    maxHeight: 250,
                    overflowY: 'auto',
                    background: 'var(--bg-card, #ffffff)',
                    border: '1px solid var(--border-default, #e2e8f0)',
                    borderRadius: 6,
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
                    zIndex: 1000,
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Search variables..."
                    value={varSearch}
                    onChange={(e) => setVarSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      fontSize: 12,
                      border: '1px solid var(--border-default)',
                      borderRadius: 4,
                      background: 'var(--bg-subtle)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', maxHeight: 180 }}>
                    {availableVariables
                      .filter((v) =>
                        !varSearch ||
                        v.path.toLowerCase().includes(varSearch.toLowerCase()) ||
                        v.label.toLowerCase().includes(varSearch.toLowerCase())
                      )
                      .map((v) => (
                        <button
                          key={v.path}
                          type="button"
                          onClick={() => handleInsertVariable(v.path)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '5px 8px',
                            background: 'none',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: 12,
                            color: 'var(--text-primary)',
                            gap: 8,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-subtle, #f1f5f9)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                        >
                          <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{`{{${v.path}}}`}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{v.sourceNodeName || v.type}</span>
                        </button>
                      ))}
                    {availableVariables.filter((v) =>
                      !varSearch ||
                      v.path.toLowerCase().includes(varSearch.toLowerCase()) ||
                      v.label.toLowerCase().includes(varSearch.toLowerCase())
                    ).length === 0 && (
                      <div style={{ padding: '8px', fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
                        No matching variables
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
            background: 'var(--bg-subtle)',
            padding: '1px 6px',
            borderRadius: 4,
          }}
        >
          {input.type}
        </span>
      </div>

      {renderFieldControl()}

      {input.helpText && (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.3 }}>
          {input.helpText}
        </span>
      )}

      {canRevise && (
        <RevisePromptModal
          isOpen={isReviseModalOpen}
          currentPrompt={typeof effectiveValue === 'string' ? effectiveValue : String(effectiveValue || '')}
          onClose={() => setIsReviseModalOpen(false)}
          onApply={(revised) => onChange(revised)}
          fieldName={input.label}
        />
      )}
    </div>
  );
};
