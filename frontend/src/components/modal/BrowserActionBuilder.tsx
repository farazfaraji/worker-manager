'use client';

import React from 'react';
import { GripVertical, Plus, Trash2, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { ToolActionDefinition, VariableItem } from '@/lib/types';
import { DynamicFieldRenderer } from './DynamicFieldRenderer';

interface BrowserActionBuilderProps {
  definitions: ToolActionDefinition[];
  actions: Record<string, any>[];
  availableVariables: VariableItem[];
  onChange: (actions: Record<string, any>[]) => void;
}

export const BrowserActionBuilder: React.FC<BrowserActionBuilderProps> = ({
  definitions,
  actions,
  availableVariables,
  onChange,
}) => {
  const addAction = () => {
    const definition = definitions[0];
    if (!definition) return;
    const config: Record<string, any> = { type: definition.type };
    for (const input of definition.inputs || []) {
      if (input.defaultValue !== undefined) config[input.name] = input.defaultValue;
    }
    onChange([...actions, config]);
  };

  const updateAction = (index: number, patch: Record<string, any>) => {
    onChange(actions.map((action, actionIndex) => actionIndex === index ? { ...action, ...patch } : action));
  };

  const changeActionType = (index: number, type: string) => {
    const definition = definitions.find((item) => item.type === type);
    if (!definition) return;
    const config: Record<string, any> = { type };
    for (const input of definition.inputs || []) {
      if (input.defaultValue !== undefined) config[input.name] = input.defaultValue;
    }
    updateAction(index, config);
  };

  const moveAction = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= actions.length) return;
    const next = [...actions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="browser-action-builder">
      <div className="browser-action-builder-header">
        <div>
          <div className="browser-action-builder-title">
            <Zap size={14} />
            Browser Actions
            <span className="browser-action-count">{actions.length}</span>
          </div>
          <div className="browser-action-builder-help">
            Actions run in order on the same browser session.
          </div>
        </div>
        <button type="button" className="btn btn-primary browser-action-add" onClick={addAction}>
          <Plus size={14} /> Add Action
        </button>
      </div>

      {actions.length === 0 ? (
        <div className="browser-action-empty">
          Add an action to navigate, interact with, inspect, or verify the page.
        </div>
      ) : (
        <div className="browser-action-list">
          {actions.map((action, index) => {
            const definition = definitions.find((item) => item.type === action.type) || definitions[0];
            if (!definition) return null;

            return (
              <div className="browser-action-card" key={`${index}-${action.type}`}>
                <div className="browser-action-card-header">
                  <div className="browser-action-order">
                    <GripVertical size={14} />
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <select
                    className="form-input browser-action-select"
                    value={action.type || definition.type}
                    onChange={(event) => changeActionType(index, event.target.value)}
                  >
                    {definitions.map((item) => (
                      <option value={item.type} key={item.type}>{item.name}</option>
                    ))}
                  </select>
                  <div className="browser-action-card-actions">
                    <button type="button" className="icon-btn" title="Move up" onClick={() => moveAction(index, -1)} disabled={index === 0}>
                      <ChevronUp size={14} />
                    </button>
                    <button type="button" className="icon-btn" title="Move down" onClick={() => moveAction(index, 1)} disabled={index === actions.length - 1}>
                      <ChevronDown size={14} />
                    </button>
                    <button type="button" className="icon-btn danger" title="Remove action" onClick={() => onChange(actions.filter((_, actionIndex) => actionIndex !== index))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="browser-action-description">{definition.description}</div>
                <div className="browser-action-fields">
                  {(definition.inputs || []).map((input) => (
                    <DynamicFieldRenderer
                      key={input.name}
                      input={input}
                      value={action[input.name]}
                      onChange={(value) => updateAction(index, { [input.name]: value })}
                      formValues={action}
                      availableVariables={availableVariables}
                    />
                  ))}
                </div>

                {definition.outputs?.length > 0 && (
                  <div className="browser-action-outputs">
                    <span>Outputs</span>
                    {definition.outputs.map((output) => (
                      <code key={output.name}>{output.name}: {output.type}</code>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
