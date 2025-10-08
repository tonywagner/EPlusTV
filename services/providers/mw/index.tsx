import {Hono} from 'hono';

import {db} from '@/services/database';

import {IProvider} from '@/services/shared-interfaces';
import {removeEntriesProvider, scheduleEntries} from '@/services/build-schedule';
import {mwHandler, TMWTokens} from '@/services/mw-handler';
import {MWBody} from './views/CardBody';

export const mw = new Hono().basePath('/mw');

const scheduleEvents = async () => {
  await mwHandler.getSchedule();
  await scheduleEntries();
};

const removeEvents = async () => {
  await removeEntriesProvider('mountain-west');
};

const registerUser = async () => {
  const isRegistered = await mwHandler.registerUser();
  if (isRegistered) {
    const {affectedDocuments} = await db.providers.updateAsync<IProvider, any>(
      {name: 'mw'}, 
      {$set: {enabled: true}},
      {returnUpdatedDocs: true},
    );
    const {tokens} = affectedDocuments as IProvider<TMWTokens>;
    scheduleEvents();
    return {enabled: true, tokens};
  } else {
    console.log('Failed to register Mountain West user');
    await db.providers.updateAsync<IProvider, any>({name: 'mw'}, {$set: {enabled: false}});
  }
}

mw.put('/toggle', async c => {
  const body = await c.req.parseBody();
  const enabled = body['mw-enabled'] === 'on';

  if (enabled) {
    const {enabled, tokens} = await registerUser();

    return c.html(<MWBody enabled={true} tokens={tokens} open={true} />, 200, {
      ...(enabled && {
        'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled Mountain West"}}`,
      }),
    });
  } else {
    await db.providers.updateAsync<IProvider, any>({name: 'mw'}, {$set: {enabled, tokens: {}}});
    removeEvents();

    return c.html(<MWBody enabled={false} open={false} />, 200, {
      ...(enabled && {
        'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully disabled Mountain West"}}`,
      }),
    });
  }
});

mw.put('/register', async c => {
  const {enabled, tokens} = await registerUser();

  return c.html(<MWBody enabled={true} tokens={tokens} open={true} />, 200, {
    ...(enabled && {
      'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully registered Mountain West"}}`,
    }),
  });
});