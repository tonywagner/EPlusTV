import {Hono} from 'hono';

import {db} from '@/services/database';

import {Login} from './views/Login';
import {MidcoBody} from './views/CardBody';

import {IProvider} from '@/services/shared-interfaces';
import {removeEntriesProvider, scheduleEntries} from '@/services/build-schedule';
import {midcoHandler, TMidcoTokens} from '@/services/midco-handler';

export const midco = new Hono().basePath('/midco');

const scheduleEvents = async () => {
  await midcoHandler.getSchedule();
  await scheduleEntries();
};

const removeEvents = async () => {
  await removeEntriesProvider('midco');
};

midco.put('/toggle', async c => {
  const body = await c.req.parseBody();
  const enabled = body['midco-enabled'] === 'on';

  if (!enabled) {
    await db.providers.updateAsync<IProvider<TMidcoTokens>, any>({name: 'midco'}, {$set: {enabled, tokens: {}}});
    removeEvents();

    return c.html(<></>);
  }

  return c.html(<Login />);
});

midco.post('/login', async c => {
  const body = await c.req.parseBody();
  const email = body.email as string;
  const password = body.password as string;

  const isAuthenticated = await midcoHandler.login(email, password);

  if (!isAuthenticated) {
    return c.html(<Login invalid={true} />);
  }

  const {affectedDocuments} = await db.providers.updateAsync<IProvider<TMidcoTokens>, any>(
    {name: 'midco'},
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
  const {tokens} = affectedDocuments as IProvider<TMidcoTokens>;

  // Kickoff event scheduler
  scheduleEvents();

  return c.html(<MidcoBody enabled={true} tokens={tokens} open={true} />, 200, {
    'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled Midco Sports Plus"}}`,
  });
});

midco.put('/reauth', async c => {
  return c.html(<Login />);
});
