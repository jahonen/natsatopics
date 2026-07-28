import './PlatformCharCounter.scss';

interface PlatformCharCounterProps {
  platform: string;
  charCount: number;
  limit: number;
  withinLimit: boolean;
}

export function PlatformCharCounter({ platform, charCount, limit, withinLimit }: PlatformCharCounterProps) {
  return (
    <div className={`platform-char-counter ${withinLimit ? '' : 'platform-char-counter--over'}`}>
      <span className="platform-char-counter__label">{platform}</span>
      <span className="platform-char-counter__count">
        {charCount} / {limit}
      </span>
    </div>
  );
}
