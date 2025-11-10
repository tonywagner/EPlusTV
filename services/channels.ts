import _ from 'lodash';

import {foxOneHandler} from './foxone-handler';
import {db} from './database';
import {IProvider} from './shared-interfaces';
import {getLinearStartChannel, usesLinear} from './misc-db-service';
import {gothamHandler} from './gotham-handler';

async function startApp() {
  await foxOneHandler.initialize(); // Ensures stationMap is populated
}

export const checkChannelEnabled = async (provider: string, channelId: string): Promise<boolean> => {
  const {enabled, linear_channels} = await db.providers.findOneAsync<IProvider>({name: provider});

  if (!enabled || !linear_channels || !linear_channels.length) {
    return false;
  }

  const network = linear_channels.find(c => c.id === channelId);

  return network?.enabled;
};

// Function to get dynamic stationId and callSign from foxOneHandler
const getFoxOneChannelData = async () => {

  const stationMap = await foxOneHandler.getStationMap();

  //console.log('getFoxOneChannelData Station Map:    ', stationMap)
  // Check if stationMap is empty or missing required keys
  // if (!stationMap['FOX'] || !stationMap['MNTV']) {
  //   await foxOneHandler.getEvents(); // Populate stationMap if empty
  // }

  return {
    foxStationId: stationMap['FOX']?.stationId,
    foxCallSign: stationMap['FOX']?.callSign,
    mnStationId: stationMap['MNTV']?.stationId,
    mnCallSign: stationMap['MNTV']?.callSign,
  };
};

