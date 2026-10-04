import * as ts from 'typescript';

/** A primitive type name ('string', 'number', ..., or an unresolved type name) or a nested object shape. */
export type SchemaShape = string | { [key: string]: SchemaShape };
export type ObjectShape = { [key: string]: SchemaShape };

const PRIMITIVE_NAMES = new Set(['string', 'number', 'boolean', 'object', 'array', 'any']);

const ZOD_FACTORY_SHAPES: Record<string, SchemaShape> = {
  string: 'string',
  number: 'number',
  bigint: 'number',
  boolean: 'boolean',
  date: 'string',
  enum: 'string',
  nativeEnum: 'string',
  array: 'array',
  tuple: 'array',
  set: 'array',
  record: 'object',
  map: 'object',
  any: 'any',
  unknown: 'any',
};

/** Zod factories that just wrap another schema: z.optional(z.string()) */
const ZOD_WRAPPER_FACTORIES = new Set(['optional', 'nullable', 'nullish', 'lazy', 'readonly']);

const TYPE_KEYWORD_SHAPES: Partial<Record<ts.SyntaxKind, SchemaShape>> = {
  [ts.SyntaxKind.StringKeyword]: 'string',
  [ts.SyntaxKind.NumberKeyword]: 'number',
  [ts.SyntaxKind.BigIntKeyword]: 'number',
  [ts.SyntaxKind.BooleanKeyword]: 'boolean',
  [ts.SyntaxKind.ObjectKeyword]: 'object',
  [ts.SyntaxKind.AnyKeyword]: 'any',
  [ts.SyntaxKind.UnknownKeyword]: 'any',
};

const TYPE_REFERENCE_SHAPES: Record<string, SchemaShape> = {
  Array: 'array',
  ReadonlyArray: 'array',
  Set: 'array',
  Record: 'object',
  Map: 'object',
  Object: 'object',
  Date: 'string',
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
};

function normalizeTypeName(name: string): string {
  const lower = name.trim().toLowerCase();
  return PRIMITIVE_NAMES.has(lower) ? lower : name.trim();
}

function propertyKey(name: ts.PropertyName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText(sf);
}

/** Zod expressions: z.string().optional(), z.object({ ... }).array(), z.optional(z.number()) */
function zodShape(node: ts.CallExpression, sf: ts.SourceFile): SchemaShape {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return 'any';
  const method = callee.name.text;
  const [firstArg] = node.arguments;

  // Root factory call on the zod namespace: z.<method>(...)
  if (ts.isIdentifier(callee.expression)) {
    if (method === 'object') return firstArg ? expressionShape(firstArg, sf) : 'object';
    if (ZOD_WRAPPER_FACTORIES.has(method) && firstArg) return expressionShape(firstArg, sf);
    return ZOD_FACTORY_SHAPES[method] ?? 'any';
  }

  // Chained modifier: <schema>.<method>(...). Only `.array()` changes the shape.
  if (method === 'array') return 'array';
  const inner = expressionShape(callee.expression, sf);
  if ((method === 'extend' || method === 'merge') && firstArg && typeof inner === 'object') {
    const extra = expressionShape(firstArg, sf);
    return typeof extra === 'object' ? { ...inner, ...extra } : inner;
  }
  return inner;
}

function expressionShape(node: ts.Expression, sf: ts.SourceFile): SchemaShape {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return expressionShape(node.expression, sf);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const shape: ObjectShape = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) shape[propertyKey(prop.name, sf)] = expressionShape(prop.initializer, sf);
      else if (ts.isShorthandPropertyAssignment(prop)) shape[prop.name.text] = 'any';
    }
    return shape;
  }
  if (ts.isCallExpression(node)) return zodShape(node, sf);
  if (ts.isArrayLiteralExpression(node)) return 'array';
  if (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) return normalizeTypeName(node.text);
  if (ts.isNumericLiteral(node)) return 'number';
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
  return 'any';
}

