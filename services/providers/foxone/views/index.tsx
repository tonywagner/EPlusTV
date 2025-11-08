import {FC} from 'hono/jsx';

import {db} from '@/services/database';
import {IProvider} from '@/services/shared-interfaces';
import {TFoxOneTokens} from '@/services/foxone-handler';

import {FoxOneBody} from './CardBody';

export const FoxOne: FC = async () => {
  const {
    enabled,
    tokens,
    linear_channels: channels,
    meta,
  } = await db.providers.findOneAsync<IProvider<TFoxOneTokens>>({name: 'foxone'});
  
  return (
    <div>
      <section class="overflow-auto provider-section">
        <div class="grid-container">
          <h4>Fox One</h4>
          <fieldset>
            <label>
              Enabled&nbsp;&nbsp;
              <input
                hx-put={`/providers/foxone/toggle`}
                hx-trigger="change"
                hx-target="#foxone-body"
                name="foxone-enabled"
                type="checkbox"
                role="switch"
                checked={enabled ? true : false}
                data-enabled={enabled ? 'true' : 'false'}
              />
            </label>
          </fieldset>
        </div>
        <div class="grid">
          <fieldset>
            <label>
              <input
                hx-put={`/providers/foxone/toggle-uhd`}
                hx-trigger="change"
                hx-target="#foxone-body"
                name="foxone-enabled-uhd"
                type="checkbox"
                role="switch"
                checked={meta.uhd ? true : false}
                data-enabled={meta.uhd ? 'true' : 'false'}
              />
              Enable UHD/HDR events?
            </label>
          </fieldset>
          <fieldset>
            <label>
              <input
                hx-put={`/providers/foxone/toggle-4k-only`}
                hx-trigger="change"
                hx-target="#foxone-body"
                name="foxone-enabled-4k-only"
                type="checkbox"
                role="switch"
                checked={meta.only4k ? true : false}
                data-enabled={meta.only4k ? 'true' : 'false'}
              />
              Only grab 4K events?
            </label>
          </fieldset>               
        </div>
        <div id="foxone-body" hx-swap="innerHTML">
          <FoxOneBody enabled={enabled} tokens={tokens} channels={channels} />
        </div>
      </section>
      <hr />
    </div>
  );
};
