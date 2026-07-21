import {FC} from 'hono/jsx';

import {db} from '@/services/database';
import {IProvider} from '@/services/shared-interfaces';
import {TBZZRTokens} from '@/services/bzzr-handler';

import {BZZRBody} from './CardBody';

export const BZZR: FC = async () => {
  const bzzr = await db.providers.findOneAsync<IProvider<TBZZRTokens>>({name: 'bzzr'});
  const enabled = bzzr?.enabled;
  const tokens = bzzr?.tokens;

  return (
    <div>
      <section class="overflow-auto provider-section">
        <div class="grid-container">
          <h4>BZZR</h4>
          <fieldset>
            <label>
              Enabled&nbsp;&nbsp;
              <input
                hx-put={`/providers/bzzr/toggle`}
                hx-trigger="change"
                hx-target="#bzzr-body"
                name="bzzr-enabled"
                type="checkbox"
                role="switch"
                checked={enabled ? true : false}
                data-enabled={enabled ? 'true' : 'false'}
              />
            </label>
          </fieldset>
        </div>
        <div id="bzzr-body" hx-swap="innerHTML">
          <BZZRBody enabled={enabled} tokens={tokens} />
        </div>
      </section>
      <hr />
    </div>
  );
};
