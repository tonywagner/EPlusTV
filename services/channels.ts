import _ from 'lodash';
import {
  useAccN,
  useCbsSportsHq,
  useEspn1,
  useEspn2,
  useEspnews,
  useEspnU,
  useFoxSports,
  useGolazo,
  useNflNetwork,
  useNflRedZone,
  useSec,
} from './networks';

let startChannel = _.toNumber(process.env.START_CHANNEL);
if (_.isNaN(startChannel)) {
  startChannel = 1;
}

let numOfChannels = _.toNumber(process.env.NUM_OF_CHANNELS);
if (_.isNaN(numOfChannels)) {
  numOfChannels = 200;
}

const nextStartChannel = (end: number, buffer: number): number => {
  const sum = end + buffer;

  // Round up to the next hundred
  let nextHundred = Math.ceil(sum / 100) * 100;

  // Check if the result is at least 50 more than X
  if (nextHundred - end < buffer) {
    nextHundred += 100;
  }

  return nextHundred;
};

export const START_CHANNEL = startChannel;
export const NUM_OF_CHANNELS = numOfChannels;

const BUFFER_CHANNELS = 50;
export const LINEAR_START_CHANNEL = nextStartChannel(startChannel + numOfChannels, BUFFER_CHANNELS);

export const useLinear = process.env.LINEAR_CHANNELS?.toLowerCase() === 'true' ? true : false;

/* eslint-disable sort-keys-custom-order-fix/sort-keys-custom-order-fix */
export const CHANNEL_MAP = {
  0: {
    canUse: useEspn1,
    id: 'espn1',
    logo: 'https://tmsimg.fancybits.co/assets/s32645_h3_aa.png?w=360&h=270',
    name: 'ESPN',
    stationId: '32645',
    tvgName: 'ESPNHD',
  },
  1: {
    canUse: useEspn2,
    id: 'espn2',
    logo: 'https://tmsimg.fancybits.co/assets/s45507_ll_h15_aa.png?w=360&h=270',
    name: 'ESPN2',
    stationId: '45507',
    tvgName: 'ESPN2HD',
  },
  2: {
    canUse: useEspnU,
    id: 'espnu',
    logo: 'https://tmsimg.fancybits.co/assets/s60696_ll_h15_aa.png?w=360&h=270',
    name: 'ESPNU',
    stationId: '60696',
    tvgName: 'ESPNUHD',
  },
  3: {
    canUse: useSec,
    id: 'sec',
    logo: 'https://tmsimg.fancybits.co/assets/s89714_ll_h15_aa.png?w=360&h=270',
    name: 'SEC Network',
    stationId: '89714',
    tvgName: 'SECH',
  },
  4: {
    canUse: useAccN,
    id: 'acc',
    logo: 'https://tmsimg.fancybits.co/assets/s111871_ll_h15_ac.png?w=360&h=270',
    name: 'ACC Network',
    stationId: '111871',
    tvgName: 'ACC',
  },
  5: {
    canUse: useEspnews,
    id: 'espnews',
    logo: 'https://tmsimg.fancybits.co/assets/s59976_ll_h15_aa.png?w=360&h=270',
    name: 'ESPNews',
    stationId: '59976',
    tvgName: 'ESPNWHD',
  },
  10: {
    canUse: useFoxSports,
    id: 'fs1',
    logo: 'https://tmsimg.fancybits.co/assets/s82547_ll_h15_aa.png?w=360&h=270',
    name: 'FS1',
    stationId: '82547',
    tvgName: 'FS1HD',
  },
  11: {
    canUse: useFoxSports,
    id: 'fs2',
    logo: 'https://tmsimg.fancybits.co/assets/s59305_ll_h15_aa.png?w=360&h=270',
    name: 'FS2',
    stationId: '59305',
    tvgName: 'FS2HD',
  },
  12: {
    canUse: useFoxSports,
    id: 'btn',
    logo: 'https://tmsimg.fancybits.co/assets/s58321_ll_h15_ac.png?w=360&h=270',
    name: 'B1G Network',
    stationId: '58321',
    tvgName: 'BIG10HD',
  },
  13: {
    canUse: useFoxSports,
    id: 'fox-soccer-plus',
    logo: 'https://tmsimg.fancybits.co/assets/s66880_ll_h15_aa.png?w=360&h=270',
    name: 'FOX Soccer Plus',
    stationId: '66880',
    tvgName: 'FSCPLHD',
  },
  20: {
    canUse: useCbsSportsHq,
    id: 'cbssportshq',
    logo: 'https://tmsimg.fancybits.co/assets/s108919_ll_h15_aa.png?w=360&h=270',
    name: 'CBS Sports HQ',
    stationId: '108919',
    tvgName: 'CBSSPHQ',
  },
  21: {
    canUse: useGolazo,
    id: 'golazo',
    logo: 'https://tmsimg.fancybits.co/assets/s133691_ll_h15_aa.png?w=360&h=270',
    name: 'GOLAZO Network',
    stationId: '133691',
    tvgName: 'GOLAZO',
  },
  30: {
    canUse: useNflNetwork,
    id: 'NFLNETWORK',
    logo: 'https://tmsimg.fancybits.co/assets/s45399_ll_h15_aa.png?w=360&h=270',
    name: 'NFL Network',
    stationId: '45399',
    tvgName: 'NFLHD',
  },
  31: {
    canUse: useNflRedZone,
    id: 'NFLNRZ',
    logo: 'https://tmsimg.fancybits.co/assets/s65025_ll_h9_aa.png?w=360&h=270',
    name: 'NFL RedZone',
    stationId: '65025',
    tvgName: 'NFLNRZD',
  },
};
/* eslint-enable sort-keys-custom-order-fix/sort-keys-custom-order-fix */

export const calculateChannelNumber = (channelNum: string): number | string => {
  const chanNum = parseInt(channelNum, 10);

  if (!useLinear || chanNum < LINEAR_START_CHANNEL) {
    return channelNum;
  }

  const linearChannel = CHANNEL_MAP[chanNum - LINEAR_START_CHANNEL];

  if (linearChannel) {
    return linearChannel.id;
  }

  return channelNum;
};

export const calculateChannelFromName = (channelName: string): number => {
  const isNumber = Number.isFinite(parseInt(channelName, 10));

  if (isNumber) {
    return parseInt(channelName, 10);
  }

  let channelNum = Number.MAX_SAFE_INTEGER;

  _.forOwn(CHANNEL_MAP, (val, key) => {
    if (val.id === channelName) {
      channelNum = parseInt(key, 10) + LINEAR_START_CHANNEL;
    }
  });

  return channelNum;
};
