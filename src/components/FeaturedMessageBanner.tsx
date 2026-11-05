import { useCallback, useEffect, useState } from 'react';
import type { FeaturedMessage, FeaturedMessageSubtitle } from '../domain';
import { formatTime } from '../timer';

type Props = {
  message: FeaturedMessage;
  now: number;
  serverOffsetMs: number;
  transition?: boolean;
};

function FeaturedSubtitle({ item, expiresAt, now, serverOffsetMs, onExpired }: {
  item: FeaturedMessageSubtitle;
  expiresAt?: number;
  now: number;
  serverOffsetMs: number;
  onExpired: (id: string) => void;
}) {
  const hasTimer = typeof expiresAt === 'number' && Number.isFinite(expiresAt);
  const remaining = hasTimer ? Math.max(0, Math.ceil((expiresAt - (now + serverOffsetMs)) / 1000)) : null;
  const expired = hasTimer && remaining === 0;

  useEffect(() => {
    if (!expired) return;
    const timeout = window.setTimeout(() => onExpired(item.id), 550);
    return () => window.clearTimeout(timeout);
  }, [expired, item.id, onExpired]);

  return <div className={'featured-message-item' + (!hasTimer ? ' featured-message-item-untimed' : '') + (expired ? ' is-expiring' : '')} aria-hidden={expired}>
    <span>{item.text}</span>
    {hasTimer && <b>{formatTime(remaining ?? 0)}</b>}
  </div>;
}

export function FeaturedMessageBanner({ message, now, serverOffsetMs, transition = false }: Props) {
  const [removedSubtitleIds, setRemovedSubtitleIds] = useState<string[]>([]);
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const currentTime = now + serverOffsetMs;
  const timedSubtitles = message.subtitles.filter((item) => Number.isFinite(item.durationSeconds) && Number(item.durationSeconds) > 0);
  const allSubtitlesAreTimed = message.subtitles.length > 0 && timedSubtitles.length === message.subtitles.length;\n  const allTimersFinished = allSubtitlesAreTimed && timedSubtitles.every((item) =>
    message.publishedAt + Number(item.durationSeconds) * 1000 <= currentTime);
  const onSubtitleExpired = useCallback((id: string) => {
    setRemovedSubtitleIds((current) => current.includes(id) ? current : [...current, id]);
  }, []);

  useEffect(() => {
    if (!allTimersFinished) return;
    const timeout = window.setTimeout(() => setBannerRemoved(true), 700);
    return () => window.clearTimeout(timeout);
  }, [allTimersFinished]);

  const visibleSubtitles = message.subtitles.filter((item) => !removedSubtitleIds.includes(item.id));
  if (bannerRemoved) return null;
  return <section className={'featured-message-banner' + (transition ? ' featured-message-banner-transition' : '') + (allTimersFinished ? ' is-expiring' : '')} aria-live="polite" aria-hidden={allTimersFinished}>
    <span className="featured-message-kicker">MENSAJE DE LA ORGANIZACIÓN</span>
    <h2>{message.title}</h2>
    <div className={'featured-message-subtitles' + (visibleSubtitles.length === 1 ? ' featured-message-subtitles-single' : '')}>
      {visibleSubtitles.map((item) => <FeaturedSubtitle
        key={item.id}
        item={item}
        expiresAt={typeof item.durationSeconds === 'number' ? message.publishedAt + item.durationSeconds * 1000 : undefined}
        now={now}
        serverOffsetMs={serverOffsetMs}
        onExpired={onSubtitleExpired}
      />)}
    </div>
  </section>;
}
