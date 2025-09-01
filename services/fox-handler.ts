import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import axios from 'axios';
import _ from 'lodash';
import moment from 'moment';

import {androidFoxUserAgent, userAgent} from './user-agent';
import {configPath} from './config';
import {useFoxOnly4k, useFoxSports} from './networks';
import {IAdobeAuthFox} from './adobe-helpers';
import {getRandomHex, normalTimeRange} from './shared-helpers';
import {ClassTypeWithoutMethods, IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {usesLinear} from './misc-db-service';

interface IAppConfig {
  api: {
    content: {
      watch: string;
    };
    key: string;
    auth: {
      accountRegCode: string;
      checkadobeauthn: string;
      getentitlements: string;
    };
    profile: {
      login: string;
    };
  };
  auth: {
    displayActivationUrl: string;
  };
}

interface IAdobePrelimAuthToken {
  accessToken: string;
  tokenExpiration: number;
  viewerId: string;
  deviceId: string;
  profileId: string;
}

interface IFoxEvent {
  airing_type: string;
  audio_only: boolean;
  call_sign: string;
  tags: string[];
  entity_id: string;
  genres: string[];
  title: string;
  description: string;
  sport_uri?: string;
  start_time: string;
  end_time: string;
  network: string;
  streamTypes: string[];
  images: {
    logo?: string;
    series_detail?: string;
    series_list?: string;
  };
  isUHD?: boolean;
}

interface IFoxEventsData {
  data: {
    listings: {
	    item_count: number;
      items: IFoxEvent[];
    };
  };
}

interface IFoxMeta {
  only4k?: boolean;
  uhd?: boolean;
  dtc_events?: boolean;
  local_station_call_sign?: string;
}

const EPG_API_KEY = [
  'c',
  'f',
  '2',
  '8',
  '9',
  'e',
  '2',
  '9',
  '9',
  'e',
  'f',
  'd',
  'f',
  'a',
  '3',
  '9',
  'f',
  'b',
  '6',
  '3',
  '1',
  '6',
  'f',
  '2',
  '5',
  '9',
  'd',
  '1',
  'd',
  'e',
  '9',
  '3',
].join('');

const foxConfigPath = path.join(configPath, 'fox_tokens.json');

const getMaxRes = (res: string) => {
  switch (res) {
    case 'UHD/HDR':
      return 'UHD/HDR';
    default:
      return '720p';
  }
};

const parseCategories = (event: IFoxEvent) => {
  const categories = ['FOX Sports', 'FOX'];
  for (const classifier of [...(event.tags || []), ...(event.genres || [])]) {
    if (classifier !== null) {
      categories.push(classifier);
    }
  }

  if (event.sport_uri) {
    categories.push(event.sport_uri);
  }

  if (event.streamTypes?.find(resolution => resolution === 'HDR' || resolution === 'SDR') || event.isUHD) {
    categories.push('4K');
  }

  return [...new Set(categories)];
};

const parseAirings = async (events: IFoxEvent[]) => {
  const useLinear = await usesLinear();

  const [now, inTwoDays] = normalTimeRange();

  const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxMeta>>({name: 'foxsports'});

  for (const event of events) {
    const entryExists = await db.entries.findOneAsync<IEntry>({id: `${event.entity_id.replace('_dtc', '')}`});

    if (!entryExists) {
      const start = moment(event.start_time);
      const end = moment(event.end_time);
      const originalEnd = moment(event.end_time);

      const isLinear = event.network !== 'fox' && useLinear;

      if (!isLinear) {
        end.add(1, 'hour');
      }

      if (end.isBefore(now) || start.isAfter(inTwoDays)) {
        continue;
      }

      const categories = parseCategories(event);

      if (meta.only4k && !_.some(categories, category => category === '4K')) {
        continue;
      }

      const eventName = `${event.sport_uri === 'NFL' ? `${event.sport_uri} - ` : ''}${event.title}`;

      console.log('Adding event: ', eventName);

      await db.entries.insertAsync<IEntry>({
        categories,
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'foxsports',
        id: event.entity_id.replace('_dtc', ''),
        image: event.images.logo || event.images.series_detail || event.images.series_list,
        name: eventName,
        network: event.call_sign,
        originalEnd: originalEnd.valueOf(),
        replay: event.airing_type !== 'live',
        start: start.valueOf(),
        ...(isLinear && {
          channel: event.network,
          linear: true,
        }),
      });
    }
  }
};

const FOX_APP_CONFIG = 'https://config.foxdcg.com/foxsports/androidtv-native/3.42/info.json';

// Will prelim token expire in the next month?
const willPrelimTokenExpire = (token: IAdobePrelimAuthToken): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 * 30 > (token?.tokenExpiration || 0);
// Will auth token expire in the next day?
const willAuthTokenExpire = (token: IAdobeAuthFox): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 > (token?.tokenExpiration || 0);

const checkEventNetwork = (entitlements, event: IFoxEvent): boolean => {
  if (event.network) {
	  for (let i=0; i<entitlements.length; i++) {
	    if ( (entitlements[i].split('-')[0] == event.network) || ((event.network == 'fox') && entitlements.includes('foxSports')) ) {
	      return true;
	    }
	  }
  }

  return false;
};

class FoxHandler {
  public adobe_device_id?: string;
  public adobe_prelim_auth_token?: IAdobePrelimAuthToken;
  public adobe_auth?: IAdobeAuthFox;

  private entitlements: string[] = [];
  private appConfig: IAppConfig;

  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'foxsports'})) > 0 ? true : false;

    if (!setup) {
      const data: TFoxTokens = {};

      if (useFoxSports) {
        this.loadJSON();

        data.adobe_auth = this.adobe_auth;
        data.adobe_device_id = this.adobe_device_id;
        data.adobe_prelim_auth_token = this.adobe_prelim_auth_token;
      }

      await db.providers.insertAsync<IProvider<TFoxTokens, IFoxMeta>>({
        enabled: useFoxSports,
        linear_channels: [
          {
            enabled: true,
            id: 'fs1',
            name: 'FS1',
            tmsId: '82547',
          },
          {
            enabled: true,
            id: 'fs2',
            name: 'FS2',
            tmsId: '59305',
          },
          {
            enabled: true,
            id: 'btn',
            name: 'B1G Network',
            tmsId: '58321',
          },
          {
            enabled: true,
            id: 'fox-soccer-plus',
            name: 'FOX Soccer Plus',
            tmsId: '66880',
          },
        ],
        meta: {
          only4k: useFoxOnly4k,
          uhd: getMaxRes(process.env.MAX_RESOLUTION) === 'UHD/HDR',
          local_station_call_sign: '',
        },
        name: 'foxsports',
        tokens: data,
      });

      if (fs.existsSync(foxConfigPath)) {
        fs.rmSync(foxConfigPath);
      }
    }

    if (useFoxSports) {
      console.log('Using FOXSPORTS variable is no longer needed. Please use the UI going forward');
    }
    if (useFoxOnly4k) {
      console.log('Using FOX_ONLY_4K variable is no longer needed. Please use the UI going forward');
    }
    if (process.env.MAX_RESOLUTION) {
      console.log('Using MAX_RESOLUTION variable is no longer needed. Please use the UI going forward');
    }

    const {enabled, meta} = await db.providers.findOneAsync<IProvider<TFoxTokens, IFoxMeta>>({name: 'foxsports'});

    if (!enabled) {
      return;
    }

    if (!meta.dtc_events) {
      const events = await db.entries.findAsync({from: 'foxsports', id: {$regex: /_dtc/}});

      for (const event of events) {
        await db.entries.updateAsync({from: 'foxsports', id: event.id}, {$set: {id: event.id.replace('_dtc', '')}});
      }

      await db.providers.updateAsync({name: 'foxsports'}, {$set: {meta: {...meta, dtc_events: true}}});
    }

    // Load tokens from local file and make sure they are valid
    await this.load();

    await this.getEntitlements();
  };

  public refreshTokens = async () => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'foxsports'});

    if (!enabled) {
      return;
    }

    if (!this.adobe_prelim_auth_token || willPrelimTokenExpire(this.adobe_prelim_auth_token)) {
      console.log('Updating FOX Sports prelim token');
      await this.getPrelimToken();
    }

    if (willAuthTokenExpire(this.adobe_auth)) {
      console.log('Refreshing TV Provider token (FOX Sports)');
      await this.authenticateRegCode();
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'foxsports'});

    if (!enabled) {
      return;
    }

    console.log('Looking for FOX Sports events...');

    try {
      const entries = await this.getEvents();
      await parseAirings(entries);
    } catch (e) {
      console.error(e);
      console.log('Could not parse FOX Sports events');
    }
  };

  public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      let cdn = 'fastly';
      let data;

      // while (cdn !== 'akamai|limelight|fastly') {
      while (cdn === 'fastly') {
        data = await this.getSteamData(eventId);
        cdn = data.trackingData.properties.CDN;
      }

      if (!data || !data?.url) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      const {data: streamData} = await axios.get(data.url, {
        headers: {
          'User-Agent': androidFoxUserAgent,
          'x-api-key': this.appConfig.api.key,
        },
      });

      if (!streamData.playURL) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      return [
        streamData.playURL,
        {
          'User-Agent': androidFoxUserAgent,
        },
      ];
    } catch (e) {
      console.error(e);
      console.log('Could not get stream information!');
    }
  };

  private getSteamData = async (eventId: string): Promise<any> => {
    const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxMeta>>({name: 'foxsports'});
    const {uhd} = meta;

    const streamOrder = ['UHD/HDR', '720p'];

    let resIndex = streamOrder.findIndex(i => i === getMaxRes(uhd ? 'UHD/HDR' : ''));

    if (resIndex < 0) {
      resIndex = 1;
    }

    if (!this.appConfig) {
      await this.getAppConfig();
    }

    let watchData;

    for (let a = resIndex; a < streamOrder.length; a++) {
      try {
        const {data} = await axios.post(
          'https://prod.api.video.fox/v2.0/watch',
          {
            capabilities: ['fsdk/yo/v3'],
            deviceHeight: 2160,
            deviceWidth: 3840,
            maxRes: streamOrder[a],
            os: 'Android',
            osv: '11.0.0',
            streamId: eventId.replace('_dtc', ''),
            streamType: 'live',
          },
          {
            headers: {
              'User-Agent': androidFoxUserAgent,
              authorization: this.adobe_auth.accessToken,
              'x-api-key': this.appConfig.api.key,
            },
          },
        );

        watchData = data;
        break;
      } catch (e) {
        console.log(
          `Could not get stream data for ${streamOrder[a]}. ${
            streamOrder[a + 1] ? `Trying to get ${streamOrder[a + 1]} next...` : ''
          }`,
        );
      }
    }

    return watchData;
  };

  private getEvents = async (): Promise<IFoxEvent[]> => {
    if (!this.appConfig) {
      await this.getAppConfig();
    }

    // get local station call sign
    let local_station_call_sign_parameter = '';
    try {
      const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxMeta>>({name: 'foxsports'});
      if ( !meta.local_station_call_sign || (meta.local_station_call_sign == '') ) {
        console.log('Fetching local FOX station call sign');
        let local_station_call_sign = 'none';
        const {data} = await axios.get(
          'https://api-sps.foxsports.com/locator/v1/location',
          {
            headers: {
              'User-Agent': userAgent,
              'x-api-key': EPG_API_KEY,
            },
          },
        );

        if ( data.data.results[0].local_station_call_sign ) {
          local_station_call_sign = data.data.results[0].local_station_call_sign;
          console.log('Found local FOX station call sign ' + local_station_call_sign);
          local_station_call_sign_parameter = '%2C' +  local_station_call_sign;
        } else {
          console.log('No local FOX station call sign found');
        }
        await db.providers.updateAsync({name: 'foxsports'}, {$set: {'meta.local_station_call_sign': local_station_call_sign}});
      } else if ( (meta.local_station_call_sign != 'none') ) {
        local_station_call_sign_parameter = '%2C' +  meta.local_station_call_sign;
      }
    } catch (e) {
      console.log(e);
    }

    const useLinear = await usesLinear();

    const events: IFoxEvent[] = [];

    const [now, inTwoDays] = normalTimeRange();

    const startTime = now.unix();
    const endTime = inTwoDays.unix();

    try {
      let max_items_per_page = 50;
      let pages = 1;

      for (let page = 1; page <= pages; page++) {
        const {data} = await axios.get<IFoxEventsData>(
          `https://api.fox.com/fs/product/curated/v1/sporting/keystone/detail/by_filters?callsign=BTN%2CBTN-DIGITAL%2CFOX%2CFOX-DIGITAL%2CFOXDEP%2CFOXDEP-DIGITAL%2CFS1%2CFS1-DIGITAL%2CFS2%2CFS2-DIGITAL%2CFSP${local_station_call_sign_parameter}&end_date=${endTime}&page=${page}&size=${max_items_per_page}&start_date=${startTime}&video_type=listing`,
          {
            headers: {
              'User-Agent': userAgent,
              authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
              'x-fox-apikey': EPG_API_KEY,
            },
          },
        );

        if ( data.data.listings.item_count ) {
          pages = Math.ceil(data.data.listings.item_count / max_items_per_page);
        }

        debug.saveRequestData(data, 'foxsports', 'epg');

        _.forEach(data.data.listings.items, m => {
          if (
            checkEventNetwork(this.entitlements, m) &&
            !m.audio_only &&
            m.start_time &&
            m.end_time &&
            m.entity_id
          ) {
            if (!useLinear) {
              if (m.airing_type === 'live' || m.airing_type === 'new') {
                events.push(m);
              }
            } else {
              events.push(m);
            }
          }
        });
      }
    } catch (e) {
      console.log(e);
    }

    return events;
  };

  private getAppConfig = async () => {
    try {
      const {data} = await axios.get<IAppConfig>(FOX_APP_CONFIG);
      this.appConfig = data;
    } catch (e) {
      console.error(e);
      console.log('Could not load API app config');
    }
  };

  private getEntitlements = async (): Promise<void> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      const {data} = await axios.get<any>(
        `${this.appConfig.api.auth.getentitlements}?device_type=&device_id=${this.adobe_device_id}&resource=&requestor=`,
        {
          headers: {
            'User-Agent': androidFoxUserAgent,
            authorization: this.adobe_auth.accessToken,
            'x-api-key': this.appConfig.api.key,
          },
        },
      );

      this.entitlements = [];

      _.forOwn(data.entitlements, (_val, key) => {
        if (/^[a-z]/.test(key) && key !== 'foxdep') {
          this.entitlements.push(key);
        }
      });
    } catch (e) {
      console.error(e);
    }
  };

  private getPrelimToken = async (): Promise<void> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      const {data} = await axios.post<IAdobePrelimAuthToken>(
        this.appConfig.api.profile.login,
        {
          deviceId: this.adobe_device_id,
        },
        {
          headers: {
            'User-Agent': androidFoxUserAgent,
            'x-api-key': this.appConfig.api.key,
            'x-signature-enabled': true,
          },
        },
      );

      this.adobe_prelim_auth_token = data;
      await this.save();
    } catch (e) {
      console.error(e);
      console.log('Could not get information to start Fox Sports login flow');
    }
  };

  public getAuthCode = async (): Promise<string> => {
    this.adobe_device_id = _.take(getRandomHex(), 16).join('');
    this.adobe_auth = undefined;

    if (!this.appConfig) {
      await this.getAppConfig();
    }

    await this.getPrelimToken();

    try {
      const {data} = await axios.post(
        this.appConfig.api.auth.accountRegCode,
        {
          deviceID: this.adobe_device_id,
          isMvpd: true,
          selectedMvpdId: '',
        },
        {
          headers: {
            'User-Agent': androidFoxUserAgent,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-api-key': this.appConfig.api.key,
          },
        },
      );

      return data.code;
    } catch (e) {
      console.error(e);
      console.log('Could not start the authentication process for Fox Sports!');
    }
  };

  public authenticateRegCode = async (showAuthnError = true): Promise<boolean> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      const {data} = await axios.get(`${this.appConfig.api.auth.checkadobeauthn}?device_id=${this.adobe_device_id}`, {
        headers: {
          'User-Agent': androidFoxUserAgent,
          authorization: !this.adobe_auth?.accessToken
            ? `Bearer ${this.adobe_prelim_auth_token.accessToken}`
            : this.adobe_auth.accessToken,
          'x-api-key': this.appConfig.api.key,
          'x-signature-enabled': true,
        },
      });

      this.adobe_auth = data;
      await this.save();

      await this.getEntitlements();

      return true;
    } catch (e) {
      if (e.response?.status !== 404) {
        if (showAuthnError) {
          if (e.response?.status === 410) {
            console.error(e);
            console.log('Adobe AuthN token has expired for FOX Sports');
          }
        } else if (e.response?.status !== 410) {
          console.error(e);
          console.log('Could not get provider token data for Fox Sports!');
        }
      }

      return false;
    }
  };

  private save = async () => {
    await db.providers.updateAsync({name: 'foxsports'}, {$set: {tokens: _.omit(this, 'appConfig', 'entitlements')}});
  };

  private load = async (): Promise<void> => {
    const {tokens} = await db.providers.findOneAsync<IProvider<TFoxTokens>>({name: 'foxsports'});
    const {adobe_device_id, adobe_auth, adobe_prelim_auth_token} = tokens;

    this.adobe_device_id = adobe_device_id;
    this.adobe_auth = adobe_auth;
    this.adobe_prelim_auth_token = adobe_prelim_auth_token;
  };

  private loadJSON = () => {
    if (fs.existsSync(foxConfigPath)) {
      const {adobe_device_id, adobe_auth, adobe_prelim_auth_token} = fsExtra.readJSONSync(foxConfigPath);

      this.adobe_device_id = adobe_device_id;
      this.adobe_auth = adobe_auth;
      this.adobe_prelim_auth_token = adobe_prelim_auth_token;
    }
  };
}

export type TFoxTokens = ClassTypeWithoutMethods<FoxHandler>;

export const foxHandler = new FoxHandler();
