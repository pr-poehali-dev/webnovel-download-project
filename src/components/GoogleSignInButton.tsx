import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: object) => void;
          renderButton: (el: HTMLElement, cfg: object) => void;
          prompt: () => void;
        };
      };
    };
    _googleGsiLoaded?: boolean;
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function loadGsi(): Promise<void> {
  if (window._googleGsiLoaded) return Promise.resolve();
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => { window._googleGsiLoaded = true; resolve(); };
    document.head.appendChild(s);
  });
}

interface Props {
  onToken: (token: string) => void;
  size?: 'small' | 'medium' | 'large';
  shape?: 'rectangular' | 'pill';
  text?: 'signin_with' | 'continue_with' | 'signup_with';
}

export default function GoogleSignInButton({ onToken, size = 'medium', shape = 'pill', text = 'signin_with' }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    loadGsi().then(() => {
      if (!ref.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response: { credential: string }) => {
          if (response.credential) onToken(response.credential);
        },
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'filled_black', size, shape, text, locale: 'ru',
      });
    });
  }, [onToken, size, shape, text]);

  if (!CLIENT_ID) {
    return (
      <div className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground">
        Google Sign-In не настроен
      </div>
    );
  }

  return <div ref={ref} />;
}
