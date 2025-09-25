import {FC} from 'hono/jsx';

import {db} from '@/services/database';
import {IProvider} from '@/services/shared-interfaces';

export const KSL: FC = async () => {
  const ksl = await db.providers.findOneAsync<IProvider>({name: 'ksl'});
  const enabled = ksl?.enabled;

  return (
    <div>
      <section class="overflow-auto provider-section">
        <div class="grid-container">
          <h4>KSL Sports</h4>
          <fieldset>
            <label>
              Enabled&nbsp;&nbsp;
              <input
                hx-put={`/providers/ksl/toggle`}
                hx-trigger="change"
                hx-target="#ksl-body"
                name="ksl-enabled"
                type="checkbox"
                role="switch"
                checked={enabled ? true : false}
                data-enabled={enabled ? 'true' : 'false'}
              />
            </label>
          </fieldset>
        </div>
        <div id="ksl-body" hx-swap="outerHTML" />
      </section>
      <hr />
    </div>
  );
};
