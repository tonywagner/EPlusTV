import {FC} from 'hono/jsx';

import {TMWTokens} from '@/services/mw-handler';

interface IMWBodyProps {
  enabled: boolean;
  tokens?: TMWTokens;
  open?: boolean;
}

export const MWBody: FC<IMWBodyProps> = async ({enabled, tokens, open}) => {
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
          <form hx-put="/providers/mw/register" hx-trigger="submit">
            <button id="mw-register">Re-Register</button>
          </form>
        </div>
      </details>
    </div>
  );
};
