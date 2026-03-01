import axios from 'axios';
import moment from 'moment';

import {userAgent} from './user-agent';
import {ClassTypeWithoutMethods, IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {hideStudio} from './misc-db-service';
import {getRandomUUID, normalTimeRange} from './shared-helpers';
import {debug} from './debug';

interface IMidcoEvent {
  cast: {
    actors: string[];
  };
  genres: string[];
  id: number;
  images: {
    poster: {
      landscape: {
        url: string;
      }[];
    };
  };
  schedule: {
    startsAt: string;
    endsAt: string;
  };
  shortDescription: string;
  title: string;
  video: {
    accessLevel: string;
    entitlementTags: string[];
  };
}

interface IMidcoMeta {
  email: string;
  password: string;
}

const ORIGIN = [
  'https://',
  'www',
  '.midcosportsplus',
  '.com',
].join('');
const REFERRER = [
  ORIGIN,
  '/',
].join('');
const BASE_API_URL = [
  REFERRER,
  'api/',
  'core/',
].join('');

const API_COLLECTION = [
  '0',
  '1',
  'E',
  'K',
  'A',
  'G',
  'Z',
  'F',
  'F',
  'M',
  '1',
  'M',
  'H',
  'X',
  'E',
  'V',
  '3',
  '7',
  'K',
  'Y',
  '8',
  'J',
  'V',
  '3',
  '1',
  '3'
].join('');

const cookieToken = (token: string): string => {
  return 'one-token=' + token + Buffer.from(token.substring(0, 24)).toString('base64');
};

const parseAirings = async (events: IMidcoEvent[]) => {
  const hide_studio = await hideStudio();

  const [now, endDate] = normalTimeRange();

  for (const event of events) {
    if (!event || !event.id) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: `midco-${event.id}`});

    if (!entryExists) {
      if ( hide_studio && event.title.toLowerCase().endsWith(' show') ) {
        continue;
      }

      const start = moment(event.schedule.startsAt);
      // endsAt is inaccurate, and startAt can be 30 minutes early
      // so we just assume 3.5-5 hour duration for all events
      const end = moment(event.schedule.startsAt).add(5, 'hours');
      const originalEnd = moment(event.schedule.startsAt).add(3.5, 'hours');

      if (end.isBefore(now) || start.isAfter(endDate)) {
        continue;
      }

      console.log('Adding event: ', event.title);

      await db.entries.insertAsync<IEntry>({
        categories: event.cast.actors,
        description: event.shortDescription,
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'midco',
        id: `midco-${event.id}`,
        image: event.images.poster.landscape[0].url,
        name: event.title,
        network: 'Midco Sports',
        originalEnd: originalEnd.valueOf(),
        sport: event.genres.join(' - '),
        start: start.valueOf(),
      });
    }
  }
};

class MidcoHandler {
  public token?: string;
  public refreshToken?: string;
  public expiration?: number;
  public entitlements?: string[];

  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'midco'})) > 0 ? true : false;

    // First time setup
    if (!setup) {
      const data: TMidcoTokens = {};

      await db.providers.insertAsync<IProvider<TMidcoTokens>>({
        enabled: false,
        name: 'midco',
        tokens: data,
      });
    }

    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'midco'});

    if (!enabled) {
      return;
    }

    // Load tokens from local file and make sure they are valid
    await this.load();
  };

  public refreshTokens = async () => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'midco'});

    if (!enabled) {
      return;
    }

    if (!this.expiration) {
      await this.login();
    }

    if (moment().isBefore(this.expiration)) {
      return;
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'midco'});

    if (!enabled) {
      return;
    }

    await this.refreshTokens();

    console.log('Looking for Midco Sports events...');

    const entries: IMidcoEvent[] = [];

    const [now, endSchedule] = normalTimeRange();

    try {
      const url = [
        BASE_API_URL,
        'catalog/',
        'collection/',
        API_COLLECTION,
        '?page=1',
        '&pageSize=100',
        '&locale=en',
      ].join('');

      const {data} = await axios.get(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Content-Type': 'application/json',
          Cookie: cookieToken(this.token),
          Referer: REFERRER,
          'User-Agent': userAgent,
        },
      });

      debug.saveRequestData(data, 'midco', 'epg');

      data.data.forEach(e => {
        if ( (e.video.accessLevel != 'ENTITLEMENT_REQUIRED') || this.entitlements.some(entitlement => e.video.entitlementTags.includes(entitlement)) ) {
          entries.push(e);
        }
      });
    } catch (e) {
      console.error(e);
      console.log('Could not parse Midco Sports events');
    }

    await parseAirings(entries);
  };

  public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
    await this.refreshTokens();

    const eventRealId = eventId.split('midco-')[1];

    const url = [
      BASE_API_URL,
      'play/',
      'item/',
      eventRealId,
      '?via=1.0.',
      API_COLLECTION,
      '&include=contentObject',
      '&locale=en',
    ].join('');

    try {
      const {data} = await axios.get(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Content-Type': 'application/json',
          Cookie: cookieToken(this.token),
          Referer: REFERRER,
          'User-Agent': userAgent,
        },
      });

      return [data.playbackInfo.videoStreams[0].url, {}];
    } catch (e) {
      console.error(e);
      console.log('Could not start playback');
    }
  };

  public login = async (email?: string, password?: string): Promise<boolean> => {
    const url = [
      BASE_API_URL,
      'auth/',
      'login',
      '?locale=en'
    ].join('');

    const device_id = getRandomUUID();

    try {
      const {meta} = await db.providers.findOneAsync<IProvider<any, IMidcoMeta>>({name: 'midco'});

      const params = {
        deviceInfo: {
          id: device_id,
          hardware: {
            manufacturer: 'UNKNOWN/UNKNOWN',
            model: 'Firefox',
            version: '148.0',
          },
          os: {
            name: 'Windows',
            version: '11',
          },
          display: {
            width: 2165,
            height: 939,
            formFactor: 'DESKTOP',
          },
          legal: {},
        },
        values: {
          email: email || meta.email,
          password: password || meta.password,
        },
      };

      const {data} = await axios.post(url, params, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Referer: REFERRER,
          'User-Agent': userAgent,
        },
      });

      this.token = data._meta.auth.token;
      this.refreshToken = data._meta.auth.refreshToken;
      this.expiration = data._meta.auth.expiration;


      const entitlements_url = [
        BASE_API_URL,
        'user/',
        'profile',
        '?locale=en'
      ].join('');

      const {data: entitlements_data} = await axios.get(entitlements_url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          Cookie: cookieToken(this.token),
          Referer: REFERRER,
          'User-Agent': userAgent,
        },
      });

      this.entitlements = entitlements_data.entitlements.grantedEntitlementTags;

      await this.save();

      return true;
    } catch (e) {
      console.error(e);
      console.log('Could not login to Midco');

      return false;
    }
  };

  private save = async (): Promise<void> => {
    await db.providers.updateAsync({name: 'midco'}, {$set: {tokens: this}});
  };

  private load = async (): Promise<void> => {
    const {tokens} = await db.providers.findOneAsync<IProvider<TMidcoTokens>>({name: 'midco'});
    const {token, refreshToken, expiration, entitlements} = tokens || {};

    this.token = token;
    this.refreshToken = refreshToken;
    this.expiration = expiration;
    this.entitlements = entitlements;
  };
}

export type TMidcoTokens = ClassTypeWithoutMethods<MidcoHandler>;

export const midcoHandler = new MidcoHandler();
