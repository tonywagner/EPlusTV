import axios from 'axios';
import _ from 'lodash';
import moment from 'moment';

import {okHttpUserAgent} from './user-agent';
import {useMountainWest} from './networks';
import {ClassTypeWithoutMethods, IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {normalTimeRange, generateRandom} from './shared-helpers';

interface IMWCategory {
  name: string;
}

interface IMWEvent {
  image: {
    image: string;
  };
  title: string;
  start_date: string;
  start_time: string
  end_date: string;
  end_time: string;
  video?: {
    data?: {
      url?: string;
    };
  };
  sport_categories: IMWCategory[];
  id: string;
  post_format: string;
}

const time_zone = 'America/Denver';

const parseAirings = async (events: IMWEvent[]) => {
  const [now, endSchedule] = normalTimeRange();

  for (const event of events) {
    if (!event || !event.id) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: `mw-${event.id}`});

    if (!entryExists) {
      const start = moment.tz([event.start_date, event.start_time].join(' '), time_zone);
      const end = moment.tz([event.end_date, event.end_time].join(' '), time_zone).add(1, 'hours');
      const originalEnd = moment.tz([event.end_date, event.end_time].join(' '), time_zone);

      if (end.isBefore(now) || event.post_format !== 'video' || start.isAfter(endSchedule)) {
        continue;
      }

      console.log('Adding event: ', event.title);

      await db.entries.insertAsync<IEntry>({
        categories: [...new Set(['Mountain West', 'The MW', event.sport_categories[0].name])],
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'mountain-west',
        id: `mw-${event.id}`,
        image: event.image.image,
        name: event.title,
        network: 'MW',
        originalEnd: originalEnd.valueOf(),
        sport: event.sport_categories[0].name,
        start: start.valueOf(),
        url: event.video.data.url,
      });
    }
  }
};

class MountainWestHandler {
  public user?: string;
  public token?: string;
  
  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'mw'})) > 0 ? true : false;

    // First time setup
    if (!setup) {
      const data: TMWTokens = {};
      
      await db.providers.insertAsync<IProvider<TMWTokens>>({
        enabled: useMountainWest,
        name: 'mw',
        tokens: data,
      });
    }

    if (useMountainWest) {
      console.log('Using MTNWEST variable is no longer needed. Please use the UI going forward');
    }

    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'mw'});

    if (!enabled) {
      return;
    }

    // Load tokens from local file and make sure they are valid
    await this.load();
    
    // Register user if token doesn't exist
    if (!this.token) {
      await this.registerUser();
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'mw'});

    if (!enabled) {
      return;
    }

    console.log('Looking for Mountain West events...');
    
    const events: IMWEvent[] = [];
      
    const mountain_time = moment.tz(time_zone).format('YYYY-MM-DD HH:mm:ss');

    const [now, inTwoDays] = normalTimeRange();

    try {
      let pages = 1;

      for (let page = 1; page <= pages; page++) {
        const url = [
          'https://',
          'mobile.',
          'themw.',
          'wmt.',
          'digital',
          '/api/tv/',
          'videos',
          '?order_by%5Bfield%5D=start_date_time',
          '&order_by%5Bordering%5D=asc',
          '&page=',
          page,
          '&per_page=25',
          '&end_after=',
          encodeURIComponent(mountain_time),
        ].join('');
        
        const {data} = await axios.get(url, {
          headers: {
             authorization: `Bearer ${this.token}`,
            'user-agent': okHttpUserAgent,
          },
        });
        
        debug.saveRequestData(data, 'mtnwest', 'epg');
        
        pages = data.meta.pagination.total_pages;

        _.forEach(data.data, m => {
          let event_start = moment.tz([m.start_date, m.start_time].join(' '), 'America/Denver');
          if ( event_start <= inTwoDays ) {
            events.push(m);
          } else {
            pages = page;
          }
        });
      }

      await parseAirings(events);
    } catch (e) {
      console.error(e);
      console.log('Could not parse Mountain West events');
    }
  };

  public getEventData = async (id: string): Promise<TChannelPlaybackInfo> => {
    try {
      const event = await db.entries.findOneAsync<IEntry>({id});

      if (event) {
        return [event.url, {}];
      }
    } catch (e) {
      console.error(e);
      console.log('Could not get event data');
    }
  };

  public registerUser = async (): Promise<boolean> => {
    const url = [
      'https://',
      'mobile.',
      'themw.',
      'wmt.',
      'digital',
      '/api',
      '/tv',
      '/auth',
      '/register',
     ].join('');

    console.log('Registering user for Mountain West...');
    try {
      const randomId = generateRandom(18);
      
      const {data} = await axios.post(
        url,
        {
          email: [randomId, '@domain.com'].join(''),
          name: randomId,
          password: randomId, 
          password_confirmation: randomId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': okHttpUserAgent,
          },
        },
      );

      if (!data || !data?.token) {
        return false;
      }

      this.user = randomId;
      this.token = data.token;

      await this.save();

      return true;
    } catch (e) {
      return false;
    }
  };

  private save = async (): Promise<void> => {
    await db.providers.updateAsync({name: 'mw'}, {$set: {tokens: this}});
  };

  private load = async (): Promise<void> => {
    const {tokens} = await db.providers.findOneAsync<IProvider<TMWTokens>>({name: 'mw'});
    const {user, token} = tokens || {};

    this.user = user;
    this.token = token;
  };
}

export type TMWTokens = ClassTypeWithoutMethods<MountainWestHandler>;

export const mwHandler = new MountainWestHandler();
