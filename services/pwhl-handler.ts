import axios from 'axios';
import moment from 'moment-timezone';

import {userAgent} from './user-agent';
import {IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {combineImages, normalTimeRange} from './shared-helpers';
import {getEventStream, getLiveEventsFromChannel, matchEvent} from './yt-dlp-helper';

const YT_CHANNEL = 'UCNKUkQV2R0JKakyE1vuC1lQ';

interface IPWHLEvent {
  awayLogo: string;
  homeLogo: string;
  title: string;
  start: Date;
  id: string;
}

const getLogo = (competitorId: string): string => {
  return ['https://', 'assets', '.leaguestat', '.com', '/pwhl', '/logos', '/50x50', '/', competitorId, '.png'].join('');
};

const parseAirings = async (events: IPWHLEvent[]) => {
  const [now, endSchedule] = normalTimeRange();

  for (const event of events) {
    if (!event || !event.id) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: event.id});

    if (!entryExists) {
      const start = moment(event.start);
      const end = moment(event.start).add(3.5, 'hours');
      const originalEnd = moment(event.start).add(2.5, 'hours');

      if (end.isBefore(now) || start.isAfter(endSchedule)) {
        continue;
      }

      console.log('Adding event: ', event.title);

      const image = await combineImages(event.homeLogo, event.awayLogo);

      await db.entries.insertAsync<IEntry>({
        categories: [...new Set(['PWHL', 'Ice Hockey', "Women's Sports"])],
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'pwhl',
        id: event.id,
        image,
        name: event.title,
        network: 'Youtube',
        originalEnd: originalEnd.valueOf(),
        sport: 'PWHL',
        start: start.valueOf(),
      });
    }
  }
};

class PWHLHandler {
  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'pwhl'})) > 0 ? true : false;

    // First time setup
    if (!setup) {
      await db.providers.insertAsync<IProvider>({
        enabled: false,
        name: 'pwhl',
      });
    }

    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'pwhl'});

    if (!enabled) {
      return;
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'pwhl'});

    if (!enabled) {
      return;
    }

    const allItems: IPWHLEvent[] = [];

    console.log('Looking for PWHL events...');

    try {
      const schedule_url = [
        'https://',
        'next-gen',
        '.sports',
        '.bellmedia',
        '.ca',
        '/v2',
        '/schedule',
        '/sports',
        '/hockey',
        '/leagues',
        '/pwhl',
        '?brand=tsn',
        '&lang=en',
        '&grouping=',
        encodeURIComponent(moment().format('YYYY-MM-DD')),
      ].join('');

      const {data: schedule_data} = await axios.get(schedule_url, {
        headers: {
          origin: 'https://www.tsn.ca',
          referer: 'https://www.tsn.ca/',
          'user-agent': userAgent,
        },
      });

      for (const game_date in schedule_data) {
        for (const game_data of schedule_data[game_date]) {
          const awayTeam = [game_data['event']['bottom']['location'], game_data['event']['bottom']['name']].join(' ');
          const homeTeam = [game_data['event']['top']['location'], game_data['event']['top']['name']].join(' ');
          const start = moment.tz(game_data['event']['dateGMT'], 'GMT');

          allItems.push({
            awayLogo: getLogo(game_data['event']['bottom']['competitorId']),
            homeLogo: getLogo(game_data['event']['top']['competitorId']),
            id: [
              'pwhl',
              start.valueOf(),
              game_data['event']['bottom']['shortName'],
              game_data['event']['top']['shortName'],
            ].join('-'),
            start: start.toDate(),
            title: `${homeTeam} vs ${awayTeam}`,
          });
        }
      }

      debug.saveRequestData(allItems, 'pwhl', 'epg');

      await parseAirings(allItems);
    } catch (e) {
      console.error(e);
      console.log('Could not parse PWHL events');
    }
  };

  public getEventData = async (id: string): Promise<TChannelPlaybackInfo> => {
    try {
      const event = await db.entries.findOneAsync<IEntry>({id});

      const channelStreams = await getLiveEventsFromChannel(YT_CHANNEL);
      const matchedEvent = matchEvent(channelStreams, event.name);

      if (!matchedEvent) {
        throw new Error('Could not get event data');
      }

      const streamUrl = await getEventStream(matchedEvent.id);

      if (streamUrl) {
        return [streamUrl, {}];
      }

      throw new Error('Could not get event data');
    } catch (e) {
      console.error(e);
      console.log('Could not get event data');
    }
  };
}

export const pwhlHandler = new PWHLHandler();
