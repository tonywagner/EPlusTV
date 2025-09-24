import {Hono} from 'hono';

import {db} from '@/services/database';

import {IProvider} from '@/services/shared-interfaces';
import {removeEntriesProvider, scheduleEntries} from '@/services/build-schedule';
import {hudlHandler, IHudlMeta} from '@/services/hudl-handler';
import {HudlBody} from './views/CardBody';

export const hudl = new Hono().basePath('/hudl');

const scheduleEvents = async () => {
  await hudlHandler.getSchedule();
  await scheduleEntries();
};

const removeEvents = async () => {
  await removeEntriesProvider('hudl');
};

hudl.put('/toggle', async c => {
  const body = await c.req.parseBody();
  const enabled = body['hudl-enabled'] === 'on';

  //await db.providers.updateAsync<IProvider, any>({name: 'hudl'}, {$set: {enabled}});
  
  const {affectedDocuments} = await db.providers.updateAsync<IProvider, any>(
    {name: 'hudl'},
    {$set: {enabled}},
    {returnUpdatedDocs: true},
  );
  
  const {meta} = affectedDocuments as IProvider<IHudlMeta>;

  if (enabled) {
    //scheduleEvents();
  } else {
    removeEvents();
  }
  
  return c.html(<HudlBody enabled={enabled} open={enabled} meta={meta} />, 200, {
    ...(enabled && {
      'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled Hudl"}}`,
    }),
  });
});

hudl.put('/conferences/toggle/:short_name', async c => {
  const short_name = c.req.param('short_name');
  const {meta} = await db.providers.findOneAsync<IProvider>({name: 'hudl'});

  const body = await c.req.parseBody();
  const enabled = body['conference-enabled'] === 'on';
  
  // find requested conference
  const matchingConference = meta.conferences.filter(obj => obj.short_name === short_name);
  // update requested conference
  matchingConference[0].enabled = enabled;
  // add the conference back
  await hudlHandler.updateConference(matchingConference[0]);
  // update sites
  await hudlHandler.updateConferenceSites(matchingConference[0]);

  // Kickoff event scheduler
  scheduleEvents();

  return c.html(
    <input
      hx-target="this"
      hx-swap="outerHTML"
      type="checkbox"
      checked={enabled ? true : false}
      data-enabled={enabled ? 'true' : 'false'}
      hx-put={`/providers/hudl/conferences/toggle/${short_name}`}
      hx-trigger="change"
      name="conference-enabled"
    />,
    200,
    {
      ...(enabled && {
        'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled ${short_name}"}}`,
      }),
    },
  );
});
