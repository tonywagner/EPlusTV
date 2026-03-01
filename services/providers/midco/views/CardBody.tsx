import {FC} from 'hono/jsx';

import {TMidcoTokens} from '@/services/midco-handler';

interface IMidcoBodyProps {
  enabled: boolean;
  tokens?: TMidcoTokens;
  open?: boolean;
}

export const MidcoBody: FC<IMidcoBodyProps> = async ({enabled, tokens, open}) => {
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
          <form hx-put="/providers/midco/reauth" hx-trigger="submit">
            <button id="midco-reauth">Re-Authenticate</button>
          </form>
        </div>
      </details>
    </div>
  );
};
