import {FC} from 'hono/jsx';

import {db} from '@/services/database';
import {IProvider} from '@/services/shared-interfaces';
import {TMWTokens} from '@/services/mw-handler';

import {MWBody} from './CardBody';

export const MntWest: FC = async () => {
  const mw = await db.providers.findOneAsync<IProvider<TMWTokens>>({name: 'mw'});
  const enabled = mw?.enabled;
  const tokens = mw?.tokens;

  return (
    <div>
      <section class="overflow-auto provider-section">
        <div class="grid-container">
          <h4>Mountain West</h4>
          <fieldset>
            <label>
              Enabled&nbsp;&nbsp;
              <input
                hx-put={`/providers/mw/toggle`}
                hx-trigger="change"
                hx-target="#mw-body"
                name="mw-enabled"
                type="checkbox"
                role="switch"
                checked={enabled ? true : false}
                data-enabled={enabled ? 'true' : 'false'}
              />
            </label>
          </fieldset>
        </div>
        <div id="mw-body" hx-swap="outerHTML">
          <MWBody enabled={enabled} tokens={tokens} />
        </div>
      </section>
      <hr />
    </div>
  );
};
