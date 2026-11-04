interface Window {
  designClover?: {
    version?: string;
    onOpenProjectFile?: (
      callback: (file: { fileName: string; contents?: string; error?: string }) => void
    ) => () => void;
  };
}