function membersShape(members: ts.NodeArray<ts.TypeElement>, sf: ts.SourceFile): ObjectShape {
  const shape: ObjectShape = {};
  for (const member of members) {
    if (ts.isPropertySignature(member)) {
      shape[propertyKey(member.name, sf)] = member.type ? typeShape(member.type, sf) : 'any';
    }
  }
  return shape;
}

function isNullish(node: ts.TypeNode): boolean {
  if (node.kind === ts.SyntaxKind.UndefinedKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true;
  return ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword;
}

/** TypeScript types: { id: string; tags: string[]; user?: { name: string } | null } */
function typeShape(node: ts.TypeNode, sf: ts.SourceFile): SchemaShape {
  const keyword = TYPE_KEYWORD_SHAPES[node.kind];
  if (keyword) return keyword;

  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) return typeShape(node.type, sf);
  if (ts.isTypeLiteralNode(node)) return membersShape(node.members, sf);
  if (ts.isArrayTypeNode(node) || ts.isTupleTypeNode(node)) return 'array';

  if (ts.isLiteralTypeNode(node)) {
    const { literal } = node;
    if (ts.isStringLiteral(literal)) return 'string';
    if (ts.isNumericLiteral(literal)) return 'number';
    if (literal.kind === ts.SyntaxKind.TrueKeyword || literal.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
    return 'any';
  }

  if (ts.isUnionTypeNode(node)) {
    const shapes = node.types.filter((t) => !isNullish(t)).map((t) => typeShape(t, sf));
    if (shapes.length === 1) return shapes[0];
    const [first] = shapes;
    return typeof first === 'string' && shapes.every((s) => s === first) ? first : 'any';
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(sf);
    return TYPE_REFERENCE_SHAPES[name] ?? name;
  }

  return normalizeTypeName(node.getText(sf));
}

function parse(fileName: string, source: string): ts.SourceFile | undefined {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // createSourceFile never throws; syntax errors are only recorded here (internal but long-stable field).
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  return diagnostics && diagnostics.length > 0 ? undefined : sf;
}

function nonEmptyObject(shape: SchemaShape | undefined): ObjectShape | undefined {
  return shape && typeof shape === 'object' && Object.keys(shape).length > 0 ? shape : undefined;
}

function parseTypeScriptSchema(source: string): ObjectShape | undefined {
  // Full declarations: `interface Order { ... }` or `type Order = { ... }`
  const declarationFile = parse('decl.ts', source);
  const declaration = declarationFile?.statements[0];
  if (declarationFile && declaration) {
    if (ts.isInterfaceDeclaration(declaration)) return nonEmptyObject(membersShape(declaration.members, declarationFile));
    if (ts.isTypeAliasDeclaration(declaration)) return nonEmptyObject(typeShape(declaration.type, declarationFile));
  }

  // Value expressions: z.object({ ... }) or { id: z.string() }
  const expressionFile = parse('expr.ts', `const __schema__ = (${source});`);
  const statement = expressionFile?.statements[0];
  if (expressionFile && statement && ts.isVariableStatement(statement)) {
    const init = statement.declarationList.declarations[0]?.initializer;
    if (init) return nonEmptyObject(expressionShape(init, expressionFile));
  }

  // Bare type literals: { id: string; tags: string[] }
  const typeFile = parse('type.ts', `type __schema__ = ${source};`);
  const alias = typeFile?.statements[0];
  if (typeFile && alias && ts.isTypeAliasDeclaration(alias)) return nonEmptyObject(typeShape(alias.type, typeFile));

  return undefined;
}

/**
 * Converts a stored output schema into a shape map. Accepts:
 * - plain objects and JSON strings
 * - Zod schemas: z.object({ orderId: z.string(), count: z.number().optional() })
 * - TypeScript types: { orderId: string; items: string[] }, `interface X { ... }`, `type X = { ... }`
 */
export function parseSchema(raw: unknown): Record<string, any> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string') return undefined;

  const source = raw.trim().replace(/;+$/, '');
  if (!source) return undefined;

  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON; fall through to TypeScript parsing.
  }

  return parseTypeScriptSchema(source);
}
