import {Hono} from 'hono';

import {db} from '@/services/database';

import {Login} from './views/Login';
import {IProvider} from '@/services/shared-interfaces';
import {removeEntriesProvider, scheduleEntries} from '@/services/build-schedule';
import {foxOneHandler, TFoxOneTokens} from '@/services/foxone-handler';
import {FoxOneBody} from './views/CardBody';

export const foxone = new Hono().basePath('/foxone');

const scheduleEvents = async () => {
  await foxOneHandler.getSchedule();
  await scheduleEntries();
};

const removeEvents = async () => {
  await removeEntriesProvider('foxone');
};

const removeAndSchedule = async () => {
  await removeEvents();
  await scheduleEvents();
};

foxone.put('/toggle', async c => {
  const body = await c.req.parseBody();
  const enabled = body['foxone-enabled'] === 'on';

  if (!enabled) {
    await db.providers.updateAsync<IProvider, any>({name: 'foxone'}, {$set: {enabled, tokens: {}}});
    removeEvents();

    return c.html(<></>);
  }

  return c.html(<Login />);
});

foxone.put('/toggle-4k-only', async c => {
  const body = await c.req.parseBody();
  const only4k = body['foxone-enabled-4k-only'] === 'on';

  const {meta} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});

  const {affectedDocuments} = await db.providers.updateAsync<IProvider<TFoxOneTokens>, any>(
    {name: 'foxone'},
    {
      $set: {
        meta: {
          ...meta,
          only4k,
        },
      },
    },
    {
      returnUpdatedDocs: true,
    },
  );
  const {enabled, tokens, linear_channels} = affectedDocuments as IProvider<TFoxOneTokens>;

  removeAndSchedule();

  return c.html(<FoxOneBody enabled={enabled} tokens={tokens} channels={linear_channels} />);
});

foxone.put('/toggle-uhd', async c => {
  const body = await c.req.parseBody();
  const uhd = body['foxone-enabled-uhd'] === 'on';

  const {meta} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});

  const {affectedDocuments} = await db.providers.updateAsync<IProvider<TFoxOneTokens>, any>(
    {name: 'foxone'},
    {
      $set: {
        meta: {
          ...meta,
          uhd,
        },
      },
    },
    {
      returnUpdatedDocs: true,
    },
  );
  const {enabled, tokens, linear_channels} = affectedDocuments as IProvider<TFoxOneTokens>;

  return c.html(<FoxOneBody enabled={enabled} tokens={tokens} channels={linear_channels} />);
});

foxone.put('/toggle-studio', async c => {
  const body = await c.req.parseBody();
  const hide_studio = body['foxone-hide-studio'] === 'on';

  const {meta} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});

  const {affectedDocuments} = await db.providers.updateAsync<IProvider<TFoxOneTokens>, any>(
    {name: 'foxone'},
    {
      $set: {
        meta: {
          ...meta,
          hide_studio,
        },
      },
    },
    {
      returnUpdatedDocs: true,
    },
  );
  const {enabled, tokens, linear_channels} = affectedDocuments as IProvider<TFoxOneTokens>;

  return c.html(<FoxOneBody enabled={enabled} tokens={tokens} channels={linear_channels} />);
});

foxone.get('/tve-login/:code', async c => {
  const code = c.req.param('code');

  const isAuthenticated = await foxOneHandler.authenticateRegCode(false);

  if (!isAuthenticated) {
    return c.html(<Login code={code} />);
  }

  // Trigger a refresh of tokens straight away
  await foxOneHandler.authenticateRegCode(false);

  const {affectedDocuments} = await db.providers.updateAsync<IProvider<TFoxOneTokens>, any>(
    {name: 'foxone'},
    {$set: {enabled: true}},
    {returnUpdatedDocs: true},
  );
  const {tokens, linear_channels} = affectedDocuments as IProvider<TFoxOneTokens>;

  // Kickoff event scheduler
  scheduleEvents();

  return c.html(<FoxOneBody enabled={true} tokens={tokens} open={true} channels={linear_channels} />, 200, {
    'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully enabled Fox One"}}`,
  });
});

foxone.put('/reauth', async c => {
  return c.html(<Login />);
});