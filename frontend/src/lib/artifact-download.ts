import { ArtifactItem } from '@/lib/types';
import { buildStoredZip } from '@/lib/stored-zip';

export type ArtifactDownloadMode = 'native' | 'markdown';

function slugDocumentName(raw: string): string {
  const slug = String(raw || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return slug || 'document';
}

export function getArtifactDocumentName(artifact: ArtifactItem): string {
  return artifact.title?.trim() || artifact.logicalId || artifact.artifactId || 'document';
}

function getNativeExtension(artifact: ArtifactItem): string {
  const isJson = artifact.format === 'json' || typeof artifact.content === 'object';
  if (isJson) return 'json';
  if (artifact.format === 'code') return 'txt';
  return 'md';
}

export function getArtifactDownloadFilename(artifact: ArtifactItem, mode: ArtifactDownloadMode = 'native'): string {
  const base = slugDocumentName(getArtifactDocumentName(artifact));
  if (mode === 'markdown') return `${base}.md`;
  return `${base}.${getNativeExtension(artifact)}`;
}

function objectToMarkdownBody(content: Record<string, any>): string {
  for (const key of ['markdown', 'body', 'text', 'content']) {
    const value = content[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``;
}

export function getArtifactMarkdownContent(artifact: ArtifactItem): string {
  const content = artifact.content;
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (typeof content === 'object') return objectToMarkdownBody(content);
  return String(content);
}

export function getArtifactDownloadText(artifact: ArtifactItem, mode: ArtifactDownloadMode = 'native'): string {
  if (mode === 'markdown') return getArtifactMarkdownContent(artifact);
  const isJson = artifact.format === 'json' || typeof artifact.content === 'object';
  return isJson ? JSON.stringify(artifact.content, null, 2) : String(artifact.content || '');
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadArtifact(artifact: ArtifactItem, mode: ArtifactDownloadMode = 'native') {
  const text = getArtifactDownloadText(artifact, mode);
  const mime = mode === 'markdown' ? 'text/markdown' : artifact.format === 'json' ? 'application/json' : 'text/markdown';
  triggerBlobDownload(new Blob([text], { type: mime }), getArtifactDownloadFilename(artifact, mode));
}

export function downloadArtifactAsMarkdown(artifact: ArtifactItem) {
  downloadArtifact(artifact, 'markdown');
}

function uniqueZipNames(artifacts: ArtifactItem[], mode: ArtifactDownloadMode): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();

  for (const artifact of artifacts) {
    const filename = getArtifactDownloadFilename(artifact, mode);
    if (!used.has(filename)) {
      used.add(filename);
      names.set(artifact.artifactId, filename);
      continue;
    }

    const dot = filename.lastIndexOf('.');
    const stem = dot >= 0 ? filename.slice(0, dot) : filename;
    const ext = dot >= 0 ? filename.slice(dot) : '';
    let index = 2;
    let candidate = `${stem}-${index}${ext}`;
    while (used.has(candidate)) {
      index += 1;
      candidate = `${stem}-${index}${ext}`;
    }
    used.add(candidate);
    names.set(artifact.artifactId, candidate);
  }

  return names;
}

export function downloadArtifactsZip(
  artifacts: ArtifactItem[],
  zipName = 'artifacts.zip',
  mode: ArtifactDownloadMode = 'native',
) {
  const encoder = new TextEncoder();
  const filenames = uniqueZipNames(artifacts, mode);
  const entries = artifacts.map((artifact) => ({
    name: filenames.get(artifact.artifactId) || getArtifactDownloadFilename(artifact, mode),
    data: encoder.encode(getArtifactDownloadText(artifact, mode)),
  }));

  triggerBlobDownload(buildStoredZip(entries), zipName);
}

export function downloadArtifacts(
  artifacts: ArtifactItem[],
  mode: ArtifactDownloadMode = 'native',
  zipName = 'artifacts.zip',
) {
  if (artifacts.length === 1) {
    downloadArtifact(artifacts[0], mode);
    return;
  }
  downloadArtifactsZip(artifacts, zipName, mode);
}
