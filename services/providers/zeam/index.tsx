import {Hono} from 'hono';

import {db} from '@/services/database';

import {IProvider} from '@/services/shared-interfaces';
import {removeEntriesProvider, scheduleEntries} from '@/services/build-schedule';
import {zeamHandler} from '@/services/zeam-handler';

export const zeam = new Hono().basePath('/zeam');

const scheduleEvents = async () => {
  await zeamHandler.getSchedule();
  await scheduleEntries();
};

const removeEvents = async () => {
  await removeEntriesProvider('zeam');
};

zeam.put('/toggle', async c => {
  const body = await c.req.parseBody();
  const enabled = body['zeam-enabled'] === 'on';

  await db.providers.updateAsync<IProvider, any>({name: 'zeam'}, {$set: {enabled}});

  if (enabled) {
    scheduleEvents();
  } else {
    removeEvents();
  }

  return c.html(<></>, 200, {
    ...(enabled && {
      'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled Zeam"}}`,
    }),
  });
});
