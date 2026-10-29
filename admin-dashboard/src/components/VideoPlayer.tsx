'use client';

/**
 * Gallery video player — Video.js v10 (@videojs/react).
 * https://github.com/videojs/v10
 */
import '@videojs/react/video/skin.css';
import { createPlayer, videoFeatures } from '@videojs/react';
import { Video, VideoSkin } from '@videojs/react/video';

const Player = createPlayer({ features: videoFeatures });

type Props = {
  src: string;
  poster?: string | null;
  className?: string;
  autoPlay?: boolean;
};

export default function VideoPlayer({ src, poster, className, autoPlay = true }: Props) {
  if (!src) {
    return (
      <div className="flex items-center justify-center text-sm text-white/60 p-8">
        No video source
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ width: '100%', maxWidth: '100%', maxHeight: '100%' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* key forces remount when switching gallery videos */}
      <Player.Provider key={src}>
        <VideoSkin>
          <Video
            src={src}
            poster={poster || undefined}
            playsInline
            controls
            autoPlay={autoPlay}
            preload="metadata"
            style={{
              width: '100%',
              maxHeight: 'min(78vh, 900px)',
              background: '#000',
              borderRadius: 8,
            }}
          />
        </VideoSkin>
      </Player.Provider>
    </div>
  );
}
