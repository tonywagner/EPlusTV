import {Hono} from 'hono';

import {db} from '@/services/database';

import {IProvider} from '@/services/shared-interfaces';
import {removeEntriesProvider, scheduleEntries} from '@/services/build-schedule';
import {kslHandler} from '@/services/ksl-handler';

export const ksl = new Hono().basePath('/ksl');

const scheduleEvents = async () => {
  await kslHandler.getSchedule();
  await scheduleEntries();
};

const removeEvents = async () => {
  await removeEntriesProvider('ksl');
};

ksl.put('/toggle', async c => {
  const body = await c.req.parseBody();
  const enabled = body['ksl-enabled'] === 'on';

  await db.providers.updateAsync<IProvider, any>({name: 'ksl'}, {$set: {enabled}});

  if (enabled) {
    scheduleEvents();
  } else {
    removeEvents();
  }

  return c.html(<></>, 200, {
    ...(enabled && {
      'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled KSL Sports"}}`,
    }),
  });
});
