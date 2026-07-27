import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import axios from 'axios';
import moment, {Moment} from 'moment-timezone';
import _ from 'lodash';

import {userAgent} from './user-agent';
import {configPath} from './config';
import {ClassTypeWithoutMethods, IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {normalTimeRange} from './shared-helpers';

interface IBroadcastResponse {
  documents: IBroadcastDocument[];
}

interface IBroadcastDocument {
  id: string;
  title: string;
  description: string;
  thumbnail: IMediaAsset;
  display: IBroadcastDisplay;
  pregameStart?: string;
  gameStart: string;
  gameEnd: string;
  owner: IOwner;
  status: string;
}

interface IMediaAsset {
  preview_xl: {
    url: string;
  };
}

interface IBroadcastDisplay {
  venue: string;
}

interface IOwner {
  displayName: string;
}

interface IBZZRMeta {
  email: string;
  password: string;
}

const AUTH_URL = [
  'h',
  't',
  't',
  'p',
  's',
  ':',
  '/',
  '/',
  'i',
  'd',
  'e',
  'n',
  't',
  'i',
  't',
  'y',
  't',
  'o',
  'o',
  'l',
  'k',
  'i',
  't',
  '.',
  'g',
  'o',
  'o',
  'g',
  'l',
  'e',
  'a',
  'p',
  'i',
  's',
  '.',
  'c',
  'o',
  'm',
  '/',
  'v',
  '1',
  '/'
].join('');

const API_KEY = [
  'A',
  'I',
  'z',
  'a',
  'S',
  'y',
  'A',
  '8',
  'f',
  '0',
  '-',
  'J',
  'P',
  '4',
  'g',
  'W',
  'E',
  'D',
  's',
  'N',
  'g',
  '5',
  's',
  'H',
  '7',
  'F',
  'R',
  '3',
  '9',
  'A',
  '5',
  'c',
  'h',
  'I',
  'V',
  'D',
  'y',
  'L',
  'Q'
].join('');

const APP_ID = [
  '1',
  ':',
  '3',
  '1',
  '8',
  '1',
  '7',
  '6',
  '2',
  '6',
  '0',
  '5',
  '1',
  '6',
  ':',
  'w',
  'e',
  'b',
  ':',
  '6',
  '7',
  'a',
  '6',
  '2',
  '6',
  '0',
  'c',
  '4',
  '1',
  '9',
  'b',
  'f',
  '3',
  '2',
  '7',
  '5',
  '9',
  '5',
  '1',
  '3',
  '1'
].join('');

const API_URL = [
  'h',
  't',
  't',
  'p',
  's',
  ':',
  '/',
  '/',
  'a',
  'p',
  'i',
  '.',
  'b',
  'z',
  'z',
  'r',
  '.',
  'c',
  'o',
  'm',
  '/'
].join('');

const parseAirings = async (events: IBroadcastDocument[]) => {
  const [now, endDate] = normalTimeRange();

  for (const event of events) {
    if (!event || !event.id) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: `bzzr-${event.id}`});

    if (!entryExists && ((event.status == 'scheduled') || (event.status == 'live'))) {
      const start = moment(event.gameStart);
      const end = moment(event.gameEnd).add(1, 'hours');
      const originalEnd = moment(event.gameEnd);

      if (end.isBefore(now) || start.isAfter(endDate)) {
        continue;
      }

      console.log('Adding event: ', event.title);

      await db.entries.insertAsync<IEntry>({
        categories: ['Baseball', 'MLB'],
        description: event.description + ' - ' + event.display.venue,
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'bzzr',
        id: `bzzr-${event.id}`,
        image: event.thumbnail.preview_xl.url,
        name: event.title,
        network: event.owner.displayName,
        originalEnd: originalEnd.valueOf(),
        sport: 'Baseball',
        start: start.valueOf(),
      });
    }

    if ( event.pregameStart && (event.pregameStart != event.gameStart) ) {
      const pregameEntryExists = await db.entries.findOneAsync<IEntry>({id: `bzzr-${event.id}-pregame`});

      if (!pregameEntryExists && ((event.status == 'scheduled') || (event.status == 'live'))) {
        const pregameStart = moment(event.pregameStart);
        const pregameEnd = moment(event.gameStart);
        const originalPregameEnd = moment(event.gameStart);

        if (pregameEnd.isBefore(now) || pregameStart.isAfter(endDate)) {
          continue;
        }

        const title = event.title + ' pregame show';

        console.log('Adding event: ', title);

        await db.entries.insertAsync<IEntry>({
          categories: ['Baseball', 'MLB'],
          description: event.description + ' pregame show - ' + event.display.venue,
          duration: pregameEnd.diff(pregameStart, 'seconds'),
          end: pregameEnd.valueOf(),
          from: 'bzzr',
          id: `bzzr-${event.id}-pregame`,
          image: event.thumbnail.preview_xl.url,
          name: title,
          network: event.owner.displayName,
          originalEnd: originalPregameEnd.valueOf(),
          sport: 'Baseball',
          start: pregameStart.valueOf(),
        });
      }
    }
  }
};

