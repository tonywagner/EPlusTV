import {FC} from 'hono/jsx';

import {db} from '@/services/database';
import {IProvider} from '@/services/shared-interfaces';

import {HudlBody} from './CardBody';

export const Hudl: FC = async () => {
  const {enabled, meta} = await db.providers.findOneAsync<IProvider>({name: 'hudl'});

  return (
    <div>
      <section class="overflow-auto provider-section">
        <div class="grid-container">
          <h4>Hudl</h4>
          <fieldset>
            <label>
              Enabled&nbsp;&nbsp;
              <input
                hx-put={`/providers/hudl/toggle`}
                hx-trigger="change"
                hx-target="#hudl-body"
                name="hudl-enabled"
                type="checkbox"
                role="switch"
                checked={enabled ? true : false}
                data-enabled={enabled ? 'true' : 'false'}
              />
            </label>
          </fieldset>
        </div>
        <div id="hudl-body" hx-swap="innerHTML">
          <HudlBody enabled={enabled} meta={meta} />
        </div>
      </section>
      <hr />
    </div>
  );
};
