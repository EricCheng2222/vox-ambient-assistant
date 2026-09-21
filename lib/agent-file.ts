export type AgentFile = {
  id: string;
  name: string;
  title: string;
  purpose: string;
  mimeType: string;
  size: number;
  objectKey: string;
  createdAt: string;
};

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
