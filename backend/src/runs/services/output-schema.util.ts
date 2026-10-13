/**
 * Safe parser + validator for Agent `outputType` schemas.
 *
 * The schema text is NEVER evaluated as code. Instead a Zod-subset grammar is parsed into a
 * small schema tree which is then used for validation. Supported inputs:
 *   - Zod:        z.object({ a: z.string().min(1), b: z.array(z.number()).optional() })
 *   - TypeScript: { a: string; b?: number[]; c: 'x' | 'y' }
 *   - JSON:       {"a": "string"}  or a JSON Schema ({"type":"object","properties":{...}})
 *
 * Unknown Zod methods (e.g. .refine(), .transform()) are skipped, so their constraints are not enforced.
 */

export type SchemaKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'any'
  | 'null'
  | 'literal'
  | 'enum'
  | 'array'
  | 'object'
  | 'record'
  | 'union';

export interface SchemaNode {
  kind: SchemaKind;
  optional?: boolean;
  nullable?: boolean;
  hasDefault?: boolean;
  defaultValue?: any;
  // string / array / number constraints
  min?: number;
  max?: number;
  length?: number;
  gt?: number;
  lt?: number;
  int?: boolean;
  format?: 'email' | 'url' | 'uuid' | 'datetime';
  regex?: RegExp;
  coerce?: boolean;
  // composite
  value?: any; // literal
  values?: any[]; // enum
  item?: SchemaNode; // array
  shape?: Record<string, SchemaNode>; // object
  strict?: boolean; // object
  valueSchema?: SchemaNode; // record
  options?: SchemaNode[]; // union
}

export interface SchemaIssue {
  path: string;
  message: string;
}

export class SchemaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaParseError';
  }
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

class Scanner {
  pos = 0;
  constructor(readonly src: string) {}

  skipWs() {
    for (;;) {
      while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
      if (this.src.startsWith('//', this.pos)) {
        const nl = this.src.indexOf('\n', this.pos);
        this.pos = nl === -1 ? this.src.length : nl + 1;
        continue;
      }
      if (this.src.startsWith('/*', this.pos)) {
        const end = this.src.indexOf('*/', this.pos + 2);
        this.pos = end === -1 ? this.src.length : end + 2;
        continue;
      }
      break;
    }
  }

  peek(): string {
    this.skipWs();
    return this.src[this.pos] || '';
  }

  eof(): boolean {
    this.skipWs();
    return this.pos >= this.src.length;
  }

