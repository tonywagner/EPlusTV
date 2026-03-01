import {FC} from 'hono/jsx';

import {db} from '@/services/database';
import {IProvider} from '@/services/shared-interfaces';
import {TMidcoTokens} from '@/services/midco-handler';

import {MidcoBody} from './CardBody';

export const Midco: FC = async () => {
  const midco = await db.providers.findOneAsync<IProvider<TMidcoTokens>>({name: 'midco'});
  const {enabled, tokens} = midco;

  return (
    <div>
      <section class="overflow-auto provider-section">
        <div class="grid-container">
          <h4>Midco Sports</h4>
          <fieldset>
            <label>
              Enabled&nbsp;&nbsp;
              <input
                hx-put={`/providers/midco/toggle`}
                hx-trigger="change"
                hx-target="#midco-body"
                name="midco-enabled"
                type="checkbox"
                role="switch"
                checked={enabled ? true : false}
                data-enabled={enabled ? 'true' : 'false'}
              />
            </label>
          </fieldset>
        </div>
        <div id="midco-body" hx-swap="innerHTML">
          <MidcoBody enabled={enabled} tokens={tokens} />
        </div>
      </section>
      <hr />
    </div>
  );
};