/* eslint-disable sort-keys-custom-order-fix/sort-keys-custom-order-fix */
export const CHANNELS = {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  get MAP() {
    return {
      0: {
        checkChannelEnabled: () => checkChannelEnabled('espn', 'espn1'),
        id: 'espn1',
        logo: 'https://tmsimg.fancybits.co/assets/s32645_h3_aa.png?w=360&h=270',
        name: 'ESPN',
        stationId: '32645',
        tvgName: 'ESPNHD',
        provider: 'espn',
      },
      1: {
        checkChannelEnabled: () => checkChannelEnabled('espn', 'espn2'),
        id: 'espn2',
        logo: 'https://tmsimg.fancybits.co/assets/s45507_ll_h15_aa.png?w=360&h=270',
        name: 'ESPN2',
        stationId: '45507',
        tvgName: 'ESPN2HD',
        provider: 'espn',
      },
      2: {
        checkChannelEnabled: () => checkChannelEnabled('espn', 'espnu'),
        id: 'espnu',
        logo: 'https://tmsimg.fancybits.co/assets/s60696_ll_h15_aa.png?w=360&h=270',
        name: 'ESPNU',
        stationId: '60696',
        tvgName: 'ESPNUHD',
        provider: 'espn',
      },
      3: {
        checkChannelEnabled: () => checkChannelEnabled('espn', 'sec'),
        id: 'sec',
        logo: 'https://tmsimg.fancybits.co/assets/s89714_ll_h15_aa.png?w=360&h=270',
        name: 'SEC Network',
        stationId: '89714',
        tvgName: 'SECH',
        provider: 'espn',
      },
      4: {
        checkChannelEnabled: () => checkChannelEnabled('espn', 'acc'),
        id: 'acc',
        logo: 'https://tmsimg.fancybits.co/assets/s111871_ll_h15_ac.png?w=360&h=270',
        name: 'ACC Network',
        stationId: '111871',
        tvgName: 'ACC',
        provider: 'espn',
      },
      5: {
        checkChannelEnabled: () => checkChannelEnabled('espn', 'espnews'),
        id: 'espnews',
        logo: 'https://tmsimg.fancybits.co/assets/s59976_ll_h15_aa.png?w=360&h=270',
        name: 'ESPNews',
        stationId: '59976',
        tvgName: 'ESPNWHD',
        provider: 'espn',
      },
      6: {
        checkChannelEnabled: () => checkChannelEnabled('espn', 'espndeportes'),
        id: 'espndeportes',
        logo: 'https://tmsimg.fancybits.co/assets/s71914_ll_h15_aa.png?w=360&h=270',
        name: 'ESPN Deportes',
        stationId: '71914',
        tvgName: 'ESPNDHD',
      },
      10: {
        checkChannelEnabled: () => checkChannelEnabled('foxsports', 'fs1'),
        id: 'fs1',
        logo: 'https://tmsimg.fancybits.co/assets/s82547_ll_h15_aa.png?w=360&h=270',
        name: 'FS1',
        stationId: '82547',
        tvgName: 'FS1HD',
        provider: 'foxsports',
      },
      11: {
        checkChannelEnabled: () => checkChannelEnabled('foxsports', 'fs2'),
        id: 'fs2',
        logo: 'https://tmsimg.fancybits.co/assets/s59305_ll_h15_aa.png?w=360&h=270',
        name: 'FS2',
        stationId: '59305',
        tvgName: 'FS2HD',
        provider: 'foxsports',
      },
      12: {
        checkChannelEnabled: () => checkChannelEnabled('foxsports', 'btn'),
        id: 'btn',
        logo: 'https://tmsimg.fancybits.co/assets/s58321_ll_h15_ac.png?w=360&h=270',
        name: 'B1G Network',
        stationId: '58321',
        tvgName: 'BIG10HD',
        provider: 'foxsports',
      },
      13: {
        checkChannelEnabled: () => checkChannelEnabled('foxsports', 'fox-soccer-plus'),
        id: 'fox-soccer-plus',
        logo: 'https://tmsimg.fancybits.co/assets/s66880_ll_h15_aa.png?w=360&h=270',
        name: 'FOX Soccer Plus',
        stationId: '66880',
        tvgName: 'FSCPLHD',
        provider: 'foxsports',
      },
      14: {
        checkChannelEnabled: () => checkChannelEnabled('foxsports', 'foxdep'),
        id: 'foxdep',
        logo: 'https://tmsimg.fancybits.co/assets/s15377_ll_h15_aa.png?w=360&h=270',
        name: 'FOX Deportes',
        stationId: '72189',
        tvgName: 'FXDEPHD',
        provider: 'foxsports',
      },
      20: {
        checkChannelEnabled: () => checkChannelEnabled('paramount', 'cbssportshq'),
        id: 'cbssportshq',
        logo: 'https://tmsimg.fancybits.co/assets/s108919_ll_h15_aa.png?w=360&h=270',
        name: 'CBS Sports HQ',
        stationId: '108919',
        tvgName: 'CBSSPHQ',
        provider: 'paramount',
      },
      21: {
        checkChannelEnabled: () => checkChannelEnabled('paramount', 'golazo'),
        id: 'golazo',
        logo: 'https://tmsimg.fancybits.co/assets/s133691_ll_h15_aa.png?w=360&h=270',
        name: 'GOLAZO Network',
        stationId: '133691',
        tvgName: 'GOLAZO',
        provider: 'paramount',
      },
      30: {
        checkChannelEnabled: () => checkChannelEnabled('nfl', 'NFLNETWORK'),
        id: 'NFLNETWORK',
        logo: 'https://tmsimg.fancybits.co/assets/s45399_ll_h15_aa.png?w=360&h=270',
        name: 'NFL Network',
        stationId: '45399',
        tvgName: 'NFLHD',
        provider: 'nfl',
      },
      31: {
        checkChannelEnabled: () => checkChannelEnabled('nfl', 'NFLNRZ'),
        id: 'NFLNRZ',
        logo: 'https://tmsimg.fancybits.co/assets/s65025_ll_h9_aa.png?w=360&h=270',
        name: 'NFL RedZone',
        stationId: '65025',
        tvgName: 'NFLNRZD',
        provider: 'nfl',
      },
      32: {
        checkChannelEnabled: () => checkChannelEnabled('nfl', 'NFLDIGITAL1_OO_v3'),
        id: 'NFLDIGITAL1_OO_v3',
        logo: 'https://tmsimg.fancybits.co/assets/s121705_ll_h15_aa.png?w=360&h=270',
        name: 'NFL Channel',
        stationId: '121705',
        tvgName: 'NFLDC1',
        provider: 'nfl',
      },
      40: {
        checkChannelEnabled: () => checkChannelEnabled('mlbtv', 'MLBTVBI'),
        id: 'MLBTVBI',
        logo: 'https://tmsimg.fancybits.co/assets/s119153_ll_h15_aa.png?w=360&h=270',
        name: 'MLB Big Inning',
        stationId: '119153',
        tvgName: 'MLBTVBI',
        provider: 'mlbtv',
      },
      41: {
        checkChannelEnabled: () => checkChannelEnabled('mlbtv', 'MLBN'),
        id: 'MLBN',
        logo: 'https://tmsimg.fancybits.co/assets/s62079_ll_h15_aa.png?w=360&h=270',
        name: 'MLB Network',
        stationId: '62079',
        tvgName: 'MLBN',
        provider: 'mlbtv',
      },
      42: {
        checkChannelEnabled: () => checkChannelEnabled('mlbtv', 'SNY'),
        id: 'SNY',
        logo: 'https://tmsimg.fancybits.co/assets/s49603_ll_h9_aa.png?w=360&h=270',
        name: 'SportsNet New York',
        stationId: '49603',
        tvgName: 'SNY',
        provider: 'mlbtv',
      },
      43: {
        checkChannelEnabled: () => checkChannelEnabled('mlbtv', 'SNLA'),
        id: 'SNLA',
        logo: 'https://tmsimg.fancybits.co/assets/s87024_ll_h15_aa.png?w=360&h=270',
        name: 'Spectrum SportsNet LA HD',
        stationId: '87024',
        tvgName: 'SNLA',
        provider: 'mlbtv',
      },
      ...gothamHandler.getLinearChannels(),
      70: {
        checkChannelEnabled: async (): Promise<boolean> =>
          (await db.providers.findOneAsync<IProvider>({name: 'wsn'}))?.enabled,
        id: 'WSN',
        logo: 'https://tmsimg.fancybits.co/assets/s124636_ll_h15_aa.png?w=360&h=270',
        name: "Women's Sports Network",
        stationId: '124636',
        tvgName: 'WSN',
        provider: 'wsn',
      },
      80: {
        checkChannelEnabled: () => checkChannelEnabled('nwsl', 'NWSL+'),
        id: 'NWSL+',
        logo: 'https://img.dge-prod.dicelaboratory.com/original/2024/11/22101220-tgwkrv9kdmvdqo2o.png',
        name: 'NWSL+ 24/7',
        provider: 'nwsl',
      },
      90: {
        checkChannelEnabled: () => checkChannelEnabled('bally', 'STADIUM'),
        id: 'STADIUM',
        logo: 'https://tmsimg.fancybits.co/assets/s104950_ll_h15_aa.png?w=360&h=270',
        name: 'Stadium HD',
        stationId: '104950',
        tvgName: 'STADIUM',
        provider: 'bally',
      },
      91: {
        checkChannelEnabled: () => checkChannelEnabled('bally', 'MiLB'),
        id: 'MiLB',
        logo: 'https://assets-stratosphere.cdn.ballys.tv/images/MiLB_New_Logo_23.png',
        name: 'MiLB',
        provider: 'bally',
      },
      92: {
        checkChannelEnabled: () => checkChannelEnabled('bally', 'bananaball'),
        id: 'bananaball',
        logo: 'https://assets-stratosphere.cdn.ballys.tv/images/BananaBall_SB_01.png',
        name: 'Banana Ball',
        provider: 'bally',
      },
      93: {
        checkChannelEnabled: () => checkChannelEnabled('bally', 'ballypoker'),
        id: 'ballypoker',
        logo: 'https://assets-stratosphere.ballys.tv/images/BallyPoker_Channel_V3.png',
        name: 'Bally Poker',
        provider: 'bally',
      },
      94: {
        checkChannelEnabled: () => checkChannelEnabled('bally', 'GLORY'),
        id: 'GLORY',
        logo: 'https://tmsimg.fancybits.co/assets/s131359_ll_h9_aa.png?w=360&h=270',
        name: 'GLORY Kickboxing',
        stationId: '131359',
        tvgName: 'GLORY',
        provider: 'bally',
      },
      100: {
        checkChannelEnabled: () => checkChannelEnabled('outside', 'OTVSTR'),
        id: 'OTVSTR',
        logo: 'https://tmsimg.fancybits.co/assets/s114313_ll_h15_ab.png?w=360&h=270',
        name: 'Outside',
        stationId: '114313',
        tvgName: 'OTVSTR',
        provider: 'outside',
      },
      110: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX'),
        id: 'FOX',
        logo: 'https://tmsimg.fancybits.co/assets/s28719_ll_h15_ac.png?w=360&h=270',
        name: 'FOX',
        stationId: async() => (await getFoxOneChannelData()).foxStationId,
        tvgName: async () => `${(await getFoxOneChannelData()).foxCallSign}`,
        provider: 'foxone',
      },
      111: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'MNTV'),
        id: 'MNTV',
        logo: 'https://tmsimg.fancybits.co/assets/GNLZZGG0028Y3ZQ.png?w=360&h=270',
        name: 'MyNetwork TV',
        stationId: async () => (await getFoxOneChannelData()).mnStationId, // Dynamic stationId
        tvgName: async () => `${(await getFoxOneChannelData()).mnCallSign}`, // Dynamic callSign
        provider: 'foxone',
      },
      112: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FS1'),
        id: 'FS1',
        logo: 'https://tmsimg.fancybits.co/assets/s82547_ll_h15_aa.png?w=360&h=270',
        name: 'FS1',
        stationId: '82547',
        tvgName: 'FS1HD',
        provider: 'foxone',
      },
      113: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FS2'),
        id: 'FS2',
        logo: 'https://tmsimg.fancybits.co/assets/s59305_ll_h15_aa.png?w=360&h=270',
        name: 'FS2',
        stationId: '59305',
        tvgName: 'FS2HD',
        provider: 'foxone',
      },
      114: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'Big Ten Network'),
        id: 'Big Ten Network',
        logo: 'https://tmsimg.fancybits.co/assets/s58321_ll_h15_ac.png?w=360&h=270',
        name: 'B1G Network',
        stationId: '58321',
        tvgName: 'BIG10HD',
        provider: 'foxone',
      },
      115: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX Deportes'),
        id: 'FOX Deportes',
        logo: 'https://tmsimg.fancybits.co/assets/s15377_ll_h15_aa.png?w=360&h=270',
        name: 'FOX Deportes',
        stationId: '72189',
        tvgName: 'FXDEPHD',
        provider: 'foxone',
      }, 
        116: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX News'),
        id: 'FOX News',
        logo: 'https://tmsimg.fancybits.co/assets/s60179_ll_h15_ab.png?w=360&h=270',
        name: 'FOX News Channel',
        stationId: '60179',
        tvgName: 'FNCHD',
        provider: 'foxone',
      },
        117: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX Business'),
        id: 'FOX Business',
        logo: 'https://tmsimg.fancybits.co/assets/s58718_ll_h15_ac.png?w=360&h=270',
        name: 'FOX Business Network',
        stationId: '58718',
        tvgName: 'FBNHD',
        provider: 'foxone',
      },
        118: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'TMZ'),
        id: 'TMZ',
        logo: 'https://tmsimg.fancybits.co/assets/s149408_ll_h15_aa.png?w=360&h=270',
        name: 'TMZ',
        stationId: '149408',
        tvgName: 'TMZFAST',
        provider: 'foxone',
      },
      119: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX Digital'),
        id: 'FOX Digital',
        logo: 'https://tmsimg.fancybits.co/assets/GNLZZGG0027SNRC.png?w=360&h=270',
        name: 'Masked Singer',
        provider: 'foxone',
      }, 
      120: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX Soul'),
        id: 'FOX Soul',
        logo: 'https://tmsimg.fancybits.co/assets/s119212_ll_h15_aa.png?w=360&h=270',
        name: 'Fox Soul',
        stationId: '119212',
        tvgName: 'FOXSOUL',
        provider: 'foxone',
      },
      121: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX Weather'),
        id: 'FOX Weather',
        logo: 'https://tmsimg.fancybits.co/assets/GNLZZGG0029CYRH.png?w=360&h=270',
        name: 'Fox Weather',
        stationId: '121307',
        tvgName: 'FWX',
        provider: 'foxone',
      },
      122: {
        checkChannelEnabled: () => checkChannelEnabled('foxone', 'FOX LOCAL'),
        id: 'FOX LOCAL',
        logo: 'https://tmsimg.fancybits.co/assets/GNLZZGG0029CYRH.png?w=360&h=270',
        name: 'Fox Live Now',
        stationId: '119219',
        tvgName: 'LIVENOW',
        provider: 'foxone',
      },                     
    };
  },
};
/* eslint-enable sort-keys-custom-order-fix/sort-keys-custom-order-fix */

export const calculateChannelNumber = async (channelNum: string): Promise<number | string> => {
  const useLinear = await usesLinear();
  const linearStartChannel = await getLinearStartChannel();

  const chanNum = parseInt(channelNum, 10);

  if (!useLinear || chanNum < linearStartChannel) {
    return channelNum;
  }

  const linearChannel = CHANNELS.MAP[chanNum - linearStartChannel];

  if (linearChannel) {
    return linearChannel.id;
  }

  return channelNum;
};

export const calculateChannelFromName = async (channelName: string): Promise<number> => {
  const isNumber = Number.isFinite(parseInt(channelName, 10));

  if (isNumber) {
    return parseInt(channelName, 10);
  }

  const linearStartChannel = await getLinearStartChannel();

  let channelNum = Number.MAX_SAFE_INTEGER;

  _.forOwn(CHANNELS.MAP, (val, key) => {
    if (val.id === channelName) {
      channelNum = parseInt(key, 10) + linearStartChannel;
    }
  });

  return channelNum;
};

export const XMLTV_PADDING = process.env.XMLTV_PADDING?.toLowerCase() === 'false' ? false : true;
export interface Channel {
  stationId: () => Promise<string>;
  tvgName: () => Promise<string>;
}

