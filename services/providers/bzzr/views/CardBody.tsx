import {FC} from 'hono/jsx';

import {TBZZRTokens} from '@/services/bzzr-handler';

interface IBZZRBodyProps {
  enabled: boolean;
  tokens?: TBZZRTokens;
  open?: boolean;
}

export const BZZRBody: FC<IBZZRBodyProps> = ({enabled, tokens, open}) => {
  const parsedTokens = JSON.stringify(tokens, undefined, 2);

  if (!enabled) {
    return <></>;
  }

  return (
    <div hx-swap="outerHTML" hx-target="this">
      <details open={open}>
        <summary>Tokens</summary>
        <div>
          <pre>{parsedTokens}</pre>
          <form hx-put="/providers/bzzr/reauth" hx-trigger="submit">
            <button id="bzzr-reauth">Re-Authenticate</button>
          </form>
        </div>
      </details>
    </div>
  );
};
