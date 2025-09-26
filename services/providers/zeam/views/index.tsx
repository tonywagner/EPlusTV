import {FC} from 'hono/jsx';

import {db} from '@/services/database';
import {IProvider} from '@/services/shared-interfaces';

export const Zeam: FC = async () => {
  const zeam = await db.providers.findOneAsync<IProvider>({name: 'zeam'});
  const enabled = zeam?.enabled;

  return (
    <div>
      <section class="overflow-auto provider-section">
        <div class="grid-container">
          <h4>Zeam Live Events</h4>
          <fieldset>
            <label>
              Enabled&nbsp;&nbsp;
              <input
                hx-put={`/providers/zeam/toggle`}
                hx-trigger="change"
                hx-target="#zeam-body"
                name="zeam-enabled"
                type="checkbox"
                role="switch"
                checked={enabled ? true : false}
                data-enabled={enabled ? 'true' : 'false'}
              />
            </label>
          </fieldset>
        </div>
        <div id="zeam-body" hx-swap="outerHTML" />
      </section>
      <hr />
    </div>
  );
};
