import {FC} from 'hono/jsx';

import {TFoxOneTokens} from '@/services/foxone-handler';
import {IProviderChannel} from '@/services/shared-interfaces';

interface IFoxOneBodyProps {
  enabled: boolean;
  tokens?: TFoxOneTokens;
  open?: boolean;
  channels: IProviderChannel[];
}

export const FoxOneBody: FC<IFoxOneBodyProps> = ({enabled, tokens, open, channels}) => {
  const parsedTokens = JSON.stringify(tokens, undefined, 2);

  if (!enabled) {
    return <></>;
  }

  return (
    <div hx-swap="outerHTML" hx-target="this">
      <summary>
        <span>Linear Channels</span>
      </summary>
      <table class="striped">
        <thead>
          <tr>
            <th scope="col">Name</th>
          </tr>
        </thead>
        <tbody>
          {channels.map(c => (
            <tr key={c.id}>
              <td>
                <input
                  hx-target="this"
                  hx-swap="outerHTML"
                  type="checkbox"
                  checked={c.enabled}
                  data-enabled={c.enabled ? 'true' : 'false'}
                  hx-put={`/providers/foxone/channels/toggle/${c.id}`}
                  hx-trigger="change"
                  name="channel-enabled"
                />
              </td>
              <td>{c.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details open={open}>
        <summary>Tokens</summary>
        <div>
          <pre>{parsedTokens}</pre>
          <form hx-put="/providers/foxone/reauth" hx-trigger="submit">
            <button id="foxone-reauth">Re-Authenticate</button>
          </form>
        </div>
      </details>
    </div>
  );
};
