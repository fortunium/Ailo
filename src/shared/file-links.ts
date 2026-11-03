/** Local targets are handled by main-process filesystem APIs, never navigation. */
export function isLocalFileLink(target: string): boolean {
  return /^file:/i.test(target) || /^\/?[a-z]:[\\/]/i.test(target) ||
    (!!target && !target.startsWith('#') && !target.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(target));
}

export interface LocalFilePreview {
  path: string;
  name: string;
  text?: string;
  message?: string;
  directory?: boolean;
}
