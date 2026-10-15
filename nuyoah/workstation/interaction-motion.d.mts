export function createInteractionTheme(options: { window: Window; css?: string; frame?: boolean }): {
  setVisible(node: HTMLElement, visible: boolean): boolean;
  destroy(): void;
};
