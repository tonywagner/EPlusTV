import {db} from './database';
import {espnHandler} from './espn-handler';
import {foxHandler} from './fox-handler';
import {foxOneHandler} from './foxone-handler';
import {mlbHandler} from './mlb-handler';
import {paramountHandler} from './paramount-handler';
import {b1gHandler} from './b1g-handler';
import {floSportsHandler} from './flo-handler';
import {nflHandler} from './nfl-handler';
import {mwHandler} from './mw-handler';
import {hudlHandler} from './hudl-handler';
import {cbsHandler} from './cbs-handler';
import {IEntry, THeaderInfo} from './shared-interfaces';
import {PlaylistHandler} from './playlist-handler';
import {appStatus} from './app-status';
import {removeChannelStatus} from './shared-helpers';
import {calculateChannelNumber} from './channels';
import {gothamHandler} from './gotham-handler';
import {wsnHandler} from './wsn-handler';
import {pwhlHandler} from './pwhl-handler';
import {ballyHandler} from './bally-handler';
import {lovbHandler} from './lovb-handler';
import {nhlHandler} from './nhltv-handler';
import {victoryHandler} from './victory-handler';
import {kboHandler} from './kbo-handler';
import {kslHandler} from './ksl-handler';
import {zeamHandler} from './zeam-handler';
import {nwslHandler} from './nwsl-handler';
import {outsideHandler} from './outside-handler';
import {wnbaHandler} from './wnba-handler';

const checkingStream = {};

const startChannelStream = async (channelId: string, appUrl: string) => {
  if (appStatus.channels[channelId].player || checkingStream[channelId]) {
    return;
  }

  checkingStream[channelId] = true;

  let url: string;
  let headers: THeaderInfo;

  const playingNow = await db.entries.findOneAsync<IEntry>({
    id: appStatus.channels[channelId].current,
  });

  if (playingNow) {
    try {
      switch (playingNow.from) {
        case 'foxsports':
          [url, headers] = await foxHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'foxone':
          [url, headers] = await foxOneHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'mlbtv':
          [url, headers] = await mlbHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'paramount+':
          [url, headers] = await paramountHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'gotham':
          [url, headers] = await gothamHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'b1g+':
          [url, headers] = await b1gHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'flo':
          [url, headers] = await floSportsHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'nfl+':
          [url, headers] = await nflHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'mountain-west':
          [url, headers] = await mwHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'wsn':
          [url, headers] = await wsnHandler.getEventData();
          break;
        case 'nhl':
          [url, headers] = await nhlHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'victory':
          [url, headers] = await victoryHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'pwhl':
          [url, headers] = await pwhlHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'nwsl':
          [url, headers] = await nwslHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'lovb':
          [url, headers] = await lovbHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'bally':
          [url, headers] = await ballyHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'hudl':
          [url, headers] = await hudlHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'cbssports':
          [url, headers] = await cbsHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'kbo':
          [url, headers] = await kboHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'ksl':
          [url, headers] = await kslHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'zeam':
          [url, headers] = await zeamHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'outside':
          [url, headers] = await outsideHandler.getEventData(appStatus.channels[channelId].current);
          break;
        case 'wnba':
          [url, headers] = await wnbaHandler.getEventData(appStatus.channels[channelId].current);
        default:
          [url, headers] = await espnHandler.getEventData(appStatus.channels[channelId].current);
      }
    } catch (e) {}

    if (!url) {
      console.log('Failed to parse the stream');

      // Reset channel state
      removeChannelStatus(channelId);
    } else {
      appStatus.channels[channelId].player = new PlaylistHandler(
        headers,
        appUrl,
        channelId,
        playingNow.from,
        appStatus.channels[channelId].current,
      );

      try {
        await appStatus.channels[channelId].player.initialize(url);
        await checkNextStream(channelId);
      } catch (e) {
        // Reset channel state
        removeChannelStatus(channelId);
      }
    }
  }

  checkingStream[channelId] = false;
};

export const launchChannel = async (channelId: string, appUrl: string): Promise<void> => {
  const channelNum = await calculateChannelNumber(channelId);
  const isNumber = Number.isFinite(parseInt(`${channelNum}`, 10));

  if (appStatus.channels[channelId].player || checkingStream[channelId]) {
    return;
  }

  const now = new Date().valueOf();
  const channel = isNumber ? parseInt(`${channelNum}`, 10) : channelNum;

  // Find the entry with the most recent start time (if there are overlapping)
  const playingNow = await db.entries
    .findOneAsync<IEntry>({
      channel,
      end: {$gt: now},
      start: {$lt: now},
    })
    .sort({start: -1});

  if (playingNow && playingNow.id) {
    console.log(`Channel #${channelId} has an active event (${playingNow.name}). Going to start the stream.`);
    appStatus.channels[channelId].current = playingNow.id;
    await startChannelStream(channelId, appUrl);
  } else {
    // Reset channel state
    removeChannelStatus(channelId);
  }
};

export const checkNextStream = async (channelId: string): Promise<void> => {
  if (appStatus.channels[channelId].heartbeatTimer) {
    return;
  }

  const now = new Date().valueOf();

  const channel = parseInt(channelId, 10);
  const entries = await db.entries.findAsync<IEntry>({channel, start: {$gt: now}}).sort({start: 1});

  if (entries && entries.length > 0) {
    const diff = entries[0].start - now;

    appStatus.channels[channelId].heartbeatTimer = setTimeout(() => {
      console.log(`Channel #${channelId} is scheduled to finish. Removing playlist info.`);
      removeChannelStatus(channelId);
    }, diff);
  }
};
