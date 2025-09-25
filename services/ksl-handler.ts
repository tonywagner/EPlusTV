import moment from 'moment';

import {userAgent} from './user-agent';
import {IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {normalTimeRange} from './shared-helpers';
import axios from 'axios';

const origin = [
  'https://',
  'kslsports.',
  'com'
].join('');
const referer = [origin, '/'].join('');

const domain = [
  'b',
  'o',
  'n',
  'n',
  'e',
  'v',
  'i',
  'l',
  'l',
  'e',
  '.',
  'd',
  'i',
  'r',
  'e',
  'c',
  't',
  'u',
  's',
  '.',
  'a',
  'p',
  'p',
].join('');

interface IKSLEvent {
  archive: boolean;
  id: string;
  thumbnail: string;
  title: string;
  StartTime: Date;
  EndTime: Date;
}

const parseAirings = async (events: IKSLEvent[]) => {
  const [now, endSchedule] = normalTimeRange();

  for (const event of events) {
    if (!event || !event.id) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: event.id});

    if (!entryExists) {
      const start = moment(event.StartTime);
      const end = moment(event.EndTime).add(1, 'hours');
      const originalEnd = moment(event.EndTime);

      if (end.isBefore(now) || start.isAfter(endSchedule)) {
        continue;
      }

      console.log('Adding event: ', event.title);

      const image = [
        'https://',
        domain,
        '/assets/', 
        event.thumbnail, 
        '?key=',
        'stream-item-thumb-jpeg'
      ].join('');

      await db.entries.insertAsync<IEntry>({
        categories: [...new Set(['KSL Sports'])],
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'ksl',
        id: event.id,
        image,
        name: event.title,
        network: 'KSL Sports',
        originalEnd: originalEnd.valueOf(),
        start: start.valueOf(),
      });
    }
  }
};

class KSLHandler {
  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'ksl'})) > 0 ? true : false;

    // First time setup
    if (!setup) {
      await db.providers.insertAsync<IProvider>({
        enabled: false,
        name: 'ksl',
      });
    }

    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'ksl'});

    if (!enabled) {
      return;
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'ksl'});

    if (!enabled) {
      return;
    }

    console.log('Looking for KSL events...');

    try {
      const [now, endSchedule] = normalTimeRange();
      
      const url = [
        'https://',
        domain,
        '/items/Streams/',
        '?filter=',
        '{%22_and%22:%20[{%22hide%22:%20{%22_neq%22:%20true}},%20{%20%22StartTime%22:%20{%22_gt%22:%20%22', 
        moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'), 
        '%22%20}},%20{%22StartTime%22:%20{%22_lt%22:%20%22', 
        moment(endSchedule).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'), 
        '%22}}]}',
        '&sort[]=',
        'StartTime'
      ].join('');

      const {data} = await axios.get<{data: IKSLEvent[]}>(url, {
        headers: {
          'user-agent': userAgent,
          'origin': origin,
          'referer': referer,
        },
      });

      debug.saveRequestData(data, 'ksl', 'epg');

      await parseAirings(data.data);
    } catch (e) {
      console.error(e);
      console.log('Could not parse KSL events');
    }
  };

  public getEventData = async (id: string): Promise<TChannelPlaybackInfo> => {
    try {
      const event = await db.entries.findOneAsync<IEntry>({id});

      const {data} = await axios.get(
        [
          'https://',
          domain,
          '/items/Streams/', 
          id, 
          '?fields=',
          'Channels.Channels_id.embedCode'
        ].join(''), {
        headers: {
          'user-agent': userAgent,
          'origin': origin,
          'referer': referer,
        },
      });

      const streamUrl = data.data.Channels[0].Channels_id.embedCode;
        
      return [streamUrl, {'user-agent': userAgent, 'origin': origin, 'referer': referer}];
    } catch (e) {
      console.error(e);
      console.log('Could not get event data');
    }
  };
}

export const kslHandler = new KSLHandler();
