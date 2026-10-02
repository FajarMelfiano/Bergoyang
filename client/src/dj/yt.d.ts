export {};

declare global {
  interface YTPlayerEvent {
    data: number;
  }

  interface YTPlayerOptions {
    videoId?: string;
    playerVars?: Record<string, number>;
    events?: {
      onReady?: () => void;
      onStateChange?: (event: YTPlayerEvent) => void;
      onError?: () => void;
    };
  }

  interface YTPlayerInstance {
    getPlayerState(): number;
    getCurrentTime(): number;
    getDuration(): number;
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    loadVideoById(videoId: string): void;
    destroy(): void;
  }

  interface Window {
    YT?: {
      Player: new (target: HTMLElement, options: YTPlayerOptions) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type { YTPlayerInstance, YTPlayerOptions };