const bzzrConfigPath = path.join(configPath, 'bzzr_tokens.json');

class BZZRHandler {
  public access_token?: string;
  public expires_at?: number;
  public refresh_token?: string;

  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'bzzr'})) > 0 ? true : false;

    if (!setup) {
      const data: TBZZRTokens = {};

      await db.providers.insertAsync<IProvider<TBZZRTokens>>({
        enabled: false,
        name: 'bzzr',
        tokens: data,
      });
    }

    const {enabled} = await db.providers.findOneAsync<IProvider<TBZZRTokens>>({name: 'bzzr'});
bzzrConfigPath
    if (!enabled) {
      return;
    }

    await this.load();
  };

  public refreshTokens = async () => {
    const {enabled} = await db.providers.findOneAsync<IProvider<TBZZRTokens>>({name: 'bzzr'});

    if (!enabled) {
      return;
    }

    if (!this.expires_at || moment(this.expires_at).isBefore(moment().add(5, 'minutes'))) {
      await this.refreshToken();
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'bzzr'});

    if (!enabled) {
      return;
    }

    await this.refreshTokens();

    console.log('Looking for BZZR events...');

    try {
      const limit = 3;
      const broadcasts_url = [API_URL, 'scheduledBroadcasts', '/upcoming', '?limit=', limit].join('');

      const response = await axios.get<IBroadcastResponse>(broadcasts_url, {
        headers: {
          Authorization: `Bearer ${this.access_token}`,
          Origin: 'https://bzzr.com',
          Referer: 'https://bzzr.com/',
          'User-Agent': userAgent,
        },
      });

      debug.saveRequestData(response.data.documents, 'bzzr', 'epg');
      await parseAirings(response.data.documents);
    } catch (e) {
      console.error(e);
      console.log(`Could not get BZZR events`);
    }
  };

  public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
    await this.refreshTokens();

    const id = eventId.replace('bzzr-', '').replace('-pregame', '');

    try {
      const streamUrl = await this.getStream(id);

      return [streamUrl, {Origin: 'https://bzzr.com', Referer: 'https://bzzr.com/', 'User-Agent': userAgent}];
    } catch (e) {
      console.error(e);
      console.log('Could not start playback');
    }
  };

  private getStream = async (eventId: string): Promise<string> => {
    try {
      const scheduledBroadcasts_url = [API_URL, 'scheduledBroadcasts', `/${eventId}`].join('');

      const headers = {
        Authorization: `Bearer ${this.access_token}`,
        Origin: 'https://bzzr.com',
        Referer: 'https://bzzr.com/',
        'User-Agent': userAgent,
      };

      const {data: scheduledBroadcasts} = await axios.get(scheduledBroadcasts_url, {
        headers,
      });

      if ( (scheduledBroadcasts.status != 'live') || !scheduledBroadcasts.liveId ) {
        console.log('BZZR broadcast not live');
        return '';
      }

      const lives_url = [API_URL, 'lives', `/${scheduledBroadcasts.liveId}`].join('');

      const {data: lives} = await axios.get(lives_url, {
        headers,
      });

      if ( (lives.status != 'live') || !lives.mediaLivePipeline || !lives.mediaLivePipeline.mediaTailorSessionInitUrl ) {
        console.log('BZZR event not live');
        return '';
      }

      const data = {
        adsParams: {
          contentUrl: ['h', 't', 't', 'p', 's', ':', '/', '/', 'b', 'z', 'z', 'r', '.', 'c', 'o', 'm', '/', 'l', 'i', 'v', 'e', '/', 'p', 'l', 'a', 'y', 'e', 'r', '?', 'b', 'r', 'o', 'a', 'd', 'c', 'a', 's', 't', 'I', 'd', '=', eventId].join('')
        }
      };

      const {data: session} = await axios.post(lives.mediaLivePipeline.mediaTailorSessionInitUrl, data, {
        headers: {
          Origin: 'https://bzzr.com',
          Referer: 'https://bzzr.com/',
          'User-Agent': userAgent,
        },
      });

      if ( !session.manifestUrl ) {
        console.log('BZZR session not live');
        return '';
      }

      return new URL(session.manifestUrl, lives.mediaLivePipeline.mediaTailorSessionInitUrl).href;
    } catch (e) {
      console.error(e);
      console.log('Could not get stream');
    }
  };

  private getAuthClient = async (): Promise<string> => {
    const auth_client = {
      version: 2,
      heartbeats: [
        {
          agent: 'fire-core/0.13.2 fire-core-esm2017/0.13.2 fire-js/ fire-js-all-app/11.10.0 fire-auth/1.10.8 fire-auth-esm2017/1.10.8 fire-fst/4.8.0 fire-fst-esm2017/4.8.0 fire-fn/0.12.9 fire-fn-esm2017/0.12.9',
          dates: [
            moment().format('YYYY-MM-DD')
          ]
        }
      ]
    }

    return Buffer.from(JSON.stringify(auth_client), 'utf8').toString('base64url');
  };

  public login = async (email?: string, password?: string): Promise<boolean> => {
    try {
      const url = [AUTH_URL, 'a', 'c', 'c', 'o', 'u', 'n', 't', 's', ':', 's', 'i', 'g', 'n', 'I', 'n', 'W', 'i', 't', 'h', 'P', 'a', 's', 's', 'w', 'o', 'r', 'd', '?', 'k', 'e', 'y', '=', API_KEY].join('');
      const headers = {
        'Content-Type': 'application/json',
        Origin: 'https://bzzr.com',
        'User-Agent': userAgent,
        'X-Client-Version': 'Firefox/JsCore/11.10.0/FirebaseCore-web',
        'X-Firebase-gmpid': APP_ID,
        'X-Firebase-Client': await this.getAuthClient(),
      };

      const login_data = {
        returnSecureToken: true,
        email: email,
        password: password,
        clientType: 'CLIENT_TYPE_WEB',
      };

      const {data} = await axios.post(url, login_data, {
        headers,
      });

      this.access_token = data.idToken;
      this.expires_at = moment().add(data.expiresIn, 'seconds').valueOf();
      this.refresh_token = data.refreshToken;

      await this.save();

      return true;
    } catch (e) {
      console.error(e);
      console.log('Could not get access token for BZZR');
    }
  };

  private refreshToken = async (): Promise<void> => {
    try {
      const url = [AUTH_URL, 't', 'o', 'k', 'e', 'n', '?', 'k', 'e', 'y', '=', API_KEY].join('');
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://bzzr.com',
        'User-Agent': userAgent,
      };

      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refresh_token,
      });

      const {data} = await axios.post(url, params, {
        headers,
      });

      this.access_token = data.access_token;
      this.expires_at = moment().add(data.expires_in, 'seconds').valueOf();
      this.refresh_token = data.refresh_token;

      await this.save();
    } catch (e) {
      console.error(e);
      console.log('Could not refresh token for BZZR');
    }
  };

  private save = async (): Promise<void> => {
    await db.providers.updateAsync({name: 'bzzr'}, {$set: {tokens: this}});
  };

  private load = async (): Promise<void> => {
    const {tokens} = await db.providers.findOneAsync<IProvider<TBZZRTokens>>({name: 'bzzr'});
    const {access_token, expires_at, refresh_token} = tokens;

    this.access_token = access_token;
    this.expires_at = expires_at;
    this.refresh_token = refresh_token;
  };
}

export type TBZZRTokens = ClassTypeWithoutMethods<BZZRHandler>;

export const bzzrHandler = new BZZRHandler();
