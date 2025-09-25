import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import axios from 'axios';
import _ from 'lodash';
import moment from 'moment';

import {androidFoxOneUserAgent, userAgent} from './user-agent';
import {configPath} from './config';
import {useFoxOneOnly4k, useFoxOne} from './networks';
import {IAdobeAuthFoxOne} from './adobe-helpers';
import {getRandomHex, normalTimeRange} from './shared-helpers';
import {ClassTypeWithoutMethods, IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {usesLinear} from './misc-db-service';

interface IAppConfig {
  network: {
    identity: {
      host: string; // this is the base url -- need to slice the trailing '/' off
      entitlementsUrl: string; // was getentitlements -- may need to change
      regcodeUrl: string; // was accountRegCode
      registerUrl: string; // not sure if necessary yet
      checkAdobeUrl: string; //was checkadobeauthn
      refreshTokenUrl: string; // not sure if necessary yet
      loginUrl: string;
    };
    auth: {
      loginWebsiteUrl: string; // returns go.foxone.com -- DO NOT USE - should be go.fox.com
    };
    apikey: string; // was key
  };
  playback: {
    baseApiUrl: string; // was content.watch
    liveAssetInfoUrl: string; // not sure if necessary yet -- adds v3.0/assetinfo/ to baseApiUrl
  };
  // old API structure below -- comments above shoud be key to most
  // api: {
  //   content: {
  //     watch: string;
  //   };
  //   key: string;
  //   auth: {
  //     accountRegCode: string;
  //     checkadobeauthn: string;
  //     getentitlements: string;
  //   };
  //   profile: {
  //     login: string;
  //   };
  // };
  // auth: {
  //   displayActivationUrl: string;
  // };
}

interface IAdobePrelimAuthToken {
  accessToken: string;
  tokenExpiration: number;
  viewerId: string;
  deviceId: string;
  profileId: string;
}

interface IFoxOneEvent {
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
  stream_types: string[];
  images: {
    logo?: string;
    series_detail?: string;
    series_list?: string;
  };
  isUHD?: boolean;
}

interface IFoxOneEventsData {
  data: {
    listings: {
	    item_count: number;
      items: IFoxOneEvent[];
    };
  };
}

interface IFoxOneMeta {
  only4k?: boolean;
  uhd?: boolean;
  dtc_events?: boolean;
  local_station_call_signs?: string;
  hide_studio?: boolean;
}

const EPG_API_KEY = [
  'Y',
  '5',
  's',
  't',
  '1',
  'H',
  'o',
  'L',
  'L',
  'O',
  'J',
  'F',
  'l',
  'H',
  'S',
  't',
  'A',
  '3',
  'a',
  'l',
  'O',
  'L',
  't',
  'G',
  'J',
  'P',
  'S',
  '7',
  'D',
  'U',
  'x',
  'n',
].join('');

const network_entitlement_map = { fox: 'foxone', btn: 'btn-btn2go', 'fox-soccer-plus': 'fspl' };

const foxOneConfigPath = path.join(configPath, 'foxone_tokens.json');

const getMaxRes = (res: string) => {
  switch (res) {
    case 'UHD/HDR':
      return 'UHD/HDR';
    default:
      return '720p';
  }
};

const parseCategories = (event: IFoxOneEvent) => {
  const categories = ['FOX One', 'FOX'];
  for (const classifier of [...(event.tags || []), ...(event.genres || [])]) {
    if (classifier !== null) {
      categories.push(classifier);
    }
  }

  if (event.sport_uri) {
    categories.push(event.sport_uri);
  }

  if (event.stream_types?.find(resolution => resolution === 'HDR' || resolution === 'SDR') || event.isUHD) {
    categories.push('4K');
  }

  return [...new Set(categories)];
};

const parseAirings = async (events: IFoxOneEvent[]) => {
  const useLinear = await usesLinear();

  const [now, inTwoDays] = normalTimeRange();

  const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxOneMeta>>({name: 'foxone'});

  for (const event of events) {
    const entryExists = await db.entries.findOneAsync<IEntry>({id: `${event.entity_id.replace('_dtc', '')}`});

    if (!entryExists) {
      const start = moment(event.start_time);
      const end = moment(event.end_time);
      const originalEnd = moment(event.end_time);

      const isLinear = event.network && useLinear; // removed !== 'fox' from before &&

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

      const studio_regex = /Sports (Commentary|Highlights|Magazine|talk)/i;
      const isStudio = categories.find(item => item.match(studio_regex));
      if (!isLinear && meta?.hide_studio && isStudio) {
        continue;
      }

      const eventName = `${event.sport_uri === 'NFL' ? `${event.sport_uri} - ` : ''}${event.title}`;

      console.log('Adding event: ', eventName);

      await db.entries.insertAsync<IEntry>({
        categories,
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'foxone',
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

const FOXONE_APP_CONFIG = 'https://config.foxplus.com/androidtv/1.1/config/info.json';

// Will prelim token expire in the next month?
const willPrelimTokenExpire = (token: IAdobePrelimAuthToken): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 * 30 > (token?.tokenExpiration || 0);
// Will auth token expire in the next day?
const willAuthTokenExpire = (token: IAdobeAuthFoxOne): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 > (token?.tokenExpiration || 0);

const checkEventNetwork = (entitlements, event: IFoxOneEvent): boolean => {
  if ( event.network && (entitlements.includes(event.network) || (network_entitlement_map[event.network] && entitlements.includes(network_entitlement_map[event.network]))) ) {
    return true;
  }

  return false;
};

class FoxOneHandler {
  public adobe_device_id?: string;
  public adobe_prelim_auth_token?: IAdobePrelimAuthToken;
  public adobe_auth?: IAdobeAuthFoxOne;

  private entitlements: string[] = [];
  private appConfig: IAppConfig;

  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'foxone'})) > 0 ? true : false;

    if (!setup) {
      const data: TFoxOneTokens = {};

      if (useFoxOne) {
        this.loadJSON();

        data.adobe_auth = this.adobe_auth;
        data.adobe_device_id = this.adobe_device_id;
        data.adobe_prelim_auth_token = this.adobe_prelim_auth_token;
      }

      // see below for update/addition of Soccer Plus and Deportes linear channels
      await db.providers.insertAsync<IProvider<TFoxOneTokens, IFoxOneMeta>>({
        enabled: useFoxOne,
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
        ],
        meta: {
          only4k: useFoxOneOnly4k,
          uhd: getMaxRes(process.env.MAX_RESOLUTION) === 'UHD/HDR',
          local_station_call_signs: '',
          hide_studio: false,
        },
        name: 'foxone',
        tokens: data,
      });

      if (fs.existsSync(foxOneConfigPath)) {
        fs.rmSync(foxOneConfigPath);
      }
    }

    if (useFoxOne) {
      console.log('Using FOXONE variable is no longer needed. Please use the UI going forward');
    }
    if (useFoxOneOnly4k) {
      console.log('Using FOXONE_ONLY_4K variable is no longer needed. Please use the UI going forward');
    }
    if (process.env.MAX_RESOLUTION) {
      console.log('Using MAX_RESOLUTION variable is no longer needed. Please use the UI going forward');
    }

    const {enabled, meta, linear_channels} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});
	
    // update/add Soccer Plus and Deportes, if necessary
    if ( linear_channels.length <= 4 ) {
      linear_channels[3] = {
    	enabled: false,
        id: 'fox-soccer-plus',
        name: 'FOX Soccer Plus',
        tmsId: '66880',
      };
      linear_channels.push({
        enabled: true,
        id: 'foxdep',
        name: 'FOX Deportes',
        tmsId: '72189',
      });
      linear_channels.push({
        enabled: true,
        id: 'localfox',
        name: 'FOX',
//        tmsId: '72189',
      });
      linear_channels.push({
        enabled: true,
//        id: meta.local_station_call_signs[1],
        id: 'mynetwork',
        name: 'MyNetwork TV',
 //       tmsId: '72189',
      });
       linear_channels.push({
        enabled: true,
        id: 'fnc',
        name: 'FOX News',
        tmsId: '60179',
      });
       linear_channels.push({
        enabled: true,
        id: 'fbc',
        name: 'FOX Business',
        tmsId: '58718',
      });                 
      await db.providers.updateAsync<IProvider<TFoxOneTokens>, any>(
        {name: 'foxone'},
        {
          $set: {
            linear_channels: linear_channels,
          },
        },
      );
    }

    if (!enabled) {
      return;
    }

    if (!meta.dtc_events) {
      const events = await db.entries.findAsync({from: 'foxone', id: {$regex: /_dtc/}});

      for (const event of events) {
        await db.entries.updateAsync({from: 'foxone', id: event.id}, {$set: {id: event.id.replace('_dtc', '')}});
      }

      await db.providers.updateAsync({name: 'foxone'}, {$set: {meta: {...meta, dtc_events: true}}});
    }

    // Load tokens from local file and make sure they are valid
    await this.load();

    await this.getEntitlements();
  };

  public refreshTokens = async () => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});

    if (!enabled) {
      return;
    }

    if (!this.adobe_prelim_auth_token || willPrelimTokenExpire(this.adobe_prelim_auth_token)) {
      console.log('Updating FOX One prelim token');
      await this.getPrelimToken();
    }

    if (willAuthTokenExpire(this.adobe_auth)) {
      console.log('Refreshing TV Provider token (FOX One)');
      await this.authenticateRegCode();
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});

    if (!enabled) {
      return;
    }

    console.log('Looking for FOX One events...');

    try {
      const entries = await this.getEvents();
      await parseAirings(entries);
    } catch (e) {
      console.error(e);
      console.log('Could not parse FOX One events');
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
          'User-Agent': androidFoxOneUserAgent,
          'x-api-key': `${this.fixedHost}${this.appConfig.network.apikey}`,
        },
      });

      if (!streamData.playURL) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      return [
        streamData.playURL,
        {
          'User-Agent': androidFoxOneUserAgent,
        },
      ];
    } catch (e) {
      console.error(e);
      console.log('Could not get stream information!');
    }
  };

  private getSteamData = async (eventId: string): Promise<any> => {
    const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxOneMeta>>({name: 'foxone'});
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
            osv: '12.0.0',
            streamId: eventId.replace('_dtc', ''),
            streamType: 'live',
          },
          {
            headers: {
              'User-Agent': androidFoxOneUserAgent,
              authorization: this.adobe_auth.accessToken,
              'x-api-key': `${this.fixedHost}${this.appConfig.network.apikey}`,
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

  private getEvents = async (): Promise<IFoxOneEvent[]> => {
    if (!this.appConfig) {
      await this.getAppConfig();
    }

    // get local station call sign
    let local_station_call_signs_parameter = '';
    try {
      const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxOneMeta>>({name: 'foxone'});
      if ( !meta.local_station_call_signs || (meta.local_station_call_signs == '') ) {
        console.log('FOX One detecting local FOX call sign to pull flagship events');
        let local_station_call_signs = 'none';
        const {data} = await axios.get(
          'https://ent.fox.com/locator/v1/location',
          {
            headers: {
              'User-Agent': userAgent,
              'x-api-key': EPG_API_KEY,
            },
          },
        );

        if ( data.data.results[0].local_station_call_signs ) {
          local_station_call_signs = data.data.results[0].local_station_call_signs;
          console.log('FOX One found local FOX call sign ' + local_station_call_signs);
          local_station_call_signs_parameter = '%2C' +  local_station_call_signs;
        } else {
          console.log('FOX One could not find a local FOX call sign');
        }
        await db.providers.updateAsync({name: 'foxone'}, {$set: {'meta.local_station_call_signs': local_station_call_signs}});
      } else if ( (meta.local_station_call_signs != 'none') ) {
        local_station_call_signs_parameter = '%2C' +  meta.local_station_call_signs;
      }
    } catch (e) {
      console.log(e);
    }

    const useLinear = await usesLinear();

    const events: IFoxOneEvent[] = [];

    const [now, inTwoDays] = normalTimeRange();

    const startTime = now.unix();
    const endTime = inTwoDays.unix();

    try {
      let max_items_per_page = 50;
      let pages = 1;

      for (let page = 1; page <= pages; page++) {
        const {data} = await axios.get<IFoxOneEventsData>(
          `https://api.fox.com/fs/product/curated/v1/sporting/keystone/detail/by_filters?callsign=BTN%2CBTN-DIGITAL%2CFOX%2CFOX-DIGITAL%2CFOXDEP%2CFOXDEP-DIGITAL%2CFS1%2CFS1-DIGITAL%2CFS2%2CFS2-DIGITAL%2CFSP${local_station_call_signs_parameter}&end_date=${endTime}&page=${page}&size=${max_items_per_page}&start_date=${startTime}&video_type=listing`,
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

        debug.saveRequestData(data, 'foxone', 'epg');

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
      const {data} = await axios.get<IAppConfig>(FOXONE_APP_CONFIG);
      this.appConfig = data;
    } catch (e) {
      console.error(e);
      console.log('Could not load API app config');
    }
  };

  private fixedHost: string;


  private async getAppConfigAndFixHost(): Promise<void> {
    await this.getAppConfig();
    if (this.appConfig?.network?.identity?.host) {
      this.fixedHost = this.appConfig.network.identity.host.slice(0, -1);
    } else {
      throw new Error("App config or identity host is not available.");
    }
  }

  private getEntitlements = async (): Promise<void> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      const {data} = await axios.get<any>(
        `${this.fixedHost}${this.appConfig.network.identity.entitlementsUrl}?device_type=&device_id=${this.adobe_device_id}&resource=&requestor=`,
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            authorization: this.adobe_auth.accessToken,
            'x-api-key': `${this.fixedHost}${this.appConfig.network.apikey}`,
          },
        },
      );

      this.entitlements = [];
      _.forOwn(data.entitlements, (_val, key) => {
        if (/^[a-z]/.test(key)) {
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
        `${this.fixedHost}${this.appConfig.network.identity.loginUrl}`,
        {
          deviceId: this.adobe_device_id,
        },
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            'x-api-key': `${this.fixedHost}${this.appConfig.network.apikey}`,
            'x-signature-enabled': true,
          },
        },
      );

      this.adobe_prelim_auth_token = data;
      await this.save();
    } catch (e) {
      console.error(e);
      console.log('Could not get information to start Fox One login flow');
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
       `${this.fixedHost}${this.appConfig.network.identity.regcodeUrl}`,
        {
          deviceID: this.adobe_device_id,
          isMvpd: true,
          selectedMvpdId: '',
        },
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-api-key': `${this.fixedHost}${this.appConfig.network.apikey}`,
          },
        },
      );
      console.log(data.code)
      console.log(this.adobe_prelim_auth_token.accessToken)
      console.log(`${this.fixedHost}${this.appConfig.network.apikey}`)
      return data.code;
    } catch (e) {
      console.error(e);
      console.log('Could not start the authentication process for Fox One!');
    }
  };

  public authenticateRegCode = async (showAuthnError = true): Promise<boolean> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      const {data} = await axios.get(`${this.fixedHost}${this.appConfig.network.identity.checkAdobeUrl}?device_id=${this.adobe_device_id}`, {
        headers: {
          'User-Agent': androidFoxOneUserAgent,
          authorization: !this.adobe_auth?.accessToken
            ? `Bearer ${this.adobe_prelim_auth_token.accessToken}`
            : this.adobe_auth.accessToken,
          'x-api-key': `${this.fixedHost}${this.appConfig.network.apikey}`,
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
            console.log('Adobe AuthN token has expired for FOX One');
          }
        } else if (e.response?.status !== 410) {
          console.error(e);
          console.log('Could not get provider token data for Fox One!');
        }
      }

      return false;
    }
  };

  private save = async () => {
    await db.providers.updateAsync({name: 'foxone'}, {$set: {tokens: _.omit(this, 'appConfig', 'entitlements')}});
  };

  private load = async (): Promise<void> => {
    const {tokens} = await db.providers.findOneAsync<IProvider<TFoxOneTokens>>({name: 'foxone'});
    const {adobe_device_id, adobe_auth, adobe_prelim_auth_token} = tokens;

    this.adobe_device_id = adobe_device_id;
    this.adobe_auth = adobe_auth;
    this.adobe_prelim_auth_token = adobe_prelim_auth_token;
  };

  private loadJSON = () => {
    if (fs.existsSync(foxOneConfigPath)) {
      const {adobe_device_id, adobe_auth, adobe_prelim_auth_token} = fsExtra.readJSONSync(foxOneConfigPath);

      this.adobe_device_id = adobe_device_id;
      this.adobe_auth = adobe_auth;
      this.adobe_prelim_auth_token = adobe_prelim_auth_token;
    }
  };
}

export type TFoxOneTokens = ClassTypeWithoutMethods<FoxOneHandler>;

export const foxOneHandler = new FoxOneHandler();