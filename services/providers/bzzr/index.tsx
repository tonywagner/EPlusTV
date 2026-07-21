import {Hono} from 'hono';

import {db} from '@/services/database';

import {Login} from './views/Login';
import {BZZRBody} from './views/CardBody';

import {IProvider} from '@/services/shared-interfaces';
import {removeEntriesProvider, scheduleEntries} from '@/services/build-schedule';
import {bzzrHandler, TBZZRTokens} from '@/services/bzzr-handler';

export const bzzr = new Hono().basePath('/bzzr');

const scheduleEvents = async () => {
  await bzzrHandler.getSchedule();
  await scheduleEntries();
};

const removeEvents = async () => {
  await removeEntriesProvider('bzzr');
};

bzzr.put('/toggle', async c => {
  const body = await c.req.parseBody();
  const enabled = body['bzzr-enabled'] === 'on';

  if (!enabled) {
    await db.providers.updateAsync<IProvider<TBZZRTokens>, any>({name: 'bzzr'}, {$set: {enabled, tokens: {}}});
    removeEvents();

    return c.html(<></>);
  }

  return c.html(<Login />);
});

bzzr.post('/login', async c => {
  const body = await c.req.parseBody();
  const email = body.email as string;
  const password = body.password as string;

  const isAuthenticated = await bzzrHandler.login(email, password);

  if (!isAuthenticated) {
    return c.html(<Login invalid={true} />);
  }

  const {affectedDocuments} = await db.providers.updateAsync<IProvider<TBZZRTokens>, any>(
    {name: 'bzzr'},
    {
      $set: {
        enabled: true,
        meta: {
          password,
          email,
        },
      },
    },
    {returnUpdatedDocs: true},
  );
  const {tokens} = affectedDocuments as IProvider<TBZZRTokens>;

  // Kickoff event scheduler
  scheduleEvents();

  return c.html(<BZZRBody enabled={true} tokens={tokens} open={true} />, 200, {
    'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled BZZR"}}`,
  });
});

bzzr.put('/reauth', async c => {
  return c.html(<Login />);
});
