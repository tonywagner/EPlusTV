import axios from 'axios';
import moment from 'moment';

import {userAgent} from './user-agent';
import {ClassTypeWithoutMethods, IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {hideStudio} from './misc-db-service';
import {combineImages, normalTimeRange} from './shared-helpers';
import {debug} from './debug';

interface IParticipant {
  id: number;
  images: string | null;
}

interface IMidcoEvent {
  caption: string;
  duration: number;
  event_utc_ts: number;
  home_team_id: number;
  id: number;
  participants: IParticipant[];
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
  'h',
  't',
  't',
  'p',
  's',
  ':',
  '/',
  '/',
  'm',
  's',
  'p',
  '-',
  'p',
  'r',
  'd',
  '-',
  'e',
  'r',
  'c',
  '5',
  'c',
  'y',
  'c',
  'c',
  'c',
  '8',
  'b',
  'c',
  'd',
  '5',
  'a',
  'z',
  '.',
  'a',
  '0',
  '3',
  '.',
  'a',
  'z',
  'u',
  'r',
  'e',
  'f',
  'd',
  '.',
  'n',
  'e',
  't',
  '/',
  'a',
  'p',
  'i',
  '/'
].join('');

const CHANNEL_KEY = [
  'J',
  'D',
  'J',
  '5',
  'J',
  'D',
  'E',
  'w',
  'J',
  'E',
  'x',
  'K',
  'R',
  'l',
  'F',
  'N',
  'b',
  'W',
  'M',
  '4',
  'N',
  'W',
  't',
  'U',
  'V',
  'm',
  '9',
  'L',
  'M',
  '0',
  'N',
  'G',
  'U',
  'V',
  'p',
  'E',
  'd',
  'E',
  '8',
  'z',
  'M',
  'k',
  't',
  'k',
  'a',
  '2',
  'V',
  'x',
  'Z',
  'F',
  'J',
  'M',
  'R',
  'E',
  'J',
  'v',
  'W',
  'H',
  'h',
  'o',
  'b',
  'V',
  'V',
  'x',
  'W',
  'j',
  'B',
  'M',
  'Z',
  'H',
  'B',
  'S',
  'a',
  'j',
  'J',
  'O',
  'e',
  'l',
  'l',
  'l',
].join('');

const FALLBACK_IMAGE = [
  'h',
  't',
  't',
  'p',
  's',
  ':',
  '/',
  '/',
  'e',
  'n',
  'c',
  'r',
  'y',
  'p',
  't',
  'e',
  'd',
  '-',
  't',
  'b',
  'n',
  '0',
  '.',
  'g',
  's',
  't',
  'a',
  't',
  'i',
  'c',
  '.',
  'c',
  'o',
  'm',
  '/',
  'i',
  'm',
  'a',
  'g',
  'e',
  's',
  '?',
  'q',
  '=',
  't',
  'b',
  'n',
  ':',
  'A',
  'N',
  'd',
  '9',
  'G',
  'c',
  'R',
  'w',
  '9',
  't',
  'C',
  '9',
  'L',
  '9',
  'A',
  'M',
  'i',
  'm',
  'Z',
  '2',
  '1',
  'G',
  'N',
  'b',
  'I',
  'C',
  'O',
  'c',
  '_',
  'M',
  'C',
  '7',
  't',
  'z',
  'j',
  'H',
  '3',
  'U',
  'M',
  'u',
  '0',
  'q',
  'D',
  'J',
  'G',
  'm',
  '7',
  'T',
  '3',
  'w',
  '&',
  's',
  '=',
  '1',
  '0',
].join('');

const parseAirings = async (events: IMidcoEvent[]) => {
  const hide_studio = await hideStudio();

  for (const event of events) {
    if (!event || !event.id) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: `midco-${event.id}`});

    if (!entryExists) {
      const start = moment(event.event_utc_ts * 1000);
      const end = moment(event.event_utc_ts * 1000).add((event.duration + 90), 'minutes');
      const originalEnd = moment(event.event_utc_ts * 1000).add(event.duration, 'minutes');

      console.log('Adding event: ', event.caption);

      let name = '';
      const description = event.caption.trim();
      let categories: string[] = [];
      let sport = '';

      const pipeCount = (event.caption.match(/\|/g) || []).length;
      let matchedFormat = false;
      let firstPart = '';
      let secondPart = '';

      if (pipeCount >= 2) {
        // Standard format: "Sport | Matchup | Metadata"
        const [extractedFirst, extractedSecond, ...rest] = event.caption.split('|');
        firstPart = extractedFirst.trim();
        secondPart = (extractedSecond || '').trim();

        name = secondPart ? `${firstPart} - ${secondPart}` : firstPart;
        matchedFormat = true;
      } else if (event.caption.includes('-')) {
        // Alternative format: "Sport - Matchup | Metadata"
        const [extractedFirst, ...rest] = event.caption.split('-');
        firstPart = extractedFirst.trim();

        const remainingText = rest.join('-').trim();
        const [matchup, ...metaRest] = remainingText.split('|');
        secondPart = matchup.trim();

        name = secondPart ? `${firstPart} - ${secondPart}` : firstPart;
        matchedFormat = true;
      } else {
        // Fallback if neither delimiter pattern fits
        name = description;
      }

      // Extract sport and categories if a valid delimiter pattern was matched
      if (matchedFormat) {
        sport = firstPart;

        const words = firstPart.split(/\s+/);
        const lastWord = words[words.length - 1];

        // If the extracted first part ends with "Show"
        if (lastWord.toLowerCase() === 'show') {
          if ( hide_studio ) {
            continue;
          }
          sport = words[0]; // First word becomes sport (e.g., "Football")
          name = secondPart ? `${sport} - ${secondPart}` : event.caption.trim();
        }

        categories = [firstPart, sport];
      }

      const homeTeam = event.participants.find(
        (participant: any) => participant.id === event.home_team_id
      );
      const awayTeam = event.participants.find(
        (participant: any) => participant.id !== event.home_team_id
      );
      const homeTeamImageUrl = homeTeam?.images ?? null;
      const awayTeamImageUrl = awayTeam?.images ?? null;
      let image: string;
      if (homeTeamImageUrl && awayTeamImageUrl) {
        image = await combineImages(awayTeamImageUrl, homeTeamImageUrl);
      } else {
        image = homeTeamImageUrl || awayTeamImageUrl || FALLBACK_IMAGE;
      }

      await db.entries.insertAsync<IEntry>({
        categories,
        description,
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'midco',
        id: `midco-${event.id}`,
        image,
        name,
        network: 'Midco Sports',
        originalEnd: originalEnd.valueOf(),
        sport,
        start: start.valueOf(),
      });
    }
  }
};

