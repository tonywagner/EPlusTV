import moment from 'moment';

import {userAgent} from './user-agent';
import {IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {normalTimeRange} from './shared-helpers';
import axios from 'axios';

const origin = [
  'https://', 
  'zeam', 
  '.com'
].join('');
const referer = [origin, '/'].join('');

const slugify = (n: string): string => {
  return n?n.toLowerCase().replace(/ /g,"-").replace(/[^\w-]+/g,""):n;
}

const getImagePath = (n: string): string => {
  return [
    'https://',
    'd',
    '1',
    '0',
    'b',
    't',
    '0',
    '8',
    '1',
    '2',
    'q',
    'i',
    'c',
    'o',
    't',
    '.',
    'c',
    'l',
    'o',
    'u',
    'd',
    'f',
    'r',
    'o',
    'n',
    't',
    '.',
    'n',
    'e',
    't',
    '/img/',
    n?(n=n.replace(/\-/g,"").toLowerCase(),n.slice(0,2)+"/"+n.slice(2)):"",
    '/',
    '400',
    'x',
    '224',
    '.jpg',
  ].join('');
}

interface IZeamEvent {
  eventId: string;
  title: string;
  start: number;
  end: number;
  imageGuid: string;
}

const parseAirings = async (events: IZeamEvent[]) => {
  const [now, endSchedule] = normalTimeRange();

  for (const event of events) {
    if (!event || !event.eventId) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: event.eventId});

    if (!entryExists) {
      const start = moment.unix(event.start);
      const end = moment.unix(event.end).add(1, 'hours');
      const originalEnd = moment.unix(event.end);

      if (end.isBefore(now) || start.isAfter(endSchedule)) {
        continue;
      }

      console.log('Adding event: ', event.title);

      await db.entries.insertAsync<IEntry>({
        categories: [...new Set(['Zeam'])],
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'zeam',
        id: event.eventId,
        image: getImagePath(event.imageGuid),
        name: event.title,
        network: 'Zeam',
        originalEnd: originalEnd.valueOf(),
        start: start.valueOf(),
      });
    }
  }
};

class ZeamHandler {
  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'zeam'})) > 0 ? true : false;

    // First time setup
    if (!setup) {
      await db.providers.insertAsync<IProvider>({
        enabled: false,
        name: 'zeam',
      });
    }

    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'zeam'});

    if (!enabled) {
      return;
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'zeam'});

    if (!enabled) {
      return;
    }

    console.log('Looking for Zeam events...');

    try {
      const [now, endSchedule] = normalTimeRange();
      
      const url = [
        'https://',
        'zeam',
        '.com',
        '/events/',
      ].join('');

      const {data} = await axios.get(url, {
        headers: {
          'user-agent': userAgent,
          'referer': referer,
        },
      });
      
      const match = data.match(/var\s*json\s*=\s*({.*?});[\r\n]/s);
      
      const json = JSON.parse(match[1]);

      debug.saveRequestData(json, 'zeam', 'epg');

      await parseAirings(json.groups[0].liveEvents);
    } catch (e) {
      console.error(e);
      console.log('Could not parse Zeam events');
    }
  };

  public getEventData = async (id: string): Promise<TChannelPlaybackInfo> => {
    try {
      const event = await db.entries.findOneAsync<IEntry>({id});

      const {data} = await axios.get(
        [
          'https://',
          'zeam',
          '.com',
          '/api/services/',
          'watchevent',
          '?id=', 
          id,
        ].join(''), {
        headers: {
          'user-agent': userAgent,
          'referer': [referer, 'events/', id, '/', slugify(event.name)].join(''),
        },
      });

      const streamUrl = data.playlistUrl;
        
      return [streamUrl, {'user-agent': userAgent, 'origin': origin, 'referer': referer}];
    } catch (e) {
      console.error(e);
      console.log('Could not get event data');
    }
  };
}

export const zeamHandler = new ZeamHandler();