  accept(ch: string): boolean {
    if (this.peek() === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(ch: string) {
    if (!this.accept(ch)) this.fail(`Expected "${ch}"`);
  }

  ident(): string {
    this.skipWs();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.src.slice(this.pos));
    if (!m) this.fail('Expected identifier');
    this.pos += m![0].length;
    return m![0];
  }

  tryIdent(): string | null {
    this.skipWs();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.src.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  string(): string {
    this.skipWs();
    const quote = this.src[this.pos];
    if (quote !== '"' && quote !== "'" && quote !== '`') this.fail('Expected string');
    let out = '';
    this.pos++;
    while (this.pos < this.src.length && this.src[this.pos] !== quote) {
      if (this.src[this.pos] === '\\') {
        const next = this.src[this.pos + 1];
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        this.pos += 2;
      } else {
        out += this.src[this.pos++];
      }
    }
    if (this.src[this.pos] !== quote) this.fail('Unterminated string');
    this.pos++;
    return out;
  }

  number(): number {
    this.skipWs();
    const m = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(this.src.slice(this.pos));
    if (!m) this.fail('Expected number');
    this.pos += m![0].length;
    return Number(m![0]);
  }

  /** Skip balanced (...) content starting right after an opening "(" has been consumed. */
  skipBalancedArgs() {
    let depth = 1;
    while (this.pos < this.src.length && depth > 0) {
      const ch = this.src[this.pos];
      if (ch === '"' || ch === "'" || ch === '`') {
        this.string();
        continue;
      }
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      this.pos++;
    }
    if (depth !== 0) this.fail('Unbalanced parentheses');
  }

  fail(message: string): never {
    const snippet = this.src.slice(this.pos, this.pos + 30).replace(/\s+/g, ' ');
    throw new SchemaParseError(`${message} at position ${this.pos} (near "${snippet}")`);
  }
}

// ---------------------------------------------------------------------------
// Literal values (for z.literal / z.enum / .default)
// ---------------------------------------------------------------------------

function parseValue(s: Scanner): any {
  const ch = s.peek();
  if (ch === '"' || ch === "'" || ch === '`') return s.string();
  if (ch === '-' || /\d|\./.test(ch)) return s.number();
  if (ch === '[') {
    s.expect('[');
    const arr: any[] = [];
    while (!s.accept(']')) {
      arr.push(parseValue(s));
      s.accept(',');
    }
    return arr;
  }
  if (ch === '{') {
    s.expect('{');
    const obj: Record<string, any> = {};
    while (!s.accept('}')) {
      const key = s.peek() === '"' || s.peek() === "'" ? s.string() : s.ident();
      s.expect(':');
      obj[key] = parseValue(s);
      s.accept(',');
    }
    return obj;
  }
  const id = s.ident();
  if (id === 'true') return true;
  if (id === 'false') return false;
  if (id === 'null') return null;
  if (id === 'undefined') return undefined;
  s.fail(`Unsupported literal value "${id}"`);
}

// ---------------------------------------------------------------------------
// Zod grammar
// ---------------------------------------------------------------------------

function parseZodExpr(s: Scanner): SchemaNode {
  const root = s.ident();
  if (root !== 'z') s.fail(`Expected "z." but found "${root}"`);
  s.expect('.');
  let fn = s.ident();
  let coerce = false;
  if (fn === 'coerce') {
    coerce = true;
    s.expect('.');
    fn = s.ident();
  }
  s.expect('(');
  let node: SchemaNode;

  switch (fn) {
    case 'string':
    case 'date':
      node = { kind: 'string', ...(fn === 'date' ? { format: 'datetime' as const } : {}) };
      s.skipBalancedArgs();
      break;
    case 'number':
    case 'bigint':
      node = { kind: 'number' };
      s.skipBalancedArgs();
      break;
    case 'boolean':
      node = { kind: 'boolean' };
      s.skipBalancedArgs();
      break;
    case 'null':
      node = { kind: 'null' };
      s.skipBalancedArgs();
      break;
    case 'any':
    case 'unknown':
    case 'nativeEnum':
    case 'custom':
      node = { kind: 'any' };
      s.skipBalancedArgs();
      break;
    case 'literal':
      node = { kind: 'literal', value: parseValue(s) };
      s.accept(',');
      s.skipBalancedArgs();
      break;
    case 'enum': {
      const values = parseValue(s);
      if (!Array.isArray(values)) s.fail('z.enum() expects an array of values');
      node = { kind: 'enum', values };
      s.accept(',');
      s.skipBalancedArgs();
      break;
    }
    case 'array':
      node = { kind: 'array', item: parseZodExpr(s) };
      s.accept(',');
      s.skipBalancedArgs();
      break;
    case 'object':
    case 'strictObject':
    case 'looseObject':
      node = { kind: 'object', shape: parseZodShape(s), strict: fn === 'strictObject' };
      s.accept(',');
      s.skipBalancedArgs();
      break;
    case 'record': {
      const first = parseZodExpr(s);
      let valueSchema = first;
      if (s.accept(',') && s.peek() !== ')') valueSchema = parseZodExpr(s);
      node = { kind: 'record', valueSchema };
      s.accept(',');
      s.skipBalancedArgs();
      break;
    }
    case 'union':
    case 'discriminatedUnion': {
      if (fn === 'discriminatedUnion') {
        s.string();
        s.expect(',');
      }
      s.expect('[');
      const options: SchemaNode[] = [];
      while (!s.accept(']')) {
        options.push(parseZodExpr(s));
        s.accept(',');
      }
      node = { kind: 'union', options };
      s.accept(',');
      s.skipBalancedArgs();
      break;
    }
    case 'tuple':
      node = { kind: 'array', item: { kind: 'any' } };
      s.skipBalancedArgs();
      break;
    case 'optional':
    case 'nullable':
      node = parseZodExpr(s);
      if (fn === 'optional') node.optional = true;
      else node.nullable = true;
      s.accept(',');
      s.skipBalancedArgs();
      break;
    default:
      s.fail(`Unsupported Zod type "z.${fn}()"`);
  }
  if (coerce) node!.coerce = true;
  return applyZodChain(s, node!);
}

function parseZodShape(s: Scanner): Record<string, SchemaNode> {
  s.expect('{');
  const shape: Record<string, SchemaNode> = {};
  while (!s.accept('}')) {
    const key = s.peek() === '"' || s.peek() === "'" ? s.string() : s.ident();
    s.expect(':');
    shape[key] = parseZodExpr(s);
    s.accept(',');
  }
  return shape;
}

function readOptionalNumberArg(s: Scanner): number {
  const n = s.number();
  s.accept(',');
  s.skipBalancedArgs(); // optional message argument
  return n;
}

function applyZodChain(s: Scanner, node: SchemaNode): SchemaNode {
  while (s.peek() === '.') {
    s.expect('.');
    const method = s.ident();
    s.expect('(');
    switch (method) {
      case 'optional':
        node.optional = true;
        s.skipBalancedArgs();
        break;
      case 'nullable':
        node.nullable = true;
        s.skipBalancedArgs();
        break;
      case 'nullish':
        node.optional = true;
        node.nullable = true;
        s.skipBalancedArgs();
        break;
      case 'default':
      case 'catch':
        if (s.peek() !== ')') {
          node.hasDefault = true;
          node.defaultValue = parseValue(s);
        }
        s.skipBalancedArgs();
        break;
      case 'array':
        s.skipBalancedArgs();
        node = { kind: 'array', item: node };
        break;
      case 'min':
      case 'gte':
        node.min = readOptionalNumberArg(s);
        break;
      case 'max':
      case 'lte':
        node.max = readOptionalNumberArg(s);
        break;
      case 'length':
        node.length = readOptionalNumberArg(s);
        break;
      case 'gt':
        node.gt = readOptionalNumberArg(s);
        break;
      case 'lt':
        node.lt = readOptionalNumberArg(s);
        break;
      case 'int':
        node.int = true;
        s.skipBalancedArgs();
        break;
      case 'positive':
        node.gt = 0;
        s.skipBalancedArgs();
        break;
      case 'nonnegative':
        node.min = 0;
        s.skipBalancedArgs();
        break;
      case 'negative':
        node.lt = 0;
        s.skipBalancedArgs();
        break;
      case 'nonpositive':
        node.max = 0;
        s.skipBalancedArgs();
        break;
      case 'nonempty':
        node.min = Math.max(node.min ?? 0, 1);
        s.skipBalancedArgs();
        break;
      case 'email':
      case 'url':
      case 'uuid':
      case 'datetime':
        node.format = method;
        s.skipBalancedArgs();
        break;
      case 'regex': {
        s.skipWs();
        const rest = s.src.slice(s.pos);
        const m = /^\/((?:\\.|[^/\\])+)\/([gimsuy]*)/.exec(rest);
        if (m) {
          try {
            node.regex = new RegExp(m[1], m[2].replace('g', ''));
          } catch {
            // ignore invalid regex; constraint not enforced
          }
          s.pos += m[0].length;
        }
        s.skipBalancedArgs();
        break;
      }
      case 'strict':
        node.strict = true;
        s.skipBalancedArgs();
        break;
      case 'or': {
        const other = parseZodExpr(s);
        s.skipBalancedArgs();
        node = { kind: 'union', options: [node, other] };
        break;
      }
      default:
        // describe, passthrough, strip, trim, refine, transform, brand, ... -> no validation effect
        s.skipBalancedArgs();
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// TypeScript-style grammar
// ---------------------------------------------------------------------------

function parseTsType(s: Scanner): SchemaNode {
  s.accept('|'); // leading pipe in multi-line unions
  const options = [parseTsPostfix(s)];
  while (s.accept('|')) options.push(parseTsPostfix(s));
  if (options.length === 1) return options[0];
  const nonNull = options.filter((o) => o.kind !== 'null');
  if (nonNull.length === 1 && nonNull.length < options.length) return { ...nonNull[0], nullable: true };
  if (options.every((o) => o.kind === 'literal')) return { kind: 'enum', values: options.map((o) => o.value) };
  return { kind: 'union', options };
}

function parseTsPostfix(s: Scanner): SchemaNode {
  let node = parseTsPrimary(s);
  while (s.peek() === '[') {
    s.expect('[');
    s.expect(']');
    node = { kind: 'array', item: node };
  }
  return node;
}

function parseTsPrimary(s: Scanner): SchemaNode {
  const ch = s.peek();
  if (ch === '{') return { kind: 'object', shape: parseTsMembers(s) };
  if (ch === '(') {
    s.expect('(');
    const inner = parseTsType(s);
    s.expect(')');
    return inner;
  }
  if (ch === '"' || ch === "'" || ch === '`') return { kind: 'literal', value: s.string() };
  if (ch === '-' || /\d/.test(ch)) return { kind: 'literal', value: s.number() };
  const id = s.ident();
  switch (id) {
    case 'string':
    case 'Date':
      return { kind: 'string' };
    case 'number':
    case 'bigint':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'true':
      return { kind: 'literal', value: true };
    case 'false':
      return { kind: 'literal', value: false };
    case 'null':
      return { kind: 'null' };
    case 'undefined':
      return { kind: 'any', optional: true };
    case 'Array': {
      s.expect('<');
      const item = parseTsType(s);
      s.expect('>');
      return { kind: 'array', item };
    }
    case 'Record': {
      s.expect('<');
      parseTsType(s);
      s.expect(',');
      const valueSchema = parseTsType(s);
      s.expect('>');
      return { kind: 'record', valueSchema };
    }
    default:
      // any, unknown, object, named types we cannot resolve
      return { kind: 'any' };
  }
}

function parseTsMembers(s: Scanner): Record<string, SchemaNode> {
  s.expect('{');
  const shape: Record<string, SchemaNode> = {};
  while (!s.accept('}')) {
    const key = s.peek() === '"' || s.peek() === "'" ? s.string() : s.ident();
    const optional = s.accept('?');
    s.expect(':');
    const node = parseTsType(s);
    if (optional) node.optional = true;
    shape[key] = node;
    while (s.accept(',') || s.accept(';')) {
      // separators
    }
  }
  return shape;
}

// ---------------------------------------------------------------------------
// JSON inputs
// ---------------------------------------------------------------------------

function fromJsonSchema(js: any): SchemaNode {
  if (!js || typeof js !== 'object') return { kind: 'any' };
  if (Array.isArray(js.enum)) return { kind: 'enum', values: js.enum };
  if ('const' in js) return { kind: 'literal', value: js.const };
  const anyOf = js.anyOf || js.oneOf;
  if (Array.isArray(anyOf)) return { kind: 'union', options: anyOf.map(fromJsonSchema) };
  let type = js.type;
  let nullable = false;
  if (Array.isArray(type)) {
    nullable = type.includes('null');
    type = type.find((t: string) => t !== 'null');
  }
  let node: SchemaNode;
  switch (type) {
    case 'string':
      node = { kind: 'string', min: js.minLength, max: js.maxLength };
      break;
    case 'integer':
    case 'number':
      node = { kind: 'number', int: type === 'integer', min: js.minimum, max: js.maximum };
      break;
    case 'boolean':
      node = { kind: 'boolean' };
      break;
    case 'null':
      node = { kind: 'null' };
      break;
    case 'array':
      node = { kind: 'array', item: fromJsonSchema(js.items), min: js.minItems, max: js.maxItems };
      break;
    case 'object': {
      const required: string[] = Array.isArray(js.required) ? js.required : [];
      const shape: Record<string, SchemaNode> = {};
      for (const [key, sub] of Object.entries(js.properties || {})) {
        shape[key] = fromJsonSchema(sub);
        if (!required.includes(key)) shape[key].optional = true;
      }
      node = { kind: 'object', shape, strict: js.additionalProperties === false };
      break;
    }
    default:
      node = { kind: 'any' };
  }
  if (nullable) node.nullable = true;
  return node;
}

function fromKeyTypeMap(value: any): SchemaNode {
  if (Array.isArray(value)) return { kind: 'array', item: value.length ? fromKeyTypeMap(value[0]) : { kind: 'any' } };
  if (value && typeof value === 'object') {
    const shape: Record<string, SchemaNode> = {};
    for (const [key, sub] of Object.entries(value)) shape[key] = fromKeyTypeMap(sub);
    return { kind: 'object', shape };
  }
  if (typeof value === 'string') {
    try {
      return parseTsType(new Scanner(value));
    } catch {
      return { kind: 'any' };
    }
  }
  return { kind: 'any' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseOutputSchema(raw: any): SchemaNode {
  if (raw && typeof raw === 'object') {
    return raw.type || raw.properties ? fromJsonSchema(raw) : fromKeyTypeMap(raw);
  }
  if (typeof raw !== 'string' || !raw.trim()) throw new SchemaParseError('Schema is empty');

  let src = raw.trim();
  src = src.replace(/^import\s+[^;\n]+;?\s*/gm, '');
  src = src.replace(/^export\s+/, '');
  src = src.replace(/^(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*/, '');
  src = src.replace(/^type\s+\w+\s*=\s*/, '');
  src = src.replace(/^interface\s+\w+\s*/, '');
  src = src.replace(/;\s*$/, '');

  if (src.startsWith('{') || src.startsWith('[')) {
    try {
      const json = JSON.parse(src);
      return json && typeof json === 'object' && (json.type || json.properties) ? fromJsonSchema(json) : fromKeyTypeMap(json);
    } catch {
      // not JSON -> TypeScript literal type
    }
  }

  const s = new Scanner(src);
  const node = s.src.startsWith('z.') ? parseZodExpr(s) : parseTsType(s);
  if (!s.eof()) s.fail('Unexpected trailing content');
  return node;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function describeKind(node: SchemaNode): string {
  if (node.kind === 'enum') return `one of ${JSON.stringify(node.values)}`;
  if (node.kind === 'literal') return JSON.stringify(node.value);
  return node.kind;
}

function typeOfValue(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

function checkSize(node: SchemaNode, size: number, unit: string, path: string, issues: SchemaIssue[]) {
  if (node.min !== undefined && size < node.min) issues.push({ path, message: `Must contain at least ${node.min} ${unit}` });
  if (node.max !== undefined && size > node.max) issues.push({ path, message: `Must contain at most ${node.max} ${unit}` });
  if (node.length !== undefined && size !== node.length) issues.push({ path, message: `Must contain exactly ${node.length} ${unit}` });
}

function validateNode(node: SchemaNode, value: any, path: string, issues: SchemaIssue[]): any {
  if (value === undefined) {
    if (node.hasDefault) return node.defaultValue;
    if (node.optional || node.kind === 'any') return value;
    issues.push({ path: path || '(root)', message: 'Required' });
    return value;
  }
  if (value === null && (node.nullable || node.kind === 'null' || node.kind === 'any')) return value;

  const at = path || '(root)';
  switch (node.kind) {
    case 'any':
      return value;
    case 'null':
      issues.push({ path: at, message: `Expected null, received ${typeOfValue(value)}` });
      return value;
    case 'string': {
      if (typeof value !== 'string') {
        issues.push({ path: at, message: `Expected string, received ${typeOfValue(value)}` });
        return value;
      }
      checkSize(node, value.length, 'character(s)', at, issues);
      if (node.format === 'email' && !EMAIL_RE.test(value)) issues.push({ path: at, message: 'Invalid email' });
      if (node.format === 'uuid' && !UUID_RE.test(value)) issues.push({ path: at, message: 'Invalid uuid' });
      if (node.format === 'url') {
        try {
          new URL(value);
        } catch {
          issues.push({ path: at, message: 'Invalid url' });
        }
      }
      if (node.format === 'datetime' && isNaN(Date.parse(value))) issues.push({ path: at, message: 'Invalid datetime' });
      if (node.regex && !node.regex.test(value)) issues.push({ path: at, message: `Must match ${node.regex}` });
      return value;
    }
    case 'number': {
      let num = value;
      if (node.coerce && typeof num === 'string' && num.trim() !== '' && !isNaN(Number(num))) num = Number(num);
      if (typeof num !== 'number' || !Number.isFinite(num)) {
        issues.push({ path: at, message: `Expected number, received ${typeOfValue(value)}` });
        return value;
      }
      if (node.int && !Number.isInteger(num)) issues.push({ path: at, message: 'Expected integer' });
      if (node.min !== undefined && num < node.min) issues.push({ path: at, message: `Must be >= ${node.min}` });
      if (node.max !== undefined && num > node.max) issues.push({ path: at, message: `Must be <= ${node.max}` });
      if (node.gt !== undefined && num <= node.gt) issues.push({ path: at, message: `Must be > ${node.gt}` });
      if (node.lt !== undefined && num >= node.lt) issues.push({ path: at, message: `Must be < ${node.lt}` });
      return num;
    }
    case 'boolean':
      if (node.coerce && (value === 'true' || value === 'false')) return value === 'true';
      if (typeof value !== 'boolean') issues.push({ path: at, message: `Expected boolean, received ${typeOfValue(value)}` });
      return value;
    case 'literal':
      if (value !== node.value) issues.push({ path: at, message: `Expected ${JSON.stringify(node.value)}` });
      return value;
    case 'enum':
      if (!node.values!.includes(value)) {
        issues.push({ path: at, message: `Expected one of ${JSON.stringify(node.values)}, received ${JSON.stringify(value)}` });
      }
      return value;
    case 'array': {
      if (!Array.isArray(value)) {
        issues.push({ path: at, message: `Expected array, received ${typeOfValue(value)}` });
        return value;
      }
      checkSize(node, value.length, 'item(s)', at, issues);
      return value.map((item, i) => validateNode(node.item!, item, joinPath(path, i), issues));
    }
    case 'record': {
      if (typeOfValue(value) !== 'object') {
        issues.push({ path: at, message: `Expected object, received ${typeOfValue(value)}` });
        return value;
      }
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) out[k] = validateNode(node.valueSchema!, v, joinPath(path, k), issues);
      return out;
    }
    case 'object': {
      if (typeOfValue(value) !== 'object') {
        issues.push({ path: at, message: `Expected object, received ${typeOfValue(value)}` });
        return value;
      }
      // Unknown keys are kept (not stripped) so downstream nodes never silently lose data; .strict() rejects them.
      const out: Record<string, any> = { ...value };
      for (const [key, sub] of Object.entries(node.shape || {})) {
        const validated = validateNode(sub, value[key], joinPath(path, key), issues);
        if (validated !== undefined) out[key] = validated;
      }
      if (node.strict) {
        for (const key of Object.keys(value)) {
          if (!(key in (node.shape || {}))) issues.push({ path: joinPath(path, key), message: 'Unrecognized key' });
        }
      }
      return out;
    }
    case 'union': {
      let best: SchemaIssue[] | null = null;
      for (const option of node.options || []) {
        const optionIssues: SchemaIssue[] = [];
        const result = validateNode(option, value, path, optionIssues);
        if (!optionIssues.length) return result;
        if (!best || optionIssues.length < best.length) best = optionIssues;
      }
      issues.push({
        path: at,
        message: `Did not match any allowed type (${(node.options || []).map(describeKind).join(' | ')})${
          best?.length ? `; closest mismatch: ${best[0].path}: ${best[0].message}` : ''
        }`,
      });
      return value;
    }
  }
}

export function validateAgainstSchema(schema: SchemaNode, value: any): { valid: boolean; value: any; issues: SchemaIssue[] } {
  const issues: SchemaIssue[] = [];
  const result = validateNode(schema, value, '', issues);
  return { valid: issues.length === 0, value: result, issues };
}

export function formatIssues(issues: SchemaIssue[], limit = 20): string {
  const lines = issues.slice(0, limit).map((i) => `- ${i.path}: ${i.message}`);
  if (issues.length > limit) lines.push(`- ...and ${issues.length - limit} more`);
  return lines.join('\n');
}