class MidcoHandler {
  public api_key?: string;

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

  private fetchEvents = async (streamStatus: string, limit: number, offset: number, retryCount = 0): Promise<any> => {
    try {
      if (retryCount >= 2) {
        console.error('Failed to refresh Midco Sports key');
      }

      const response = await axios.get(BASE_API_URL + 'events', {
        params: {
          'stream_status[]': streamStatus,
          limit,
          offset,
          sort_direction: 'asc',
          api_key: this.api_key,
        },
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Content-Type': 'application/json',
          'Origin': ORIGIN,
          'User-Agent': userAgent,
        },
      });

      if (response.data?.error?.errors?.api_key === 'Key not valid') {
        console.log('refreshing Midco Sports key');
        await this.login();
        return this.fetchEvents(streamStatus, limit, offset, retryCount + 1);
      }

      return response.data?.data ?? [];
    } catch (e) {
      console.error(e);
      console.log('Could not fetch Midco Sports events');
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'midco'});

    if (!enabled) {
      return;
    }

    console.log('Looking for Midco Sports events...');

    const entries: IMidcoEvent[] = [];

    const [now, endSchedule] = normalTimeRange();

    try {
      let streamStatus = 'live';
      let offset = 0;
      const limit = 12;

      while (true) {
        const events = await this.fetchEvents(streamStatus, limit, offset);

        if ((!events || events.length === 0) && streamStatus === 'live') {
          streamStatus = 'upcoming';
          offset = 0;
          continue;
        }

        if (!events || events.length === 0) {
          break;
        }

        let reachedEndSchedule = false;

        for (const event of events) {
          if (moment(event.event_utc_ts * 1000).isAfter(endSchedule)) {
            reachedEndSchedule = true;
            break;
          }
          if (!event.has_access) {
            continue;
          }
          entries.push(event);
        }

        if (reachedEndSchedule) {
          break;
        }

        offset += limit;
      };
    } catch (e) {
      console.error(e);
      console.log('Could not parse Midco Sports events');
    }

    await parseAirings(entries);
  };

  private fetchEvent = async (eventId: string, retryCount = 0): Promise<any> => {
    try {
      if (retryCount >= 2) {
        console.error('Failed to refresh Midco Sports key');
      }

      const response = await axios.get(BASE_API_URL + `events/${eventId}`, {
        params: {
          api_key: this.api_key,
        },
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Content-Type': 'application/json',
          'Origin': ORIGIN,
          'User-Agent': userAgent,
        },
      });

      if (response.data?.error?.errors?.api_key === 'Key not valid') {
        console.log('refreshing Midco Sports key');
        await this.login();
        return this.fetchEvent(eventId, retryCount + 1);
      }

      return response.data?.data ?? [];
    } catch (e) {
      console.error(e);
      console.log('Could not fetch Midco Sports event');
    }
  };

  public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
    try {
      const eventRealId = eventId.split('midco-')[1];

      const eventData = await this.fetchEvent(eventRealId);

      const streamMedia = eventData.media?.find(
        (item: any) =>
          typeof item.media_url === 'string' &&
          /\.m3u8(\?|$)/i.test(item.media_url)
      );

      return [streamMedia?.media_url ?? null, {'Origin': ORIGIN, 'User-Agent': userAgent}];
    } catch (e) {
      console.error(e);
      console.log('Could not start playback');
    }
  };

  public login = async (email?: string, password?: string): Promise<boolean> => {
    try {
      const apiKeyUrl = BASE_API_URL + 'get_api_key';
      const payload = {
        channel_key: 'JDJ5JDEwJExKRlFNbWM4NWtUVm9LM0NGUVpEdE8zMktka2VxZFJMREJvWHhobVVxWjBMZHBSajJOelll'
      };
      const { data: apiKeyData } = await axios.post(apiKeyUrl, payload, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Content-Type': 'application/json',
          'Origin': ORIGIN,
          'User-Agent': userAgent,
        },
      });
      this.api_key = apiKeyData.data.api_key;

      const loginUrl = BASE_API_URL + 'v2/auth/login';
      const loginPayload = {
        email,
        password,
        api_key: this.api_key,
      };
      await axios.post(loginUrl, loginPayload, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Content-Type': 'application/json',
          'Origin': ORIGIN,
          'User-Agent': userAgent,
        },
      });

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
    const {api_key} = tokens || {};

    this.api_key = api_key;
  };
}

export type TMidcoTokens = ClassTypeWithoutMethods<MidcoHandler>;

export const midcoHandler = new MidcoHandler();
